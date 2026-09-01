import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { createBrowserProvider } from "./browser-provider-factory.js";
import { ComputerBrowserProvider } from "./computer-browser.js";
import { FakeBrowserProvider } from "./fake-browser.js";
import { pageBrowserSessionKey } from "./page-browser-session.js";

const context: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

const pages = {
  "https://example.test/a": {
    title: "A",
    html: `<!doctype html><html><head><title>A</title></head><body>
      <input aria-label="Secret" value="from-bot-a" />
    </body></html>`,
  },
};

describe("computer browser provider", () => {
  it("defaults createBrowserProvider to computer, not fake", () => {
    const provider = createBrowserProvider();
    expect(provider.describe().id).toBe("computer");
  });

  it("falls back to computer_act on real computers", async () => {
    const provider = new ComputerBrowserProvider({ pages });
    const computer: ComputerRef = {
      id: "team-1",
      botId: "bot-a",
      kind: "docker",
      providerRef: "team-1",
    };
    const result = await provider.navigate(computer, { url: "https://example.test/a" }, context);
    expect(result).toMatchObject({
      fallback: "computer_act",
      error: expect.stringMatching(/not attached|computer_act/i),
    });
  });

  it("uses in-process pages for fake computers", async () => {
    const provider = new ComputerBrowserProvider({ pages });
    const computer: ComputerRef = {
      id: "c1",
      botId: "bot-a",
      kind: "fake",
      providerRef: "c1",
    };
    const result = await provider.navigate(computer, { url: "https://example.test/a" }, context);
    expect(result.fallback).toBeUndefined();
    expect(result.title).toBe("A");
  });
});

describe("page browser session isolation", () => {
  it("keeps Team bots on the same computer in separate sessions", async () => {
    const browser = new FakeBrowserProvider({ pages });
    const shared = { id: "team-computer", kind: "fake" as const, providerRef: "team-computer" };
    const botA: ComputerRef = { ...shared, botId: "bot-a" };
    const botB: ComputerRef = { ...shared, botId: "bot-b" };

    expect(pageBrowserSessionKey(botA)).not.toBe(pageBrowserSessionKey(botB));

    await browser.navigate(botA, { url: "https://example.test/a" }, context);
    const snapA = await browser.snapshot(botA, {}, context);
    const secret = snapA.elements.find((el) => el.name.includes("Secret"));
    expect(secret?.value).toBe("from-bot-a");

    // Bot B has not navigated; its session must not see bot A's page.
    const snapB = await browser.snapshot(botB, {}, context);
    expect(snapB.url).toBe("about:blank");
    expect(snapB.elements.find((el) => el.name.includes("Secret"))).toBeUndefined();
  });
});
