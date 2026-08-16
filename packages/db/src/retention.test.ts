import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  createDataRetentionSweeper,
  DEFAULT_DATA_RETENTION_DAYS,
  pruneExpiredData,
  resolveDataRetentionDays,
} from "./retention.js";

function fakePrisma(counts = [3, 2, 1]) {
  const eventDeleteMany = vi.fn(async () => ({ count: counts[0] ?? 0 }));
  const messageDeleteMany = vi.fn(async () => ({ count: counts[1] ?? 0 }));
  const memoryRevisionDeleteMany = vi.fn(async () => ({ count: counts[2] ?? 0 }));
  const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations));
  const prisma = {
    event: { deleteMany: eventDeleteMany },
    message: { deleteMany: messageDeleteMany },
    memoryRevision: { deleteMany: memoryRevisionDeleteMany },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return {
    prisma,
    eventDeleteMany,
    messageDeleteMany,
    memoryRevisionDeleteMany,
    transaction,
  };
}

afterEach(() => vi.useRealTimers());

describe("resolveDataRetentionDays", () => {
  it("defaults to 90 days and allows an operator to disable pruning", () => {
    expect(resolveDataRetentionDays(undefined)).toBe(DEFAULT_DATA_RETENTION_DAYS);
    expect(resolveDataRetentionDays(" ")).toBe(DEFAULT_DATA_RETENTION_DAYS);
    expect(resolveDataRetentionDays("0")).toBe(0);
  });

  it.each(["-1", "1.5", "many", "9007199254740992"])("rejects invalid value %s", (value) => {
    expect(() => resolveDataRetentionDays(value)).toThrow(
      "DATA_RETENTION_DAYS must be a non-negative integer",
    );
  });
});

describe("pruneExpiredData", () => {
  it("deletes expired events, messages, and memory revisions in one transaction", async () => {
    const { prisma, eventDeleteMany, messageDeleteMany, memoryRevisionDeleteMany, transaction } =
      fakePrisma();
    const now = new Date("2026-08-16T12:00:00.000Z");

    await expect(pruneExpiredData(prisma, 30, now)).resolves.toEqual({
      cutoff: new Date("2026-07-17T12:00:00.000Z"),
      events: 3,
      messages: 2,
      memoryRevisions: 1,
    });

    const where = { where: { createdAt: { lt: new Date("2026-07-17T12:00:00.000Z") } } };
    expect(eventDeleteMany).toHaveBeenCalledWith(where);
    expect(messageDeleteMany).toHaveBeenCalledWith(where);
    expect(memoryRevisionDeleteMany).toHaveBeenCalledWith(where);
    expect(transaction).toHaveBeenCalledOnce();
  });
});

describe("createDataRetentionSweeper", () => {
  it("runs immediately and then once per interval", async () => {
    vi.useFakeTimers();
    const { prisma, transaction } = fakePrisma();
    const log = { info: vi.fn(), error: vi.fn() };
    const sweeper = createDataRetentionSweeper(prisma, {
      retentionDays: 30,
      intervalMs: 1_000,
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      log,
    });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(transaction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledTimes(2);
    await sweeper.stop();
  });

  it("does no work when retention is disabled", async () => {
    vi.useFakeTimers();
    const { prisma, transaction } = fakePrisma();
    const sweeper = createDataRetentionSweeper(prisma, { retentionDays: 0 });

    sweeper.start();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(transaction).not.toHaveBeenCalled();
    await sweeper.stop();
  });
});
