import type { RakazoDesktop, RakazoDesktopOAuthCallback } from "@rakazo/contracts";

export type { RakazoDesktop, RakazoDesktopOAuthCallback } from "@rakazo/contracts";

declare global {
  interface Window {
    rakazoDesktop?: RakazoDesktop;
  }
}

export function desktopBridge(): RakazoDesktop | undefined {
  return typeof window === "undefined" ? undefined : window.rakazoDesktop;
}

/** The compact `code#state` form the manual paste flow already accepts. */
export function desktopOAuthCode(callback: RakazoDesktopOAuthCallback) {
  return callback.state === undefined ? callback.code : `${callback.code}#${callback.state}`;
}

/**
 * Sign-in popups in the desktop app redirect to a loopback URL the renderer
 * never sees. The main process captures the code there so the browser flow's
 * copy-and-paste step can be skipped. No-ops in a browser.
 */
export function onDesktopOAuthCallback(listener: (code: string) => void): () => void {
  const oauth = desktopBridge()?.oauth;
  if (!oauth) return () => undefined;
  return oauth.onCallback((callback) => listener(desktopOAuthCode(callback)));
}

export function windowChromeKind(desktop?: RakazoDesktop): "spacer" | "darwin" | "controls" {
  if (!desktop) return "spacer";
  if (desktop.platform === "darwin") return "darwin";
  return "controls";
}
