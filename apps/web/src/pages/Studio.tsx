import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AssignmentManifest, EmployeeRolePreset, StudioProject } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import { rpc } from "../lib/rpc";

export function StudioPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [roles, setRoles] = useState<EmployeeRolePreset[]>([]);
  const [bots, setBots] = useState<Awaited<ReturnType<typeof rpc.bots.list>>>([]);
  const [assignments, setAssignments] = useState<AssignmentManifest[]>([]);
  const [repositories, setRepositories] = useState<
    Awaited<ReturnType<typeof rpc.studio.registeredRepositories>>
  >([]);
  const [sources, setSources] = useState<Awaited<ReturnType<typeof rpc.studio.projectSources>>>([]);
  const [wikiPages, setWikiPages] = useState<
    Awaited<ReturnType<typeof rpc.studio.projectWikiPages>>
  >([]);
  const [wikiPage, setWikiPage] = useState<Awaited<
    ReturnType<typeof rpc.studio.projectWikiPage>
  > | null>(null);
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceBindingId, setSourceBindingId] = useState("");
  const [foundation, setFoundation] =
    useState<Awaited<ReturnType<typeof rpc.studio.foundation>>>(null);
  const [foundationFields, setFoundationFields] = useState({
    goals: "",
    standards: "",
    guidelines: "",
    workflow: "",
  });
  const [objective, setObjective] = useState("");
  const [scope, setScope] = useState<"studio" | "one" | "multi">("studio");
  const [botId, setBotId] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [roleKey, setRoleKey] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleInstructions, setRoleInstructions] = useState("");
  const [editingRole, setEditingRole] = useState<EmployeeRolePreset | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = async () => {
    try {
      const [p, r, f, a, b, rr] = await Promise.all([
        rpc.studio.projects(),
        rpc.studio.roles(),
        rpc.studio.foundation(),
        rpc.studio.assignments(),
        rpc.bots.list(),
        rpc.studio.registeredRepositories(),
      ]);
      setProjects(p);
      setRoles(r);
      setFoundation(f);
      setAssignments(a);
      setBots(b);
      setRepositories(rr);
      if (f?.currentRevision) {
        const c = f.currentRevision.content;
        setFoundationFields({
          goals: String(c.goals ?? ""),
          standards: String(c.standards ?? ""),
          guidelines: String(c.guidelines ?? ""),
          workflow: String(c.workflow ?? ""),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Studio");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };
  async function publishFoundation() {
    setFoundation(await rpc.studio.publishFoundation({ content: foundationFields }));
  }
  async function createRole() {
    const r = await rpc.studio.createRole({
      key: roleKey,
      name: roleName,
      description: "",
      instructions: roleInstructions,
      isDefault: roles.length === 0,
    });
    setRoles((all) => [...all, r]);
    setRoleKey("");
    setRoleName("");
    setRoleInstructions("");
  }
  async function updateRole() {
    if (!editingRole) return;
    const r = await rpc.studio.updateRole({
      roleId: editingRole.id,
      name: roleName,
      instructions: roleInstructions,
    });
    setRoles((all) => all.map((x) => (x.id === r.id ? r : x)));
    setEditingRole(null);
    setRoleName("");
    setRoleInstructions("");
  }
  async function createProject() {
    const name = projectName.trim();
    const slug =
      projectSlug.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") ||
      "project";
    const p = await rpc.studio.createProject({ name, slug, scope: "one" });
    setProjects((all) => [...all, p]);
    setProjectName("");
    setProjectSlug("");
  }
  async function selectSourceProject(projectId: string) {
    setSourceProjectId(projectId);
    setSourceBindingId("");
    setSources([]);
    setWikiPages([]);
    setWikiPage(null);
    if (projectId) setSources(await rpc.studio.projectSources({ projectId }));
  }
  async function addSource(repositoryId: string) {
    const source = await rpc.studio.addProjectSource({ projectId: sourceProjectId, repositoryId });
    setSources((all) => [...all, source]);
    setSourceBindingId(source.id);
  }
  async function refreshSource(bindingId: string) {
    const synced = await rpc.studio.syncProjectSource({ bindingId });
    setSources((all) => all.map((s) => (s.id === bindingId ? synced : s)));
    if (bindingId === sourceBindingId)
      setWikiPages(await rpc.studio.projectWikiPages({ projectId: sourceProjectId, bindingId }));
  }
  async function loadWiki(bindingId: string) {
    setSourceBindingId(bindingId);
    setWikiPage(null);
    setWikiPages(await rpc.studio.projectWikiPages({ projectId: sourceProjectId, bindingId }));
  }
  async function readWiki(pageId: string) {
    if (!sourceProjectId || !sourceBindingId) return;
    setWikiPage(
      await rpc.studio.projectWikiPage({
        projectId: sourceProjectId,
        bindingId: sourceBindingId,
        pageId,
      }),
    );
  }
  async function createAssignment() {
    const a = await rpc.studio.createAssignment({
      scope,
      projectIds: scope === "studio" ? [] : selectedProjects,
      objective,
      botId,
      manifest: { objective },
    });
    setAssignments((all) => [a, ...all]);
    setObjective("");
  }
  return (
    <main
      className="min-h-full overflow-y-auto bg-background px-6 py-8 md:px-12"
      data-testid="studio-page"
    >
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          className="mb-6 text-sm text-muted-foreground"
          onClick={() => navigate("/app")}
        >
          ← Back to workspace
        </button>
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Sunrise Studio</p>
            <h1 className="mt-1 text-3xl font-semibold">Your studio workplace</h1>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border p-5">
            <h2 className="text-lg font-medium">Studio foundation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Shared context every specialist inherits.
            </p>
            <div className="mt-3 grid gap-2">
              {(["goals", "standards", "guidelines", "workflow"] as const).map((key) => (
                <textarea
                  key={key}
                  aria-label={`Studio ${key}`}
                  className="min-h-14 rounded-xl border border-border bg-muted/20 p-3 text-sm"
                  placeholder={key[0]!.toUpperCase() + key.slice(1)}
                  value={foundationFields[key]}
                  onChange={(e) =>
                    setFoundationFields({ ...foundationFields, [key]: e.target.value })
                  }
                />
              ))}
            </div>
            <Button className="mt-3" onClick={() => void run(publishFoundation)}>
              Publish revision
            </Button>
          </div>
          <div className="rounded-2xl border border-border p-5">
            <h2 className="text-lg font-medium">Employee roles</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {roles.length} configured role{roles.length === 1 ? "" : "s"} available to
              specialists.
            </p>
            <div className="mt-3 grid gap-2">
              <Input
                aria-label="Role key"
                placeholder="Role key"
                value={roleKey}
                onChange={(e) => setRoleKey(e.target.value)}
              />
              <Input
                aria-label="Role name"
                placeholder="Role name"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
              />
              <textarea
                aria-label="Role instructions"
                className="min-h-14 rounded-xl border border-border bg-muted/20 p-3 text-sm"
                placeholder="Role instructions"
                value={roleInstructions}
                onChange={(e) => setRoleInstructions(e.target.value)}
              />
              <Button
                disabled={!roleName.trim() || (!editingRole && !roleKey.trim())}
                onClick={() => void run(editingRole ? updateRole : createRole)}
              >
                {editingRole ? "Save role" : "Create role"}
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {roles.map((role) => (
                <div key={role.id} className="rounded-xl bg-muted/40 px-4 py-3">
                  <span className="font-medium">{role.name}</span>
                  <button
                    type="button"
                    className="ml-2 text-xs underline"
                    onClick={() => {
                      setEditingRole(role);
                      setRoleName(role.name);
                      setRoleInstructions(role.instructions);
                    }}
                  >
                    Edit
                  </button>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {role.instructions || role.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="mt-4 rounded-2xl border border-border p-5">
          <h2 className="text-lg font-medium">Project sources &amp; wiki</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect an authorized repository to a project and inspect its cited pages.
          </p>
          <select
            aria-label="Source project"
            className="mt-3 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={sourceProjectId}
            onChange={(e) => void selectSourceProject(e.target.value)}
          >
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {sourceProjectId ? (
            <div className="mt-3 space-y-2">
              {repositories.length ? (
                repositories.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-sm"
                  >
                    <span>{repo.label}</span>
                    <Button variant="secondary" onClick={() => void run(() => addSource(repo.id))}>
                      Connect
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No authorized repositories are registered yet. An administrator must connect one
                  in setup.
                </p>
              )}
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm"
                >
                  <span>
                    {source.repository ?? source.kind} · {source.ref ?? "unresolved"}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void run(() => refreshSource(source.id))}
                    >
                      Refresh
                    </Button>
                    <Button variant="secondary" onClick={() => void loadWiki(source.id)}>
                      Wiki
                    </Button>
                  </span>
                </div>
              ))}
              {wikiPages.length ? (
                <div className="border-t border-border pt-2">
                  {wikiPages.map((page) => (
                    <button
                      type="button"
                      key={page.pageId}
                      className="block text-left text-sm underline"
                      onClick={() => void run(() => readWiki(page.pageId))}
                    >
                      {page.title} · {page.commit} ·{" "}
                      {page.localOverlay ? "local overlay" : "canonical"}
                    </button>
                  ))}
                  {wikiPage ? (
                    <article className="border-t border-border pt-3">
                      <h3 className="font-medium">{wikiPage.page.title}</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{wikiPage.page.content}</p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {wikiPage.manifest.commit} · {wikiPage.freshness.status} ·{" "}
                        {wikiPage.page.citations
                          .map((c) => `${c.relativePath}:${c.startLine}-${c.endLine}`)
                          .join(", ")}
                      </p>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className="mt-4 rounded-2xl border border-border p-5">
          <h2 className="text-lg font-medium">Projects</h2>
          <div className="mt-3 flex gap-2">
            <Input
              aria-label="Project name"
              placeholder="Project name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <Input
              aria-label="Project slug"
              placeholder="Slug"
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
            />
            <Button disabled={!projectName.trim()} onClick={() => void run(createProject)}>
              Create
            </Button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {projects.map((p) => (
              <label key={p.id} className="rounded-xl bg-muted/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={selectedProjects.includes(p.id)}
                  onChange={(e) =>
                    setSelectedProjects((ids) =>
                      e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                    )
                  }
                />{" "}
                <span className="ml-2 font-medium">{p.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {p.scope === "studio"
                    ? "Studio shared"
                    : p.scope === "multi"
                      ? "Multiple projects"
                      : "Project"}
                </span>
              </label>
            ))}
          </div>
        </section>
        <section className="mt-4 rounded-2xl border border-border p-5">
          <h2 className="text-lg font-medium">Assign work</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe the outcome and choose the specialist and project scope.
          </p>
          <textarea
            aria-label="Assignment objective"
            className="mt-3 min-h-20 w-full rounded-xl border border-border bg-muted/20 p-3 text-sm"
            placeholder="What should this specialist accomplish?"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <select
              aria-label="Assignment scope"
              className="rounded-xl border border-border bg-background px-3 text-sm"
              value={scope}
              onChange={(e) => {
                const next = e.target.value as typeof scope;
                setScope(next);
                if (next === "studio") setSelectedProjects([]);
              }}
            >
              <option value="studio">Studio wide</option>
              <option value="one">One project</option>
              <option value="multi">Multiple projects</option>
            </select>
            <select
              aria-label="Specialist"
              className="rounded-xl border border-border bg-background px-3 text-sm"
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
            >
              <option value="">Choose a specialist</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Button
              disabled={
                !objective.trim() ||
                !botId ||
                (scope === "one" && selectedProjects.length !== 1) ||
                (scope === "multi" && selectedProjects.length < 2)
              }
              onClick={() => void run(createAssignment)}
            >
              Assign work
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            {assignments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3"
              >
                <div>
                  <span className="font-medium">
                    {typeof a.manifest.objective === "string" ? a.manifest.objective : "Assignment"}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {a.status} ·{" "}
                    {a.projectIds.length
                      ? a.projectIds
                          .map((id) => projects.find((p) => p.id === id)?.name ?? "Project")
                          .join(", ")
                      : "Studio wide"}
                  </p>
                </div>
                {a.status === "draft" ? (
                  <Button
                    onClick={() =>
                      void run(async () => {
                        const accepted = await rpc.studio.acceptAssignment({ assignmentId: a.id });
                        setAssignments((all) => all.map((x) => (x.id === a.id ? accepted : x)));
                      })
                    }
                  >
                    Accept
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
