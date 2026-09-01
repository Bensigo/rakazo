import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  ComputerFileEntry,
  HostDiskProvider,
  PortableFile,
} from "@rakazo/adapter-kit";
import { isAllowedDesktopPath } from "./desktop-sandbox-paths.js";
import {
  type HostDiskSettings,
  hostDiskAccessAllowed,
  loadHostDiskSettings,
} from "./host-disk-settings.js";

export type LocalHostDiskOptions = {
  dataDir: string;
  /** Override settings lookup (tests). */
  loadSettings?: (userId: string) => Promise<HostDiskSettings>;
  /** When true, skip the client heartbeat check (local same-process tests). */
  ignoreClientHeartbeat?: boolean;
};

/**
 * Reads and writes the machine that runs this process, limited to granted roots.
 * Used in tests and when the API/worker share the user's host filesystem.
 * Never invents Documents/Desktop roots; the user must grant folders explicitly.
 */
export class LocalHostDiskProvider implements HostDiskProvider {
  constructor(private readonly options: LocalHostDiskOptions) {}

  describe() {
    return {
      id: "local-host-disk",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { list: true, read: true, write: true },
    };
  }

  async isAvailable(userId: string): Promise<boolean> {
    const settings = await this.settingsFor(userId);
    if (this.options.ignoreClientHeartbeat) {
      return settings.enabled && settings.roots.length > 0;
    }
    return hostDiskAccessAllowed(settings);
  }

  async listFiles(
    userId: string,
    requestPath: string,
    _context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    const roots = await this.requireRoots(userId);
    const trimmed = requestPath.trim();
    if (!trimmed) {
      return roots.map((root) => ({
        path: root,
        kind: "dir" as const,
        size: 0,
      }));
    }
    const target = this.resolveAllowed(trimmed, roots);
    const entries = await readdir(target, { withFileTypes: true });
    const listed: ComputerFileEntry[] = [];
    for (const entry of entries) {
      const full = path.join(target, entry.name);
      if (!isAllowedDesktopPath(full, roots)) continue;
      if (entry.isDirectory()) {
        listed.push({ path: full, kind: "dir", size: 0 });
        continue;
      }
      if (entry.isFile()) {
        const info = await stat(full);
        listed.push({ path: full, kind: "file", size: info.size });
      }
    }
    return listed.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readFile(
    userId: string,
    requestPath: string,
    _context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    const roots = await this.requireRoots(userId);
    const target = this.resolveAllowed(requestPath, roots);
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Host path is not a file");
    if (options?.maxBytes !== undefined && info.size > options.maxBytes) {
      throw new Error(`file exceeds ${options.maxBytes} bytes`);
    }
    return new Uint8Array(await readFile(target));
  }

  async writeFile(userId: string, file: PortableFile, _context: AdapterContext): Promise<void> {
    const roots = await this.requireRoots(userId);
    const target = this.resolveAllowed(file.path, roots);
    await mkdir(path.dirname(target), { recursive: true });
    // Re-check after resolving parent creation targets.
    if (!isAllowedDesktopPath(target, roots)) {
      throw new Error("Host path is outside the granted folders");
    }
    await writeFile(target, file.content);
  }

  private async settingsFor(userId: string) {
    if (this.options.loadSettings) return this.options.loadSettings(userId);
    return loadHostDiskSettings(this.options.dataDir, userId);
  }

  private async requireRoots(userId: string) {
    const settings = await this.settingsFor(userId);
    const allowed = this.options.ignoreClientHeartbeat
      ? settings.enabled && settings.roots.length > 0
      : hostDiskAccessAllowed(settings);
    if (!allowed) {
      throw new Error(
        "Host disk access is off. Opt in from the Mac or phone app and grant a folder.",
      );
    }
    return settings.roots.map((root) => path.resolve(root));
  }

  private resolveAllowed(requestPath: string, roots: string[]) {
    const resolved = path.resolve(requestPath);
    if (!isAllowedDesktopPath(resolved, roots)) {
      throw new Error("Host path is outside the granted folders");
    }
    return resolved;
  }
}
