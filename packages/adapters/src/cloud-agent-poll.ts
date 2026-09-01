import type {
  AdapterContext,
  BackgroundJobPayloads,
  CloudAgentProvider,
  JobPublisher,
} from "@rakazo/adapter-kit";
import { cloudAgentPollJob, runContinueJob } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  type PrismaClient,
  withTransactionRetry,
} from "@rakazo/db";

const TERMINAL = new Set(["finished", "failed", "cancelled"]);
const POLL_DELAY_MS = 5_000;
/** Cap retries so a stuck agent cannot poll forever. */
const MAX_ATTEMPTS = 60;

export async function pollCloudAgent(
  deps: {
    prisma: PrismaClient;
    jobs: JobPublisher;
    cloudAgent: CloudAgentProvider | null | undefined;
  },
  payload: BackgroundJobPayloads["cloud_agent.poll"],
): Promise<void> {
  if (!deps.cloudAgent) return;
  const context: AdapterContext = {
    operationId: `cloud-agent-poll:${payload.agentId}`,
    traceId: `cloud-agent-poll:${payload.agentId}`,
    spaceId: payload.spaceId,
    userId: payload.userId,
    botId: payload.botId,
    signal: new AbortController().signal,
  };

  const attempt = payload.attempt ?? 0;
  let snapshot: Awaited<ReturnType<CloudAgentProvider["get"]>>;
  try {
    snapshot = await deps.cloudAgent.get(payload.agentId, context);
  } catch (error) {
    console.error("cloud agent poll", error);
    if (attempt < MAX_ATTEMPTS) {
      await deps.jobs.enqueue(
        cloudAgentPollJob(
          { ...payload, attempt: attempt + 1 },
          new Date(Date.now() + POLL_DELAY_MS),
        ),
      );
    }
    return;
  }

  const message = await deps.prisma.message.findUnique({
    where: { id: payload.messageId },
    select: { id: true, blocks: true, threadId: true },
  });
  if (!message || message.threadId !== payload.threadId) return;

  const previous = (message.blocks as MessageBlock[]).find(
    (block): block is Extract<MessageBlock, { kind: "cloud_agent" }> =>
      block.kind === "cloud_agent" && block.agentId === payload.agentId,
  );
  const nextBlock = {
    kind: "cloud_agent" as const,
    agentId: payload.agentId,
    title: snapshot.title || previous?.title || "Cloud agent",
    status: snapshot.status,
    url: snapshot.url || previous?.url || "",
    ...(snapshot.branch || previous?.branch ? { branch: snapshot.branch || previous?.branch } : {}),
    ...(snapshot.prUrl || previous?.prUrl ? { prUrl: snapshot.prUrl || previous?.prUrl } : {}),
    ...(snapshot.latestRunId || previous?.latestRunId
      ? { latestRunId: snapshot.latestRunId || previous?.latestRunId }
      : {}),
  } satisfies Extract<MessageBlock, { kind: "cloud_agent" }>;

  const changed =
    !previous ||
    previous.title !== nextBlock.title ||
    previous.status !== nextBlock.status ||
    previous.url !== nextBlock.url ||
    previous.branch !== nextBlock.branch ||
    previous.prUrl !== nextBlock.prUrl ||
    previous.latestRunId !== nextBlock.latestRunId;

  if (changed) {
    const blocks = (message.blocks as MessageBlock[]).map((block) =>
      block.kind === "cloud_agent" && block.agentId === payload.agentId ? nextBlock : block,
    );
    await deps.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: message.id },
        data: { blocks },
      });
      await appendEventInTransaction(tx, {
        spaceId: payload.spaceId,
        threadId: payload.threadId,
        botId: payload.botId,
        type: "thread.cloud_agent",
        payload: {
          messageId: message.id,
          agentId: snapshot.id,
          title: nextBlock.title,
          status: nextBlock.status,
          url: nextBlock.url,
          branch: nextBlock.branch,
          prUrl: nextBlock.prUrl,
          latestRunId: nextBlock.latestRunId,
        },
      });
    });
  }

  if (!TERMINAL.has(snapshot.status)) {
    if (attempt < MAX_ATTEMPTS) {
      await deps.jobs.enqueue(
        cloudAgentPollJob(
          { ...payload, attempt: attempt + 1 },
          new Date(Date.now() + POLL_DELAY_MS),
        ),
      );
    }
    return;
  }

  await wakeBotForCloudAgent(deps, payload, snapshot);
}

async function wakeBotForCloudAgent(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  payload: BackgroundJobPayloads["cloud_agent.poll"],
  snapshot: {
    id: string;
    title: string;
    status: string;
    url: string;
    branch?: string;
    prUrl?: string;
  },
) {
  const wakeNonce = `cloud-agent-wake:${payload.agentId}:${snapshot.status}`;
  const existing = await deps.prisma.message.findFirst({
    where: { threadId: payload.threadId, clientNonce: wakeNonce },
    select: { id: true, runId: true },
  });
  if (existing?.runId) {
    await deps.jobs.enqueue(runContinueJob(existing.runId)).catch((error) => {
      console.error("cloud agent wake reenqueue", error);
    });
    return;
  }

  const summary = [
    `Cloud agent "${snapshot.title}" is ${snapshot.status}.`,
    snapshot.prUrl ? `PR: ${snapshot.prUrl}` : null,
    snapshot.branch ? `Branch: ${snapshot.branch}` : null,
    `Agent: ${snapshot.url}`,
  ]
    .filter(Boolean)
    .join(" ");

  const claimed = await withTransactionRetry(() =>
    deps.prisma.$transaction(async (tx) => {
      const wakeMessage = await createThreadMessageInTransaction(tx, {
        threadId: payload.threadId,
        role: "system",
        blocks: [{ kind: "meta", text: summary }],
        botId: payload.botId,
        clientNonce: wakeNonce,
      });
      const task = await tx.task.create({
        data: {
          spaceId: payload.spaceId,
          botId: payload.botId,
          threadId: payload.threadId,
          userId: payload.userId,
          prompt: summary,
          status: "queued",
        },
      });
      const run = await tx.run.create({
        data: {
          spaceId: payload.spaceId,
          botId: payload.botId,
          threadId: payload.threadId,
          taskId: task.id,
          userId: payload.userId,
          status: "queued",
          trigger: "cloud_agent",
          sourceMessageId: wakeMessage.id,
          clientNonce: `cloud-agent-wake-run:${payload.agentId}:${snapshot.status}`,
        },
      });
      await tx.message.update({ where: { id: wakeMessage.id }, data: { runId: run.id } });
      await appendEventInTransaction(tx, {
        spaceId: payload.spaceId,
        threadId: payload.threadId,
        botId: payload.botId,
        type: "thread.message.created",
        runId: run.id,
        payload: {
          messageId: wakeMessage.id,
          role: "system",
          blocks: [{ kind: "meta", text: summary }],
        },
      });
      return run;
    }),
  );

  await deps.jobs.enqueue(runContinueJob(claimed.id)).catch((error) => {
    console.error("cloud agent wake enqueue", error);
  });
}
