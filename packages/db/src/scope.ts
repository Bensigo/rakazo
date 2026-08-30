import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";

export class IsolationError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "IsolationError";
  }
}

export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  requestedWorkspaceId?: string | null,
): Promise<Actor> {
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      ...(requestedWorkspaceId ? { workspaceId: requestedWorkspaceId } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { member: { include: { user: true } } },
  });
  if (!membership) {
    throw new IsolationError("No personal workspace");
  }
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
  });
  return {
    userId: membership.userId,
    workspaceId: membership.workspaceId,
    email: membership.member.user.email,
    isDeploymentOwner: settings?.ownerUserId === membership.userId,
  };
}

export function scoped<T extends { workspaceId: string; userId?: string }>(
  actor: Actor,
  record: T | null,
): T {
  if (!record || record.workspaceId !== actor.workspaceId) {
    throw new IsolationError();
  }
  if (record.userId && record.userId !== actor.userId) {
    throw new IsolationError();
  }
  return record;
}
