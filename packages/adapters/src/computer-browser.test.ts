import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { createBrowserProvider } from "./browser-provider-factory.js";
import { ComputerBrowserProvider } from "./computer-browser.js";
import { FakeBrowserProvider } from "./fake-browser.js";
import { pageBrowserSessionKey } from "./page-browser-session.js";

const baseContext: AdapterContext = {
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

  it("falls back to computer_act when live Chrome is unavailable", async () => {
    const provider = new ComputerBrowserProvider({ pages });
    const computer: ComputerRef = {
      id: "team-1",
      botId: "home-key",
      kind: "docker",
      providerRef: "team-1",
    };
    const result = await provider.navigate(
      computer,
      { url: "https://example.test/a" },
      { ...baseContext, botId: "bot-a" },
    );
    expect(result).toMatchObject({
      fallback: "computer_act",
      error: expect.stringMatching(/not attached|computer_act|live page browser/i),
    });
  });

  it("drives the live page path when the CDP helper succeeds", async () => {
    const liveDriver = vi.fn(async (_c, _ctx, command, args) => {
      if (command === "navigate") {
        return { ok: true, url: String(args.url), title: "Live" };
      }
      if (command === "snapshot") {
        return {
          ok: true,
          url: "https://example.test/live",
          title: "Live",
          tree: '- textbox "Secret" [e1] value="live-secret"',
          elements: [{ ref: "e1", role: "textbox", name: "Secret", value: "live-secret" }],
        };
      }
      return {
        ok: true,
        completed: 1,
        url: "https://example.test/live",
        title: "Live",
        tree: '- textbox "Secret" [e1] value="typed"',
        elements: [{ ref: "e1", role: "textbox", name: "Secret", value: "typed" }],
      };
    });
    const provider = new ComputerBrowserProvider({ pages, liveDriver });
    const computer: ComputerRef = {
      id: "team-1",
      botId: "home-key",
      kind: "docker",
      providerRef: "team-1",
    };
    const context = { ...baseContext, botId: "bot-a" };
    const nav = await provider.navigate(computer, { url: "https://example.test/live" }, context);
    expect(nav).toEqual({ url: "https://example.test/live", title: "Live" });
    const snap = await provider.snapshot(computer, {}, context);
    expect(snap.fallback).toBeUndefined();
    expect(snap.elements[0]?.value).toBe("live-secret");
    const act = await provider.act(
      computer,
      { actions: [{ kind: "fill", ref: "e1", text: "typed" }] },
      context,
    );
    expect(act.ok).toBe(true);
    expect(act.completed).toBe(1);
    expect(liveDriver).toHaveBeenCalled();
    expect(liveDriver.mock.calls[0]?.[3]).toMatchObject({
      sessionKey: pageBrowserSessionKey(computer, context),
    });
  });

  it("returns computer_act when the live driver reports failure", async () => {
    const provider = new ComputerBrowserProvider({
      pages,
      liveDriver: async () => ({
        ok: false,
        error: "chrome not listening",
        fallback: "computer_act",
      }),
    });
    const computer: ComputerRef = {
      id: "c1",
      botId: "home-key",
      kind: "docker",
      providerRef: "c1",
    };
    const result = await provider.snapshot(computer, {}, { ...baseContext, botId: "bot-a" });
    expect(result.fallback).toBe("computer_act");
    expect(result.error).toMatch(/chrome not listening/i);
  });

  it("uses in-process pages for fake computers", async () => {
    const provider = new ComputerBrowserProvider({ pages });
    const computer: ComputerRef = {
      id: "c1",
      botId: "bot-a",
      kind: "fake",
      providerRef: "c1",
    };
    const result = await provider.navigate(
      computer,
      { url: "https://example.test/a" },
      baseContext,
    );
    expect(result.fallback).toBeUndefined();
    expect(result.title).toBe("A");
  });
});

describe("page browser session isolation", () => {
  it("keeps Team bots on the same computer in separate sessions", async () => {
    const browser = new FakeBrowserProvider({ pages });
    // Production Team computers share computer.botId (home key) across bots.
    const shared: ComputerRef = {
      id: "team-computer",
      botId: "team-home",
      kind: "fake",
      providerRef: "team-computer",
    };
    const contextA = { ...baseContext, botId: "bot-a" };
    const contextB = { ...baseContext, botId: "bot-b" };

    expect(pageBrowserSessionKey(shared, contextA)).not.toBe(
      pageBrowserSessionKey(shared, contextB),
    );

    await browser.navigate(shared, { url: "https://example.test/a" }, contextA);
    const snapA = await browser.snapshot(shared, {}, contextA);
    const secret = snapA.elements.find((el) => el.name.includes("Secret"));
    expect(secret?.value).toBe("from-bot-a");

    // Bot B has not navigated; its session must not see bot A's page.
    const snapB = await browser.snapshot(shared, {}, contextB);
    expect(snapB.url).toBe("about:blank");
    expect(snapB.elements.find((el) => el.name.includes("Secret"))).toBeUndefined();
  });
});
