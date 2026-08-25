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

/** Split the compact form produced by {@link desktopOAuthCode}. */
export function desktopOAuthCodeParts(value: string): { code: string; state?: string } {
  const hash = value.indexOf("#");
  if (hash === -1) return { code: value };
  return { code: value.slice(0, hash), state: value.slice(hash + 1) };
}

/**
 * Providers that put `state` on the authorize URL (Anthropic) let the renderer
 * ignore a captured callback from a cancelled popup when a newer attempt is active.
 */
export function oauthStateFromAuthorizeUrl(verificationUri: string): string | undefined {
  try {
    return new URL(verificationUri).searchParams.get("state")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** True when a desktop-captured code belongs to the in-flight authorize attempt. */
export function desktopOAuthCaptureMatches(
  captured: string,
  verificationUri: string | undefined,
): boolean {
  if (!verificationUri) return false;
  const expected = oauthStateFromAuthorizeUrl(verificationUri);
  if (!expected) return true;
  return desktopOAuthCodeParts(captured).state === expected;
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
