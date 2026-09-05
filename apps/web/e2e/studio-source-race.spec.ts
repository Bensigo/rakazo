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
      ]),
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

  await sourceProject.selectOption("project-b");
  const connect = page.getByRole("button", { name: "Connect" });
  await connect.click();
  await connect.click();
  await expect(page.getByText("github:studio/game · workspace")).toHaveCount(1);
});
