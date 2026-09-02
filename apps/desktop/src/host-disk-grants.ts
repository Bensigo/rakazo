import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Main-process grant set with load/revoke serialization so a revoke cannot be
 * resurrected by a late grants-file load.
 */
export type HostDiskGrantStore = {
  /** Resolves when the initial load has finished. Handlers must await this. */
  readonly ready: Promise<void>;
  list(): string[];
  add(root: string): Promise<string>;
  revoke(root: string): Promise<boolean>;
  hasGrantCovering(target: string): boolean;
};

export type HostDiskGrantStoreOptions = {
  grantsFilePath: string;
  /** Start loading immediately (default true). */
  autoload?: boolean;
};

export function createHostDiskGrantStore(options: HostDiskGrantStoreOptions): HostDiskGrantStore {
  const grantedRoots = new Set<string>();
  /** Paths revoked before or during load; load must not re-add them. */
  const revokedRoots = new Set<string>();
  let ready = Promise.resolve();

  async function save() {
    await mkdir(path.dirname(options.grantsFilePath), { recursive: true });
    await writeFile(
      options.grantsFilePath,
      `${JSON.stringify(
        [...grantedRoots].sort((a, b) => a.localeCompare(b)),
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  async function load() {
    try {
      const raw = JSON.parse(await readFile(options.grantsFilePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        if (typeof item !== "string" || item.length === 0) continue;
        const resolved = path.resolve(item);
        if (revokedRoots.has(resolved)) continue;
        try {
          if (revokedRoots.has(await realpath(resolved))) continue;
        } catch {
          // Keep lexical form when the path is missing.
        }
        // Re-check after awaits so a revoke that landed mid-load still wins.
        if (revokedRoots.has(resolved)) continue;
        grantedRoots.add(resolved);
      }
    } catch {
      // First run or unreadable file: empty grant set.
    }
  }

  async function rememberRevoked(root: string) {
    const resolved = path.resolve(root);
    revokedRoots.add(resolved);
    try {
      revokedRoots.add(await realpath(resolved));
    } catch {
      // Path may already be gone.
    }
  }

  if (options.autoload !== false) {
    ready = load();
  }

  return {
    get ready() {
      return ready;
    },
    list() {
      return [...grantedRoots].sort((left, right) => left.localeCompare(right));
    },
    async add(root: string) {
      await ready;
      const resolved = await realpath(path.resolve(root));
      revokedRoots.delete(resolved);
      grantedRoots.add(resolved);
      await save();
      return resolved;
    },
    async revoke(root: string) {
      // Record intent before waiting on load so a concurrent load cannot revive it.
      await rememberRevoked(root);
      await ready;
      const resolved = path.resolve(root);
      let removed = grantedRoots.delete(resolved);
      try {
        removed = grantedRoots.delete(await realpath(resolved)) || removed;
      } catch {
        // Root may already be gone from disk.
      }
      // Always persist after revoke so a no-op in-memory miss still clears disk.
      await save();
      // True when we dropped it from memory, or blocked a concurrent load from
      // resurrecting a root that had been on disk.
      return removed || revokedRoots.has(resolved);
    },
    hasGrantCovering(target: string) {
      const resolved = path.resolve(target);
      return [...grantedRoots].some((root) => {
        const relative = path.relative(path.resolve(root), resolved);
        return (
          relative === "" ||
          (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        );
      });
    },
  };
}
