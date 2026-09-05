// Browser-only visual fixture. This entry is outside the production app bundle.
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { StudioPage } from "../../src/pages/Studio";
import "../../src/styles.css";

const projects = [
  { id: "fixture-garden", name: "Garden Tiles", slug: "garden-tiles", scope: "one" },
  { id: "fixture-moon", name: "Moon Runner", slug: "moon-runner", scope: "one" },
];
const roles = [
  {
    id: "fixture-engineer-role",
    key: "engineering",
    name: "Engineer",
    description: "",
    instructions: "Make small changes, run relevant tests, and return cited evidence.",
    isDefault: true,
  },
  {
    id: "fixture-reviewer-role",
    key: "review",
    name: "Reviewer",
    description: "Check evidence and acceptance boundaries.",
    instructions: "Check evidence and acceptance boundaries.",
    isDefault: false,
  },
];
const jobRoles = [
  {
    id: "fixture-job-role",
    key: "product",
    name: "Product team",
    description: "A focused product role.",
    defaultRolePresetIds: ["fixture-engineer-role"],
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  },
];
let selectedJobRole: unknown = null;
let bots = [{ id: "fixture-engineer", name: "Engineer" }];
const fixtureMode = new URLSearchParams(window.location.search);
let roleSelectionCalls = 0;
const routes: Record<string, unknown> = {
  "/rpc/studio/permissions": null,
  "/rpc/studio/projects": projects,
  "/rpc/studio/roles": roles,
  "/rpc/bots/list": bots,
  "/rpc/studio/jobRoles": jobRoles,
  "/rpc/studio/jobRoleSelection": null,
  "/rpc/studio/registeredRepositories": [],
  "/rpc/studio/assignments": [],
  "/rpc/studio/foundation": {
    currentRevision: {
      revision: 3,
      content: {
        goals: "Build small, polished mobile games.",
        standards: "Keep each change reviewable and support claims with evidence.",
        guidelines: "Preserve player agency and protect private project material.",
        workflow: "Propose the work, verify the result, and request human acceptance.",
      },
    },
  },
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const request = new Request(input, init);
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/rpc/")) return realFetch(input, init);
  if (pathname === "/rpc/studio/selectJobRole") {
    roleSelectionCalls += 1;
    if (fixtureMode.has("fail-after-first") && roleSelectionCalls > 1) {
      return new Response("Synthetic role provisioning failure", { status: 503 });
    }
    if (fixtureMode.has("slow-role")) {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    selectedJobRole = {
      jobRole: jobRoles[0],
      specialists: [
        { rolePresetId: "fixture-engineer-role", botId: "fixture-provisioned-engineer" },
      ],
    };
    if (!bots.some((bot) => bot.id === "fixture-provisioned-engineer")) {
      bots = [...bots, { id: "fixture-provisioned-engineer", name: "Engineer (yours)" }];
    }
    routes["/rpc/bots/list"] = bots;
    routes["/rpc/studio/jobRoleSelection"] = selectedJobRole;
    return Response.json({ json: selectedJobRole });
  }
  if (pathname === "/rpc/studio/createJobRole") {
    const envelope = (await request.clone().json()) as {
      json: {
        key: string;
        name: string;
        description?: string;
        defaultRolePresetIds: string[];
      };
    };
    const input = envelope.json;
    const role = {
      id: `fixture-job-role-${jobRoles.length}`,
      ...input,
      description: input.description ?? "",
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    jobRoles.push(role);
    routes["/rpc/studio/jobRoles"] = jobRoles;
    return Response.json({ json: role });
  }
  if (!(pathname in routes))
    return new Response("Fixture is read-only; execution is disabled.", { status: 503 });
  const value =
    pathname === "/rpc/studio/jobRoleSelection"
      ? selectedJobRole
      : pathname === "/rpc/studio/permissions"
        ? {
            memberRole: fixtureMode.has("member") ? "member" : "admin",
            canManageJobRoles: !fixtureMode.has("member"),
            canManageFoundation: !fixtureMode.has("member"),
          }
        : routes[pathname];
  return Response.json({ json: value });
};

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <div className="border-b border-border bg-muted px-6 py-2 text-center text-xs text-muted-foreground">
      UI fixture · synthetic data · execution disabled
    </div>
    <StudioPage />
  </BrowserRouter>,
);
