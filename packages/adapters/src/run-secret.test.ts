import { describe, expect, it, vi } from "vitest";
import {
  commitConsumedRunSecret,
  resolveCompletedSecretLeftover,
  resolveMissingRunSecretAction,
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

describe("commitConsumedRunSecret", () => {
  it("deletes the stored secret only after persist succeeds", async () => {
    const order: string[] = [];
    const result = { ok: true, submitted: true };
    const onPersistFailed = { error: "uncertain", uncertain: true as const };

    await expect(
      commitConsumedRunSecret({
        persist: async () => {
          order.push("persist");
          return true;
        },
        deleteSecret: async () => {
          order.push("delete");
        },
        result,
        onPersistFailed,
      }),
    ).resolves.toBe(result);

    expect(order).toEqual(["persist", "delete"]);
  });

  it("keeps the stored secret when persist fails so a retry can reuse it", async () => {
    const deleteSecret = vi.fn();
    const onPersistFailed = { error: "uncertain", uncertain: true as const };

    await expect(
      commitConsumedRunSecret({
        persist: async () => false,
        deleteSecret,
        result: { ok: true, submitted: true },
        onPersistFailed,
      }),
    ).resolves.toBe(onPersistFailed);

    expect(deleteSecret).not.toHaveBeenCalled();
  });
});

describe("resolveCompletedSecretLeftover", () => {
  it("drops a leftover OTP created before the effect completed", () => {
    expect(
      resolveCompletedSecretLeftover({
        secretCreatedAt: new Date("2026-08-27T12:00:00.000Z"),
        effectUpdatedAt: new Date("2026-08-27T12:00:05.000Z"),
      }),
    ).toBe("drop_leftover");
  });

  it("consumes a replacement OTP submitted after the effect completed", () => {
    expect(
      resolveCompletedSecretLeftover({
        secretCreatedAt: new Date("2026-08-27T12:01:00.000Z"),
        effectUpdatedAt: new Date("2026-08-27T12:00:05.000Z"),
      }),
    ).toBe("consume_replacement");
  });
});

describe("resolveMissingRunSecretAction", () => {
  it("replays a completed effect instead of asking again after the secret was deleted", () => {
    const result = { ok: true, submitted: true, connected: true };
    expect(resolveMissingRunSecretAction({ status: "completed", result })).toEqual({
      action: "return",
      result,
    });
  });

  it("asks again when the effect is still waiting for input", () => {
    expect(resolveMissingRunSecretAction({ status: "intended" })).toEqual({ action: "ask" });
    expect(resolveMissingRunSecretAction(undefined)).toEqual({ action: "ask" });
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
    ).resolves.toEqual({ connected: false, error: "Connection could not be completed." });
  });
});
