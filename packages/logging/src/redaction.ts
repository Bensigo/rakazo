const REDACTED = "[Redacted]";
const REDACT_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "api_key",
  "credential",
  "credentials",
  "email",
  "prompt",
  "message",
  "messages",
  "body",
  "query",
  "rawheaders",
  "headers",
  "cookieheader",
]);

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (value instanceof Error) return value;
  if (value instanceof Date) return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = shouldRedactKey(key) ? REDACTED : redactValue(nested, seen);
  }
  return output;
}

export function redactBindings(bindings: Record<string, unknown>): Record<string, unknown> {
  return redactValue(bindings) as Record<string, unknown>;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+\S+/gi;
const SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:password|secret|token|authorization|apikey|api_key)[A-Za-z0-9_]*)\s*[:=]\s*\S+/gi;
/** OpenRouter/OpenAI-style keys and compact JWTs that appear bare in error text. */
const API_KEY_PREFIX = /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{8,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const COMPOSIO_KEY = /\b(?:ak_|ck_)[A-Za-z0-9]+\b/g;

export function redactSensitiveText(text: string): string {
  return text
    .replace(EMAIL, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`)
    .replace(API_KEY_PREFIX, REDACTED)
    .replace(JWT, REDACTED)
    .replace(COMPOSIO_KEY, REDACTED);
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (REDACT_KEYS.has(normalized)) return true;
  return /password|secret|token|authorization|cookie|credential|apikey/.test(normalized);
}
