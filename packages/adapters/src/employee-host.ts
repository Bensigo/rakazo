import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerObservation,
  ComputerRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenSession,
} from "@rakazo/adapter-kit";

export type EmployeeHostPlatform = "macos" | "windows" | "linux" | "unknown";

export interface EmployeeHostCapabilities {
  platform: EmployeeHostPlatform;
  graphical: false;
  takeover: false;
  multiScreen: false;
  xcode: boolean;
  simulator: boolean;
  workspaceRoot: string;
}

export interface EmployeeHostRecord {
  hostId: string;
  spaceId: string;
  ownerUserId: string;
  name: string;
  platform: EmployeeHostPlatform;
  capabilities: EmployeeHostCapabilities;
  workspaceRoot: string;
  lastSeenAt: number;
  expiresAt: number;
  connected: boolean;
}

export interface EmployeeHostLease {
  hostId: string;
  spaceId: string;
  botId: string;
  runId: string;
  fence: number;
  expiresAt: number;
}

export interface EmployeeHostOperation {
  operationId: string;
  hostId: string;
  spaceId: string;
  botId: string;
  lease: EmployeeHostLease;
  kind: "exec";
  request: CommandRequest;
}

export interface EmployeeHostReceipt {
  operationId: string;
  hostId: string;
  acceptedAt: number;
  completedAt?: number;
  status: "accepted" | "completed" | "failed";
  result?: { stdout: string; stderr: string; code: number };
}

export interface EmployeeHostEnrollment {
  hostId: string;
  enrollmentToken: string;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Deterministic protocol state machine for a durable API implementation.
 * Production storage can replace these maps without changing the companion or
 * provider contract. Tokens are retained as hashes, never returned after enroll.
 */
export class EmployeeHostRegistry {
  private readonly hosts = new Map<string, EmployeeHostRecord>();
  private readonly tokenHashes = new Map<string, string>();
  private readonly queues = new Map<string, EmployeeHostOperation[]>();
  private readonly receipts = new Map<string, EmployeeHostReceipt>();
  private readonly fences = new Map<string, number>();

  constructor(private readonly heartbeatTtlMs = 60_000) {}

  enroll(input: Omit<EmployeeHostRecord, "lastSeenAt" | "expiresAt" | "connected">, now = Date.now()): EmployeeHostEnrollment {
    const token = randomUUID();
    this.hosts.set(input.hostId, { ...input, lastSeenAt: now, expiresAt: now + this.heartbeatTtlMs, connected: true });
    this.tokenHashes.set(input.hostId, hashToken(token));
    this.queues.set(input.hostId, []);
    return { hostId: input.hostId, enrollmentToken: token };
  }

  authenticate(hostId: string, token: string, now = Date.now()) {
    const host = this.hosts.get(hostId);
    if (!host || this.tokenHashes.get(hostId) !== hashToken(token) || host.expiresAt <= now) return false;
    return true;
  }

  heartbeat(hostId: string, token: string, capabilities: EmployeeHostCapabilities, now = Date.now()) {
    if (!this.authenticate(hostId, token, now)) return false;
    const host = this.hosts.get(hostId)!;
    this.hosts.set(hostId, { ...host, capabilities, lastSeenAt: now, expiresAt: now + this.heartbeatTtlMs, connected: true });
    return true;
  }

  expire(now = Date.now()) {
    for (const [hostId, host] of this.hosts) {
      if (host.expiresAt <= now) this.hosts.set(hostId, { ...host, connected: false });
    }
  }

  get(hostId: string, now = Date.now()): EmployeeHostRecord | undefined {
    this.expire(now);
    const host = this.hosts.get(hostId);
    return host ? { ...host } : undefined;
  }

  acquireLease(input: { hostId: string; spaceId: string; botId: string; runId: string }, now = Date.now()): EmployeeHostLease | null {
    const host = this.get(input.hostId, now);
    if (!host || !host.connected || host.spaceId !== input.spaceId) return null;
    const key = `${input.hostId}:${input.botId}`;
    const fence = (this.fences.get(key) ?? 0) + 1;
    this.fences.set(key, fence);
    return { ...input, fence, expiresAt: now + this.heartbeatTtlMs };
  }

