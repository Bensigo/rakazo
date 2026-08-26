import { describe, expect, it, vi } from "vitest";
import {
  runSecretKind,
  secretPausedToolResult,
  tryCompleteConnectionWithCode,
} from "./run-secret.js";

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
  const context = {
    operationId: "run-1",
    traceId: "run-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    signal: new AbortController().signal,
  };

  it("forwards the code to a pending managed connector", async () => {
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

    await expect(
      tryCompleteConnectionWithCode(
        prisma as never,
        connectors as never,
        { workspaceId: "workspace-1", userId: "user-1" },
        context,
        "conn-1",
        "123456",
      ),
    ).resolves.toEqual({ connected: true });

    expect(prisma.connection.findFirst).toHaveBeenCalledWith({
      where: {
        id: "conn-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        status: "pending",
      },
    });
    expect(complete).toHaveBeenCalledWith({ state: "gmail-state", code: "123456" }, context);
    expect(prisma.connection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { status: "connected" },
    });
  });

  it("returns a connector error instead of throwing", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("invalid code"));
    const prisma = {
      connection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn-1",
          connectorId: "composio",
          provider: "gmail",
          providerRef: "gmail-state",
          status: "pending",
        }),
        update: vi.fn(),
      },
    };
    const connectors = {
      managed: vi.fn(() => ({ complete, connectionReady: vi.fn() })),
    };

    await expect(
      tryCompleteConnectionWithCode(
        prisma as never,
        connectors as never,
        { workspaceId: "workspace-1", userId: "user-1" },
        context,
        "conn-1",
        "bad",
      ),
    ).resolves.toEqual({ connected: false, error: "invalid code" });
  });
});
