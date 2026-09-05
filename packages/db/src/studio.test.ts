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
  const assignment = {
    id: "assignment-1",
    status: "draft",
    createdByUserId: actor.userId,
    reviewerUserId: null,
    task: { status: "completed" },
  };
  return {
    spaceMember: { findUnique: vi.fn(async () => membership) },
    assignmentManifest: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === assignment.id ? assignment : null,
      ),
      findUniqueOrThrow: vi.fn(async () => assignment),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...assignment,
        ...data,
      })),
    },
  } as any;
}

describe("studio domain", () => {
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
      where: { id: "missing", bot: { space: { organizationId: "org-1" } } },
    });
  });

  it("records human acceptance server-side and remains idempotent", async () => {
    const prisma = fakePrisma();
    const domain = createStudioDomain(prisma);
    await expect(domain.acceptAssignment(actor, "assignment-1")).resolves.toMatchObject({
      status: "accepted",
      acceptedByUserId: actor.userId,
    });
    prisma.assignmentManifest.findFirst = vi.fn(async () => ({
      id: "assignment-1",
      status: "accepted",
      createdByUserId: actor.userId,
      reviewerUserId: null,
      task: { status: "completed" },
    })) as any;
    prisma.assignmentManifest.findUniqueOrThrow = vi.fn(async () => ({
      id: "assignment-1",
      status: "accepted",
    })) as any;
    await expect(domain.acceptAssignment(actor, "assignment-1")).resolves.toMatchObject({
      status: "accepted",
    });
    expect(prisma.assignmentManifest.update).toHaveBeenCalledTimes(1);
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
    expect(prisma.assignmentManifest.update).not.toHaveBeenCalled();
  });

  it("creates runnable studio-wide work without treating run creation as acceptance", async () => {
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
          bot: {
            findFirst: vi.fn(async () => ({ id: "bot-1", thread: { id: "thread-1" } })),
          },
          task: { create: taskCreate },
          assignmentManifest: { create: assignmentCreate },
          run: { create: runCreate },
        }),
      ),
    } as any;

    const created = await createStudioDomain(prisma).createAssignment(actor, {
      scope: "studio",
      projectIds: [],
      objective: "Prepare the studio release plan",
      botId: "bot-1",
      manifest: { deliverable: "Release plan" },
    });

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
});
