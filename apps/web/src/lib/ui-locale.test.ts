import { describe, expect, it } from "vitest";
import { resolveUiLocale, selectUiLocale } from "./ui-locale";

describe("selectUiLocale", () => {
  it("prefers a deployment locale over browser language", () => {
    expect(selectUiLocale("ko", null, "en-US")).toBe("ko");
  });

  it("allows a saved user choice to override browser language", () => {
    expect(selectUiLocale(null, "ko-KR", "en-US")).toBe("ko-KR");
  });

  it("falls back to browser language and then English", () => {
    expect(selectUiLocale(null, null, "ko-KR")).toBe("ko-KR");
    expect(selectUiLocale(null, null, null)).toBe("en");
  });
});

describe("resolveUiLocale", () => {
  it("falls back when storage access is blocked", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => resolveUiLocale()).not.toThrow();
      expect(typeof resolveUiLocale()).toBe("string");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
