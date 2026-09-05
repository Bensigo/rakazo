import type { Actor } from "@rakazo/contracts";
import { createDb, createStudioDomain, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureSpawnRun } from "./child-bots.js";
import {
  type AuthorizedStudioSource,
  resolveStudioRunContext,
  type StudioKnowledgeBridge,
} from "./studio-context.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("studio assignment runtime (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `studio-org-${suffix}`;
  const creatorId = `studio-creator-${suffix}`;
  const reviewerId = `studio-reviewer-${suffix}`;
  const unrelatedId = `studio-unrelated-${suffix}`;
  const spaceId = `studio-space-${suffix}`;
  const otherSpaceId = `studio-other-space-${suffix}`;
  const botId = `studio-bot-${suffix}`;
  const childBotId = `studio-child-bot-${suffix}`;
  const otherBotId = `studio-other-bot-${suffix}`;
  const threadId = `studio-thread-${suffix}`;
  const childThreadId = `studio-child-thread-${suffix}`;
  const otherThreadId = `studio-other-thread-${suffix}`;
  const foundationId = `studio-foundation-${suffix}`;
  const revisionId = `studio-revision-${suffix}`;
  const roleId = `studio-role-${suffix}`;
  const projectId = `studio-project-${suffix}`;
  const bindingId = `studio-binding-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  const creator: Actor = {
    userId: creatorId,
    spaceId,
    email: `${creatorId}@rakazo.test`,
    isDeploymentOwner: false,
  };
  const reviewer: Actor = {
    userId: reviewerId,
    spaceId,
    email: `${reviewerId}@rakazo.test`,
    isDeploymentOwner: false,
  };
  const unrelated: Actor = {
    userId: unrelatedId,
    spaceId,
    email: `${unrelatedId}@rakazo.test`,
    isDeploymentOwner: false,
  };
  const sameUserOtherSpace: Actor = { ...creator, spaceId: otherSpaceId };

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const createdAt = new Date();
    await prisma.user.createMany({
      data: [creator, reviewer, unrelated].map((actor) => ({
        id: actor.userId,
        name: actor.userId,
        email: actor.email,
        emailVerified: true,
      })),
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Studio Runtime Test", slug: organizationId, createdAt },
    });
    await prisma.space.createMany({
      data: [
        {
          id: spaceId,
          organizationId,
          name: "Private A",
          createdByUserId: creatorId,
        },
        {
          id: otherSpaceId,
          organizationId,
          name: "Private B",
          createdByUserId: creatorId,
        },
      ],
    });
    await prisma.member.createMany({
      data: [creatorId, reviewerId, unrelatedId].map((userId) => ({
        id: `member-${userId}`,
        organizationId,
        userId,
        role: "member",
        createdAt,
      })),
    });
    await prisma.spaceMember.createMany({
      data: [
        { id: `membership-a-${creatorId}`, spaceId, organizationId, userId: creatorId, createdAt },
        {
          id: `membership-b-${creatorId}`,
          spaceId: otherSpaceId,
          organizationId,
          userId: creatorId,
          createdAt,
        },
        {
          id: `membership-a-${reviewerId}`,
          spaceId,
          organizationId,
          userId: reviewerId,
          createdAt,
        },
        {
          id: `membership-a-${unrelatedId}`,
          spaceId,
          organizationId,
          userId: unrelatedId,
          createdAt,
        },
      ],
    });
    await prisma.bot.createMany({
      data: [
        { id: botId, spaceId, userId: creatorId, name: "Producer", color: "#f97316" },
        {
          id: childBotId,
          spaceId,
          userId: creatorId,
          name: "Reviewer child",
          color: "#fb923c",
          parentBotId: botId,
        },
        {
          id: otherBotId,
          spaceId: otherSpaceId,
          userId: creatorId,
          name: "Other private bot",
          color: "#fdba74",
        },
      ],
    });
    await prisma.thread.createMany({
      data: [
        { id: threadId, spaceId, botId, userId: creatorId },
        { id: childThreadId, spaceId, botId: childBotId, userId: creatorId },
        { id: otherThreadId, spaceId: otherSpaceId, botId: otherBotId, userId: creatorId },
      ],
    });
    await prisma.studioFoundation.create({ data: { id: foundationId, organizationId } });
    await prisma.foundationRevision.create({
      data: {
        id: revisionId,
        foundationId,
        revision: 1,
        content: { mission: "Protect player trust" },
        createdByUserId: creatorId,
      },
    });
    await prisma.studioFoundation.update({
      where: { id: foundationId },
      data: { currentRevisionId: revisionId },
    });
    await prisma.employeeRolePreset.create({
      data: {
        id: roleId,
        organizationId,
        foundationRevisionId: revisionId,
        key: "producer",
        name: "Producer",
        instructions: "Keep delivery evidence explicit.",
        isDefault: true,
      },
    });
    await prisma.studioProject.create({
      data: {
        id: projectId,
        organizationId,
        name: "Game",
        slug: `game-${suffix}`,
        scope: "one",
        createdByUserId: creatorId,
      },
    });
    await prisma.projectSourceBinding.create({
      data: {
        id: bindingId,
        projectId,
        kind: "repository",
        repository: "github-gameplay",
        ref: "main@abc123",
        path: "README.md",
        metadata: {
          access: { allowedScopes: ["admin"] },
          snapshotId: "client-selected-snapshot",
        },
        createdByUserId: creatorId,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [creatorId, reviewerId, unrelatedId] } },
    });
    await close();
  });

  it("persists inherited context and enforces privacy, delegation, revocation, and acceptance", async () => {
    const domain = createStudioDomain(prisma);
    const created = await domain.createAssignment(creator, {
      scope: "one",
      projectIds: [projectId],
      objective: "Prepare the release candidate",
      botId,
      foundationRevisionId: revisionId,
      rolePresetId: roleId,
      reviewerUserId: reviewerId,
      manifest: {
        scope: "studio",
        projectIds: ["project-outside-studio"],
        snapshotId: "client-selected-snapshot",
        access: { allowedScopes: ["admin"] },
      },
    });
    expect(created.runId).toBeTruthy();
    expect(created.assignment).toMatchObject({
      scope: "one",
      projectId,
      projectIds: [projectId],
      status: "draft",
      acceptedAt: null,
    });
    const queuedRun = await prisma.run.findUniqueOrThrow({ where: { id: created.runId! } });
    expect(queuedRun).toMatchObject({ status: "queued", trigger: "assignment" });

    await expect(domain.assignment(sameUserOtherSpace, created.assignment.id)).resolves.toBeNull();
    await expect(domain.assignments(sameUserOtherSpace)).resolves.toEqual([]);
    await expect(
      domain.acceptAssignment(sameUserOtherSpace, created.assignment.id),
    ).rejects.toThrow("Resource not found");
    await expect(domain.assignment(unrelated, created.assignment.id)).resolves.toBeNull();
    await expect(domain.assignments(unrelated)).resolves.toEqual([]);
    await expect(domain.acceptAssignment(unrelated, created.assignment.id)).rejects.toThrow(
      "Resource not found",
    );
    await expect(domain.assignment(reviewer, created.assignment.id)).resolves.toMatchObject({
      id: created.assignment.id,
    });
    await expect(domain.assignments(reviewer)).resolves.toHaveLength(1);
    await expect(domain.acceptAssignment(reviewer, created.assignment.id)).rejects.toThrow(
      "Assignment work must complete before human acceptance",
    );

    const bridge: StudioKnowledgeBridge = {
      pin: vi.fn(async ({ sources }: { sources: AuthorizedStudioSource[] }) => ({
        sources: sources.map((source) => ({
          ...source,
          knowledgeProjectId: "knowledge-game",
          snapshotId: "snapshot-server-pinned",
        })),
      })),
      read: vi.fn(async () => ({ instructions: "README.md @ snapshot-server-pinned" })),
      sync: vi.fn(async () => {
        throw new Error("not used");
      }),
      listWiki: vi.fn(async () => ({ pages: [] })),
      getWikiPage: vi.fn(async () => {
        throw new Error("not used");
      }),
      close: vi.fn(async () => undefined),
    };
    const resolved = await resolveStudioRunContext(prisma, bridge, {
      runId: created.runId!,
      taskId: created.assignment.taskId,
      botId,
      spaceId,
      userId: creatorId,
      prompt: "Prepare the release candidate",
    });
    expect(resolved.manifest).toMatchObject({
      version: 1,
      organizationId,
      foundation: { id: revisionId, revision: 1 },
      role: { id: roleId, key: "producer" },
      assignment: { id: created.assignment.id, scope: "one", projectIds: [projectId] },
      sourceProjectIds: [projectId],
      sources: [
        {
          bindingId,
          studioProjectId: projectId,
          sourceId: "github-gameplay",
          refKey: "main@abc123",
          access: { allowedScopes: ["project"] },
          knowledgeProjectId: "knowledge-game",
          snapshotId: "snapshot-server-pinned",
        },
      ],
    });
    expect(resolved.instructions).toContain("Protect player trust");
    expect(resolved.instructions).toContain("Keep delivery evidence explicit.");
    expect(resolved.instructions).toContain("README.md @ snapshot-server-pinned");
    const [storedTask, storedRun] = await Promise.all([
      prisma.task.findUniqueOrThrow({ where: { id: created.assignment.taskId } }),
      prisma.run.findUniqueOrThrow({ where: { id: created.runId! } }),
    ]);
    expect(storedTask.studioContext).toEqual(resolved.manifest);
    expect(storedRun.studioContext).toEqual(resolved.manifest);

    const childRun = await ensureSpawnRun(prisma, {
      spaceId,
      userId: creatorId,
      botId: childBotId,
      threadId: childThreadId,
      sourceRunId: created.runId!,
      sourceBotId: botId,
      spawnKey: `delegate-${suffix}`,
      prompt: "Review the release candidate",
    });
    const childTask = await prisma.task.findUniqueOrThrow({ where: { id: childRun.taskId } });
    expect(childTask.projectId).toBe(projectId);
    expect(childTask.studioContext).toEqual(resolved.manifest);
    expect(childRun.studioContext).toEqual(resolved.manifest);

    await prisma.projectSourceBinding.delete({ where: { id: bindingId } });
    const readCount = vi.mocked(bridge.read).mock.calls.length;
    await expect(
      resolveStudioRunContext(prisma, bridge, {
        runId: childRun.id,
        taskId: childTask.id,
        botId: childBotId,
        spaceId,
        userId: creatorId,
        prompt: "Review the release candidate",
      }),
    ).rejects.toMatchObject({
      code: "STUDIO_CONTEXT_UNAVAILABLE",
      message: "A pinned studio source is no longer authorized.",
    });
    expect(vi.mocked(bridge.read).mock.calls).toHaveLength(readCount);

    await prisma.task.update({
      where: { id: created.assignment.taskId },
      data: { status: "completed" },
    });
    const receipts = await Promise.all([
      domain.acceptAssignment(creator, created.assignment.id),
      domain.acceptAssignment(reviewer, created.assignment.id),
    ]);
    const finalAssignment = await prisma.assignmentManifest.findUniqueOrThrow({
      where: { id: created.assignment.id },
    });
    expect(finalAssignment.status).toBe("accepted");
    expect([creatorId, reviewerId]).toContain(finalAssignment.acceptedByUserId);
    expect(finalAssignment.acceptedAt).toBeTruthy();
    expect(receipts).toEqual([finalAssignment, finalAssignment]);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: created.runId! } })).status).toBe(
      "queued",
    );
  });
});
