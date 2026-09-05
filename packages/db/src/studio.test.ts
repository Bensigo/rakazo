import { describe, expect, it, vi } from "vitest";
import { createStudioDomain } from "./studio.js";

const actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "owner@example.test",
  isDeploymentOwner: true,
};
const membership = { organizationId: "org-1" };

function fakePrisma() {
  let assignment = {
    id: "assignment-1",
    status: "draft",
    createdByUserId: actor.userId,
    reviewerUserId: null,
    acceptedAt: null as Date | null,
    acceptedByUserId: null as string | null,
    task: { status: "completed" },
  };
  return {
    spaceMember: { findUnique: vi.fn(async () => membership) },
    assignmentManifest: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === assignment.id ? assignment : null,
      ),
      findUniqueOrThrow: vi.fn(async () => assignment),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (assignment.status !== "draft" || assignment.acceptedAt) return { count: 0 };
        assignment = { ...assignment, ...data } as typeof assignment;
        return { count: 1 };
      }),
    },
  } as any;
}

describe("studio domain", () => {
  it("projects organization membership permissions for Studio administration", async () => {
    const findUnique = vi.fn(async () => ({
      organizationId: "org-1",
      member: { role: "member" },
    }));
    const domain = createStudioDomain({ spaceMember: { findUnique } } as any);
    await expect(domain.permissions({ ...actor, isDeploymentOwner: false })).resolves.toEqual({
      memberRole: "member",
      canManageJobRoles: false,
      canManageFoundation: false,
    });
    findUnique.mockResolvedValue({ organizationId: "org-1", member: { role: "admin" } });
    await expect(domain.permissions({ ...actor, isDeploymentOwner: false })).resolves.toEqual({
      memberRole: "admin",
      canManageJobRoles: true,
      canManageFoundation: true,
    });
  });

  it("scopes project source reads to the actor organization", async () => {
    const findMany = vi.fn(async () => [{ id: "source-1", projectId: "project-1" }]);
    const prisma = {
      spaceMember: { findUnique: vi.fn(async () => membership) },
      studioProject: {
        findFirst: vi.fn(async ({ where }: { where: { organizationId: string } }) =>
          where.organizationId === "org-1" ? { id: "project-1" } : null,
        ),
      },
      projectSourceBinding: { findMany },
    } as any;
    await expect(createStudioDomain(prisma).projectSources(actor, "project-1")).resolves.toEqual([
      { id: "source-1", projectId: "project-1" },
    ]);
    expect(prisma.studioProject.findFirst).toHaveBeenCalledWith({
      where: { id: "project-1", organizationId: "org-1" },
      select: { id: true },
    });
  });

  it("requires admin authority and keeps a stable repository binding id across syncs", async () => {
    const upsert = vi.fn(async ({ where, create, update }: any) => ({
      id: where.id,
      ...create,
      ...update,
    }));
    const prisma = {
      spaceMember: {
        findUnique: vi.fn(async () => ({ organizationId: "org-1", member: { role: "admin" } })),
      },
      studioProject: { findFirst: vi.fn(async () => ({ id: "project-1" })) },
      projectSourceBinding: { findFirst: vi.fn(async () => null), upsert },
    } as any;
    const domain = createStudioDomain(prisma);
    const first = await domain.saveProjectSource(
      { ...actor, isDeploymentOwner: false },
      {
        projectId: "project-1",
        sourceId: "github:studio/game",
        refKey: "workspace",
        metadata: { snapshotId: "snapshot-1" },
      },
    );
    const second = await domain.saveProjectSource(
      { ...actor, isDeploymentOwner: false },
      {
        projectId: "project-1",
        sourceId: "github:studio/game",
        refKey: "workspace",
        metadata: { snapshotId: "snapshot-2" },
      },
    );
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^studio-source-[a-f0-9]{64}$/);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: first.id },
        update: { metadata: { snapshotId: "snapshot-2" } },
      }),
    );
  });
  it("requires organization owner or admin for foundation writes", async () => {
    const prisma = {
      spaceMember: {
        findUnique: vi.fn(async () => ({ organizationId: "org-1", member: { role: "member" } })),
      },
    } as any;
    const domain = createStudioDomain(prisma);
    await expect(
      domain.publishFoundation({ ...actor, isDeploymentOwner: false }, { mission: "x" }),
    ).rejects.toThrow("Studio admin access required");
  });

  it("rejects an assignment outside the actor organization", async () => {
    const prisma = fakePrisma();
    const domain = createStudioDomain(prisma);
    await expect(domain.assignment(actor, "missing")).resolves.toBeNull();
    expect(prisma.assignmentManifest.findFirst).toHaveBeenCalledWith({
      where: {
        id: "missing",
        bot: { spaceId: "space-1", space: { organizationId: "org-1" } },
        OR: [{ createdByUserId: "user-1" }, { reviewerUserId: "user-1" }],
      },
    });
  });

  it("does not expose a creator's assignment from another private space in the same organization", async () => {
    const prisma = privacyPrisma({
      spaceId: "space-2",
      createdByUserId: actor.userId,
      reviewerUserId: null,
    });
    const domain = createStudioDomain(prisma);

    await expect(domain.assignment(actor, "private-assignment")).resolves.toBeNull();
    await expect(domain.assignments(actor)).resolves.toEqual([]);
    await expect(domain.acceptAssignment(actor, "private-assignment")).rejects.toThrow(
      "Resource not found",
    );
  });

  it("does not expose a same-space assignment to an unrelated member", async () => {
    const prisma = privacyPrisma({
      spaceId: actor.spaceId,
      createdByUserId: "user-2",
      reviewerUserId: "user-3",
    });
    const domain = createStudioDomain(prisma);

    await expect(domain.assignment(actor, "private-assignment")).resolves.toBeNull();
    await expect(domain.assignments(actor)).resolves.toEqual([]);
    await expect(domain.acceptAssignment(actor, "private-assignment")).rejects.toThrow(
      "Resource not found",
    );
  });

  it("lets an explicitly assigned same-space reviewer read and accept", async () => {
    const prisma = privacyPrisma({
      spaceId: actor.spaceId,
      createdByUserId: "user-2",
      reviewerUserId: actor.userId,
    });
    const domain = createStudioDomain(prisma);

    await expect(domain.assignment(actor, "private-assignment")).resolves.toMatchObject({
      id: "private-assignment",
    });
    await expect(domain.assignments(actor)).resolves.toHaveLength(1);
    await expect(domain.acceptAssignment(actor, "private-assignment")).resolves.toMatchObject({
      status: "accepted",
      acceptedByUserId: actor.userId,
    });
  });

  it("records human acceptance server-side and remains idempotent", async () => {
    const prisma = fakePrisma();
    const domain = createStudioDomain(prisma);
    await expect(domain.acceptAssignment(actor, "assignment-1")).resolves.toMatchObject({
      status: "accepted",
      acceptedByUserId: actor.userId,
    });
    await expect(domain.acceptAssignment(actor, "assignment-1")).resolves.toMatchObject({
      status: "accepted",
    });
    expect(prisma.assignmentManifest.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not turn a running assignment into human acceptance", async () => {
    const prisma = fakePrisma();
    prisma.assignmentManifest.findFirst = vi.fn(async () => ({
      id: "assignment-1",
      status: "draft",
      createdByUserId: actor.userId,
      reviewerUserId: null,
      task: { status: "running" },
    })) as any;

    await expect(
      createStudioDomain(prisma).acceptAssignment(actor, "assignment-1"),
    ).rejects.toThrow("Assignment work must complete before human acceptance");
    expect(prisma.assignmentManifest.updateMany).not.toHaveBeenCalled();
  });

  it("preserves the first acceptance receipt when another request wins the compare-and-set", async () => {
    const firstAcceptedAt = new Date("2026-09-05T08:00:00.000Z");
    const prisma = fakePrisma();
    prisma.assignmentManifest.updateMany = vi.fn(async () => ({ count: 0 })) as any;
    prisma.assignmentManifest.findUniqueOrThrow = vi.fn(async () => ({
      id: "assignment-1",
      status: "accepted",
      acceptedAt: firstAcceptedAt,
      acceptedByUserId: "reviewer-1",
    })) as any;

    await expect(
      createStudioDomain(prisma).acceptAssignment(actor, "assignment-1"),
    ).resolves.toMatchObject({
      acceptedAt: firstAcceptedAt,
      acceptedByUserId: "reviewer-1",
    });
    expect(prisma.assignmentManifest.updateMany).toHaveBeenCalledWith({
      where: { id: "assignment-1", status: "draft", acceptedAt: null },
      data: expect.objectContaining({ status: "accepted", acceptedByUserId: actor.userId }),
    });
  });

  it("lets a normal space member create runnable work for their own bot", async () => {
    const taskCreate = vi.fn(async () => ({ id: "task-new" }));
    const runCreate = vi.fn(async () => ({ id: "run-new" }));
    const assignmentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "assignment-new",
      status: "draft",
      ...data,
    }));
    const prisma = {
      spaceMember: { findUnique: vi.fn(async () => membership) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          studioProject: { findMany: vi.fn(async () => []) },
          spaceMember: { findUnique: vi.fn(async () => null) },
          bot: {
            findFirst: vi.fn(async () => ({ id: "bot-1", thread: { id: "thread-1" } })),
          },
          task: { create: taskCreate },
          assignmentManifest: { create: assignmentCreate },
          run: { create: runCreate },
        }),
      ),
    } as any;

    const created = await createStudioDomain(prisma).createAssignment(
      { ...actor, isDeploymentOwner: false },
      {
        scope: "studio",
        projectIds: [],
        objective: "Prepare the studio release plan",
        botId: "bot-1",
        manifest: { deliverable: "Release plan" },
      },
    );

    expect(taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        prompt: "Prepare the studio release plan",
        projectId: null,
        status: "queued",
      }),
    });
    expect(runCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-new",
        status: "queued",
        trigger: "assignment",
      }),
      select: { id: true },
    });
    expect(assignmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: "studio", projectId: null, projectIds: [] }),
    });
    expect(created).toMatchObject({
      runId: "run-new",
      assignment: { id: "assignment-new", status: "draft" },
    });
  });

  it("rejects a reviewer who is not a member of the assignment space", async () => {
    const assignmentCreate = vi.fn();
    const prisma = {
      spaceMember: { findUnique: vi.fn(async () => membership) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          studioProject: { findMany: vi.fn(async () => []) },
          spaceMember: { findUnique: vi.fn(async () => null) },
          bot: {
            findFirst: vi.fn(async () => ({ id: "bot-1", thread: { id: "thread-1" } })),
          },
          task: { create: vi.fn() },
          assignmentManifest: { create: assignmentCreate },
        }),
      ),
    } as any;

    await expect(
      createStudioDomain(prisma).createAssignment(actor, {
        scope: "studio",
        projectIds: [],
        objective: "Prepare the studio release plan",
        botId: "bot-1",
        reviewerUserId: "outsider",
        manifest: {},
      }),
    ).rejects.toThrow("Reviewer is outside this space");
    expect(assignmentCreate).not.toHaveBeenCalled();
  });
});

