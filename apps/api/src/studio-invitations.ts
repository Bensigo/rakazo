import type { Auth } from "@rakazo/auth";
import { type PrismaClient, requireMembership } from "@rakazo/db";
import type { Hono } from "hono";

type InvitationDeps = {
  prisma: PrismaClient;
  auth: Auth;
  authBaseUrl: string;
  webOrigin: string;
};

/**
 * Narrow employee-invitation surface. Organization and role are always derived
 * by the server; the broader Better Auth organization mutation routes remain
 * unavailable at the public auth catch-all.
 */
export function mountStudioInvitationRoutes(app: Hono, deps: InvitationDeps): void {
  app.post("/api/studio/invitations", async (c) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Unauthorized" }, 401);

    const actor = await requireMembership(
      deps.prisma,
      session.user.id,
      c.req.header("x-rakazo-space-id"),
      session.session.activeOrganizationId,
    ).catch(() => null);
    if (!actor) return c.json({ error: "Studio not found" }, 404);

    const membership = await deps.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      select: { organizationId: true, member: { select: { role: true } } },
    });
    const settings = await deps.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { ownerUserId: true },
    });
    if (
      !membership ||
      (settings?.ownerUserId !== actor.userId &&
        !["owner", "admin"].includes(membership.member.role))
    ) {
      return c.json({ error: "Studio admin access required" }, 403);
    }

    const body = await readObject(c.req.raw);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return c.json({ error: "Employee email is required" }, 400);

    const response = await callOrganizationAuth(deps, c.req.raw, "/invite-member", {
      email,
      role: "member",
      organizationId: membership.organizationId,
    });
    if (!response.ok) return response;
    const result = await readObject(response);
    const invitationId = typeof result?.id === "string" ? result.id : "";
    if (!invitationId) return c.json({ error: "Invitation response was invalid" }, 502);

    const invitation = await deps.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        organizationId: membership.organizationId,
        email,
        status: "pending",
      },
      select: { id: true, email: true, expiresAt: true },
    });
    if (!invitation) return c.json({ error: "Invitation was not persisted" }, 502);

    return c.json({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      inviteUrl: new URL(`/invite/${encodeURIComponent(invitation.id)}`, deps.webOrigin).href,
    });
  });

  app.get("/api/studio/invitations/:invitationId", async (c) => {
    const invitationId = c.req.param("invitationId");
    const response = await callOrganizationAuth(
      deps,
      c.req.raw,
      `/get-invitation?id=${encodeURIComponent(invitationId)}`,
    );
    if (!response.ok) return response;

    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Unauthorized" }, 401);
    const invitation = await deps.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        email: { equals: session.user.email, mode: "insensitive" },
        status: "pending",
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
    });
    if (!invitation) return c.json({ error: "Invitation not found" }, 404);
    return c.json({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      organizationName: invitation.organization.name,
    });
  });

  app.post("/api/studio/invitations/:invitationId/accept", async (c) => {
    const invitationId = c.req.param("invitationId");
    return callOrganizationAuth(deps, c.req.raw, "/accept-invitation", { invitationId });
  });
}

async function callOrganizationAuth(
  deps: InvitationDeps,
  source: Request,
  route: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers(source.headers);
  if (body) headers.set("content-type", "application/json");
  const target = new URL(`/api/auth/organization${route}`, deps.authBaseUrl);
  return deps.auth.handler(
    new Request(target, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function readObject(request: Request | Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
