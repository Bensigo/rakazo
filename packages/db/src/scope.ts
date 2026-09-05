import type { Actor } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "./client.js";

export class IsolationError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "IsolationError";
  }
}

export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  requestedSpaceId?: string | null,
  preferredOrganizationId?: string | null,
): Promise<Actor> {
  const findMembership = (where: Prisma.SpaceMemberWhereInput) =>
    prisma.spaceMember.findFirst({
      where,
      orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
      include: { member: { include: { user: true } } },
    });
  let membership = await findMembership({
    userId,
    ...(requestedSpaceId ? { spaceId: requestedSpaceId } : {}),
    ...(!requestedSpaceId && preferredOrganizationId
      ? { organizationId: preferredOrganizationId }
      : {}),
  });
  if (!membership && !requestedSpaceId && preferredOrganizationId) {
    membership = await findMembership({ userId });
  }
  if (!membership) {
    throw new IsolationError("No personal space");
  }
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
  });
  return {
    userId: membership.userId,
    spaceId: membership.spaceId,
    email: membership.member.user.email,
    isDeploymentOwner: settings?.ownerUserId === membership.userId,
  };
}

export function scoped<T extends { spaceId: string; userId?: string }>(
  actor: Actor,
  record: T | null,
): T {
  if (!record || record.spaceId !== actor.spaceId) {
    throw new IsolationError();
  }
  if (record.userId && record.userId !== actor.userId) {
    throw new IsolationError();
  }
  return record;
}
