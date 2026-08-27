import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { type ApprovalPausedToolResult, resolveDuplicateEffectGate } from "./approval-effect.js";
import type { EncryptedSecretStore } from "./secrets.js";

export function runSecretKind(runId: string): string {
  return `run-secret:${runId}`;
}

export function secretPausedToolResult(): ApprovalPausedToolResult {
  return {
    kind: "agent_tool_result",
    content: [{ type: "text", text: "Waiting for protected input." }],
    details: { secret: "paused" },
    terminate: true,
  };
}

/**
 * Delete the stored secret before connector side effects, then persist the tool result.
 * Keeping the ciphertext until after complete() lets a crash retry resubmit a single-use OTP.
 * If persist fails after the connector already succeeded, retry reconciles via connection status.
 */
export async function commitConsumedRunSecret<TResult, TFailed>(input: {
  deleteSecret: () => Promise<void>;
  afterSecretTaken: () => Promise<TResult>;
  persist: (result: TResult) => Promise<boolean>;
  onPersistFailed: TFailed;
}): Promise<TResult | TFailed> {
  await input.deleteSecret();
  const result = await input.afterSecretTaken();
  if (!(await input.persist(result))) return input.onPersistFailed;
  return result;
}

/**
 * When a completed request_secret effect still has a run-secret row, decide whether
 * that row is a crash leftover (same OTP, do not resubmit) or a newer replacement.
 */
export function resolveCompletedSecretLeftover(input: {
  secretCreatedAt: Date;
  effectUpdatedAt: Date;
}): "drop_leftover" | "consume_replacement" {
  return input.secretCreatedAt.getTime() <= input.effectUpdatedAt.getTime()
    ? "drop_leftover"
    : "consume_replacement";
}

/**
 * When the stored run secret is already gone, decide whether to reuse a settled
 * effect result or ask again. Prevents re-prompting after persist if the worker
 * crashes before the tool result reaches the runtime.
 */
export function resolveMissingRunSecretAction(
  effect: { status: string; result?: unknown } | null | undefined,
):
  | { action: "return"; result: unknown }
  | { action: "uncertain"; toolName: string }
  | { action: "ask" } {
  if (!effect) return { action: "ask" };
  const gate = resolveDuplicateEffectGate(effect, "request_secret");
  if (gate.action === "return") return { action: "return", result: gate.result };
  if (gate.action === "uncertain") return { action: "uncertain", toolName: gate.toolName };
  return { action: "ask" };
}

export async function connectionAlreadyConnected(
  prisma: PrismaClient,
  run: { workspaceId: string; userId: string },
  connectionId: string,
): Promise<boolean> {
  const row = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      workspaceId: run.workspaceId,
      userId: run.userId,
      status: "connected",
    },
    select: { id: true },
  });
  return row != null;
}

export interface RunSecretWriter {
  store(input: {
    runId: string;
    userId: string;
    workspaceId: string;
    plaintext: string;
    tx: Prisma.TransactionClient;
  }): Promise<void>;
}

export function createRunSecretWriter(secretStore: EncryptedSecretStore): RunSecretWriter {
  return {
    async store({ runId, userId, workspaceId, plaintext, tx }) {
      const stored = await secretStore.put(plaintext, {
        operationId: runId,
        traceId: runId,
        workspaceId,
        userId,
        signal: new AbortController().signal,
      });
      await tx.secret.create({
        data: {
          id: stored.id,
          userId,
          workspaceId,
          kind: runSecretKind(runId),
          ciphertext: stored.ciphertext,
        },
      });
    },
  };
}

export async function tryCompleteConnectionWithCode(
  prisma: PrismaClient,
  connectors: { managed(id: string): ManagedConnectorProvider | undefined } | undefined,
  run: { workspaceId: string; userId: string },
  context: AdapterContext,
  connectionId: string,
  code: string,
): Promise<{ connected: boolean; error?: string }> {
  const row = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      workspaceId: run.workspaceId,
      userId: run.userId,
      status: { in: ["pending", "connected"] },
    },
  });
  if (!row) return { connected: false };
  // Already finished on a prior attempt; do not resubmit the OTP.
  if (row.status === "connected") return { connected: true };
  const connector = connectors?.managed(row.connectorId);
  if (!connector) return { connected: false };
  const state = row.providerRef ?? row.provider;
  try {
    await connector.complete({ state, code }, context);
    const ready = await connector.connectionReady(context, row.provider);
    if (ready) {
      await prisma.connection.update({
        where: { id: row.id },
        data: { status: "connected" },
      });
    }
    return { connected: ready };
  } catch {
    return {
      connected: false,
      error: "Connection could not be completed.",
    };
  }
}
