import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "rakazo.session_token";

/** In-memory gate so a failed SecureStore wipe cannot keep sending the old bearer. */
let sessionInvalidated = false;
let sessionFallback: string | undefined;

export async function loadSessionToken() {
  if (sessionFallback !== undefined) return sessionFallback;
  if (sessionInvalidated) return "";
  try {
    return (await SecureStore.getItemAsync(SESSION_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function saveSessionToken(token: string) {
  await SecureStore.setItemAsync(SESSION_KEY, token);
  sessionInvalidated = false;
  sessionFallback = undefined;
}

/** Clears the session. Returns false only when SecureStore could neither delete nor overwrite. */
export async function clearSessionToken(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    sessionInvalidated = false;
    sessionFallback = undefined;
    return true;
  } catch {
    try {
      await SecureStore.setItemAsync(SESSION_KEY, "");
      sessionInvalidated = false;
      sessionFallback = undefined;
      return true;
    } catch {
      sessionInvalidated = true;
      sessionFallback = undefined;
      return false;
    }
  }
}

/** Restores the current-server session in memory even when persistence is unavailable. */
export async function restoreSessionToken(token: string) {
  if (!token) {
    sessionInvalidated = false;
    sessionFallback = undefined;
    return;
  }
  try {
    await saveSessionToken(token);
  } catch {
    sessionInvalidated = false;
    sessionFallback = token;
  }
}

/** Read the active token for restore snapshots, including in-memory fallbacks. */
export async function peekStoredSessionToken() {
  if (sessionFallback) return sessionFallback;
  try {
    return (await SecureStore.getItemAsync(SESSION_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function tokenFromAuthResponse(res: Response, body: unknown) {
  const fromJson = jsonToken(body);
  if (fromJson) return fromJson;
  const cookies = res.headers.get("set-cookie") ?? "";
  const match = cookies.match(/better-auth\.session_token=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function jsonToken(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.token === "string" && record.token) return record.token;
  const session = record.session;
  if (
    session &&
    typeof session === "object" &&
    typeof (session as { token?: string }).token === "string"
  ) {
    return (session as { token: string }).token;
  }
  return "";
}
