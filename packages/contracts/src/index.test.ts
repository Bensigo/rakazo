import { describe, expect, it } from "vitest";
import {
  appContract,
  CreateBotInput,
  CreateRoutineInput,
  MAX_MODEL_INPUT_CHARS,
  MemoryContentInput,
  ModelInputText,
  ProductEventType,
  UpdateRoutineInput,
} from "./index.js";

describe("contracts", () => {
  it("parses bot create input", () => {
    const parsed = CreateBotInput.parse({ name: "Chief" });
    expect(parsed.title).toBe("");
    expect(parsed.notifyOnFinish).toBe(true);
  });

  it("exposes the product rpc surface", () => {
    expect(appContract.models.beginOAuth).toBeTruthy();
    expect(appContract.models.completeOAuth).toBeTruthy();
    expect(appContract.bots.create).toBeTruthy();
    expect(appContract.bots.remove).toBeTruthy();
    expect(appContract.threads.subscribe).toBeTruthy();
    expect(appContract.notifications.registerPush).toBeTruthy();
    expect(ProductEventType.options).toContain("thread.message.created");
    expect(ProductEventType.options).toContain("thread.subagent");
    expect(ProductEventType.options).toContain("bot.spawned");
  });

  it("bounds every model-facing free-text input", () => {
    const maximum = "x".repeat(MAX_MODEL_INPUT_CHARS);
    const oversized = `${maximum}x`;

    expect(ModelInputText.safeParse(maximum).success).toBe(true);
    expect(ModelInputText.safeParse(oversized).success).toBe(false);
    expect(MemoryContentInput.safeParse("").success).toBe(true);
    expect(MemoryContentInput.safeParse(oversized).success).toBe(false);
    expect(
      CreateRoutineInput.safeParse({
        botId: "bot",
        name: "Daily check",
        prompt: oversized,
        cron: "0 9 * * *",
      }).success,
    ).toBe(false);
    expect(UpdateRoutineInput.safeParse({ routineId: "routine", prompt: oversized }).success).toBe(
      false,
    );

    const rpcInputs: Array<[unknown, Record<string, unknown>]> = [
      [appContract.threads.send, { botId: "bot", text: oversized }],
      [appContract.threads.followUp, { botId: "bot", text: oversized }],
      [appContract.threads.answer, { botId: "bot", runId: "run", answer: oversized }],
      [appContract.memory.update, { documentId: "memory", content: oversized }],
      [
        appContract.routines.create,
        { botId: "bot", name: "Daily check", prompt: oversized, cron: "0 9 * * *" },
      ],
      [appContract.routines.update, { routineId: "routine", prompt: oversized }],
    ];
    for (const [procedure, input] of rpcInputs) {
      expect(parseRpcInput(procedure, input).success).toBe(false);
    }
  });

  it("applies the create-time routine name constraints to updates", () => {
    expect(UpdateRoutineInput.safeParse({ routineId: "routine", name: "" }).success).toBe(false);
    expect(
      UpdateRoutineInput.safeParse({ routineId: "routine", name: "x".repeat(81) }).success,
    ).toBe(false);
    expect(
      UpdateRoutineInput.safeParse({ routineId: "routine", name: "Daily check" }).success,
    ).toBe(true);
  });
});

function parseRpcInput(procedure: unknown, input: unknown): { success: boolean } {
  return (
    procedure as {
      "~orpc": { inputSchema: { safeParse(value: unknown): { success: boolean } } };
    }
  )["~orpc"].inputSchema.safeParse(input);
}
