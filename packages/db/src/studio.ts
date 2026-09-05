import type { Actor } from "@rakazo/contracts";
import { IsolationError } from "./scope.js";
import { Prisma, type PrismaClient } from "./client.js";

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
    async publishFoundation(actor: Actor, content: Record<string, unknown>) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.$transaction(async (tx) => {
        const foundation = await tx.studioFoundation.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
        const latest = await tx.foundationRevision.findFirst({ where: { foundationId: foundation.id }, orderBy: { revision: "desc" }, select: { revision: true } });
        const revision = await tx.foundationRevision.create({ data: { foundationId: foundation.id, revision: (latest?.revision ?? 0) + 1, content: content as Prisma.InputJsonValue, createdByUserId: actor.userId } });
        return tx.studioFoundation.update({ where: { id: foundation.id }, data: { currentRevisionId: revision.id }, include: { currentRevision: true } });
      });
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
    async createRole(actor: Actor, input: { key: string; name: string; description: string; instructions: string; isDefault: boolean }) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.employeeRolePreset.updateMany({ where: { organizationId }, data: { isDefault: false } });
        return tx.employeeRolePreset.create({ data: { organizationId, ...input } });
      });
    },
    async updateRole(actor: Actor, id: string, input: { name?: string; description?: string; instructions?: string; isDefault?: boolean }) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.$transaction(async (tx) => {
        const existing = await tx.employeeRolePreset.findFirst({ where: { id, organizationId } });
        if (!existing) throw new IsolationError();
        if (input.isDefault) await tx.employeeRolePreset.updateMany({ where: { organizationId, id: { not: id } }, data: { isDefault: false } });
        return tx.employeeRolePreset.update({ where: { id }, data: input });
      });
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
