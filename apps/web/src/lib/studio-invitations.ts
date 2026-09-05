import { withSpaceHeaders } from "./rpc";

export type StudioInvitation = {
  id: string;
  email: string;
  status: "pending";
  expiresAt: string;
  organizationName: string;
};

export type CreatedStudioInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  inviteUrl: string;
};

export async function createStudioInvitation(email: string): Promise<CreatedStudioInvitation> {
  return invitationRequest("/api/studio/invitations", {
    method: "POST",
    headers: withSpaceHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ email }),
  });
}

export async function getStudioInvitation(invitationId: string): Promise<StudioInvitation> {
  return invitationRequest(`/api/studio/invitations/${encodeURIComponent(invitationId)}`);
}

export async function acceptStudioInvitation(invitationId: string): Promise<void> {
  await invitationRequest(`/api/studio/invitations/${encodeURIComponent(invitationId)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function safeAuthNext(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://rakazo.invalid");
    if (url.origin !== "https://rakazo.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function invitationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  const body = (await response.json().catch(() => null)) as
    | ({ error?: string; message?: string } & T)
    | null;
  if (!response.ok) {
    throw new Error(body?.error ?? body?.message ?? "Invitation request failed");
  }
  return body as T;
}
