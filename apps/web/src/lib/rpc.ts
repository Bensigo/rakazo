import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { AppContract } from "@rakazo/contracts";

const WORKSPACE_STORAGE_KEY = "rakazo:private-space-id";

type RpcClientContext = { privateSpaceId?: string | null };

export function selectedPrivateSpaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function selectPrivateSpace(id: string): boolean {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    return true;
  } catch {
    try {
      // Write failed but the desired selection is already durable — treat as success.
      return window.localStorage.getItem(WORKSPACE_STORAGE_KEY) === id;
    } catch {
      return false;
    }
  }
}

export function clearPrivateSpaceSelection(): void {
  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Ignore storage failures on sign-out / reset paths.
  }
}

/** Adds `x-rakazo-workspace-id` when a private space is selected. */
export function withPrivateSpaceHeaders(
  init?: HeadersInit,
  workspaceId: string | null = selectedPrivateSpaceId(),
): Headers {
  const headers = new Headers(init);
  if (workspaceId) headers.set("x-rakazo-workspace-id", workspaceId);
  else headers.delete("x-rakazo-workspace-id");
  return headers;
}

const link = new RPCLink<RpcClientContext>({
  url: () =>
    typeof window === "undefined" ? "http://127.0.0.1:5173/rpc" : `${window.location.origin}/rpc`,
  fetch: (input, init, options) => {
    const request = new Request(input, init);
    const workspaceId =
      options.context.privateSpaceId === undefined
        ? selectedPrivateSpaceId()
        : options.context.privateSpaceId;
    return fetch(request, {
      headers: withPrivateSpaceHeaders(request.headers, workspaceId),
      credentials: "include",
    });
  },
});

export const rpc: ContractRouterClient<AppContract, RpcClientContext> = createORPCClient(link);
