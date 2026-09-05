import { describe, expect, it } from "vitest";
import { loadStudioKnowledgeBridge } from "./studio-knowledge-loader.js";

describe("studio knowledge module loading", () => {
  it("stays disabled when no server module is configured", async () => {
    await expect(loadStudioKnowledgeBridge({})).resolves.toBeUndefined();
  });

  it("requires a separate canonical database when the module is configured", async () => {
    await expect(
      loadStudioKnowledgeBridge({ modulePath: "@sunrise-studio/sdlc/studio" }),
    ).rejects.toThrow("SUNRISE_KNOWLEDGE_DATABASE_URL is required");
  });
});
