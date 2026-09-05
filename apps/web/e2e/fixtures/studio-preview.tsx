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
];
const routes: Record<string, unknown> = {
  "/rpc/studio/projects": projects,
  "/rpc/studio/roles": roles,
  "/rpc/bots/list": [{ id: "fixture-engineer", name: "Engineer" }],
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
  if (!(pathname in routes))
    return new Response("Fixture is read-only; execution is disabled.", { status: 503 });
  return Response.json({ json: routes[pathname] });
};

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <div className="border-b border-border bg-muted px-6 py-2 text-center text-xs text-muted-foreground">
      UI fixture · synthetic data · execution disabled
    </div>
    <StudioPage />
  </BrowserRouter>,
);
