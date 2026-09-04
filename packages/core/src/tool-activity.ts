import type { MessageBlock } from "@rakazo/contracts";

export type ToolActivityBlock = Extract<MessageBlock, { kind: "progress" | "steps" }>;

export function isToolActivityBlock(block: MessageBlock): block is ToolActivityBlock {
  return (
    block.kind === "steps" ||
    (block.kind === "progress" &&
      ((block.pendingToolNames?.length ?? 0) > 0 || /^Using\s+\S+(?::\s*\S+)?$/i.test(block.text)))
  );
}
