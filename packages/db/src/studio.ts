import { createHash } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "./client.js";
import { createBotInTransaction } from "./repos.js";
import { IsolationError } from "./scope.js";
import { withTransactionRetry } from "./transaction-retry.js";

async function organizationFor(prisma: PrismaClient, actor: Actor) {
  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    select: {
      id: true,
      organizationId: true,
      jobRoleId: true,
      member: { select: { role: true } },
    },
  });
  if (!membership) throw new IsolationError();
  return membership;
}
async function organizationIdFor(prisma: PrismaClient, actor: Actor) {
  return (await organizationFor(prisma, actor)).organizationId;
}
async function requireAdmin(prisma: PrismaClient, actor: Actor) {
  const membership = await organizationFor(prisma, actor);
  if (!actor.isDeploymentOwner && !["owner", "admin"].includes(membership.member.role))
    throw new IsolationError("Studio admin access required");
  return membership.organizationId;
}

function parseRolePresetIds(value: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== "string" || id.trim().length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new IsolationError("Job role has invalid specialist presets");
  }
  return value as string[];
}

async function validatedRolePresets(
  prisma: Pick<Prisma.TransactionClient, "employeeRolePreset">,
  organizationId: string,
  presetIds: string[],
) {
  if (new Set(presetIds).size !== presetIds.length) {
    throw new IsolationError("Duplicate specialist preset");
  }
  const presets = await prisma.employeeRolePreset.findMany({
    where: { id: { in: presetIds }, organizationId },
    select: { id: true, name: true, description: true },
  });
  if (presets.length !== presetIds.length) {
    throw new IsolationError("Specialist preset is outside this organization");
  }
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  return presetIds.map((id) => byId.get(id)!);
}

