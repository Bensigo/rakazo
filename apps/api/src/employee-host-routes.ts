import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

const TTL_MS = 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const receiptSchema = z.object({
  operationId: z.string().min(1).max(256),
  hostId: z.string().min(1).max(256),
  lease: z.object({ computerId: z.string().min(1).max(256), runId: z.string().min(1).max(256), fence: z.number().int().nonnegative() }),
  result: z.object({ stdout: z.string().max(1_000_000), stderr: z.string().max(1_000_000), code: z.number().int().min(-1_000_000).max(1_000_000) }),
}).strict();

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
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Origin denied" }, 403);
    if (Number(c.req.header("content-length") ?? 0) > 64 * 1024) return c.json({ error: "Payload too large" }, 413);
    const input = (await c.req.json().catch(() => null)) as { hostId?: string; name?: string; platform?: string; capabilities?: unknown; workspaceRoot?: string } | null;
    if (!input?.hostId || !input.name || !input.platform || !input.workspaceRoot) return c.json({ error: "Invalid enrollment" }, 400);
    if ([input.hostId, input.name, input.platform, input.workspaceRoot].some((value) => value.length > 512)) return c.json({ error: "Invalid enrollment" }, 400);
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(input.hostId)) return c.json({ error: "Invalid enrollment" }, 400);
    const existing = await deps.prisma.employeeHost.findUnique({ where: { hostId: input.hostId } });
    if (existing) return c.json({ error: "Host already enrolled" }, 409);
    const capabilities = (input.capabilities && typeof input.capabilities === "object" ? input.capabilities : {}) as Prisma.InputJsonValue;
    const token = randomUUID();
    const now = new Date();
    try { await deps.prisma.employeeHost.create({ data: { hostId: input.hostId, spaceId: actor.spaceId, ownerUserId: actor.userId, name: input.name, platform: input.platform, capabilities, workspaceRoot: input.workspaceRoot, tokenHash: hash(token), lastSeenAt: now, expiresAt: new Date(now.getTime() + TTL_MS) } }); }
    catch { return c.json({ error: "Host already enrolled" }, 409); }
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
    return c.json({ operation: { operationId: operation.operationId, hostId: operation.hostId, spaceId: operation.spaceId, botId: operation.botId, computerId: operation.computerId, lease: { hostId: operation.hostId, spaceId: operation.spaceId, botId: operation.botId, runId: operation.runId, fence: operation.fence, expiresAt: operation.acceptedAt.getTime() + TTL_MS }, kind: "exec", request: operation.request } });
  });

  app.post("/employee-hosts/:hostId/receipts/:operationId", async (c) => {
    const authenticated = await host(c);
    if (!authenticated) return c.json({ error: "Unauthorized" }, 401);
    const operation = await deps.prisma.employeeHostOperation.findFirst({ where: { hostId: c.req.param("hostId"), operationId: c.req.param("operationId"), spaceId: authenticated.record.spaceId } });
    if (!operation) return c.json({ error: "Not found" }, 404);
    if (operation.status !== "accepted" && operation.status !== "dispatched") return c.json({ ok: true, status: operation.status });
    const input = receiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid receipt" }, 400);
    const receipt = input.data;
    if (receipt.operationId !== operation.operationId || receipt.hostId !== operation.hostId || receipt.lease.runId !== operation.runId || receipt.lease.fence !== operation.fence || receipt.lease.computerId !== operation.computerId) return c.json({ error: "Stale receipt" }, 409);
    const result = receipt.result;
    const lease = await deps.prisma.computerExecutionLease.findFirst({ where: { computerId: operation.computerId, botId: operation.botId, runId: operation.runId, fence: operation.fence, expiresAt: { gt: new Date() }, computer: { spaceId: operation.spaceId } } });
    if (!lease) return c.json({ error: "Stale receipt" }, 409);
    const updated = await deps.prisma.employeeHostOperation.updateMany({ where: { id: operation.id, hostId: operation.hostId, runId: operation.runId, fence: operation.fence, status: "dispatched" }, data: { status: result.code === 0 ? "completed" : "failed", stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1, completedAt: new Date() } });
    if (updated.count !== 1) return c.json({ ok: true, status: "already-completed" });
    return c.json({ ok: true });
  });
}
