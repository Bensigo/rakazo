import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { isToolActivityBlock } from "./tool-activity.js";

describe("tool activity", () => {
  it.each<MessageBlock>([
    { kind: "steps", steps: [{ label: "Browser", count: 1 }] },
    { kind: "progress", text: "Using browser" },
    { kind: "progress", text: "Let me check", pendingToolNames: ["browser"] },
  ])("recognizes $kind activity", (block) => {
    expect(isToolActivityBlock(block)).toBe(true);
  });

  it("keeps assistant narration separate from tool activity", () => {
    expect(isToolActivityBlock({ kind: "progress", text: "I’m checking that now." })).toBe(false);
    expect(isToolActivityBlock({ kind: "text", text: "Done." })).toBe(false);
  });
});
