import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AssignmentManifest, EmployeeRolePreset, StudioProject } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import { rpc } from "../lib/rpc";

export function StudioPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [roles, setRoles] = useState<EmployeeRolePreset[]>([]);
  const [foundation, setFoundation] = useState<Awaited<ReturnType<typeof rpc.studio.foundation>>>(null);
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState("");
  const [assignment, setAssignment] = useState<AssignmentManifest | null>(null);
  const load = async () => {
    try {
      const [nextProjects, nextRoles, nextFoundation] = await Promise.all([
        rpc.studio.projects(), rpc.studio.roles(), rpc.studio.foundation(),
      ]);
      setProjects(nextProjects); setRoles(nextRoles); setFoundation(nextFoundation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Studio"); }
  };
  useEffect(() => { void load(); }, []);
  async function createProject() {
    setError(null);
    try {
      const project = await rpc.studio.createProject({ name: projectName, slug: projectSlug || projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), scope: "one" });
      setProjects((items) => [...items, project].sort((a, b) => a.name.localeCompare(b.name)));
      setProjectName(""); setProjectSlug("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create project"); }
  }
  async function inspectAssignment() {
    setError(null);
    try { setAssignment(await rpc.studio.assignment({ assignmentId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Assignment not found"); }
  }
  async function acceptAssignment() {
    if (!assignment) return;
    try { setAssignment(await rpc.studio.acceptAssignment({ assignmentId: assignment.id })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not accept assignment"); }
  }
  return <main className="min-h-full overflow-y-auto bg-background px-6 py-10 md:px-12" data-testid="studio-page">
    <div className="mx-auto max-w-5xl">
      <button type="button" className="mb-8 text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate("/app")}>← Back to workspace</button>
      <div className="mb-10 flex items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Studio workspace</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Foundation, roles, and projects</h1></div><Button variant="secondary" onClick={() => void load()}>Refresh</Button></div>
      {error ? <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-border p-5"><h2 className="text-lg font-medium">Studio foundation</h2><p className="mt-2 text-sm text-muted-foreground">The current revision inherited by specialist work.</p>{foundation?.currentRevision ? <div className="mt-5 rounded-xl bg-muted/40 p-4 text-sm"><span className="font-medium">Revision {foundation.currentRevision.revision}</span><pre className="mt-3 max-h-32 overflow-auto text-xs text-muted-foreground">{JSON.stringify(foundation.currentRevision.content, null, 2)}</pre></div> : <p className="mt-5 text-sm text-muted-foreground">No foundation revision published yet.</p>}</div>
        <div className="rounded-2xl border border-border p-5"><h2 className="text-lg font-medium">Employee roles</h2><p className="mt-2 text-sm text-muted-foreground">Role presets specialists can inherit.</p><div className="mt-5 space-y-2">{roles.length ? roles.map((role) => <div key={role.id} className="rounded-xl bg-muted/40 px-4 py-3"><div className="flex justify-between gap-3"><span className="font-medium">{role.name}</span>{role.isDefault ? <span className="text-xs text-muted-foreground">Default</span> : null}</div><p className="mt-1 text-sm text-muted-foreground">{role.description}</p></div>) : <p className="text-sm text-muted-foreground">No role presets yet.</p>}</div></div>
      </section>
      <section className="mt-5 rounded-2xl border border-border p-5"><h2 className="text-lg font-medium">Projects</h2><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><Input aria-label="Project name" placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} /><Input aria-label="Project slug" placeholder="Slug (optional)" value={projectSlug} onChange={(e) => setProjectSlug(e.target.value)} /><Button disabled={!projectName.trim()} onClick={() => void createProject()}>Create project</Button></div><div className="mt-5 grid gap-3 md:grid-cols-3">{projects.map((project) => <div key={project.id} className="rounded-xl bg-muted/40 p-4"><p className="font-medium">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">{project.slug} · {project.scope}</p></div>)}</div></section>
      <section className="mt-5 rounded-2xl border border-border p-5"><h2 className="text-lg font-medium">Assignment review</h2><p className="mt-2 text-sm text-muted-foreground">Inspect the manifest and record human acceptance separately from run completion.</p><div className="mt-4 flex gap-3"><Input aria-label="Assignment ID" placeholder="Assignment ID" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} /><Button variant="secondary" disabled={!assignmentId.trim()} onClick={() => void inspectAssignment()}>Inspect</Button></div>{assignment ? <div className="mt-5 rounded-xl bg-muted/40 p-4"><div className="flex items-center justify-between gap-4"><span className="font-medium">{assignment.status}</span>{assignment.status === "draft" ? <Button onClick={() => void acceptAssignment()}>Accept assignment</Button> : null}</div><pre className="mt-3 max-h-48 overflow-auto text-xs text-muted-foreground">{JSON.stringify(assignment.manifest, null, 2)}</pre></div> : null}</section>
    </div>
  </main>;
}
