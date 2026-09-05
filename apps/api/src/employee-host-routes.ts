import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { Hono } from "hono";
import type { Context } from "hono";

const TTL_MS = 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface EmployeeHostActor {
  userId: string;
  spaceId: string;
}

export function mountEmployeeHostRoutes(
  app: Hono,
  deps: { prisma: PrismaClient; actor: (request: Request) => Promise<EmployeeHostActor | null> },
) {
  app.post("/employee-hosts/enroll", async (c) => {
    const actor = await deps.actor(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const input = (await c.req.json().catch(() => null)) as { hostId?: string; name?: string; platform?: string; capabilities?: unknown; workspaceRoot?: string } | null;
    if (!input?.hostId || !input.name || !input.platform || !input.workspaceRoot) return c.json({ error: "Invalid enrollment" }, 400);
    const capabilities = (input.capabilities && typeof input.capabilities === "object" ? input.capabilities : {}) as Prisma.InputJsonValue;
    const token = randomUUID();
    const now = new Date();
    await deps.prisma.employeeHost.upsert({
      where: { hostId: input.hostId },
      create: { hostId: input.hostId, spaceId: actor.spaceId, ownerUserId: actor.userId, name: input.name, platform: input.platform, capabilities, workspaceRoot: input.workspaceRoot, tokenHash: hash(token), lastSeenAt: now, expiresAt: new Date(now.getTime() + TTL_MS) },
      update: { spaceId: actor.spaceId, ownerUserId: actor.userId, name: input.name, platform: input.platform, capabilities, workspaceRoot: input.workspaceRoot, tokenHash: hash(token), lastSeenAt: now, expiresAt: new Date(now.getTime() + TTL_MS) },
    });
    return c.json({ hostId: input.hostId, enrollmentToken: token });
  });

  async function host(c: Context) {
    const hostId = c.req.param("hostId");
    const authorization = c.req.header("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const record = await deps.prisma.employeeHost.findUnique({ where: { hostId } });
    if (!record || !token || record.tokenHash !== hash(token) || record.expiresAt <= new Date()) return null;
    return { record, token };
  }

  app.post("/employee-hosts/:hostId/heartbeat", async (c) => {
    const authenticated = await host(c);
    if (!authenticated) return c.json({ error: "Unauthorized" }, 401);
    const input = (await c.req.json().catch(() => null)) as { capabilities?: unknown } | null;
    const now = new Date();
    const capabilities = (input?.capabilities && typeof input.capabilities === "object" ? input.capabilities : authenticated.record.capabilities) as Prisma.InputJsonValue;
    await deps.prisma.employeeHost.update({ where: { hostId: c.req.param("hostId") }, data: { capabilities, lastSeenAt: now, expiresAt: new Date(now.getTime() + TTL_MS) } });
    return c.json({ ok: true });
  });

  app.post("/employee-hosts/:hostId/poll", async (c) => {
    const authenticated = await host(c);
    if (!authenticated) return c.json({ error: "Unauthorized" }, 401);
    const candidate = await deps.prisma.employeeHostOperation.findFirst({ where: { hostId: c.req.param("hostId"), status: "accepted", spaceId: authenticated.record.spaceId }, orderBy: { createdAt: "asc" } });
    const operation = candidate && (await deps.prisma.employeeHostOperation.updateMany({ where: { id: candidate.id, status: "accepted" }, data: { status: "dispatched" } })).count === 1 ? { ...candidate, status: "dispatched" } : null;
    if (!operation) return c.json({});
    return c.json({ operation: { operationId: operation.operationId, hostId: operation.hostId, spaceId: operation.spaceId, botId: operation.botId, lease: { hostId: operation.hostId, spaceId: operation.spaceId, botId: operation.botId, runId: operation.runId, fence: operation.fence, expiresAt: operation.acceptedAt.getTime() + TTL_MS }, kind: "exec", request: operation.request } });
  });

  app.post("/employee-hosts/:hostId/receipts/:operationId", async (c) => {
    const authenticated = await host(c);
    if (!authenticated) return c.json({ error: "Unauthorized" }, 401);
    const operation = await deps.prisma.employeeHostOperation.findFirst({ where: { hostId: c.req.param("hostId"), operationId: c.req.param("operationId"), spaceId: authenticated.record.spaceId } });
    if (!operation) return c.json({ error: "Not found" }, 404);
    if (operation.status !== "accepted" && operation.status !== "dispatched") return c.json({ ok: true, status: operation.status });
    const input = (await c.req.json().catch(() => null)) as { result?: { stdout?: string; stderr?: string; code?: number } } | null;
    const result = input?.result ?? {};
    await deps.prisma.employeeHostOperation.update({ where: { id: operation.id }, data: { status: result.code === 0 ? "completed" : "failed", stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1, completedAt: new Date() } });
    return c.json({ ok: true });
  });
}
