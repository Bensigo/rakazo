import { describe, expect, it, vi } from "vitest";
import { createStudioDomain } from "./studio.js";

const actor = { userId: "user-1", spaceId: "space-1", email: "owner@example.test", isDeploymentOwner: true };
const membership = { organizationId: "org-1" };

function fakePrisma() {
  const assignment = { id: "assignment-1", status: "draft", createdByUserId: actor.userId, reviewerUserId: null };
  return {
    spaceMember: { findUnique: vi.fn(async () => membership) },
    assignmentManifest: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => where.id === assignment.id ? assignment : null),
      findUniqueOrThrow: vi.fn(async () => assignment),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...assignment, ...data })),
    },
  } as any;
}

describe("studio domain", () => {
  it("requires organization owner or admin for foundation writes", async () => {
    const prisma = { spaceMember: { findUnique: vi.fn(async () => ({ organizationId: "org-1", member: { role: "member" } })) } } as any;
    const domain = createStudioDomain(prisma);
    await expect(domain.publishFoundation({ ...actor, isDeploymentOwner: false }, { mission: "x" })).rejects.toThrow("Studio admin access required");
  });

  it("rejects an assignment outside the actor organization", async () => {
    const prisma = fakePrisma();
    const domain = createStudioDomain(prisma);
    await expect(domain.assignment(actor, "missing")).resolves.toBeNull();
    expect(prisma.assignmentManifest.findFirst).toHaveBeenCalledWith({ where: { id: "missing", project: { organizationId: "org-1" } } });
  });

  it("records human acceptance server-side and remains idempotent", async () => {
    const prisma = fakePrisma();
    const domain = createStudioDomain(prisma);
    await expect(domain.acceptAssignment(actor, "assignment-1")).resolves.toMatchObject({ status: "accepted", acceptedByUserId: actor.userId });
    prisma.assignmentManifest.findFirst = vi.fn(async () => ({ id: "assignment-1", status: "accepted", createdByUserId: actor.userId, reviewerUserId: null })) as any;
    prisma.assignmentManifest.findUniqueOrThrow = vi.fn(async () => ({ id: "assignment-1", status: "accepted" })) as any;
    await expect(domain.acceptAssignment(actor, "assignment-1")).resolves.toMatchObject({ status: "accepted" });
    expect(prisma.assignmentManifest.update).toHaveBeenCalledTimes(1);
  });
});
