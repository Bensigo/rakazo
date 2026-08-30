import type { AdapterContext, WebProvider } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";

const ctx: AdapterContext = {
  operationId: "1",
  traceId: "1",
  workspaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

/**
 * Offline conformance: every WebProvider must advertise search+fetch and honor
 * the request shape without requiring the network when given a fake backend.
 */
async function assertWebConformance(provider: WebProvider) {
  const desc = provider.describe();
  expect(desc.capabilities.search).toBe(true);
  expect(desc.capabilities.fetch).toBe(true);
  expect(desc.capabilities.readability).toBe(true);
  expect(desc.contractVersion).toBe("1");

  if (desc.id === "fake") {
    const fake = provider as FakeWebProvider;
    fake.searchHits = [{ title: "Hit", url: "https://example.test", snippet: "…" }];
    fake.fetchResult = {
      url: "https://example.test",
      title: "Hit",
      text: "body",
      truncated: false,
    };
    const hits = await provider.search({ query: "q", maxResults: 3 }, ctx);
    expect(hits).toHaveLength(1);
    const page = await provider.fetch({ url: "https://example.test", maxChars: 100 }, ctx);
    expect(page.text).toBe("body");
    return;
  }

  // Keyless provider: inject a deterministic fetch so conformance stays offline.
  const htmlSearch = `
    <div class="result">
      <a class="result__a" href="https://example.test/a">Alpha</a>
      <div class="result__snippet">Snippet</div>
    </div>`;
  const htmlPage = `<html><title>Page</title><body><p>Readable body text for conformance.</p></body></html>`;
  const fetchMock: typeof fetch = async (input) => {
    const href = String(input);
    if (href.includes("duckduckgo.com") || href.includes("q=")) {
      return new Response(htmlSearch, { status: 200 });
    }
    return new Response(htmlPage, { status: 200, headers: { "content-type": "text/html" } });
  };
  const keyless = new KeylessHttpWebProvider({
    fetch: fetchMock,
    resolveHostname: async () => [{ address: "203.0.113.10", family: 4 }],
  });
  const hits = await keyless.search({ query: "conformance", maxResults: 2 }, ctx);
  expect(hits[0]?.url).toMatch(/^https?:\/\//);
  const page = await keyless.fetch({ url: "https://example.test/a", maxChars: 500 }, ctx);
  expect(page.title).toBeTruthy();
  expect(page.text.length).toBeGreaterThan(0);
}

describe("web provider conformance", () => {
  it("holds for fake and keyless HTTP (offline)", async () => {
    await assertWebConformance(new FakeWebProvider());
    await assertWebConformance(new KeylessHttpWebProvider());
  });
});
