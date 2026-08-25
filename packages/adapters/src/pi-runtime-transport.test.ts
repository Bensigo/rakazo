import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { reliableStreamOptions } from "./pi-runtime.js";

describe("Pi runtime transport", () => {
  it("forces SSE for Codex OAuth models", () => {
    const model = {
      provider: "openai-codex",
      api: "openai-codex-responses",
    } as Model<Api>;

    expect(reliableStreamOptions(model, { transport: "auto", maxRetries: 4 })).toEqual({
      transport: "sse",
      maxRetries: 4,
    });
  });

  it("leaves other provider transports unchanged", () => {
    const model = { provider: "openrouter", api: "openai-completions" } as Model<Api>;
    const options = { transport: "auto" as const, maxRetries: 2 };

    expect(reliableStreamOptions(model, options)).toBe(options);
  });
});
