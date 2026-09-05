import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";
import { createStudioDomain } from "./studio.js";

const databaseUrl = process.env.DATABASE_URL;
const integration =
  process.env.VERIFY_DATABASE === "true" && databaseUrl ? describe : describe.skip;

integration.sequential("studio job role provisioning (PostgreSQL)", () => {
  const suffix = randomUUID();
  const ids = {
    organization: `job-role-org-${suffix}`,
    user: `job-role-user-${suffix}`,
    member: `job-role-member-${suffix}`,
    space: `job-role-space-${suffix}`,
    spaceMember: `job-role-space-member-${suffix}`,
  };
  const actor = {
    userId: ids.user,
    spaceId: ids.space,
    email: `job-role-${suffix}@example.test`,
    isDeploymentOwner: false,
  };
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    await prisma.user.create({
      data: { id: ids.user, name: "Job role test member", email: actor.email },
    });
    await prisma.organization.create({
      data: {
        id: ids.organization,
        name: "Job role test organization",
        slug: `job-role-${suffix}`,
        createdAt: new Date(),
      },
    });
    await prisma.member.create({
      data: {
        id: ids.member,
        organizationId: ids.organization,
        userId: ids.user,
        role: "admin",
        createdAt: new Date(),
      },
    });
    await prisma.space.create({
      data: {
        id: ids.space,
        organizationId: ids.organization,
        name: "Job role test space",
        createdByUserId: ids.user,
      },
    });
    await prisma.spaceMember.create({
      data: {
        id: ids.spaceMember,
        spaceId: ids.space,
        organizationId: ids.organization,
        userId: ids.user,
        role: "member",
        createdAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.organization.deleteMany({ where: { id: ids.organization } });
      await prisma.user.deleteMany({ where: { id: ids.user } });
    }
    await close?.();
  });

  it("provisions one persistent specialist bot per preset under concurrent selection", async () => {
    const presets = await Promise.all(
      [
        ["research", "Researcher"],
        ["writing", "Writer"],
        ["review", "Reviewer"],
      ].map(([key, name]) =>
        prisma.employeeRolePreset.create({
          data: {
            organizationId: ids.organization,
            key: `${key}-${suffix}`,
            name: `${name} ${suffix}`,
            description: `${name} specialist`,
            instructions: `${name} instructions`,
          },
        }),
      ),
    );
    const [researcher, writer, reviewer] = presets;
    const domain = createStudioDomain(prisma);
    const firstRole = await domain.createJobRole(actor, {
      key: `product-${suffix}`,
      name: "Product",
      defaultRolePresetIds: [researcher!.id, writer!.id],
    });
    const secondRole = await domain.createJobRole(actor, {
      key: `quality-${suffix}`,
      name: "Quality",
      defaultRolePresetIds: [writer!.id, reviewer!.id],
    });
    await prisma.member.update({ where: { id: ids.member }, data: { role: "member" } });
    await expect(
      domain.createJobRole(actor, {
        key: `member-write-${suffix}`,
        name: "Member write",
        defaultRolePresetIds: [],
      }),
    ).rejects.toThrow("Studio admin access required");

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => domain.selectJobRole(actor, firstRole.id)),
    );
    const firstIds = concurrent[0]!.specialists.map((binding) => binding.botId);
    expect(concurrent.every((selection) => selection.jobRole.id === firstRole.id)).toBe(true);
    expect(
      concurrent.every(
        (selection) =>
          JSON.stringify(selection.specialists.map((binding) => binding.botId)) ===
          JSON.stringify(firstIds),
      ),
    ).toBe(true);

    const firstBindings = await prisma.employeeJobRoleSpecialist.findMany({
      where: { spaceMemberId: ids.spaceMember },
      orderBy: { createdAt: "asc" },
    });
    expect(firstBindings).toHaveLength(2);
    expect(await prisma.bot.count({ where: { id: { in: firstIds } } })).toBe(2);
    expect(await prisma.thread.count({ where: { botId: { in: firstIds } } })).toBe(2);
    expect(await prisma.browserProfile.count({ where: { botId: { in: firstIds } } })).toBe(2);
    expect(
      await prisma.memoryDocument.count({ where: { botId: { in: firstIds }, path: "MEMORY.md" } }),
    ).toBe(2);

    const secondSelection = await domain.selectJobRole(actor, secondRole.id);
    const sharedWriter = firstBindings.find((binding) => binding.rolePresetId === writer!.id)!;
    expect(secondSelection.specialists).toEqual([
      { rolePresetId: writer!.id, botId: sharedWriter.botId },
      expect.objectContaining({ rolePresetId: reviewer!.id }),
    ]);
    expect(
      await prisma.employeeJobRoleSpecialist.count({
        where: { spaceMemberId: ids.spaceMember },
      }),
    ).toBe(3);
    expect(
      await prisma.bot.count({
        where: {
          spaceId: ids.space,
          userId: ids.user,
          rolePresetId: { in: presets.map((p) => p.id) },
        },
      }),
    ).toBe(3);

    const selected = await domain.jobRoleSelection(actor);
    expect(selected?.jobRole.id).toBe(secondRole.id);
    expect(selected?.specialists).toEqual(secondSelection.specialists);

    const corrupt = await prisma.employeeJobRole.create({
      data: {
        organizationId: ids.organization,
        key: `corrupt-${suffix}`,
        name: "Corrupt",
        defaultRolePresetIds: [researcher!.id, `missing-${suffix}`],
      },
    });
    await expect(domain.selectJobRole(actor, corrupt.id)).rejects.toThrow(
      "Specialist preset is outside this organization",
    );
    await expect(
      prisma.spaceMember.findUniqueOrThrow({ where: { id: ids.spaceMember } }),
    ).resolves.toMatchObject({ jobRoleId: secondRole.id });
    expect(
      await prisma.employeeJobRoleSpecialist.count({ where: { spaceMemberId: ids.spaceMember } }),
    ).toBe(3);
  });
});
