import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { IsolationError, requireMembership } from "./scope.js";

function prismaForMembership(found: boolean) {
  return {
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; spaceId?: string } }) =>
        found
          ? {
              userId: where.userId,
              spaceId: where.spaceId ?? "space-default",
              member: { user: { email: "owner@example.test" } },
            }
          : null,
      ),
    },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({ ownerUserId: "user-1" })),
    },
  } as unknown as PrismaClient;
}

describe("requireMembership", () => {
  it("scopes the actor to an explicitly requested space", async () => {
    const prisma = prismaForMembership(true);

    await expect(requireMembership(prisma, "user-1", "space-support")).resolves.toEqual({
      userId: "user-1",
      spaceId: "space-support",
      email: "owner@example.test",
      isDeploymentOwner: true,
    });
    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", spaceId: "space-support" },
      }),
    );
  });

  it("rejects a requested space the user does not belong to", async () => {
    await expect(
      requireMembership(prismaForMembership(false), "user-1", "space-foreign"),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("selects the explicit default Space before older non-default memberships", async () => {
    const prisma = prismaForMembership(true);

    await requireMembership(prisma, "user-1");

    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("uses the session's active organization when no space is explicitly selected", async () => {
    const prisma = prismaForMembership(true);

    await requireMembership(prisma, "user-1", null, "organization-studio");

    expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", organizationId: "organization-studio" },
      }),
    );
  });

  it("falls back to another membership when the session's active organization is stale", async () => {
    const prisma = prismaForMembership(true);
    vi.mocked(prisma.spaceMember.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        userId: "user-1",
        spaceId: "space-personal",
        member: { user: { email: "owner@example.test" } },
      } as never);

    await expect(
      requireMembership(prisma, "user-1", null, "organization-removed"),
    ).resolves.toMatchObject({ spaceId: "space-personal" });
    expect(prisma.spaceMember.findFirst).toHaveBeenCalledTimes(2);
  });
});
