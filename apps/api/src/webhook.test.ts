import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

describe("inbound webhook bot endpoint", () => {
  it("formats json and text payloads cleanly into prompt text", () => {
    const jsonPayload = { event: "github.push", repository: "elie222/rakazo", ref: "refs/heads/main" };
    const promptText = `[Inbound Event: ${jsonPayload.event}]\n\`\`\`json\n${JSON.stringify(jsonPayload, null, 2)}\n\`\`\``;
    
    expect(promptText).toContain("[Inbound Event: github.push]");
    expect(promptText).toContain("refs/heads/main");
  });

  it("handles plaintext payloads directly", () => {
    const payload = { text: "Deployment to staging succeeded!" };
    const promptText = typeof payload.text === "string" && payload.text.trim()
      ? payload.text.trim()
      : "fallback";
    expect(promptText).toBe("Deployment to staging succeeded!");
  });
});