import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import {
  filterImageReturningComputerTools,
  IMAGE_RETURNING_COMPUTER_TOOLS,
  MODEL_CANNOT_SEE_MESSAGE,
  modelAcceptsImageInput,
} from "./model-vision.js";

describe("model vision gating for computer tools", () => {
  it("treats catalog text-only models as unable to see", () => {
    expect(modelAcceptsImageInput("openrouter", "deepseek/deepseek-v4-flash-0731")).toBe(false);
    expect(modelAcceptsImageInput("openrouter", "deepseek/deepseek-v4-pro")).toBe(false);
  });

  it("treats catalog vision models as able to see", () => {
    expect(modelAcceptsImageInput("openrouter", "openai/gpt-4o")).toBe(true);
    expect(modelAcceptsImageInput("openrouter", "deepseek/deepseek-v4-flash-vision-exp")).toBe(
      true,
    );
  });

  it("treats unknown models as text-only and allows scripted fixtures", () => {
    expect(modelAcceptsImageInput("openrouter", "rakazo-test/unknown-future-model")).toBe(false);
    expect(modelAcceptsImageInput("scripted", "scripted")).toBe(true);
  });

  it("omits image-returning computer tools for text-only models", () => {
    const names = filterImageReturningComputerTools(builtinAgentTools, false).map(
      (tool) => tool.name,
    );
    for (const name of IMAGE_RETURNING_COMPUTER_TOOLS) {
      expect(names).not.toContain(name);
    }
    expect(names).toContain("shell");
    expect(names).toContain("list_files");
  });

  it("keeps image-returning computer tools for vision models", () => {
    const names = filterImageReturningComputerTools(builtinAgentTools, true).map(
      (tool) => tool.name,
    );
    expect(names).toEqual(builtinAgentTools.map((tool) => tool.name));
    expect(names).toContain("computer_observe");
    expect(names).toContain("computer_act");
  });

  it("exposes a clear operator-facing cannot-see message", () => {
    expect(MODEL_CANNOT_SEE_MESSAGE).toMatch(/cannot see/i);
    expect(MODEL_CANNOT_SEE_MESSAGE).toMatch(/vision-capable model/i);
  });
});
