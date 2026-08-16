import type { PrismaClient } from "./client.js";

export const DEFAULT_DATA_RETENTION_DAYS = 90;
export const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface DataRetentionResult {
  cutoff: Date;
  events: number;
  messages: number;
  memoryRevisions: number;
}

export function resolveDataRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_DATA_RETENTION_DAYS;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new Error("DATA_RETENTION_DAYS must be a non-negative integer");
  }
  return days;
}

export async function pruneExpiredData(
  prisma: PrismaClient,
  retentionDays: number,
  now = new Date(),
): Promise<DataRetentionResult> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("retentionDays must be a positive integer");
  }
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
  const [events, messages, memoryRevisions] = await prisma.$transaction([
    prisma.event.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.message.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.memoryRevision.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return {
    cutoff,
    events: events.count,
    messages: messages.count,
    memoryRevisions: memoryRevisions.count,
  };
}

export function createDataRetentionSweeper(
  prisma: PrismaClient,
  options: {
    retentionDays: number;
    intervalMs?: number;
    now?: () => Date;
    log?: Pick<Console, "error" | "info">;
  },
) {
  const intervalMs = options.intervalMs ?? DEFAULT_RETENTION_SWEEP_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? console;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweeping: Promise<DataRetentionResult> | undefined;

  const sweepOnce = () => {
    if (sweeping) return sweeping;
    sweeping = pruneExpiredData(prisma, options.retentionDays, now()).finally(() => {
      sweeping = undefined;
    });
    return sweeping;
  };
  const sweepSafely = () => {
    void sweepOnce()
      .then((result) => log.info("data retention sweep", result))
      .catch((error) => log.error("data retention sweep", error));
  };

  return {
    sweepOnce,
    start() {
      if (timer || options.retentionDays === 0) return;
      sweepSafely();
      timer = setInterval(sweepSafely, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await sweeping?.catch(() => undefined);
    },
  };
}
