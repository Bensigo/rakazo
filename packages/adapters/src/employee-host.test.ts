import { describe, expect, it } from "vitest";
import { EmployeeHostRegistry, LocalEmployeeHostCompanion } from "./employee-host.js";

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
    const lease = registry.acquireLease({ hostId: "host-1", spaceId: "space-1", botId: "bot-1", runId: "run-1" }, 1001)!;
    expect(() => registry.enqueue({ hostId: "host-1", spaceId: "space-2", botId: "bot-1", lease, kind: "exec", request: { argv: ["true"] } }, 1002)).toThrow(/unavailable/);
    const operation = registry.enqueue({ hostId: "host-1", spaceId: "space-1", botId: "bot-1", lease, kind: "exec", request: { argv: ["true"] } }, 1002);
    expect(() => registry.enqueue({ hostId: operation.hostId, spaceId: operation.spaceId, botId: operation.botId, lease: { ...lease, fence: lease.fence - 1 }, kind: operation.kind, request: operation.request }, 1003)).toThrow(/stale/);
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
});
