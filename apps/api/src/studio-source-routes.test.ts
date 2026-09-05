import { createHash } from "node:crypto";
import { RPCHandler } from "@orpc/server/fetch";
import type { RegisteredStudioRepository, StudioKnowledgeBridge } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "member@example.test",
  isDeploymentOwner: false,
};

const repository: RegisteredStudioRepository = {
  id: "game",
  organizationId: "org-1",
  label: "Game repository",
  checkoutPath: "/srv/studio/game",
  sourceId: "github:studio/game",
  refKey: "workspace",
};

function fixture(
  role: "admin" | "member" = "admin",
  initialBinding?: any,
  repositories: RegisteredStudioRepository[] = [
    repository,
    { ...repository, id: "foreign", organizationId: "org-2" },
  ],
) {
  let binding: any = initialBinding;
  const prisma = {
    spaceMember: {
      findUnique: vi.fn(async () => ({ organizationId: "org-1", member: { role } })),
    },
    studioProject: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === "project-1" && where.organizationId === "org-1" ? { id: "project-1" } : null,
      ),
    },
    projectSourceBinding: {
      findMany: vi.fn(async ({ where }: any) =>
        where.projectId === "project-1" && binding ? [binding] : [],
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        if (!binding) return null;
        if (where.id && where.id !== binding.id) return null;
        if (where.projectId && where.projectId !== binding.projectId) return null;
        if (where.repository && where.repository !== binding.repository) return null;
        if (where.ref && where.ref !== binding.ref) return null;
        return binding;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        binding = binding
          ? { ...binding, ...update }
          : { ...create, path: null, createdAt: new Date(), updatedAt: new Date() };
        binding.id = where.id;
        return binding;
      }),
    },
  } as unknown as PrismaClient;
  const sync = vi.fn(async () => ({
    knowledgeProjectId: "knowledge-game",
    snapshotId: "snapshot-1",
    commit: "abc123",
    localOverlay: false,
    freshness: { added: 3, updated: 0, unchanged: 0, deleted: 0, embedded: 5, reused: 0 },
    skipped: [{ relativePath: ".env", reason: "denied-path" }],
  }));
  const page = {
    pageId: "architecture",
    page: {
      slug: "architecture",
      title: "Architecture",
      content: "# Architecture",
      citations: [{ relativePath: "src/app.ts", startLine: 1, endLine: 8 }],
    },
    manifest: {
      snapshotId: "snapshot-1",
      inputsHash: "inputs-1",
      projectId: "knowledge-game",
      commit: "abc123",
      indexerVersion: "knowledge-core-v1",
      parserVersion: "knowledge-parser-v1",
      generatorVersion: "repository-wiki-v2",
      generatedAt: "2026-09-05T00:00:00.000Z",
      sourceAuthority: "generated" as const,
      localOverlay: false,
    },
    freshness: { status: "current" as const, reasons: [] },
    activeSnapshot: {
      id: "snapshot-1",
      projectId: "knowledge-game",
      commit: "abc123",
      overlay: "shared-commit" as const,
    },
  };
  const bridge: StudioKnowledgeBridge = {
    pin: vi.fn(async ({ sources }) => ({
      sources: sources.map((source) => ({
        ...source,
        knowledgeProjectId: "knowledge-game",
        snapshotId: "snapshot-1",
      })),
    })),
    read: vi.fn(async () => ({ instructions: "" })),
    sync,
    listWiki: vi.fn(async () => ({
      pages: [
        {
          pageId: "architecture",
          title: "Architecture",
          snapshotId: "snapshot-1",
          commit: "abc123",
          generatedAt: "2026-09-05T00:00:00.000Z",
          generatorVersion: "repository-wiki-v2",
          localOverlay: false,
          freshness: { status: "current", reasons: [] },
        },
      ],
    })),
    getWikiPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const deps = {
    prisma,
    studioKnowledge: bridge,
    studioRepositories: repositories,
    env: {},
    dataDir: "/tmp/rakazo-studio-source-test",
  } as unknown as RouterDeps;
  return {
    bridge,
    handler: new RPCHandler(createRouter(deps)),
    sync,
  };
}

async function call(handler: RPCHandler<never>, path: string, body: unknown = {}) {
  const { response } = await handler.handle(
    new Request(`http://127.0.0.1/rpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: body }),
    }),
    { prefix: "/rpc", context: { actor } },
  );
  return response;
}

describe("Studio source routes", () => {
  it("lists only repository labels registered to the actor organization", async () => {
    const { handler } = fixture();
    const response = await call(handler, "studio/registeredRepositories");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      json: [{ id: "game", label: "Game repository" }],
    });
  });

  it("ignores client source identity and syncs the server registered checkout", async () => {
    const { handler, sync } = fixture();
    const response = await call(handler, "studio/addProjectSource", {
      projectId: "project-1",
      repositoryId: "game",
      checkoutPath: "/tmp/client-controlled",
      sourceId: "client-source",
      refKey: "client-ref",
      expectedSnapshotId: "client-snapshot",
    });
    expect(response.status).toBe(200);
    expect(sync).toHaveBeenCalledWith({
      studioProjectId: "project-1",
      sourceId: "github:studio/game",
      refKey: "workspace",
      access: { allowedScopes: ["project"] },
      checkoutPath: "/srv/studio/game",
    });
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({
        projectId: "project-1",
        repository: "github:studio/game",
        ref: "workspace",
        path: null,
        metadata: expect.objectContaining({ snapshotId: "snapshot-1", commit: "abc123" }),
      }),
    });
  });

  it("derives sync CAS state from the persisted binding and maps stale writes to 409", async () => {
    const { handler, sync } = fixture();
    expect(
      (
        await call(handler, "studio/addProjectSource", {
          projectId: "project-1",
          repositoryId: "game",
        })
      ).status,
    ).toBe(200);
    sync.mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "source-binding-stale" }));
    const bindingId = `studio-source-${createHash("sha256")
      .update("project-1\u0000github:studio/game\u0000workspace")
      .digest("hex")}`;
    const response = await call(handler, "studio/syncProjectSource", { bindingId });
    expect(response.status).toBe(409);
    expect(sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedSnapshotId: "snapshot-1" }),
    );
  });

  it("lets members read canonical wiki citations through an authorized binding", async () => {
    const admin = fixture();
    const added = await call(admin.handler, "studio/addProjectSource", {
      projectId: "project-1",
      repositoryId: "game",
    });
    const body = (await added.json()) as { json: Record<string, unknown> & { id: string } };
    const member = fixture("member", body.json, []);
    const response = await call(member.handler, "studio/projectWikiPage", {
      projectId: "project-1",
      bindingId: body.json.id,
      pageId: "architecture",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({
        page: expect.objectContaining({
          citations: [{ relativePath: "src/app.ts", startLine: 1, endLine: 8 }],
        }),
      }),
    });
    expect(member.bridge.getWikiPage).toHaveBeenCalledWith({
      studioProjectId: "project-1",
      sourceId: "github:studio/game",
      refKey: "workspace",
      access: { allowedScopes: ["project"] },
      pageId: "architecture",
    });
  });

  it("blocks member writes and foreign organization registrations before scanning", async () => {
    const member = fixture("member");
    expect(
      (
        await call(member.handler, "studio/addProjectSource", {
          projectId: "project-1",
          repositoryId: "game",
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(member.sync).not.toHaveBeenCalled();

    const admin = fixture();
    expect(
      (
        await call(admin.handler, "studio/addProjectSource", {
          projectId: "project-1",
          repositoryId: "foreign",
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(admin.sync).not.toHaveBeenCalled();
  });
});
