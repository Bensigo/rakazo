import type { MessageBlock } from "@rakazo/contracts";

export type ToolActivityBlock = Extract<MessageBlock, { kind: "progress" | "steps" }>;

export function isToolActivityBlock(block: MessageBlock): block is ToolActivityBlock {
  return (
    block.kind === "steps" ||
    (block.kind === "progress" &&
      (block.activity === true || (block.pendingToolNames?.length ?? 0) > 0))
  );
}
