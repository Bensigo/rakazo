import { randomUUID } from "node:crypto";
import { HttpEmployeeHostControlPlaneClient } from "@rakazo/adapters";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, requireMembership, type PrismaClient } from "@rakazo/db";
import { mountEmployeeHostRoutes } from "./employee-host-routes.js";

const databaseUrl = process.env.DATABASE_URL;
const integration = process.env.VERIFY_DATABASE === "true" && databaseUrl
  ? describe.sequential
  : describe.skip;

integration("employee host routes (PostgreSQL)", () => {
  const ids = { org: randomUUID(), user: randomUUID(), member: randomUUID(), space: randomUUID(), spaceMember: randomUUID(), bot: randomUUID(), thread: randomUUID(), task: randomUUID(), run: randomUUID(), computer: randomUUID() };
  const hostId = `postgres-host-${randomUUID()}`;
  const operationId = `postgres-op-${randomUUID()}`;
  let prisma: PrismaClient;
  let close: (() => Promise<void>) | undefined;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.delete({ where: { id: ids.org } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: ids.user } }).catch(() => undefined);
    await close?.();
  });

  it("enrolls, claims once, fences receipts, and persists completion", async () => {
    const db = createDb(databaseUrl!); prisma = db.prisma; close = async () => { await db.prisma.$disconnect(); await db.pool.end(); };
    const now = new Date();
    await prisma.organization.create({ data: { id: ids.org, name: "Host test", slug: `host-test-${ids.org}`, createdAt: now } });
    await prisma.user.create({ data: { id: ids.user, name: "Host test", email: `host-${ids.user}@test.invalid` } });
    await prisma.member.create({ data: { id: ids.member, organizationId: ids.org, userId: ids.user, role: "owner", createdAt: now } });
    await prisma.space.create({ data: { id: ids.space, organizationId: ids.org, name: "Host test", createdAt: now } });
    await prisma.spaceMember.create({ data: { id: ids.spaceMember, spaceId: ids.space, organizationId: ids.org, userId: ids.user, role: "owner", createdAt: now } });
    await prisma.bot.create({ data: { id: ids.bot, spaceId: ids.space, userId: ids.user, name: "Host bot", color: "blue" } });
    await prisma.thread.create({ data: { id: ids.thread, spaceId: ids.space, botId: ids.bot, userId: ids.user } });
    await prisma.task.create({ data: { id: ids.task, spaceId: ids.space, botId: ids.bot, threadId: ids.thread, userId: ids.user, prompt: "host test", status: "running" } });
    await prisma.run.create({ data: { id: ids.run, spaceId: ids.space, botId: ids.bot, threadId: ids.thread, taskId: ids.task, userId: ids.user, status: "running", trigger: "test" } });
    const app = new Hono();
    mountEmployeeHostRoutes(app, { prisma, actor: async (request) => {
      const userId = request.headers.get("x-test-user");
      if (!userId) return null;
      const actor = await requireMembership(prisma, userId, request.headers.get("x-rakazo-space-id"));
      return { userId: actor.userId, spaceId: actor.spaceId };
    } });
    const session = { "x-test-user": ids.user, "x-rakazo-space-id": ids.space };
    let response = await app.request("http://test/employee-hosts/enroll", { method: "POST", headers: { ...session, "content-type": "application/json" }, body: JSON.stringify({ hostId, name: "Mac", platform: "darwin", capabilities: { xcode: true }, workspaceRoot: "/work" }) });
    expect(response.status).toBe(200); const token = (await response.json()).enrollmentToken as string;
    const enrolledHost = await prisma.employeeHost.findUniqueOrThrow({ where: { hostId }, include: { computer: true } });
    const computerId = enrolledHost.computerId;
    expect(enrolledHost.computer).toMatchObject({ id: computerId, spaceId: ids.space, userId: ids.user, scope: "dedicated", kind: "employee-host", providerRef: hostId });
    await prisma.computerExecutionLease.create({ data: { computerId, botId: ids.bot, runId: ids.run, fence: 7, expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.employeeHostOperation.create({ data: { operationId, hostId, computerId, spaceId: ids.space, botId: ids.bot, runId: ids.run, fence: 7, request: { argv: ["printf", "ok"] } } });
    response = await app.request("http://test/employee-hosts/enroll", { method: "POST", headers: { ...session, "content-type": "application/json" }, body: JSON.stringify({ hostId, name: "Takeover", platform: "darwin", workspaceRoot: "/other" }) });
    expect(response.status).toBe(409);
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    expect((await app.request("http://test/employee-hosts/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hostId: `unauthorized-${hostId}`, name: "No", platform: "darwin", workspaceRoot: "/work" }) })).status).toBe(401);
    await prisma.employeeHost.update({ where: { hostId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await app.request(`http://test/employee-hosts/${hostId}/poll`, { method: "POST", headers: auth, body: "{}" })).status).toBe(401);
    expect((await app.request(`http://test/employee-hosts/${hostId}/heartbeat`, { method: "POST", headers: auth, body: JSON.stringify({ capabilities: { xcode: true } }) })).status).toBe(200);
    response = await app.request(`http://test/employee-hosts/${hostId}/poll`, { method: "POST", headers: auth, body: "{}" });
    expect(response.status).toBe(200); const operation = (await response.json()).operation;
    expect(operation.operationId).toBe(operationId);
    expect((await app.request(`http://test/employee-hosts/${hostId}/poll`, { method: "POST", headers: auth, body: "{}" })).status).toBe(200);
    const terminal = { acceptedAt: Date.now(), completedAt: Date.now(), status: "completed" as const };
    const wrong = { operationId, hostId, ...terminal, lease: { computerId: "wrong", runId: ids.run, fence: 7 }, result: { stdout: "bad", stderr: "", code: 0 } };
    expect((await app.request(`http://test/employee-hosts/${hostId}/receipts/${operationId}`, { method: "POST", headers: auth, body: JSON.stringify(wrong) })).status).toBe(409);
    const staleFence = { ...wrong, lease: { computerId, runId: ids.run, fence: 6 } };
    expect((await app.request(`http://test/employee-hosts/${hostId}/receipts/${operationId}`, { method: "POST", headers: auth, body: JSON.stringify(staleFence) })).status).toBe(409);
    const good = { operationId, hostId, ...terminal, lease: { computerId, runId: ids.run, fence: 7 }, result: { stdout: "ok", stderr: "", code: 0 } };
    const otherComputer = `${ids.computer}-other`;
    await prisma.computer.create({ data: { id: otherComputer, spaceId: ids.space, userId: ids.user, scope: "dedicated", scopeKey: `host-test-${otherComputer}`, homeKey: `host-home-${otherComputer}`, kind: "employee-host" } });
    await prisma.computerExecutionLease.delete({ where: { computerId_botId: { computerId, botId: ids.bot } } });
    await prisma.computerExecutionLease.create({ data: { computerId: otherComputer, botId: ids.bot, runId: ids.run, fence: 7, expiresAt: new Date(Date.now() + 60_000) } });
    expect((await app.request(`http://test/employee-hosts/${hostId}/receipts/${operationId}`, { method: "POST", headers: auth, body: JSON.stringify(good) })).status).toBe(409);
    await prisma.computerExecutionLease.create({ data: { computerId, botId: ids.bot, runId: ids.run, fence: 7, expiresAt: new Date(Date.now() + 60_000) } });
    const client = new HttpEmployeeHostControlPlaneClient("http://test", (input, init) => app.request(input, init));
    await expect(client.receipt(hostId, token, { ...good, status: "failed" })).rejects.toMatchObject({ status: 400 });
    await expect(client.receipt(hostId, token, good)).resolves.toBeUndefined();
    await expect(prisma.employeeHostOperation.findUniqueOrThrow({ where: { operationId } })).resolves.toMatchObject({ status: "completed", stdout: "ok", exitCode: 0 });
    expect((await app.request(`http://test/employee-hosts/${hostId}/receipts/${operationId}`, { method: "POST", headers: auth, body: JSON.stringify(good) })).status).toBe(200);
  });
});