  enqueue(operation: Omit<EmployeeHostOperation, "operationId">, now = Date.now()) {
    const host = this.get(operation.hostId, now);
    if (!host || !host.connected || host.spaceId !== operation.spaceId) throw new Error("employee host is unavailable");
    const key = `${operation.hostId}:${operation.botId}`;
    if (this.fences.get(key) !== operation.lease.fence || operation.lease.expiresAt <= now) throw new Error("employee host lease is stale");
    const full = { ...operation, operationId: randomUUID() };
    this.queues.get(operation.hostId)!.push(full);
    this.receipts.set(full.operationId, { operationId: full.operationId, hostId: full.hostId, acceptedAt: now, status: "accepted" });
    return full;
  }

  poll(hostId: string, token: string, now = Date.now()): EmployeeHostOperation | undefined {
    if (!this.authenticate(hostId, token, now)) throw new Error("employee host authentication failed");
    const queue = this.queues.get(hostId)!;
    return queue.shift();
  }

  receipt(operationId: string, hostId: string, token: string, result: EmployeeHostReceipt["result"], now = Date.now()) {
    if (!this.authenticate(hostId, token, now)) throw new Error("employee host authentication failed");
    const previous = this.receipts.get(operationId);
    if (!previous || previous.hostId !== hostId) throw new Error("unknown employee host operation");
    if (previous.status !== "accepted") return { ...previous };
    const next: EmployeeHostReceipt = { ...previous, completedAt: now, status: result.code === 0 ? "completed" : "failed", result };
    this.receipts.set(operationId, next);
    return { ...next };
  }
}

export async function detectEmployeeHostCapabilities(workspaceRoot: string): Promise<EmployeeHostCapabilities> {
  const platform: EmployeeHostPlatform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unknown";
  const xcode = platform === "macos" && (await commandExists("xcodebuild"));
  const simulator = xcode && (await commandExists("xcrun"));
  return { platform, graphical: false, takeover: false, multiScreen: false, xcode, simulator, workspaceRoot: path.resolve(workspaceRoot) };
}

async function commandExists(command: string) {
  try {
    await access(command);
    return true;
  } catch {
    return new Promise<boolean>((resolve) => {
      const child = spawn("which", [command]);
      child.once("close", (code) => resolve(code === 0));
      child.once("error", () => resolve(false));
    });
  }
}

export interface EmployeeHostCompanion {
  execute(request: CommandRequest, signal?: AbortSignal): AsyncIterable<ProcessEvent>;
  capabilities(): Promise<EmployeeHostCapabilities>;
}

export interface EmployeeHostControlPlaneClient {
  heartbeat(hostId: string, token: string, capabilities: EmployeeHostCapabilities): Promise<void>;
  poll(hostId: string, token: string, signal: AbortSignal): Promise<EmployeeHostOperation | undefined>;
  receipt(hostId: string, token: string, receipt: EmployeeHostReceipt): Promise<void>;
}

/** Local companion implementation. It never exports credentials or permits cwd outside its bound root. */
export class LocalEmployeeHostCompanion implements EmployeeHostCompanion {
  constructor(private readonly workspaceRoot: string) {}

  capabilities() { return detectEmployeeHostCapabilities(this.workspaceRoot); }

