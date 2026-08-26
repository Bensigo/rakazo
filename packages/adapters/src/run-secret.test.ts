import { describe, expect, it, vi } from "vitest";
import { runSecretKind, secretPausedToolResult, tryCompleteConnectionWithCode } from "./run-secret.js";

describe("runSecretKind", () => {
  it("scopes secrets to a single run", () => {
    expect(runSecretKind("run-1")).toBe("run-secret:run-1");
  });
});

describe("secretPausedToolResult", () => {
  it("terminates the agent turn without exposing a value", () => {
    expect(secretPausedToolResult()).toMatchObject({
      terminate: true,
      details: { secret: "paused" },
    });
  });
});

describe("tryCompleteConnectionWithCode", () => {
  it("forwards the code to the managed connector", async () => {
    const complete = vi.fn().mockResolvedValue({ connectionRef: "gmail" });
    const connectionReady = vi.fn().mockResolvedValue(true);
    const prisma = {
      connection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn-1",
          connectorId: "composio",
          provider: "gmail",
          providerRef: "gmail-state",
          status: "pending",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const connectors = {
      managed: vi.fn(() => ({ complete, connectionReady })),
    };
    const context = {
      operationId: "run-1",
      traceId: "run-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      signal: new AbortController().signal,
    };

    await expect(
      tryCompleteConnectionWithCode(
        prisma as never,
        connectors,
        { workspaceId: "workspace-1", userId: "user-1" },
        context,
        "conn-1",
        "123456",
      ),
    ).resolves.toBe(true);

    expect(complete).toHaveBeenCalledWith({ state: "gmail-state", code: "123456" }, context);
    expect(prisma.connection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { status: "connected" },
    });
  });
});
