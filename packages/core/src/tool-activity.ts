import type { MessageBlock } from "@rakazo/contracts";

export type ToolActivityBlock = Extract<MessageBlock, { kind: "progress" | "steps" }>;

/** Tool status labels like `Using browser` or `Using brex: list_expenses`, not sentence narration. */
function isToolProgressLabel(text: string): boolean {
  return /^Using\s+\S+(?::\s*\S+)?$/i.test(text.trim());
}

export function isToolActivityBlock(block: MessageBlock): block is ToolActivityBlock {
  return (
    block.kind === "steps" ||
    (block.kind === "progress" &&
      ((block.pendingToolNames?.length ?? 0) > 0 || isToolProgressLabel(block.text)))
  );
}
