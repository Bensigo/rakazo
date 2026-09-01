import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  ComputerFileEntry,
  HostDiskProvider,
  PortableFile,
} from "@rakazo/adapter-kit";
import { hostDiskAccessAllowed, loadHostDiskSettings } from "./host-disk-settings.js";
import { LocalHostDiskProvider } from "./local-host-disk.js";

export type HostDiskOperationKind = "list" | "read" | "write";

export type HostDiskOperation = {
  id: string;
  userId: string;
  kind: HostDiskOperationKind;
  path: string;
  /** Base64 payload for write requests and read results. */
  contentBase64?: string;
  maxBytes?: number;
  status: "pending" | "done" | "error";
  entries?: ComputerFileEntry[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type BridgingHostDiskOptions = {
  dataDir: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_POLL_MS = 200;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Queues host-disk work for a connected Mac/phone client. The API exposes claim
 * and complete RPCs; the desktop/mobile app performs FS I/O inside granted roots.
 */
export class BridgingHostDiskProvider implements HostDiskProvider {
  constructor(private readonly options: BridgingHostDiskOptions) {}

  describe() {
    return {
      id: "bridging-host-disk",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { list: true, read: true, write: true },
    };
  }

  async isAvailable(userId: string): Promise<boolean> {
    const settings = await loadHostDiskSettings(this.options.dataDir, userId);
    return hostDiskAccessAllowed(settings, this.options.now?.() ?? Date.now());
  }

  async listFiles(
    userId: string,
    requestPath: string,
    context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    const result = await this.runOperation(userId, { kind: "list", path: requestPath }, context);
    return result.entries ?? [];
  }

  async readFile(
    userId: string,
    requestPath: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    const result = await this.runOperation(
      userId,
      { kind: "read", path: requestPath, maxBytes: options?.maxBytes },
      context,
    );
    if (!result.contentBase64) throw new Error(result.error ?? "Host read returned no content");
    return Uint8Array.from(Buffer.from(result.contentBase64, "base64"));
  }

  async writeFile(userId: string, file: PortableFile, context: AdapterContext): Promise<void> {
    const result = await this.runOperation(
      userId,
      {
        kind: "write",
        path: file.path,
        contentBase64: Buffer.from(file.content).toString("base64"),
      },
      context,
    );
    if (result.status === "error") throw new Error(result.error ?? "Host write failed");
  }

  async claimNext(userId: string): Promise<HostDiskOperation | null> {
    return claimHostDiskOperation(this.options.dataDir, userId);
  }

  async complete(
    userId: string,
    input: {
      id: string;
      status: "done" | "error";
      entries?: ComputerFileEntry[];
      contentBase64?: string;
      error?: string;
    },
  ): Promise<HostDiskOperation> {
    return completeHostDiskOperation(this.options.dataDir, userId, input, this.options.now);
  }

  private async runOperation(
    userId: string,
    request: {
      kind: HostDiskOperationKind;
      path: string;
      contentBase64?: string;
      maxBytes?: number;
    },
    context: AdapterContext,
  ): Promise<HostDiskOperation> {
    if (!(await this.isAvailable(userId))) {
      throw new Error(
        "Host disk access is off. Opt in from the Mac or phone app and grant a folder.",
      );
    }
    const id = randomUUID();
    const now = new Date(this.options.now?.() ?? Date.now()).toISOString();
    const operation: HostDiskOperation = {
      id,
      userId,
      kind: request.kind,
      path: request.path,
      contentBase64: request.contentBase64,
      maxBytes: request.maxBytes,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    const file = operationPath(this.options.dataDir, userId, id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(operation, null, 2)}\n`, "utf8");

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollMs = this.options.pollIntervalMs ?? DEFAULT_POLL_MS;
    const sleep =
      this.options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const started = this.options.now?.() ?? Date.now();

    while ((this.options.now?.() ?? Date.now()) - started < timeoutMs) {
      if (context.signal.aborted) throw new Error("Host disk operation aborted");
      const current = await readOperationFile(file);
      if (current && current.status !== "pending") {
        if (current.status === "error") {
          throw new Error(current.error ?? "Host disk operation failed");
        }
        void unlink(file).catch(() => undefined);
        return current;
      }
      await sleep(pollMs);
    }
    await this.complete(userId, {
      id,
      status: "error",
      error: "Timed out waiting for the Mac or phone app to handle host disk access",
    }).catch(() => undefined);
    throw new Error("Timed out waiting for the Mac or phone app to handle host disk access");
  }
}

function operationsDir(dataDir: string, userId: string) {
  return path.join(dataDir, "host-disk", "operations", userId);
}

function operationPath(dataDir: string, userId: string, id: string) {
  return path.join(operationsDir(dataDir, userId), `${id}.json`);
}

async function readOperationFile(file: string): Promise<HostDiskOperation | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as HostDiskOperation;
  } catch {
    return null;
  }
}

export async function claimHostDiskOperation(
  dataDir: string,
  userId: string,
): Promise<HostDiskOperation | null> {
  const dir = operationsDir(dataDir, userId);
  await mkdir(dir, { recursive: true });
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const operation = await readOperationFile(path.join(dir, name));
    if (operation?.status === "pending") return operation;
  }
  return null;
}

export async function completeHostDiskOperation(
  dataDir: string,
  userId: string,
  input: {
    id: string;
    status: "done" | "error";
    entries?: ComputerFileEntry[];
    contentBase64?: string;
    error?: string;
  },
  now: () => number = Date.now,
): Promise<HostDiskOperation> {
  const file = operationPath(dataDir, userId, input.id);
  const existing = await readOperationFile(file);
  if (!existing || existing.userId !== userId) {
    throw new Error("Host disk operation not found");
  }
  const updated: HostDiskOperation = {
    ...existing,
    status: input.status,
    entries: input.entries,
    contentBase64: input.contentBase64 ?? existing.contentBase64,
    error: input.error,
    updatedAt: new Date(now()).toISOString(),
  };
  await writeFile(file, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

/** Production default is the client bridge; set RAKAZO_HOST_DISK_MODE=local for same-host FS. */
export function createHostDiskProvider(dataDir: string): HostDiskProvider {
  if (process.env.RAKAZO_HOST_DISK_MODE === "local") {
    return new LocalHostDiskProvider({ dataDir, ignoreClientHeartbeat: true });
  }
  return new BridgingHostDiskProvider({ dataDir });
}
