import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
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
import type { Prisma, PrismaClient } from "@rakazo/db";

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
  computerId: string;
  runId: string;
  fence: number;
  expiresAt: number;
}

export interface EmployeeHostOperation {
  operationId: string;
  hostId: string;
  spaceId: string;
  botId: string;
  computerId: string;
  lease: EmployeeHostLease;
  kind: "exec";
  request: CommandRequest;
}

export interface EmployeeHostAcceptedReceipt {
  operationId: string;
  hostId: string;
  acceptedAt: number;
  status: "accepted";
  lease: Pick<EmployeeHostLease, "runId" | "fence" | "computerId">;
}

export interface EmployeeHostTerminalReceipt {
  operationId: string;
  hostId: string;
  acceptedAt: number;
  completedAt: number;
  status: "completed" | "failed" | "unknown";
  lease: Pick<EmployeeHostLease, "runId" | "fence" | "computerId">;
  result: { stdout: string; stderr: string; code: number };
}

export type EmployeeHostReceipt = EmployeeHostAcceptedReceipt | EmployeeHostTerminalReceipt;

export class LocalEmployeeHostReceiptSpool {
  constructor(private readonly root: string) {}
  private file(operationId: string) {
    return path.join(this.root, `${createHash("sha256").update(operationId).digest("hex")}.json`);
  }
  async claim(operation: EmployeeHostOperation) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const handle = await open(this.file(operation.operationId), "wx", 0o600).catch(() => null);
    if (!handle) return "existing" as const;
    try { await handle.writeFile(JSON.stringify({ operation, state: "claimed" })); await handle.sync(); }
    finally { await handle.close(); }
    return "claimed" as const;
  }
  async terminal(receipt: EmployeeHostTerminalReceipt) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = `${this.file(receipt.operationId)}.tmp`;
    const handle = await open(temp, "w", 0o600);
    try { await handle.writeFile(JSON.stringify({ receipt, state: "terminal" })); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, this.file(receipt.operationId));
  }
  async acknowledge(operationId: string) { await unlink(this.file(operationId)).catch(() => undefined); }
  async quarantine(receipt: EmployeeHostTerminalReceipt) {
    await this.terminal(receipt);
    await rename(this.file(receipt.operationId), `${this.file(receipt.operationId)}.unresolved`).catch(() => undefined);
  }
  async pending(): Promise<EmployeeHostTerminalReceipt[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const receipts: EmployeeHostTerminalReceipt[] = [];
    for (const name of await readdir(this.root)) {
      if (!name.endsWith(".json")) continue;
      let value: { receipt?: EmployeeHostTerminalReceipt; operation?: EmployeeHostOperation; state?: string };
      try {
        value = JSON.parse(await readFile(path.join(this.root, name), "utf8")) as typeof value;
      } catch (error) {
        throw new Error(`Employee host receipt spool entry ${name} is invalid; preserve it for inspection and repair or remove it before restarting.`, { cause: error });
      }
      if (value.receipt) receipts.push(value.receipt);
      else if (value.operation) receipts.push({ operationId: value.operation.operationId, hostId: value.operation.hostId, lease: { computerId: value.operation.computerId, runId: value.operation.lease.runId, fence: value.operation.lease.fence }, acceptedAt: Date.now(), completedAt: Date.now(), status: "unknown", result: { stdout: "", stderr: "Execution claim existed before companion restart; result is unknown and was not replayed.", code: 125 } });
    }
    return receipts;
  }
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

  acquireLease(input: { hostId: string; spaceId: string; botId: string; computerId: string; runId: string }, now = Date.now()): EmployeeHostLease | null {
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
    this.receipts.set(full.operationId, { operationId: full.operationId, hostId: full.hostId, acceptedAt: now, status: "accepted", lease: { computerId: full.computerId, runId: full.lease.runId, fence: full.lease.fence } });
    return full;
  }

  poll(hostId: string, token: string, now = Date.now()): EmployeeHostOperation | undefined {
    if (!this.authenticate(hostId, token, now)) throw new Error("employee host authentication failed");
    const queue = this.queues.get(hostId)!;
    return queue.shift();
  }

  receipt(operationId: string, hostId: string, token: string, result: EmployeeHostTerminalReceipt["result"], now = Date.now()) {
    if (!this.authenticate(hostId, token, now)) throw new Error("employee host authentication failed");
    const previous = this.receipts.get(operationId);
    if (!previous || previous.hostId !== hostId) throw new Error("unknown employee host operation");
    if (previous.status !== "accepted") return { ...previous };
    const next: EmployeeHostReceipt = { ...previous, completedAt: now, status: result?.code === 0 ? "completed" : "failed", result };
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

export const EMPLOYEE_HOST_MAX_OUTPUT_BYTES = 1_000_000;
export const EMPLOYEE_HOST_MAX_TIMEOUT_MS = 5 * 60_000;

export interface EmployeeHostCompanion {
  execute(request: CommandRequest, signal?: AbortSignal): AsyncIterable<ProcessEvent>;
  capabilities(): Promise<EmployeeHostCapabilities>;
}

export interface EmployeeHostControlPlaneClient {
  heartbeat(hostId: string, token: string, capabilities: EmployeeHostCapabilities): Promise<void>;
  poll(hostId: string, token: string, signal: AbortSignal): Promise<EmployeeHostOperation | undefined>;
  receipt(hostId: string, token: string, receipt: EmployeeHostTerminalReceipt): Promise<void>;
}

/** Minimal HTTP client used by the companion. All requests are outbound. */
export class HttpEmployeeHostControlPlaneClient implements EmployeeHostControlPlaneClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private url(pathname: string) {
    return `${this.baseUrl.replace(/\/$/u, "")}${pathname}`;
  }

  private async request(pathname: string, token: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(this.url(pathname), {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const error = new Error(`employee host control plane returned ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async heartbeat(hostId: string, token: string, capabilities: EmployeeHostCapabilities) {
    await this.request(`/employee-hosts/${encodeURIComponent(hostId)}/heartbeat`, token, { method: "POST", body: JSON.stringify({ capabilities }) });
  }

  async poll(hostId: string, token: string, signal: AbortSignal) {
    const response = await this.request(`/employee-hosts/${encodeURIComponent(hostId)}/poll`, token, { method: "POST", signal });
    const body = (await response.json()) as { operation?: EmployeeHostOperation };
    return body.operation;
  }

  async receipt(hostId: string, token: string, receipt: EmployeeHostTerminalReceipt) {
    await this.request(`/employee-hosts/${encodeURIComponent(hostId)}/receipts/${encodeURIComponent(receipt.operationId)}`, token, { method: "POST", body: JSON.stringify(receipt) });
  }
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
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? root,
      LANG: process.env.LANG ?? "C",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      ...Object.fromEntries(Object.entries(request.env ?? {}).filter(([key]) => /^(PATH|HOME|LANG|TMPDIR|LC_[A-Z_]+)$/u.test(key))),
    };
    const timeoutMs = Math.min(request.timeoutMs ?? EMPLOYEE_HOST_MAX_TIMEOUT_MS, EMPLOYEE_HOST_MAX_TIMEOUT_MS);
    const child = spawn(request.argv[0] ?? "true", request.argv.slice(1), { cwd, signal, env });
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    let outputBytes = 0;
    const append = (type: "stdout" | "stderr", data: unknown) => {
      const value = String(data);
      if (outputBytes >= EMPLOYEE_HOST_MAX_OUTPUT_BYTES) return;
      const remaining = EMPLOYEE_HOST_MAX_OUTPUT_BYTES - outputBytes;
      const bounded = value.slice(0, remaining);
      outputBytes += bounded.length;
      events.push({ type, data: bounded });
    };
    child.stdout?.on("data", (data) => append("stdout", data));
    child.stderr?.on("data", (data) => append("stderr", data));
    const events: ProcessEvent[] = [];
    let code: number | null = null;
    child.once("close", (exitCode) => { code = exitCode ?? 1; });
    while (code === null || events.length) {
      while (events.length) yield events.shift()!;
      if (code !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    clearTimeout(timeout);
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
  spool?: LocalEmployeeHostReceiptSpool;
}) {
  const heartbeatMs = input.heartbeatMs ?? 30_000;
  const sendHeartbeat = async () => input.client.heartbeat(input.hostId, input.enrollmentToken, await input.companion.capabilities());
  const retry = async <T>(work: () => Promise<T>) => {
    let delay = 100;
    while (!input.signal.aborted) { try { return await work(); } catch (error) { if (isPermanentControlPlaneError(error)) throw error; await new Promise((resolve) => setTimeout(resolve, delay)); delay = Math.min(delay * 2, 5_000); } }
    throw input.signal.reason ?? new Error("employee host companion aborted");
  };
  if (input.spool) for (const receipt of await input.spool.pending()) {
    try { await retry(() => input.client.receipt(input.hostId, input.enrollmentToken, receipt)); await input.spool.acknowledge(receipt.operationId); }
    catch (error) {
      if (isPermanentControlPlaneError(error)) await input.spool.quarantine(receipt);
      else throw error;
    }
  }
  await retry(sendHeartbeat);
  let nextHeartbeat = Date.now() + heartbeatMs;
  while (!input.signal.aborted) {
    if (Date.now() >= nextHeartbeat) {
      await retry(sendHeartbeat);
      nextHeartbeat = Date.now() + heartbeatMs;
    }
    const operation = await retry(() => input.client.poll(input.hostId, input.enrollmentToken, input.signal));
    if (!operation) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    if (input.spool && await input.spool.claim(operation) === "existing") continue;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let code = 1;
    let executionDone = false;
    const heartbeatLoop = (async () => {
      while (!input.signal.aborted && !executionDone) {
        await abortableDelay(heartbeatMs, input.signal);
        if (!input.signal.aborted && !executionDone) await retry(sendHeartbeat);
      }
    })();
    const execute = (async () => {
      for await (const event of input.companion.execute(operation.request, input.signal)) {
        if (event.type === "stdout") stdout.push(event.data);
        if (event.type === "stderr") stderr.push(event.data);
        if (event.type === "exit") code = event.code;
      }
    })();
    try { await execute; } finally { executionDone = true; }
    await heartbeatLoop.catch((error) => { if (input.signal.aborted) return; throw error; });
    const receipt: EmployeeHostTerminalReceipt = {
      operationId: operation.operationId,
      hostId: input.hostId,
      lease: { runId: operation.lease.runId, fence: operation.lease.fence, computerId: operation.computerId },
      acceptedAt: Date.now(),
      completedAt: Date.now(),
      status: code === 0 ? "completed" : "failed",
      result: { stdout: stdout.join(""), stderr: stderr.join(""), code },
    };
    if (input.spool) await input.spool.terminal(receipt);
    try { await retry(() => input.client.receipt(input.hostId, input.enrollmentToken, receipt)); if (input.spool) await input.spool.acknowledge(receipt.operationId); }
    catch (error) { if (input.spool && isPermanentControlPlaneError(error)) await input.spool.quarantine(receipt); else throw error; }
  }
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); };
    function done() { signal.removeEventListener("abort", abort); resolve(); }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function isPermanentControlPlaneError(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return status === 401 || status === 403 || status === 404 || status === 409;
}

/** Provider-facing transport seam; server composition owns authentication and durable storage. */
export interface EmployeeHostTransport {
  provision(request: { botId: string; computerId?: string; homePath: string; providerRef?: string; providerKind?: ComputerRef["kind"] }, context: AdapterContext): Promise<ComputerRef>;
  execute(computer: ComputerRef, request: CommandRequest, context: AdapterContext): AsyncIterable<ProcessEvent>;
}

/** Prisma-backed producer/receipt transport used by API and worker composition. */
export class PrismaEmployeeHostTransport implements EmployeeHostTransport {
  constructor(private readonly prisma: PrismaClient, private readonly pollMs = 50) {}

  async provision(request: { botId: string; computerId?: string; homePath: string; providerRef?: string; providerKind?: ComputerRef["kind"] }, context: AdapterContext) {
    if (!request.computerId || !request.providerRef) throw new Error("employee host computer identity is missing");
    const host = await this.prisma.employeeHost.findFirst({ where: { hostId: request.providerRef, computerId: request.computerId, spaceId: context.spaceId, ownerUserId: context.userId, expiresAt: { gt: new Date() }, computer: { id: request.computerId, spaceId: context.spaceId, userId: context.userId, kind: "employee-host" } } });
    if (!host) throw new Error("employee host is unavailable");
    return { id: host.computerId, botId: request.botId, kind: "employee-host" as ComputerRef["kind"], providerRef: host.hostId, fresh: false };
  }

  async *execute(computer: ComputerRef, request: CommandRequest, context: AdapterContext): AsyncIterable<ProcessEvent> {
    if (!context.botId || !context.runId) throw new Error("employee host execution requires bot and run context");
    const host = await this.prisma.employeeHost.findFirst({ where: { hostId: computer.providerRef, computerId: computer.id, spaceId: context.spaceId, ownerUserId: context.userId, expiresAt: { gt: new Date() } } });
    if (!host) throw new Error("employee host is unavailable");
    const lease = await this.prisma.computerExecutionLease.findUnique({ where: { computerId_botId: { computerId: computer.id, botId: context.botId } } });
    if (!lease || lease.runId !== context.runId || lease.fence !== context.computerLeaseFence || lease.expiresAt <= new Date()) throw new Error("employee host execution lease is stale");
    const operation = await this.prisma.employeeHostOperation.create({ data: { operationId: randomUUID(), hostId: host.hostId, computerId: computer.id, spaceId: context.spaceId, botId: context.botId, runId: context.runId, fence: lease.fence, request: request as unknown as Prisma.InputJsonValue } });
    while (!context.signal.aborted) {
      const current = await this.prisma.employeeHostOperation.findUnique({ where: { id: operation.id } });
      if (current?.status === "completed" || current?.status === "failed") {
        if (current.stdout) yield { type: "stdout", data: current.stdout };
        if (current.stderr) yield { type: "stderr", data: current.stderr };
        yield { type: "exit", code: current.exitCode ?? 1 };
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
    throw context.signal.reason ?? new Error("employee host execution aborted");
  }
}

/** Placeholder adapter until API composition supplies the durable transport. */
export class EmployeeHostSandboxProvider implements SandboxProvider {
  constructor(private readonly transport: EmployeeHostTransport) {}
  describe() { return { id: "employee-host", contractVersion: "1", adapterVersion: "0.1.0", capabilities: { graphical: false, pty: true, snapshots: false, takeover: false, persistentHome: true, multiScreen: false } }; }
  provision(request: Parameters<EmployeeHostTransport["provision"]>[0], context: AdapterContext) { return this.transport.provision(request, context); }
  prepare() { return Promise.resolve(); }
  execute(computer: ComputerRef, request: CommandRequest, context: AdapterContext) { return this.transport.execute(computer, { ...request, cwd: employeeHostWorkspaceCwd(request.cwd) }, context); }
  connectScreen(): Promise<ScreenSession> { return Promise.reject(new Error("employee host GUI is unsupported")); }
  sendInput(): Promise<void> { return Promise.reject(new Error("employee host input is unsupported")); }
  observe(): Promise<ComputerObservation> { return Promise.reject(new Error("employee host GUI observation is unsupported")); }
  act(_computer: ComputerRef, _request: ComputerActionRequest): Promise<{ completed: number }> { return Promise.reject(new Error("employee host GUI actions are unsupported")); }
  listFiles(): Promise<ComputerFileEntry[]> { return Promise.reject(new Error("employee host file transport is unsupported")); }
  readFile(): Promise<Uint8Array> { return Promise.reject(new Error("employee host file transport is unsupported")); }
  writeFile(_computer: ComputerRef, _file: PortableFile): Promise<void> { return Promise.reject(new Error("employee host file transport is unsupported")); }
  exportWorkspace(): AsyncIterable<PortableFile> { throw new Error("employee host workspace transport is unsupported"); }
  importWorkspace(): Promise<void> { return Promise.reject(new Error("employee host workspace transport is unsupported")); }
  snapshot(): Promise<{ id: string; createdAt: string }> { return Promise.reject(new Error("employee host snapshots are unsupported")); }
  stop(): Promise<void> { return Promise.resolve(); }
  destroy(): Promise<void> { return Promise.resolve(); }
}

export function employeeHostWorkspaceCwd(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === ".") return cwd;
  const portable = cwd.replace(/\\/g, "/");
  for (const root of ["/home/rakazo", "/home/user"]) {
    if (portable === root) return ".";
    if (portable.startsWith(`${root}/`)) return normalizeEmployeeWorkspacePath(portable.slice(root.length + 1));
  }
  if (portable.startsWith("/")) throw new Error("Employee host cwd is outside the enrolled workspace");
  return normalizeEmployeeWorkspacePath(portable);
}

function normalizeEmployeeWorkspacePath(value: string) {
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("Employee host cwd escapes the enrolled workspace");
  return segments.join("/") || ".";
}
