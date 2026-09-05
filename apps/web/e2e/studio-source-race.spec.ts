import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

const projects = [
  {
    id: "project-a",
    name: "Project A",
    slug: "project-a",
    scope: "one",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  },
  {
    id: "project-b",
    name: "Project B",
    slug: "project-b",
    scope: "one",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  },
];

const sourceB = {
  id: "binding-b",
  projectId: "project-b",
  kind: "repository",
  repository: "github:studio/game",
  ref: "workspace",
  path: null,
  metadata: { snapshotId: "snapshot-b" },
};

function jsonResponse(value: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify({ json: value }) };
}

test("ignores out-of-order source and wiki responses and de-duplicates connects", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `studio-source-race-${stamp}@rakazo.test`, "password12", "Source Race");
  await completeOnboarding(page);

  let releaseProjectA!: () => void;
  const projectAReady = new Promise<void>((resolve) => {
    releaseProjectA = resolve;
  });
  let releaseWikiB!: () => void;
  const wikiBReady = new Promise<void>((resolve) => {
    releaseWikiB = resolve;
  });
  let releasePageA!: () => void;
  const pageAReady = new Promise<void>((resolve) => {
    releasePageA = resolve;
  });
  let releasePageB!: () => void;
  const pageBReady = new Promise<void>((resolve) => {
    releasePageB = resolve;
  });

  await page.route("**/rpc/studio/projects", (route) => route.fulfill(jsonResponse(projects)));
  await page.route("**/rpc/studio/registeredRepositories", (route) =>
    route.fulfill(jsonResponse([{ id: "game", label: "Game repository" }])),
  );
  await page.route("**/rpc/studio/projectSources", async (route) => {
    const projectId = (route.request().postDataJSON() as { json: { projectId: string } }).json.projectId;
    if (projectId === "project-a") {
      await projectAReady;
      return route.fulfill(jsonResponse([]));
    }
    return route.fulfill(jsonResponse([sourceB]));
  });
  await page.route("**/rpc/studio/projectWikiPages", async (route) => {
    await wikiBReady;
    return route.fulfill(
      jsonResponse([
        {
          pageId: "b-page",
          title: "Project B page",
          snapshotId: "snapshot-b",
          commit: "commit-b",
          generatedAt: "2026-09-05T00:00:00.000Z",
          generatorVersion: "test",
          localOverlay: false,
          freshness: { status: "current", reasons: [] },
        },
        {
          pageId: "a-page",
          title: "Project A page",
          snapshotId: "snapshot-b",
          commit: "commit-b",
          generatedAt: "2026-09-05T00:00:00.000Z",
          generatorVersion: "test",
          localOverlay: false,
          freshness: { status: "current", reasons: [] },
        },
      ]),
    );
  });
  await page.route("**/rpc/studio/projectWikiPage", async (route) => {
    const pageId = (route.request().postDataJSON() as { json: { pageId: string } }).json.pageId;
    if (pageId === "a-page") await pageAReady;
    else await pageBReady;
    return route.fulfill(
      jsonResponse({
        pageId,
        page: {
          slug: pageId,
          title: pageId === "a-page" ? "Project A page" : "Project B page",
          content: pageId === "a-page" ? "A content" : "B content",
          citations: [{ relativePath: `${pageId}.md`, startLine: 1, endLine: 2 }],
        },
        manifest: {
          snapshotId: "snapshot-b",
          inputsHash: "inputs-b",
          projectId: "project-b",
          commit: "commit-b",
          indexerVersion: "test",
          parserVersion: "test",
          generatorVersion: "test",
          generatedAt: "2026-09-05T00:00:00.000Z",
          sourceAuthority: "generated",
          localOverlay: false,
        },
        freshness: { status: "current", reasons: [] },
        activeSnapshot: {
          id: "snapshot-b",
          projectId: "project-b",
          commit: "commit-b",
          overlay: "shared-commit",
        },
      }),
    );
  });
  await page.route("**/rpc/studio/addProjectSource", (route) =>
    route.fulfill(jsonResponse(sourceB)),
  );

  await page.getByRole("button", { name: "Studio" }).click();
  await expect(page.getByTestId("studio-page")).toBeVisible();
  const sourceProject = page.getByRole("combobox", { name: "Source project" });
  await sourceProject.selectOption("project-a");
  await sourceProject.selectOption("project-b");
  await expect(page.getByText("github:studio/game · workspace")).toBeVisible();
  releaseProjectA();

  await page.getByRole("button", { name: "Wiki" }).click();
  await sourceProject.selectOption("project-a");
  releaseWikiB();
  await expect(page.getByText("Project B page")).toHaveCount(0);

  await page.getByRole("button", { name: "Wiki" }).click();
  await expect(page.getByRole("button", { name: /Project A page/ })).toBeVisible();
  await page.getByRole("button", { name: /Project A page/ }).click();
  await page.getByRole("button", { name: /Project B page/ }).click();
  releasePageA();
  releasePageB();
  await expect(page.getByRole("heading", { name: "Project B page" })).toBeVisible();

  const connect = page.getByRole("button", { name: "Connect" });
  await connect.click();
  await connect.click();
  await expect(page.getByText("github:studio/game · workspace")).toHaveCount(1);
});
