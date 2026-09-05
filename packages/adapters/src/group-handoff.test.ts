import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { handoffToGroupBot } from "./group-handoff.js";

const run = {
  id: "run-a",
  spaceId: "workspace-1",
  threadId: "thread-1",
  botId: "bot-a",
  userId: "user-1",
};

function harness(
  sourceBlocks: unknown,
  existing?: { sourceRuns: { id: string; botId: string }[] },
  computerId?: string,
  options?: {
    projectId?: string | null;
    studioContext?: Record<string, unknown> | null;
    targetUserId?: string;
  },
) {
  const runCreate = vi.fn(async () => ({ id: "run-b" }));
  const taskCreate = vi.fn(async () => ({ id: "task-b" }));
  const messageCreate = vi.fn(async () => ({ id: "message-1" }));
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: "group-1" }]),
    chatGroup: {
      findFirst: vi.fn(async () => ({
        id: "group-1",
        members: ["bot-a", "bot-b", "bot-c"].map((id) => ({
          bot: {
            id,
            name: id.toUpperCase(),
            spaceId: run.spaceId,
            userId: id === "bot-b" ? (options?.targetUserId ?? run.userId) : run.userId,
          },
        })),
      })),
      update: vi.fn(async () => ({ id: "group-1" })),
    },
    run: {
      findFirst: vi.fn(async () => ({
        id: run.id,
        computerId: computerId ?? null,
        studioContext: options?.studioContext ?? null,
        task: {
          projectId: options?.projectId ?? null,
          studioContext: options?.studioContext ?? null,
        },
        sourceMessage: { blocks: sourceBlocks },
      })),
      findUnique: vi.fn(async () => ({ status: "running" })),
      create: runCreate,
    },
    message: {
      findUnique: vi.fn(async () => existing ?? null),
      create: messageCreate,
    },
    thread: {
      update: vi.fn(async (args: { select: { nextMessageSeq?: boolean } }) =>
        args.select.nextMessageSeq ? { nextMessageSeq: 2 } : { nextEventSeq: 2 },
      ),
    },
    task: { create: taskCreate },
    event: {
      findFirst: vi.fn(async () => ({ seq: 1 })),
      create: vi.fn(async () => ({ seq: 1 })),
    },
    computer: {
      findFirst: vi.fn(async () =>
        computerId ? { id: computerId, kind: "employee-host", providerRef: "host-1" } : null,
      ),
    },
    employeeHost: {
      findFirst: vi.fn(async () => (computerId ? { computerId } : null)),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return {
    deps: {
      prisma,
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
    },
    messageCreate,
    taskCreate,
    runCreate,
  };
}

describe("group handoff ownership", () => {
  it("marks a new ownership transfer as a follow-up with a chain hop", async () => {
    const { deps, messageCreate, runCreate } = harness([{ kind: "text", text: "user request" }]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "Do the distinct next stage",
      }),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b" });

    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocks: [
            expect.objectContaining({
              kind: "handoff",
              fromBotId: "bot-a",
              toBotId: "bot-b",
              hop: 1,
            }),
          ],
        }),
      }),
    );
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trigger: "follow_up" }) }),
    );
  });

  it("inherits a revalidated selected computer for a group stage", async () => {
    const { deps, runCreate } = harness(
      [{ kind: "text", text: "user request" }],
      undefined,
      "employee-computer",
    );

    await handoffToGroupBot(deps as never, run, "group-1", {
      bot_id: "bot-b",
      message: "Do this stage locally",
    });

    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ computerId: "employee-computer" }),
      }),
    );
  });

  it("preserves protected Studio context and fails closed after target access is revoked", async () => {
    const studioContext = {
      version: 1,
      organizationId: "organization-1",
      foundation: { id: "foundation-1", revision: 4, content: { standards: "Cite sources" } },
      assignment: {
        id: "assignment-1",
        scope: "one",
        projectIds: ["project-1"],
        brief: { objective: "Review the release" },
      },
      sourceProjectIds: ["project-1"],
      sources: [
        {
          bindingId: "binding-1",
          studioProjectId: "project-1",
          sourceId: "repository-1",
          refKey: "main",
          snapshotId: "snapshot-1",
          knowledgeProjectId: "knowledge-1",
          access: { allowedScopes: ["project"] },
        },
      ],
    };
    const { deps, taskCreate, runCreate } = harness(
      [{ kind: "text", text: "user request" }],
      undefined,
      "employee-computer",
      { projectId: "project-1", studioContext },
    );

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "Continue with the pinned release context",
      }),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b" });
    expect(taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: "project-1", studioContext }),
    });
    expect(runCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ computerId: "employee-computer", studioContext }),
    });

    const revoked = harness(
      [{ kind: "text", text: "user request" }],
      undefined,
      "employee-computer",
      { projectId: "project-1", studioContext, targetUserId: "user-2" },
    );
    await expect(
      handoffToGroupBot(revoked.deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "Must not cross the owner boundary",
      }),
    ).resolves.toEqual({ error: "handoff target is no longer available" });
    expect(revoked.taskCreate).not.toHaveBeenCalled();
    expect(revoked.runCreate).not.toHaveBeenCalled();
  });

  it("refuses to bounce a handed-off stage straight back to its sender", async () => {
    const { deps, runCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Investigate", hop: 1 },
    ]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "You investigate it",
      }),
    ).resolves.toEqual({
      error:
        "do not hand this stage back to its sender; post the result in the shared thread instead",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("caps longer multi-agent handoff chains", async () => {
    const { deps, runCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Stage six", hop: 6 },
    ]);

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-c",
        message: "Stage seven",
      }),
    ).resolves.toEqual({
      error:
        "group handoff limit reached for this chain; finish the current stage in the shared thread instead",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("reuses the recorded transfer when a source run is retried", async () => {
    const { deps, messageCreate, runCreate } = harness([], {
      sourceRuns: [{ id: "run-b", botId: "bot-b" }],
    });

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-c",
        message: "A duplicate stage",
      }),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b", runId: "run-b" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed source ancestry instead of restarting its hop count", async () => {
    const { deps, runCreate } = harness({ kind: "not-an-array" });

    await expect(
      handoffToGroupBot(deps as never, run, "group-1", {
        bot_id: "bot-b",
        message: "Continue",
      }),
    ).resolves.toEqual({ error: "cannot verify the group handoff chain" });
    expect(runCreate).not.toHaveBeenCalled();
  });
});
