import { randomUUID } from "node:crypto";
import { createAuth } from "@rakazo/auth";
import {
  createDb,
  createSpaceForMember,
  createStudioDomain,
  type PrismaClient,
  requireMembership,
} from "@rakazo/db";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountStudioInvitationRoutes } from "./studio-invitations.js";

const databaseUrl = process.env.DATABASE_URL;
const integration =
  process.env.VERIFY_DATABASE === "true" && databaseUrl ? describe.sequential : describe.skip;

integration("Studio employee invitations (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const baseUrl = "http://studio-invitation.test";
  const password = "employee-invitation-password";
  const identities = {
    owner: { email: `invite-owner-${suffix}@example.test`, name: "Studio Owner" },
    employeeA: { email: `invite-a-${suffix}@example.test`, name: "Employee A" },
    employeeB: { email: `invite-b-${suffix}@example.test`, name: "Employee B" },
    outsider: { email: `invite-outsider-${suffix}@example.test`, name: "Outsider" },
  };
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let app: Hono;
  let originalSettings: Awaited<ReturnType<PrismaClient["deploymentSettings"]["findUnique"]>>;
  const userIds: string[] = [];

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    originalSettings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
    await prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        signupsEnabled: true,
        signupAllowlist: "",
        signupPolicyInitialized: true,
      },
      update: { signupsEnabled: true, signupAllowlist: "", signupPolicyInitialized: true },
    });

    const auth = createAuth(prisma, {
      secret: "studio-invitation-test-secret-0000000000000000",
      baseURL: baseUrl,
      webOrigin: baseUrl,
      signupsEnabled: "true",
      signupAllowlist: undefined,
    });
    app = new Hono();
    mountStudioInvitationRoutes(app, {
      prisma,
      auth,
      authBaseUrl: baseUrl,
      webOrigin: baseUrl,
    });
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  });

  afterAll(async () => {
    if (!prisma) return;
    const memberships = await prisma.member.findMany({
      where: { userId: { in: userIds } },
      select: { organizationId: true },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [...new Set(memberships.map((row) => row.organizationId))] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (originalSettings) {
      await prisma.deploymentSettings.update({
        where: { id: "default" },
        data: {
          ownerUserId: originalSettings.ownerUserId,
          signupsEnabled: originalSettings.signupsEnabled,
          signupAllowlist: originalSettings.signupAllowlist,
          signupPolicyInitialized: originalSettings.signupPolicyInitialized,
        },
      });
    } else {
      await prisma.deploymentSettings.deleteMany({ where: { id: "default" } });
    }
    await close();
  });

  it("joins two employees to one shared Studio and preserves every private Space", async () => {
    const owner = await signup(identities.owner);
    const employeeA = await signup(identities.employeeA);
    const employeeB = await signup(identities.employeeB);
    const outsider = await signup(identities.outsider);
    const ownerActor = await requireMembership(prisma, owner.userId);
    const studio = createStudioDomain(prisma);
    const organizationId = await studio.organizationId(ownerActor);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { name: "Sunrise Product Studio" },
    });
    const privateSpace = await createSpaceForMember(prisma, {
      currentSpaceId: ownerActor.spaceId,
      userId: owner.userId,
      name: "Owner private",
    });
    await studio.publishFoundation(ownerActor, { standards: "Cite the pinned source" });
    const project = await studio.createProject(ownerActor, {
      name: "Launch",
      slug: `launch-${suffix}`,
      scope: "one",
    });
    const preset = await studio.createRole(ownerActor, {
      key: `engineer-${suffix}`,
      name: "Engineer",
      description: "Builds the product",
      instructions: "Follow the Studio foundation",
      isDefault: true,
    });
    const jobRole = await studio.createJobRole(ownerActor, {
      key: `product-engineer-${suffix}`,
      name: "Product engineer",
      defaultRolePresetIds: [preset.id],
    });

    const invitationA = await invite(owner.cookie, ownerActor.spaceId, identities.employeeA.email);
    const invitationB = await invite(owner.cookie, ownerActor.spaceId, identities.employeeB.email);
    const expiring = await invite(owner.cookie, ownerActor.spaceId, identities.outsider.email);

    expect(
      (
        await app.request(`${baseUrl}/api/studio/invitations/${invitationA.id}`, {
          headers: { cookie: employeeB.cookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`${baseUrl}/api/studio/invitations/${invitationA.id}/accept`, {
          method: "POST",
          headers: { cookie: employeeB.cookie, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    await prisma.invitation.update({
      where: { id: expiring.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(
      (
        await app.request(`${baseUrl}/api/studio/invitations/${expiring.id}`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(`${baseUrl}/api/studio/invitations/${expiring.id}/accept`, {
          method: "POST",
          headers: { cookie: outsider.cookie, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400);

    for (const [employee, invitation] of [
      [employeeA, invitationA],
      [employeeB, invitationB],
    ] as const) {
      const response = await app.request(
        `${baseUrl}/api/studio/invitations/${invitation.id}/accept`,
        {
          method: "POST",
          headers: { cookie: employee.cookie, "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(response.status).toBe(200);
      expect(
        await prisma.member.findUnique({
          where: { organizationId_userId: { organizationId, userId: employee.userId } },
        }),
      ).toMatchObject({ role: "member" });
      expect(
        await prisma.spaceMember.findUnique({
          where: {
            spaceId_userId: { spaceId: ownerActor.spaceId, userId: employee.userId },
          },
        }),
      ).toMatchObject({ organizationId, role: "member" });
      expect(
        await prisma.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId: privateSpace.id, userId: employee.userId } },
        }),
      ).toBeNull();
      expect(
        await prisma.session.findFirst({
          where: { userId: employee.userId },
          orderBy: { createdAt: "desc" },
          select: { activeOrganizationId: true },
        }),
      ).toEqual({ activeOrganizationId: organizationId });
    }

    expect(
      (
        await app.request(`${baseUrl}/api/studio/invitations`, {
          method: "POST",
          headers: {
            cookie: employeeA.cookie,
            origin: baseUrl,
            "content-type": "application/json",
            "x-rakazo-space-id": ownerActor.spaceId,
          },
          body: JSON.stringify({ email: `forbidden-${suffix}@example.test` }),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await app.request(`${baseUrl}/api/studio/invitations/${invitationA.id}/accept`, {
          method: "POST",
          headers: { cookie: employeeA.cookie, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(400);

    const employeeActor = await requireMembership(prisma, employeeA.userId, null, organizationId);
    expect(employeeActor.spaceId).toBe(ownerActor.spaceId);
    await expect(requireMembership(prisma, employeeA.userId, privateSpace.id)).rejects.toThrow(
      "No personal space",
    );
    expect(await studio.foundation(employeeActor)).toMatchObject({ organizationId });
    expect(await studio.projects(employeeActor)).toEqual([
      expect.objectContaining({ id: project.id, organizationId }),
    ]);
    const selection = await studio.selectJobRole(employeeActor, jobRole.id);
    expect(selection).toMatchObject({
      jobRole: { id: jobRole.id },
      specialists: [{ rolePresetId: preset.id }],
    });

    const employeeOrganizations = await prisma.member.count({
      where: { userId: employeeA.userId },
    });
    expect(employeeOrganizations).toBe(2);
  });

  async function signup(identity: { email: string; name: string }) {
    const response = await app.request(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ ...identity, password }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    userIds.push(body.user.id);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    return { userId: body.user.id, cookie: cookie! };
  }

  async function invite(cookie: string, spaceId: string, email: string) {
    const response = await app.request(`${baseUrl}/api/studio/invitations`, {
      method: "POST",
      headers: {
        cookie,
        origin: baseUrl,
        "content-type": "application/json",
        "x-rakazo-space-id": spaceId,
      },
      body: JSON.stringify({ email, organizationId: randomUUID(), role: "owner" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      email: string;
      inviteUrl: string;
    };
    expect(body).toMatchObject({ email, inviteUrl: `${baseUrl}/invite/${body.id}` });
    return body;
  }
});
