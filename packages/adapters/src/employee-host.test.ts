import { describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@rakazo/db";
import { EmployeeHostRegistry, employeeHostWorkspaceCwd, LocalEmployeeHostCompanion, LocalEmployeeHostReceiptSpool, PrismaEmployeeHostTransport, runEmployeeHostCompanion, type EmployeeHostOperation } from "./employee-host.js";

const capabilities = {
  platform: "macos" as const,
  graphical: false as const,
  takeover: false as const,
  multiScreen: false as const,
  xcode: true,
  simulator: true,
  workspaceRoot: "/workspace",
};

function host(registry: EmployeeHostRegistry) {
  return registry.enroll({ hostId: "host-1", spaceId: "space-1", ownerUserId: "user-1", name: "Build Mac", platform: "macos", capabilities, workspaceRoot: "/workspace" }, 1000);
}

describe("employee host protocol", () => {
  it("preserves the server computer identity and scopes it to its owner", async () => {
    const findFirst = vi.fn(async () => ({ hostId: "host-1", computerId: "computer-1" }));
    const transport = new PrismaEmployeeHostTransport({ employeeHost: { findFirst } } as unknown as PrismaClient);
    const context = { operationId: "op-1", traceId: "op-1", spaceId: "space-1", userId: "user-1", signal: new AbortController().signal };
    await expect(transport.provision({ botId: "employee-home", computerId: "computer-1", homePath: "/server-home", providerKind: "employee-host", providerRef: "host-1" }, context)).resolves.toMatchObject({ id: "computer-1", kind: "employee-host", providerRef: "host-1", fresh: false });
    expect(findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ computerId: "computer-1", hostId: "host-1", ownerUserId: "user-1", spaceId: "space-1" }) });
    await expect(transport.provision({ botId: "employee-home", homePath: "/server-home", providerKind: "employee-host" }, context)).rejects.toThrow(/identity is missing/);
  });

  it("maps only the virtual agent home into the enrolled workspace", () => {
    expect(employeeHostWorkspaceCwd(undefined)).toBeUndefined();
    expect(employeeHostWorkspaceCwd("/home/rakazo")).toBe(".");
    expect(employeeHostWorkspaceCwd("/home/user/project/src")).toBe("project/src");
    expect(employeeHostWorkspaceCwd("project/src")).toBe("project/src");
    expect(() => employeeHostWorkspaceCwd("/etc")).toThrow(/outside/);
    expect(() => employeeHostWorkspaceCwd("../outside")).toThrow(/escapes/);
  });

  it("authenticates outbound poll and expires missed heartbeats", () => {
    const registry = new EmployeeHostRegistry(100);
    const enrollment = host(registry);
    expect(registry.authenticate(enrollment.hostId, enrollment.enrollmentToken, 1050)).toBe(true);
    expect(registry.authenticate(enrollment.hostId, "wrong", 1050)).toBe(false);
    expect(registry.get("host-1", 1101)?.connected).toBe(false);
    expect(() => registry.poll("host-1", enrollment.enrollmentToken, 1101)).toThrow(/authentication/);
  });

  it("rejects a wrong-space operation and stale fenced replay", () => {
    const registry = new EmployeeHostRegistry(10_000);
    const enrollment = host(registry);
    const lease = registry.acquireLease({ hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", runId: "run-1" }, 1001)!;
    expect(() => registry.enqueue({ hostId: "host-1", spaceId: "space-2", botId: "bot-1", computerId: "computer-1", lease, kind: "exec", request: { argv: ["true"] } }, 1002)).toThrow(/unavailable/);
    const operation = registry.enqueue({ hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", lease, kind: "exec", request: { argv: ["true"] } }, 1002);
    expect(() => registry.enqueue({ hostId: operation.hostId, spaceId: operation.spaceId, botId: operation.botId, computerId: operation.computerId, lease: { ...lease, fence: lease.fence - 1 }, kind: operation.kind, request: operation.request }, 1003)).toThrow(/stale/);
    expect(registry.poll("host-1", enrollment.enrollmentToken, 1004)?.operationId).toBe(operation.operationId);
    const receipt = registry.receipt(operation.operationId, "host-1", enrollment.enrollmentToken, { stdout: "", stderr: "", code: 0 }, 1005);
    expect(registry.receipt(operation.operationId, "host-1", enrollment.enrollmentToken, { stdout: "replayed", stderr: "", code: 0 }, 1006)).toEqual(receipt);
  });

  it("executes only inside the bound workspace", async () => {
    const companion = new LocalEmployeeHostCompanion(process.cwd());
    const events = [];
    for await (const event of companion.execute({ argv: ["node", "-e", "process.stdout.write('ok')"], cwd: "." })) events.push(event);
    expect(events).toContainEqual({ type: "stdout", data: "ok" });
    expect(events.at(-1)).toEqual({ type: "exit", code: 0 });
    const blocked = [];
    for await (const event of companion.execute({ argv: ["true"], cwd: ".." })) blocked.push(event);
    expect(blocked).toContainEqual({ type: "exit", code: 1 });
  });

  it("spools terminal receipts and never reruns an uncertain claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "employee-host-test-"));
    const spool = new LocalEmployeeHostReceiptSpool(root);
    const operation = { operationId: "op-1", hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", lease: { hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", runId: "run-1", fence: 1, expiresAt: Date.now() + 10_000 }, kind: "exec" as const, request: { argv: ["true"] } };
    expect(await spool.claim(operation)).toBe("claimed");
    expect(await spool.claim(operation)).toBe("existing");
    const pending = await spool.pending();
    expect(pending[0]?.status).toBe("unknown");
    await spool.terminal({ ...pending[0]!, status: "completed", result: { stdout: "ok", stderr: "", code: 0 } });
    expect((await spool.pending())[0]?.status).toBe("completed");
  });

  it("keeps operation identifiers inside the spool and preserves malformed evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "employee-host-spool-boundary-test-"));
    const spoolRoot = join(root, "receipts");
    const spool = new LocalEmployeeHostReceiptSpool(spoolRoot);
    const operation = { operationId: "../../outside", hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", lease: { hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", runId: "run-1", fence: 1, expiresAt: Date.now() + 10_000 }, kind: "exec" as const, request: { argv: ["true"] } };
    expect(await spool.claim(operation)).toBe("claimed");
    expect(await readdir(spoolRoot)).toHaveLength(1);
    await expect(access(join(root, "outside.json"))).rejects.toThrow();

    const malformed = join(spoolRoot, "malformed.json");
    await writeFile(malformed, "{", { mode: 0o600 });
    await expect(spool.pending()).rejects.toThrow(/preserve it for inspection and repair or remove it/);
    await expect(readFile(malformed, "utf8")).resolves.toBe("{");
  });

  it("reconciles a lost terminal receipt response after restart without rerunning", async () => {
    const root = await mkdtemp(join(tmpdir(), "employee-host-restart-test-"));
    const spoolRoot = join(root, "receipts");
    const spool = new LocalEmployeeHostReceiptSpool(spoolRoot);
    const markerPath = join(root, "marker.txt");
    const operation: EmployeeHostOperation = {
      operationId: "op-restart",
      hostId: "host-1",
      spaceId: "space-1",
      botId: "bot-1",
      computerId: "computer-1",
      lease: { hostId: "host-1", spaceId: "space-1", botId: "bot-1", computerId: "computer-1", runId: "run-1", fence: 1, expiresAt: Date.now() + 10_000 },
      kind: "exec",
      request: { argv: [process.execPath, "-e", "require('node:fs').appendFileSync('marker.txt', 'once\\n')"], cwd: "." },
    };
    const first = new AbortController();
    let polled = false;
    let receiptCalls = 0;
    await expect(runEmployeeHostCompanion({
      hostId: operation.hostId,
      enrollmentToken: "token",
      companion: new LocalEmployeeHostCompanion(root),
      client: {
        heartbeat: async () => undefined,
        poll: async () => polled ? undefined : (polled = true, operation),
        receipt: async () => {
          receiptCalls += 1;
          first.abort(new Error("response lost after server commit"));
          throw new TypeError("connection lost");
        },
      },
      signal: first.signal,
      heartbeatMs: 5,
      spool,
    })).rejects.toThrow("response lost after server commit");
    expect(await readFile(markerPath, "utf8")).toBe("once\n");
    expect(await spool.pending()).toEqual([expect.objectContaining({ operationId: operation.operationId, status: "completed" })]);

    const second = new AbortController();
    await runEmployeeHostCompanion({
      hostId: operation.hostId,
      enrollmentToken: "token",
      companion: new LocalEmployeeHostCompanion(root),
      client: {
        heartbeat: async () => undefined,
        poll: async () => { second.abort(); return undefined; },
        receipt: async () => { receiptCalls += 1; },
      },
      signal: second.signal,
      heartbeatMs: 5,
      spool: new LocalEmployeeHostReceiptSpool(spoolRoot),
    });
    expect(receiptCalls).toBe(2);
    expect(await readFile(markerPath, "utf8")).toBe("once\n");
    expect(await readdir(spoolRoot)).toEqual([]);
  });
});
