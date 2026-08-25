import { describe, expect, it } from "vitest";
import { createApprovedEffectReplayQueue } from "./approval-effect.js";
import { buildApprovalContinuation } from "./executor.js";

describe("executor approval replay", () => {
  it("lists and replays every approved request in FIFO order when a tool repeats", () => {
    const effects = [
      { kind: "destination.write", request: { sequence: 1 } },
      { kind: "destination.write", request: { sequence: 2 } },
    ];

    const continuation = buildApprovalContinuation(effects, JSON.stringify);
    expect(continuation).toContain(
      "Call each listed approved request exactly once, in the listed order",
    );
    expect(continuation?.indexOf('{"sequence":1}')).toBeLessThan(
      continuation?.indexOf('{"sequence":2}') ?? -1,
    );

    const queue = createApprovedEffectReplayQueue(effects);
    expect(queue.take("destination.write")).toEqual({ sequence: 1 });
    expect(queue.take("destination.write")).toEqual({ sequence: 2 });
    expect(queue.take("destination.write")).toBeUndefined();
  });
});
