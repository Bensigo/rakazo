import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  desktopOAuthCaptureMatches,
  desktopOAuthCode,
  desktopOAuthCodeParts,
  oauthStateFromAuthorizeUrl,
  type RakazoDesktop,
  windowChromeKind,
} from "./desktop.js";

function desktop(platform: string): RakazoDesktop {
  return {
    platform,
    window: {
      close: async () => undefined,
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
    },
    oauth: { onCallback: () => () => undefined },
  };
}

describe("window chrome", () => {
  it("does not paint fake traffic lights in the browser", () => {
    expect(windowChromeKind(undefined)).toBe("spacer");
  });

  it("leaves macOS traffic lights to Electron", () => {
    expect(windowChromeKind(desktop("darwin"))).toBe("darwin");
  });

  it("uses real window-control buttons on Windows and Linux", () => {
    expect(windowChromeKind(desktop("win32"))).toBe("controls");
    expect(windowChromeKind(desktop("linux"))).toBe("controls");
  });

  it("does not paint fake traffic lights into the browser shell or welcome page", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../pages");
    const shell = readFileSync(path.join(root, "Shell.tsx"), "utf8");
    const welcome = readFileSync(path.join(root, "Welcome.tsx"), "utf8");
    expect(shell).not.toContain("FF5F57");
    expect(welcome).not.toContain("FF5F57");
  });
});

describe("captured OAuth callbacks", () => {
  it("sends the code and state as the compact form the paste flow accepts", () => {
    expect(desktopOAuthCode({ code: "ac_123", state: "verifier_456" })).toBe("ac_123#verifier_456");
  });

  it("sends a bare code when the provider redirects without state", () => {
    expect(desktopOAuthCode({ code: "ac_123" })).toBe("ac_123");
  });

  it("splits the compact form back into code and state", () => {
    expect(desktopOAuthCodeParts("ac_123#verifier_456")).toEqual({
      code: "ac_123",
      state: "verifier_456",
    });
    expect(desktopOAuthCodeParts("ac_123")).toEqual({ code: "ac_123" });
  });

  it("reads state from the authorize URL when the provider embeds it", () => {
    expect(
      oauthStateFromAuthorizeUrl("https://claude.ai/oauth/authorize?state=verifier_456&code=true"),
    ).toBe("verifier_456");
    expect(oauthStateFromAuthorizeUrl("https://claude.ai/oauth/authorize")).toBeUndefined();
  });

  it("ignores captured codes whose state does not match the active authorize URL", () => {
    const uri = "https://claude.ai/oauth/authorize?state=active";
    expect(desktopOAuthCaptureMatches("ac_123#active", uri)).toBe(true);
    expect(desktopOAuthCaptureMatches("ac_123#stale", uri)).toBe(false);
    expect(desktopOAuthCaptureMatches("ac_123", uri)).toBe(false);
    expect(desktopOAuthCaptureMatches("ac_123#any", "https://claude.ai/oauth/authorize")).toBe(
      true,
    );
  });
});
