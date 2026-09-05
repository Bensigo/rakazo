import type { Actor } from "@rakazo/contracts";
import { IsolationError } from "./scope.js";
import type { PrismaClient } from "./client.js";

async function organizationIdFor(prisma: PrismaClient, actor: Actor): Promise<string> {
  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    select: { organizationId: true },
  });
  if (!membership) throw new IsolationError();
  return membership.organizationId;
}

export function createStudioDomain(prisma: PrismaClient) {
  return {
    async foundation(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.studioFoundation.findUnique({
        where: { organizationId },
        include: { currentRevision: true },
      });
    },
    async projects(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.studioProject.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
    },
    async createProject(actor: Actor, input: { name: string; slug: string; scope: string }) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.studioProject.create({
        data: { organizationId, name: input.name.trim(), slug: input.slug.trim(), scope: input.scope, createdByUserId: actor.userId },
      });
    },
    async roles(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.employeeRolePreset.findMany({ where: { organizationId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    },
    async assignment(actor: Actor, id: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.assignmentManifest.findFirst({ where: { id, project: { organizationId } } });
    },
    async acceptAssignment(actor: Actor, id: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      const current = await prisma.assignmentManifest.findFirst({ where: { id, project: { organizationId } }, select: { id: true, status: true } });
      if (!current) throw new IsolationError();
      if (current.status !== "draft") return prisma.assignmentManifest.findUniqueOrThrow({ where: { id: current.id } });
      return prisma.assignmentManifest.update({ where: { id: current.id }, data: { status: "accepted", acceptedAt: new Date(), acceptedByUserId: actor.userId } });
    },
  };
}
