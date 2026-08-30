import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { AppContract } from "@rakazo/contracts";

const WORKSPACE_STORAGE_KEY = "rakazo:private-space-id";

export function selectedPrivateSpaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function selectPrivateSpace(id: string): void {
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
}

export function clearPrivateSpaceSelection(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

/** Adds `x-rakazo-workspace-id` when a private space is selected. */
export function withPrivateSpaceHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const workspaceId = selectedPrivateSpaceId();
  if (workspaceId) headers.set("x-rakazo-workspace-id", workspaceId);
  return headers;
}

const link = new RPCLink({
  url: () =>
    typeof window === "undefined" ? "http://127.0.0.1:5173/rpc" : `${window.location.origin}/rpc`,
  fetch: (input, init) => {
    const request = new Request(input, init);
    return fetch(request, {
      headers: withPrivateSpaceHeaders(request.headers),
      credentials: "include",
    });
  },
});

export const rpc: ContractRouterClient<AppContract> = createORPCClient(link);