function privacyPrisma(input: {
  spaceId: string;
  createdByUserId: string;
  reviewerUserId: string | null;
}) {
  let assignment = {
    id: "private-assignment",
    status: "draft",
    acceptedAt: null as Date | null,
    acceptedByUserId: null as string | null,
    task: { status: "completed" },
    ...input,
  };
  const visible = (where: {
    id?: string;
    bot: { spaceId: string };
    OR: Array<{ createdByUserId?: string; reviewerUserId?: string }>;
  }) =>
    (!where.id || where.id === assignment.id) &&
    where.bot.spaceId === assignment.spaceId &&
    where.OR.some(
      (clause) =>
        clause.createdByUserId === assignment.createdByUserId ||
        (assignment.reviewerUserId !== null && clause.reviewerUserId === assignment.reviewerUserId),
    );
  return {
    spaceMember: { findUnique: vi.fn(async () => membership) },
    assignmentManifest: {
      findFirst: vi.fn(async ({ where }: { where: Parameters<typeof visible>[0] }) =>
        visible(where) ? assignment : null,
      ),
      findMany: vi.fn(async ({ where }: { where: Parameters<typeof visible>[0] }) =>
        visible(where) ? [assignment] : [],
      ),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        assignment = { ...assignment, ...data } as typeof assignment;
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => assignment),
    },
  } as any;
}
