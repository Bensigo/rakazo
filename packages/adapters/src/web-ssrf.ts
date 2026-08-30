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
  signal?: AbortSignal,
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
  assertPublicAddresses(await withAbort(resolve(hostname), signal));
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
  // One deadline for the whole redirect chain + body read, not per hop.
  const signal = combineSignals(options.signal, AbortSignal.timeout(timeoutMs));

  try {
    return await followRedirects(url, {
      baseFetch,
      resolve,
      dispatcher,
      maxBytes,
      userAgent: options.userAgent ?? "Rakazo/0.1 (+https://github.com/elie222/rakazo)",
      headers: options.headers,
      signal,
      redirectsRemaining: MAX_REDIRECTS,
    });
  } finally {
    // destroy() tears down immediately; close() can wait on unread redirect bodies.
    dispatcher.destroy();
  }
}

async function followRedirects(
  rawUrl: string,
  state: {
    baseFetch: typeof globalThis.fetch;
    resolve: ResolveHostname;
    dispatcher: Agent;
    maxBytes: number;
    userAgent: string;
    headers?: Record<string, string>;
    signal: AbortSignal;
    redirectsRemaining: number;
  },
): Promise<{ url: string; body: string; contentType: string | null }> {
  if (state.signal.aborted) {
    throw abortError(state.signal);
  }
  const validated = await assertSafeWebUrl(rawUrl, state.resolve, state.signal);
  const response = await state.baseFetch(validated.href, {
    method: "GET",
    redirect: "manual",
    signal: state.signal,
    headers: {
      "user-agent": state.userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      ...state.headers,
    },
    dispatcher: state.dispatcher,
  } as RequestInit & { dispatcher: Agent });

  if (response.status >= 300 && response.status < 400) {
    try {
      if (state.redirectsRemaining <= 0) {
        throw new Error("Too many redirects");
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect missing Location header");
      const next = new URL(location, validated.href).href;
      // Re-validate every hop — a public host must not 302 into a private one.
      return await followRedirects(next, {
        ...state,
        redirectsRemaining: state.redirectsRemaining - 1,
      });
    } finally {
      await cancelResponseBody(response);
    }
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`Request failed: HTTP ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > state.maxBytes) {
    await cancelResponseBody(response);
    throw new Error("Response is too large");
  }

  const buffer = await readBodyCapped(response, state.maxBytes, state.signal);

  return {
    url: validated.href,
    body: new TextDecoder().decode(buffer),
    contentType: response.headers.get("content-type"),
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Read the body as a stream and abort once maxBytes is exceeded (DoS guard). */
export async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error("Response is too large");
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw abortError(signal);
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Response is too large");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already cancelled / released
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function assertPublicAddresses(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("URL resolves to a private address");
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Request timed out");
}

/** Race a promise against an AbortSignal so stalled DNS cannot outlive the deadline. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0]!;
  return AbortSignal.any(active);
}