export function createStudioDomain(prisma: PrismaClient) {
  return {
    async permissions(actor: Actor) {
      const membership = await organizationFor(prisma, actor);
      const memberRole = membership.member.role;
      const canManage = actor.isDeploymentOwner || ["owner", "admin"].includes(memberRole);
      return { memberRole, canManageJobRoles: canManage, canManageFoundation: canManage };
    },
    async jobRoles(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.employeeJobRole.findMany({
        where: { organizationId },
        orderBy: { name: "asc" },
      });
    },
    async createJobRole(
      actor: Actor,
      input: {
        key: string;
        name: string;
        description?: string;
        defaultRolePresetIds: string[];
      },
    ) {
      const organizationId = await requireAdmin(prisma, actor);
      await validatedRolePresets(prisma, organizationId, input.defaultRolePresetIds);
      return prisma.employeeJobRole.create({
        data: {
          organizationId,
          key: input.key.trim(),
          name: input.name.trim(),
          description: input.description?.trim() ?? "",
          defaultRolePresetIds: input.defaultRolePresetIds,
        },
      });
    },
    async updateJobRole(
      actor: Actor,
      id: string,
      input: { name?: string; description?: string; defaultRolePresetIds?: string[] },
    ) {
      const organizationId = await requireAdmin(prisma, actor);
      const existing = await prisma.employeeJobRole.findFirst({ where: { id, organizationId } });
      if (!existing) throw new IsolationError();
      if (input.defaultRolePresetIds) {
        await validatedRolePresets(prisma, organizationId, input.defaultRolePresetIds);
      }
      return prisma.employeeJobRole.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.description === undefined ? {} : { description: input.description.trim() }),
          ...(input.defaultRolePresetIds === undefined
            ? {}
            : { defaultRolePresetIds: input.defaultRolePresetIds }),
        },
      });
    },
    async jobRoleSelection(actor: Actor) {
      const membership = await organizationFor(prisma, actor);
      if (!membership.jobRoleId) return null;
      const role = await prisma.employeeJobRole.findFirst({
        where: { id: membership.jobRoleId, organizationId: membership.organizationId },
      });
      if (!role) return null;
      const presetIds = parseRolePresetIds(role.defaultRolePresetIds);
      await validatedRolePresets(prisma, membership.organizationId, presetIds);
      const bindings = await prisma.employeeJobRoleSpecialist.findMany({
        where: { spaceMemberId: membership.id, rolePresetId: { in: presetIds } },
        select: {
          rolePresetId: true,
          botId: true,
          bot: { select: { spaceId: true, userId: true, rolePresetId: true, archivedAt: true } },
        },
      });
      const byPresetId = new Map(
        bindings
          .filter(
            (binding) =>
              binding.bot.spaceId === actor.spaceId &&
              binding.bot.userId === actor.userId &&
              binding.bot.rolePresetId === binding.rolePresetId &&
              binding.bot.archivedAt === null,
          )
          .map((binding) => [
            binding.rolePresetId,
            { rolePresetId: binding.rolePresetId, botId: binding.botId },
          ]),
      );
      return {
        jobRole: role,
        specialists: presetIds.flatMap((id) => {
          const binding = byPresetId.get(id);
          return binding ? [binding] : [];
        }),
      };
    },
    async selectJobRole(actor: Actor, jobRoleId: string) {
      return withTransactionRetry(() =>
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM space_members WHERE "spaceId" = ${actor.spaceId} AND "userId" = ${actor.userId} FOR UPDATE`;
          const membership = await tx.spaceMember.findUnique({
            where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
            select: { id: true, organizationId: true },
          });
          if (!membership) throw new IsolationError();
          const role = await tx.employeeJobRole.findFirst({
            where: { id: jobRoleId, organizationId: membership.organizationId },
          });
          if (!role) throw new IsolationError();
          const presetIds = parseRolePresetIds(role.defaultRolePresetIds);
          const presets = await validatedRolePresets(tx, membership.organizationId, presetIds);
          const existing = await tx.employeeJobRoleSpecialist.findMany({
            where: { spaceMemberId: membership.id, rolePresetId: { in: presetIds } },
            select: {
              id: true,
              rolePresetId: true,
              botId: true,
              bot: {
                select: { spaceId: true, userId: true, rolePresetId: true, archivedAt: true },
              },
            },
          });
          const staleByPresetId = new Map(
            existing.map((binding) => [binding.rolePresetId, binding]),
          );
          const byPresetId = new Map(
            existing
              .filter(
                (binding) =>
                  binding.bot.spaceId === actor.spaceId &&
                  binding.bot.userId === actor.userId &&
                  binding.bot.rolePresetId === binding.rolePresetId &&
                  binding.bot.archivedAt === null,
              )
              .map((binding) => [
                binding.rolePresetId,
                { rolePresetId: binding.rolePresetId, botId: binding.botId },
              ]),
          );
          for (const preset of presets) {
            if (byPresetId.has(preset.id)) continue;
            const bot = await createBotInTransaction(tx, actor, {
              name: preset.name,
              title: "Studio specialist",
              description: preset.description,
              instructions: "",
              notifyOnFinish: true,
              rolePresetId: preset.id,
            });
            const stale = staleByPresetId.get(preset.id);
            const binding = stale
              ? await tx.employeeJobRoleSpecialist.update({
                  where: { id: stale.id },
                  data: { botId: bot.id },
                  select: { rolePresetId: true, botId: true },
                })
              : await tx.employeeJobRoleSpecialist.create({
                  data: {
                    spaceMemberId: membership.id,
                    rolePresetId: preset.id,
                    botId: bot.id,
                  },
                  select: { rolePresetId: true, botId: true },
                });
            byPresetId.set(preset.id, binding);
          }
          await tx.spaceMember.update({
            where: { id: membership.id },
            data: { jobRoleId: role.id },
          });
          return {
            jobRole: role,
            specialists: presetIds.map((id) => byPresetId.get(id)!),
          };
        }),
      );
    },
    async organizationId(actor: Actor) {
      return organizationIdFor(prisma, actor);
    },
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
        const foundation = await tx.studioFoundation.upsert({
          where: { organizationId },
          create: { organizationId },
          update: {},
        });
        const latest = await tx.foundationRevision.findFirst({
          where: { foundationId: foundation.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const revision = await tx.foundationRevision.create({
          data: {
            foundationId: foundation.id,
            revision: (latest?.revision ?? 0) + 1,
            content: content as Prisma.InputJsonValue,
            createdByUserId: actor.userId,
          },
        });
        return tx.studioFoundation.update({
          where: { id: foundation.id },
          data: { currentRevisionId: revision.id },
          include: { currentRevision: true },
        });
      });
    },
    async createProject(actor: Actor, input: { name: string; slug: string; scope: string }) {
      const organizationId = await requireAdmin(prisma, actor);
      return prisma.studioProject.create({
        data: {
          organizationId,
          name: input.name.trim(),
          slug: input.slug.trim(),
          scope: input.scope,
          createdByUserId: actor.userId,
        },
      });
    },
    async projectSources(actor: Actor, projectId: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      const project = await prisma.studioProject.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true },
      });
      if (!project) throw new IsolationError();
      return prisma.projectSourceBinding.findMany({
        where: { projectId },
        orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      });
    },
    async projectSource(actor: Actor, projectId: string, bindingId: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      const binding = await prisma.projectSourceBinding.findFirst({
        where: { id: bindingId, projectId, project: { organizationId } },
      });
      if (!binding) throw new IsolationError();
      return binding;
    },
    async projectSourceForWrite(actor: Actor, bindingId: string) {
      const organizationId = await requireAdmin(prisma, actor);
      const binding = await prisma.projectSourceBinding.findFirst({
        where: { id: bindingId, project: { organizationId } },
      });
      if (!binding) throw new IsolationError();
      return { organizationId, binding };
    },
    async projectForSourceWrite(actor: Actor, projectId: string) {
      const organizationId = await requireAdmin(prisma, actor);
      const project = await prisma.studioProject.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true },
      });
      if (!project) throw new IsolationError();
      return { organizationId, projectId: project.id };
    },
    async saveProjectSource(
      actor: Actor,
      input: {
        projectId: string;
        sourceId: string;
        refKey: string;
        metadata: Record<string, unknown>;
      },
    ) {
      const organizationId = await requireAdmin(prisma, actor);
      const project = await prisma.studioProject.findFirst({
        where: { id: input.projectId, organizationId },
        select: { id: true },
      });
      if (!project) throw new IsolationError();
      const existing = await prisma.projectSourceBinding.findFirst({
        where: {
          projectId: input.projectId,
          kind: "repository",
          repository: input.sourceId,
          ref: input.refKey,
        },
        select: { id: true },
      });
      const id =
        existing?.id ??
        `studio-source-${createHash("sha256")
          .update(`${input.projectId}\u0000${input.sourceId}\u0000${input.refKey}`)
          .digest("hex")}`;
      return prisma.projectSourceBinding.upsert({
        where: { id },
        create: {
          id,
          projectId: input.projectId,
          kind: "repository",
          repository: input.sourceId,
          ref: input.refKey,
          metadata: input.metadata as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
        },
        update: { metadata: input.metadata as Prisma.InputJsonValue },
      });
    },
    async roles(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.employeeRolePreset.findMany({
        where: { organizationId },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
    },
    async createRole(
      actor: Actor,
      input: {
        key: string;
        name: string;
        description: string;
        instructions: string;
        isDefault: boolean;
        foundationRevisionId?: string | null;
      },
    ) {
      const organizationId = await requireAdmin(prisma, actor);
      if (input.foundationRevisionId) {
        const revision = await prisma.foundationRevision.findFirst({
          where: { id: input.foundationRevisionId, foundation: { organizationId } },
          select: { id: true },
        });
        if (!revision) throw new IsolationError("Foundation revision is outside this organization");
      }
      return prisma.$transaction(async (tx) => {
        if (input.isDefault)
          await tx.employeeRolePreset.updateMany({
            where: { organizationId },
            data: { isDefault: false },
          });
        return tx.employeeRolePreset.create({ data: { organizationId, ...input } });
      });
    },
    async updateRole(
      actor: Actor,
      id: string,
      input: { name?: string; description?: string; instructions?: string; isDefault?: boolean },
    ) {
      const organizationId = await requireAdmin(prisma, actor);
      return prisma.$transaction(async (tx) => {
        const existing = await tx.employeeRolePreset.findFirst({ where: { id, organizationId } });
        if (!existing) throw new IsolationError();
        if (input.isDefault)
          await tx.employeeRolePreset.updateMany({
            where: { organizationId, id: { not: id } },
            data: { isDefault: false },
          });
        return tx.employeeRolePreset.update({ where: { id }, data: input });
      });
    },
    async assignment(actor: Actor, id: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.assignmentManifest.findFirst({
        where: {
          id,
          bot: { spaceId: actor.spaceId, space: { organizationId } },
          OR: [{ createdByUserId: actor.userId }, { reviewerUserId: actor.userId }],
        },
      });
    },
    async assignments(actor: Actor) {
      const organizationId = await organizationIdFor(prisma, actor);
      return prisma.assignmentManifest.findMany({
        where: {
          bot: { spaceId: actor.spaceId, space: { organizationId } },
          OR: [{ createdByUserId: actor.userId }, { reviewerUserId: actor.userId }],
        },
        orderBy: { createdAt: "desc" },
      });
    },
    async createAssignment(
      actor: Actor,
      input: {
        scope: "studio" | "one" | "multi";
        projectIds: string[];
        taskId?: string;
        objective?: string;
        botId: string;
        foundationRevisionId?: string | null;
        rolePresetId?: string | null;
        reviewerUserId?: string | null;
        manifest: Record<string, unknown>;
      },
    ) {
      const organizationId = await organizationIdFor(prisma, actor);
      const projectIds = [...new Set(input.projectIds)];
      if (input.scope === "studio" && projectIds.length !== 0)
        throw new IsolationError("Studio assignments do not name projects");
      if (input.scope === "one" && projectIds.length !== 1)
        throw new IsolationError("One-project assignments require one project");
      if (input.scope === "multi" && projectIds.length < 2)
        throw new IsolationError("Multi-project assignments require at least two projects");
      return prisma.$transaction(async (tx) => {
        const [projects, existingTask, bot, reviewerMembership] = await Promise.all([
          tx.studioProject.findMany({
            where: { id: { in: projectIds }, organizationId },
            select: { id: true },
          }),
          input.taskId
            ? tx.task.findFirst({
                where: { id: input.taskId, spaceId: actor.spaceId, userId: actor.userId },
                select: { id: true, botId: true, assignment: { select: { id: true } } },
              })
            : Promise.resolve(null),
          tx.bot.findFirst({
            where: { id: input.botId, spaceId: actor.spaceId, userId: actor.userId },
            select: { id: true, thread: { select: { id: true } } },
          }),
          input.reviewerUserId
            ? tx.spaceMember.findUnique({
                where: {
                  spaceId_userId: {
                    spaceId: actor.spaceId,
                    userId: input.reviewerUserId,
                  },
                },
                select: { userId: true },
              })
            : Promise.resolve(null),
        ]);
        if (projects.length !== projectIds.length)
          throw new IsolationError("Project is outside this organization");
        if (
          input.taskId &&
          (!existingTask || existingTask.botId !== input.botId || existingTask.assignment)
        )
          throw new IsolationError(
            "Task and bot must belong to this space and task must be unassigned",
          );
        if (!bot?.thread) throw new IsolationError("Bot is outside this space");
        if (input.reviewerUserId && !reviewerMembership)
          throw new IsolationError("Reviewer is outside this space");
        if (input.foundationRevisionId) {
          const revision = await tx.foundationRevision.findFirst({
            where: { id: input.foundationRevisionId, foundation: { organizationId } },
            select: { id: true },
          });
          if (!revision)
            throw new IsolationError("Foundation revision is outside this organization");
        }
        if (input.rolePresetId) {
          const role = await tx.employeeRolePreset.findFirst({
            where: { id: input.rolePresetId, organizationId },
            select: { id: true },
          });
          if (!role) throw new IsolationError("Role preset is outside this organization");
        }
        const task =
          existingTask ??
          (await tx.task.create({
            data: {
              spaceId: actor.spaceId,
              botId: input.botId,
              threadId: bot.thread.id,
              userId: actor.userId,
              prompt: input.objective!,
              status: "queued",
              projectId: projectIds[0] ?? null,
            },
          }));
        const assignment = await tx.assignmentManifest.create({
          data: {
            scope: input.scope,
            projectId: projectIds[0] ?? null,
            projectIds,
            taskId: task.id,
            botId: input.botId,
            foundationRevisionId: input.foundationRevisionId ?? null,
            rolePresetId: input.rolePresetId ?? null,
            manifest: input.manifest as Prisma.InputJsonValue,
            createdByUserId: actor.userId,
            reviewerUserId: input.reviewerUserId ?? null,
          },
        });
        const run = existingTask
          ? null
          : await tx.run.create({
              data: {
                spaceId: actor.spaceId,
                botId: input.botId,
                threadId: bot.thread.id,
                taskId: task.id,
                userId: actor.userId,
                status: "queued",
                trigger: "assignment",
              },
              select: { id: true },
            });
        return { assignment, runId: run?.id ?? null };
      });
    },
    async acceptAssignment(actor: Actor, id: string) {
      const organizationId = await organizationIdFor(prisma, actor);
      const current = await prisma.assignmentManifest.findFirst({
        where: {
          id,
          bot: { spaceId: actor.spaceId, space: { organizationId } },
          OR: [{ createdByUserId: actor.userId }, { reviewerUserId: actor.userId }],
        },
        select: {
          id: true,
          status: true,
          createdByUserId: true,
          reviewerUserId: true,
          task: { select: { status: true } },
        },
      });
      if (!current) throw new IsolationError();
      if (current.status !== "draft")
        return prisma.assignmentManifest.findUniqueOrThrow({ where: { id: current.id } });
      if (current.task.status !== "completed")
        throw new IsolationError("Assignment work must complete before human acceptance");
      await prisma.assignmentManifest.updateMany({
        where: { id: current.id, status: "draft", acceptedAt: null },
        data: { status: "accepted", acceptedAt: new Date(), acceptedByUserId: actor.userId },
      });
      return prisma.assignmentManifest.findUniqueOrThrow({ where: { id: current.id } });
    },
  };
}