  async *execute(request: CommandRequest, signal?: AbortSignal): AsyncIterable<ProcessEvent> {
    const root = path.resolve(this.workspaceRoot);
    const cwd = path.resolve(root, request.cwd ?? ".");
    const relative = path.relative(root, cwd);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      yield { type: "stderr", data: "path is outside employee host workspace" };
      yield { type: "exit", code: 1 };
      return;
    }
    const child = spawn(request.argv[0] ?? "true", request.argv.slice(1), { cwd, signal, env: { ...process.env } });
    child.stdout?.on("data", (data) => events.push({ type: "stdout", data: String(data) }));
    child.stderr?.on("data", (data) => events.push({ type: "stderr", data: String(data) }));
    const events: ProcessEvent[] = [];
    let code: number | null = null;
    child.once("close", (exitCode) => { code = exitCode ?? 1; });
    while (code === null || events.length) {
      while (events.length) yield events.shift()!;
      if (code !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    yield { type: "exit", code };
  }
}

/**
 * Runs the employee-host side of the protocol. The control plane client must
 * use an outbound authenticated connection; no inbound port or credentials
 * are required on the employee machine.
 */
export async function runEmployeeHostCompanion(input: {
  hostId: string;
  enrollmentToken: string;
  companion: EmployeeHostCompanion;
  client: EmployeeHostControlPlaneClient;
  signal: AbortSignal;
  heartbeatMs?: number;
}) {
  const heartbeatMs = input.heartbeatMs ?? 30_000;
  const sendHeartbeat = async () => input.client.heartbeat(input.hostId, input.enrollmentToken, await input.companion.capabilities());
  await sendHeartbeat();
  let nextHeartbeat = Date.now() + heartbeatMs;
  while (!input.signal.aborted) {
    if (Date.now() >= nextHeartbeat) {
      await sendHeartbeat();
      nextHeartbeat = Date.now() + heartbeatMs;
    }
    const operation = await input.client.poll(input.hostId, input.enrollmentToken, input.signal);
    if (!operation) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    const stdout: string[] = [];
    const stderr: string[] = [];
    let code = 1;
    for await (const event of input.companion.execute(operation.request, input.signal)) {
      if (event.type === "stdout") stdout.push(event.data);
      if (event.type === "stderr") stderr.push(event.data);
      if (event.type === "exit") code = event.code;
    }
    await input.client.receipt(input.hostId, input.enrollmentToken, {
      operationId: operation.operationId,
      hostId: input.hostId,
      acceptedAt: Date.now(),
      completedAt: Date.now(),
      status: code === 0 ? "completed" : "failed",
      result: { stdout: stdout.join(""), stderr: stderr.join(""), code },
    });
  }
}

/** Provider-facing transport seam; server composition owns authentication and durable storage. */
export interface EmployeeHostTransport {
  provision(request: { botId: string; homePath: string; providerRef?: string; providerKind?: ComputerRef["kind"] }, context: AdapterContext): Promise<ComputerRef>;
  execute(computer: ComputerRef, request: CommandRequest, context: AdapterContext): AsyncIterable<ProcessEvent>;
}

/** Placeholder adapter until API composition supplies the durable transport. */
export class EmployeeHostSandboxProvider implements SandboxProvider {
  constructor(private readonly transport: EmployeeHostTransport) {}
  describe() { return { id: "employee-host", contractVersion: "1", adapterVersion: "0.1.0", capabilities: { graphical: false, pty: true, snapshots: false, takeover: false, persistentHome: true, multiScreen: false } }; }
  provision(request: Parameters<EmployeeHostTransport["provision"]>[0], context: AdapterContext) { return this.transport.provision(request, context); }
  prepare() { return Promise.resolve(); }
  execute(computer: ComputerRef, request: CommandRequest, context: AdapterContext) { return this.transport.execute(computer, request, context); }
  connectScreen(): Promise<ScreenSession> { return Promise.resolve({ url: null, mimeType: "text/plain", close: async () => undefined }); }
  sendInput(): Promise<void> { return Promise.resolve(); }
  observe(): Promise<ComputerObservation> {
    return Promise.resolve({ frameId: "employee-host-no-gui", capturedAt: new Date().toISOString(), mimeType: "image/png", image: new Uint8Array(), width: 0, height: 0 });
  }
  act(_computer: ComputerRef, _request: ComputerActionRequest): Promise<{ completed: number }> { return Promise.resolve({ completed: 0 }); }
  listFiles(): Promise<ComputerFileEntry[]> { return Promise.resolve([]); }
  readFile(): Promise<Uint8Array> { return Promise.reject(new Error("employee host file transport is not wired")); }
  writeFile(_computer: ComputerRef, _file: PortableFile): Promise<void> { return Promise.reject(new Error("employee host file transport is not wired")); }
  exportWorkspace(): AsyncIterable<PortableFile> { return (async function* () {})(); }
  importWorkspace(): Promise<void> { return Promise.reject(new Error("employee host workspace transport is not wired")); }
  snapshot(): Promise<{ id: string; createdAt: string }> { return Promise.reject(new Error("employee host snapshots are not supported")); }
  stop(): Promise<void> { return Promise.resolve(); }
  destroy(): Promise<void> { return Promise.resolve(); }
}
