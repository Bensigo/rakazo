import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import {
  createAddressCheckedLookup,
  isPrivateAddress,
  type ResolvedAddress,
  type ResolveHostname,
} from "./network-address.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type { ResolveHostname } from "./network-address.js";

export interface SafeWebFetchOptions {
  fetch?: typeof globalThis.fetch;
  resolveHostname?: ResolveHostname;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const defaultResolveHostname: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function assertSafeWebUrl(
  value: string,
  resolve: ResolveHostname = defaultResolveHostname,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http: and https: URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URL must not contain credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) {
    throw new Error("URL targets a private or internal host");
  }
  assertPublicAddresses(await resolve(hostname));
  return url;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal" ||
    normalized === "metadata.goog"
  ) {
    return true;
  }
  if (isIP(normalized) !== 0) return isPrivateAddress(normalized);
  return false;
}

export async function fetchSafeWebText(
  url: string,
  options: SafeWebFetchOptions = {},
): Promise<{ url: string; body: string; contentType: string | null }> {
  const resolve = options.resolveHostname ?? defaultResolveHostname;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const baseFetch = options.fetch ?? globalThis.fetch;
  const dispatcher = new Agent({
    connect: { lookup: createAddressCheckedLookup(resolve, assertPublicAddresses) },
  });

  try {
    return await followRedirects(url, {
      baseFetch,
      resolve,
      dispatcher,
      timeoutMs,
      maxBytes,
      userAgent: options.userAgent ?? "Rakazo/0.1 (+https://github.com/elie222/rakazo)",
      headers: options.headers,
      signal: options.signal,
      redirectsRemaining: MAX_REDIRECTS,
    });
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

async function followRedirects(
  rawUrl: string,
  state: {
    baseFetch: typeof globalThis.fetch;
    resolve: ResolveHostname;
    dispatcher: Agent;
    timeoutMs: number;
    maxBytes: number;
    userAgent: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    redirectsRemaining: number;
  },
): Promise<{ url: string; body: string; contentType: string | null }> {
  const validated = await assertSafeWebUrl(rawUrl, state.resolve);
  const signal = combineSignals(state.signal, AbortSignal.timeout(state.timeoutMs));
  const response = await state.baseFetch(validated.href, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "user-agent": state.userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      ...state.headers,
    },
    dispatcher: state.dispatcher,
  } as RequestInit & { dispatcher: Agent });

  if (response.status >= 300 && response.status < 400) {
    if (state.redirectsRemaining <= 0) {
      throw new Error("Too many redirects");
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing Location header");
    const next = new URL(location, validated.href).href;
    // Re-validate every hop — a public host must not 302 into a private one.
    return followRedirects(next, {
      ...state,
      redirectsRemaining: state.redirectsRemaining - 1,
    });
  }

  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > state.maxBytes) {
    throw new Error("Response is too large");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > state.maxBytes) {
    throw new Error("Response is too large");
  }

  return {
    url: validated.href,
    body: new TextDecoder().decode(buffer),
    contentType: response.headers.get("content-type"),
  };
}

function assertPublicAddresses(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("URL resolves to a private address");
  }
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0]!;
  return AbortSignal.any(active);
}
