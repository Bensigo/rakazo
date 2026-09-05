import type { Actor } from "@rakazo/contracts";
import { IsolationError } from "./scope.js";
import { Prisma, type PrismaClient } from "./client.js";

async function organizationFor(prisma: PrismaClient, actor: Actor) {
  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    select: { organizationId: true, member: { select: { role: true } } },
  });
  if (!membership) throw new IsolationError();
  return membership;
}
async function organizationIdFor(prisma: PrismaClient, actor: Actor) { return (await organizationFor(prisma, actor)).organizationId; }
async function requireAdmin(prisma: PrismaClient, actor: Actor) {
  const membership = await organizationFor(prisma, actor);
  if (!actor.isDeploymentOwner && !["owner", "admin"].includes(membership.member.role)) throw new IsolationError("Studio admin access required");
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
      const organizationId = await requireAdmin(prisma, actor);
      return prisma.$transaction(async (tx) => {
        const foundation = await tx.studioFoundation.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
        const latest = await tx.foundationRevision.findFirst({ where: { foundationId: foundation.id }, orderBy: { revision: "desc" }, select: { revision: true } });
        const revision = await tx.foundationRevision.create({ data: { foundationId: foundation.id, revision: (latest?.revision ?? 0) + 1, content: content as Prisma.InputJsonValue, createdByUserId: actor.userId } });
        return tx.studioFoundation.update({ where: { id: foundation.id }, data: { currentRevisionId: revision.id }, include: { currentRevision: true } });
      });
    },
    async createProject(actor: Actor, input: { name: string; slug: string; scope: string }) {
      const organizationId = await requireAdmin(prisma, actor);
      return prisma.studioProject.create({
        data: { organizationId, name: input.name.trim(), slug: input.slug.trim(), scope: input.scope, createdByUserId: actor.userId },
      });
    },
    async roles(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.employeeRolePreset.findMany({ where: { organizationId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    },
    async createRole(actor: Actor, input: { key: string; name: string; description: string; instructions: string; isDefault: boolean; foundationRevisionId?: string | null }) {
      const organizationId = await requireAdmin(prisma, actor);
      if (input.foundationRevisionId) {
        const revision = await prisma.foundationRevision.findFirst({ where: { id: input.foundationRevisionId, foundation: { organizationId } }, select: { id: true } });
        if (!revision) throw new IsolationError("Foundation revision is outside this organization");
      }
      return prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.employeeRolePreset.updateMany({ where: { organizationId }, data: { isDefault: false } });
        return tx.employeeRolePreset.create({ data: { organizationId, ...input } });
      });
    },
    async updateRole(actor: Actor, id: string, input: { name?: string; description?: string; instructions?: string; isDefault?: boolean }) {
      const organizationId = await requireAdmin(prisma, actor);
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
    async assignments(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.assignmentManifest.findMany({ where: { project: { organizationId } }, orderBy: { createdAt: "desc" } });
    },
    async createAssignment(actor: Actor, input: { projectIds: string[]; taskId: string; botId: string; foundationRevisionId?: string | null; rolePresetId?: string | null; reviewerUserId?: string | null; manifest: Record<string, unknown> }) {
      const organizationId = await requireAdmin(prisma, actor);
      const projectIds = [...new Set(input.projectIds)];
      if (!projectIds.length) throw new IsolationError("At least one project is required");
      return prisma.$transaction(async (tx) => {
        const [projects, task, bot] = await Promise.all([
          tx.studioProject.findMany({ where: { id: { in: projectIds }, organizationId }, select: { id: true } }),
          tx.task.findFirst({ where: { id: input.taskId, spaceId: actor.spaceId }, select: { id: true, botId: true, assignment: { select: { id: true } } } }),
          tx.bot.findFirst({ where: { id: input.botId, spaceId: actor.spaceId }, select: { id: true } }),
        ]);
        if (projects.length !== projectIds.length) throw new IsolationError("Project is outside this organization");
        if (!task || task.botId !== input.botId || task.assignment) throw new IsolationError("Task and bot must belong to this space and task must be unassigned");
        if (!bot) throw new IsolationError("Bot is outside this space");
        if (input.foundationRevisionId) {
          const revision = await tx.foundationRevision.findFirst({ where: { id: input.foundationRevisionId, foundation: { organizationId } }, select: { id: true } });
          if (!revision) throw new IsolationError("Foundation revision is outside this organization");
        }
        if (input.rolePresetId) {
          const role = await tx.employeeRolePreset.findFirst({ where: { id: input.rolePresetId, organizationId }, select: { id: true } });
          if (!role) throw new IsolationError("Role preset is outside this organization");
        }
        return tx.assignmentManifest.create({ data: { projectId: projectIds[0]!, projectIds, taskId: input.taskId, botId: input.botId, foundationRevisionId: input.foundationRevisionId ?? null, rolePresetId: input.rolePresetId ?? null, manifest: input.manifest as Prisma.InputJsonValue, createdByUserId: actor.userId, reviewerUserId: input.reviewerUserId ?? null } });
      });
    },
    async acceptAssignment(actor: Actor, id: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      const current = await prisma.assignmentManifest.findFirst({ where: { id, project: { organizationId } }, select: { id: true, status: true, createdByUserId: true, reviewerUserId: true } });
      if (!current) throw new IsolationError();
      if (current.createdByUserId !== actor.userId && current.reviewerUserId !== actor.userId) throw new IsolationError("Only the assignment creator or reviewer can accept it");
      if (current.status !== "draft") return prisma.assignmentManifest.findUniqueOrThrow({ where: { id: current.id } });
      return prisma.assignmentManifest.update({ where: { id: current.id }, data: { status: "accepted", acceptedAt: new Date(), acceptedByUserId: actor.userId } });
    },
  };
}
