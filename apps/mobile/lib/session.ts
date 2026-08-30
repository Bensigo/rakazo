import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "rakazo.session_token";

/** In-memory gate so a failed SecureStore wipe cannot keep sending the old bearer. */
let sessionInvalidated = false;

export async function loadSessionToken() {
  if (sessionInvalidated) return "";
  try {
    return (await SecureStore.getItemAsync(SESSION_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function saveSessionToken(token: string) {
  sessionInvalidated = false;
  await SecureStore.setItemAsync(SESSION_KEY, token);
}

/** Clears the session. Returns false only when SecureStore could neither delete nor overwrite. */
export async function clearSessionToken(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    sessionInvalidated = false;
    return true;
  } catch {
    try {
      await SecureStore.setItemAsync(SESSION_KEY, "");
      sessionInvalidated = false;
      return true;
    } catch {
      sessionInvalidated = true;
      return false;
    }
  }
}

/** Drop the in-memory gate when a failed wipe left the bearer in SecureStore. */
export function acknowledgeStoredSession() {
  sessionInvalidated = false;
}

/** Read the stored token even if the in-memory gate is set (for restore snapshots). */
export async function peekStoredSessionToken() {
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
