import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { webFetchFromTool, webSearchFromTool } from "./web-tools.js";

/**
 * Mirrors executor apply for web_search / web_fetch: the executor calls these
 * helpers with deps.web, so a fake provider must be enough to drive results.
 */
describe("executor web tool apply", () => {
  const ctx: AdapterContext = {
    operationId: "op",
    traceId: "tr",
    workspaceId: "ws",
    userId: "u",
    botId: "b",
    signal: new AbortController().signal,
  };

  it("returns fake provider results for web_search and web_fetch", async () => {
    const web = new FakeWebProvider();
    web.searchHits = [{ title: "Rakazo", url: "https://example.test/rakazo", snippet: "agents" }];
    web.fetchResult = {
      url: "https://example.test/rakazo",
      title: "Rakazo",
      text: "Bots without a computer can still look things up.",
      truncated: false,
    };

    const search = await webSearchFromTool(web, ctx, { query: "rakazo", maxResults: 5 });
    expect(search).toEqual({
      results: [{ title: "Rakazo", url: "https://example.test/rakazo", snippet: "agents" }],
    });

    const page = await webFetchFromTool(web, ctx, {
      url: "https://example.test/rakazo",
      maxChars: 8_000,
    });
    expect(page).toMatchObject({
      title: "Rakazo",
      text: expect.stringContaining("look things up"),
      truncated: false,
    });
  });
});
