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
): Promise<boolean> {
  const row = await prisma.connection.findFirst({
    where: { id: connectionId, workspaceId: run.workspaceId, userId: run.userId },
  });
  if (!row) return false;
  const connector = connectors?.managed(row.connectorId);
  if (!connector) return false;
  const state = row.providerRef ?? row.provider;
  await connector.complete({ state, code }, context);
  const ready = await connector.connectionReady(context, row.provider);
  if (ready && row.status !== "connected") {
    await prisma.connection.update({
      where: { id: row.id },
      data: { status: "connected" },
    });
  }
  return ready;
}
