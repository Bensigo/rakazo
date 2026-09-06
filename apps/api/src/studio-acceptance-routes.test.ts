import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

describe("Studio acceptance errors", () => {
  it("returns an actionable conflict for owned unfinished work without accepting it", async () => {
    const updateMany = vi.fn();
    const prisma = {
      spaceMember: {
        findUnique: vi.fn(async () => ({ organizationId: "org-qa" })),
      },
      assignmentManifest: {
        findFirst: vi.fn(async () => ({
          id: "assignment-qa",
          status: "draft",
          task: { status: "running", runs: [{ status: "running" }] },
        })),
        updateMany,
      },
    };
    const handler = new RPCHandler(createRouter({ prisma } as unknown as RouterDeps));
    const actor: Actor = {
      userId: "user-qa",
      spaceId: "space-qa",
      email: "qa@example.test",
      isDeploymentOwner: false,
    };
    const { response } = await handler.handle(
      new Request("http://localhost/rpc/studio/acceptAssignment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { assignmentId: "assignment-qa" } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    expect(response?.status).toBe(409);
    expect(await response?.text()).toContain(
      "Assignment work must complete before human acceptance",
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
