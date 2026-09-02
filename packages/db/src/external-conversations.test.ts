import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createExternalConversationRepos } from "./external-conversations.js";

describe("external conversations", () => {
  it("lists authorized conversations with their transcript preview", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "external-1",
        spaceId: "space-1",
        botId: "bot-1",
        provider: "slack",
        displayName: "Morgan, Pat, Chief",
        participantNames: ["Morgan", "Pat", "Chief"],
        updatedAt: new Date("2026-09-01T12:30:00.000Z"),
        thread: {
          id: "thread-1",
          unread: false,
          messages: [{ blocks: [{ kind: "text", text: "GROUP DM OK" }] }],
        },
      },
    ]);
    const repos = createExternalConversationRepos({
      externalConversation: { findMany },
    } as unknown as PrismaClient);

    await expect(
      repos.listForSpaces(
        {
          spaceId: "space-1",
          userId: "user-1",
          email: "owner@example.test",
          isDeploymentOwner: true,
        },
        ["space-1"],
      ),
    ).resolves.toEqual([
      {
        id: "external-1",
        spaceId: "space-1",
        botId: "bot-1",
        provider: "slack",
        displayName: "Morgan, Pat, Chief",
        participantNames: ["Morgan", "Pat", "Chief"],
        threadId: "thread-1",
        preview: "GROUP DM OK",
        unread: false,
        updatedAt: "2026-09-01T12:30:00.000Z",
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          spaceId: { in: ["space-1"] },
          userId: "user-1",
          bot: { archivedAt: null },
          thread: { isNot: null },
        },
      }),
    );
  });
});
