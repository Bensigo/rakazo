import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { finalizeRun } from "./events.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

describePostgres("run finalization under PostgreSQL lock contention", () => {
  const id = `finalize-qa-${process.pid}-${Date.now()}`;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    db = createDb(databaseUrl!);
    const p = db.prisma;
    await p.user.create({
      data: { id, name: "Finalization QA", email: `${id}@example.test`, emailVerified: true },
    });
    await p.organization.create({
      data: { id, name: "Finalization QA", slug: id, createdAt: new Date() },
    });
    await p.space.create({
      data: { id, organizationId: id, name: "Finalization QA", createdByUserId: id },
    });
    await p.bot.create({
      data: { id, spaceId: id, userId: id, name: "Finalization QA", color: "#888888" },
    });
    await p.thread.create({ data: { id, spaceId: id, userId: id, botId: id } });
    await p.task.create({
      data: {
        id,
        spaceId: id,
        userId: id,
        botId: id,
        threadId: id,
        prompt: "Synthetic durability check",
        status: "running",
      },
    });
    await p.run.create({
      data: {
        id,
        spaceId: id,
        userId: id,
        botId: id,
        threadId: id,
        taskId: id,
        status: "running",
        trigger: "assignment",
        leaseOwner: id,
        leaseFence: 1,
        startedAt: new Date(),
      },
    });
    await p.attempt.create({ data: { id, runId: id, fence: 1, status: "running" } });
    await p.externalEffect.create({
      data: {
        id,
        spaceId: id,
        runId: id,
        kind: "shell",
        idempotencyKey: id,
        status: "completed",
        request: { command: "synthetic-already-executed" },
        result: { code: 0, stdout: "once", stderr: "" },
      },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.prisma.organization.deleteMany({ where: { id } });
    await db.prisma.user.deleteMany({ where: { id } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });
  it("waits beyond five seconds and commits exactly one terminal history without changing the effect", async () => {
    const lock = await db.pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [id]);
    const released = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        lock.query("COMMIT").then(() => resolve(), reject);
      }, 6_000);
    });
    const input = {
      spaceId: id,
      threadId: id,
      botId: id,
      runId: id,
      taskId: id,
      attemptId: id,
      leaseOwner: id,
      leaseFence: 1,
      outcome: "completed" as const,
      blocks: [{ kind: "text" as const, text: "Durably complete" }],
    };
    try {
      const result = await finalizeRun(db.prisma, input);
      await released;
      expect(result).toEqual({ continuationRunId: null });
      expect(await finalizeRun(db.prisma, input)).toBe(false);
      expect(await db.prisma.run.findUnique({ where: { id } })).toMatchObject({
        status: "completed",
      });
      expect(await db.prisma.task.findUnique({ where: { id } })).toMatchObject({
        status: "completed",
      });
      expect(await db.prisma.attempt.findUnique({ where: { id } })).toMatchObject({
        status: "completed",
      });
      expect(await db.prisma.event.count({ where: { runId: id, type: "run.completed" } })).toBe(1);
      expect(await db.prisma.message.count({ where: { runId: id } })).toBe(1);
      expect(
        await db.prisma.event.count({ where: { runId: id, type: "thread.message.created" } }),
      ).toBe(1);
      expect(await db.prisma.externalEffect.findUnique({ where: { id } })).toMatchObject({
        status: "completed",
        result: { code: 0, stdout: "once", stderr: "" },
      });
    } finally {
      await released;
      lock.release();
    }
  }, 30_000);
});
