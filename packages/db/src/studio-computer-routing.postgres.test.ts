import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";
import { createStudioDomain } from "./studio.js";

const databaseUrl = process.env.DATABASE_URL;
const integration =
  process.env.VERIFY_DATABASE === "true" && databaseUrl ? describe : describe.skip;

integration.sequential("studio assignment computer routing (PostgreSQL)", () => {
  const suffix = randomUUID();
  const ids = {
    organization: `routing-org-${suffix}`,
    user: `routing-user-${suffix}`,
    otherUser: `routing-other-user-${suffix}`,
    member: `routing-member-${suffix}`,
    otherMember: `routing-other-member-${suffix}`,
    space: `routing-space-${suffix}`,
    otherSpace: `routing-other-space-${suffix}`,
    spaceMember: `routing-space-member-${suffix}`,
    bot: `routing-bot-${suffix}`,
    thread: `routing-thread-${suffix}`,
    defaultComputer: `routing-default-${suffix}`,
    employeeComputer: `routing-employee-${suffix}`,
    otherOwnerComputer: `routing-other-owner-${suffix}`,
    otherSpaceComputer: `routing-other-space-computer-${suffix}`,
    host: `routing-host-${suffix}`,
  };
  const actor = {
    userId: ids.user,
    spaceId: ids.space,
    email: `routing-${suffix}@example.test`,
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
    const now = new Date();
    await prisma.user.createMany({
      data: [
        { id: ids.user, name: "Routing member", email: actor.email },
        {
          id: ids.otherUser,
          name: "Other routing member",
          email: `routing-other-${suffix}@example.test`,
        },
      ],
    });
    await prisma.organization.create({
      data: {
        id: ids.organization,
        name: "Routing test organization",
        slug: `routing-${suffix}`,
        createdAt: now,
      },
    });
    await prisma.member.createMany({
      data: [
        {
          id: ids.member,
          organizationId: ids.organization,
          userId: ids.user,
          role: "member",
          createdAt: now,
        },
        {
          id: ids.otherMember,
          organizationId: ids.organization,
          userId: ids.otherUser,
          role: "member",
          createdAt: now,
        },
      ],
    });
    await prisma.space.createMany({
      data: [
        {
          id: ids.space,
          organizationId: ids.organization,
          name: "Routing test space",
          createdByUserId: ids.user,
        },
        {
          id: ids.otherSpace,
          organizationId: ids.organization,
          name: "Other routing test space",
          createdByUserId: ids.user,
        },
      ],
    });
    await prisma.spaceMember.create({
      data: {
        id: ids.spaceMember,
        spaceId: ids.space,
        organizationId: ids.organization,
        userId: ids.user,
        role: "member",
        createdAt: now,
      },
    });
    await prisma.computer.createMany({
      data: [
        {
          id: ids.defaultComputer,
          spaceId: ids.space,
          userId: ids.user,
          scope: "dedicated",
          scopeKey: `routing-default-${suffix}`,
          homeKey: `routing-default-${suffix}`,
          kind: "docker",
        },
        {
          id: ids.employeeComputer,
          spaceId: ids.space,
          userId: ids.user,
          scope: "dedicated",
          scopeKey: `routing-employee-${suffix}`,
          homeKey: `routing-employee-${suffix}`,
          kind: "employee-host",
          providerRef: ids.host,
          state: "running",
        },
        {
          id: ids.otherOwnerComputer,
          spaceId: ids.space,
          userId: ids.otherUser,
          scope: "team",
          scopeKey: `routing-other-owner-${suffix}`,
          homeKey: `routing-other-owner-${suffix}`,
          kind: "docker",
        },
        {
          id: ids.otherSpaceComputer,
          spaceId: ids.otherSpace,
          userId: ids.user,
          scope: "team",
          scopeKey: `routing-other-space-${suffix}`,
          homeKey: `routing-other-space-${suffix}`,
          kind: "docker",
        },
      ],
    });
    await prisma.employeeHost.create({
      data: {
        hostId: ids.host,
        spaceId: ids.space,
        ownerUserId: ids.user,
        computerId: ids.employeeComputer,
        name: "Build computer",
        platform: "test",
        capabilities: { exec: true },
        workspaceRoot: "/registered-workspace",
        tokenHash: "test-only",
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    await prisma.bot.create({
      data: {
        id: ids.bot,
        spaceId: ids.space,
        userId: ids.user,
        name: "Routing bot",
        color: "blue",
        computerId: ids.defaultComputer,
      },
    });
    await prisma.thread.create({
      data: {
        id: ids.thread,
        spaceId: ids.space,
        botId: ids.bot,
        userId: ids.user,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.organization.deleteMany({ where: { id: ids.organization } });
      await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.otherUser] } } });
    }
    await close?.();
  });

  it("lists only usable owned targets and snapshots the selected host", async () => {
    const domain = createStudioDomain(prisma);
    const targets = await domain.assignmentComputers(actor, ids.bot);
    expect(targets).toHaveLength(2);
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ids.defaultComputer, name: "Specialist computer" }),
        expect.objectContaining({ id: ids.employeeComputer, name: "Build computer" }),
      ]),
    );

    const created = await domain.createAssignment(actor, {
      scope: "studio",
      projectIds: [],
      objective: "Run on the enrolled workspace",
      botId: ids.bot,
      computerId: ids.employeeComputer,
      manifest: {},
    });
    expect(created.assignment.computerId).toBe(ids.employeeComputer);
    await expect(
      prisma.run.findUniqueOrThrow({ where: { id: created.runId! } }),
    ).resolves.toMatchObject({ computerId: ids.employeeComputer, trigger: "assignment" });

    for (const computerId of [ids.otherOwnerComputer, ids.otherSpaceComputer]) {
      await expect(
        domain.createAssignment(actor, {
          scope: "studio",
          projectIds: [],
          objective: "Must remain isolated",
          botId: ids.bot,
          computerId,
          manifest: {},
        }),
      ).rejects.toThrow("Computer is outside this space");
    }
  });
});
