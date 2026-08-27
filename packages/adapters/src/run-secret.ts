import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import type { Prisma, PrismaClient } from "@rakazo/db";
import type { ApprovalPausedToolResult } from "./approval-effect.js";
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
 * Persist the secret tool result first, then delete the stored ciphertext.
 * Deleting before persist loses single-use OTPs if the worker crashes mid-flight.
 */
export async function commitConsumedRunSecret<TResult, TFailed>(input: {
  persist: () => Promise<boolean>;
  deleteSecret: () => Promise<void>;
  result: TResult;
  onPersistFailed: TFailed;
}): Promise<TResult | TFailed> {
  const persisted = await input.persist();
  if (!persisted) return input.onPersistFailed;
  await input.deleteSecret();
  return input.result;
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
      status: "pending",
    },
  });
  if (!row) return { connected: false };
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
