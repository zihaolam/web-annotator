import { useEffect, useState } from "preact/hooks";
import type { CommentMode, ProjectDTO } from "../../shared/api";
import type { AppContext } from "../main";
import { navigate } from "../main";
import { Badge, Button, Card, ErrorText, Field, Input, Meter, Spinner, Textarea } from "../ui";

export const MODE_LABELS: Record<CommentMode, { label: string; description: string }> = {
  guests: { label: "Anyone", description: "Visitors type a name and comment. Comments are visible to everyone on the site." },
  members: {
    label: "Workspace members",
    description: "Visitors sign in with their account; only members of this workspace can see or leave comments.",
  },
  verified: {
    label: "Your app's users",
    description: "Your backend signs a token for each logged-in user. Commenters never see a separate login.",
  },
};

export const parseOrigins = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const NewProject = ({ ctx, onCreated, onCancel }: { ctx: AppContext; onCreated: (p: ProjectDTO) => void; onCancel: () => void }) => {
  const [name, setName] = useState("");
  const [origins, setOrigins] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await ctx.api.createProject({ name, allowedOrigins: parseOrigins(origins) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card class="p-5">
      <form class="grid gap-4" onSubmit={submit}>
        <h2 class="font-semibold">New project</h2>
        <Field label="Name">
          <Input value={name} placeholder="Marketing site" required autoFocus onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="Allowed origins" hint="One per line, e.g. https://app.example.com. Leave empty to allow any site (guests mode only).">
          <Textarea rows={2} value={origins} placeholder="https://app.example.com" onInput={(e) => setOrigins(e.currentTarget.value)} />
        </Field>
        <ErrorText error={error} />
        <div class="flex gap-2">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
};

export const ProjectsPage = ({ ctx }: { ctx: AppContext }) => {
  const { workspace } = ctx;
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const isAdmin = workspace.role === "admin";
  const atLimit = workspace.usage.projects >= workspace.usage.limits.projects;

  useEffect(() => {
    ctx.api.projects().then(setProjects, (err: Error) => setError(err.message));
  }, []);

  return (
    <div class="grid gap-8">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
          <p class="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Each project is a site with its own script tag, comment settings and inbox.
          </p>
        </div>
        {isAdmin && !creating && (
          <Button variant="primary" disabled={atLimit} title={atLimit ? "Project limit reached for your plan" : undefined} onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </div>

      <Card class="grid gap-4 p-5 sm:grid-cols-2">
        <Meter label="Projects" used={workspace.usage.projects} limit={workspace.usage.limits.projects} />
        <Meter label="Comments this month" used={workspace.usage.commentsThisMonth} limit={workspace.usage.limits.commentsPerMonth} />
      </Card>

      {creating && (
        <NewProject
          ctx={ctx}
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            void ctx.refreshWorkspace();
            navigate(`#/p/${p.id}/install`);
          }}
        />
      )}

      <ErrorText error={error} />
      {!projects && !error && <Spinner />}
      {projects && projects.length === 0 && !creating && (
        <Card class="p-10 text-center">
          <p class="font-medium">No projects yet</p>
          <p class="mt-1 text-sm text-stone-500">
            {isAdmin ? "Create one to get a script tag for your site." : "Ask a workspace admin to create one."}
          </p>
        </Card>
      )}
      {projects && projects.length > 0 && (
        <div class="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <a key={p.id} href={`#/p/${p.id}/inbox`} class="group">
              <Card class="h-full p-5 transition-colors group-hover:border-stone-300 dark:group-hover:border-stone-700">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="truncate font-semibold">{p.name}</h3>
                    <p class="mt-0.5 truncate font-mono text-xs text-stone-500">{p.publicKey}</p>
                  </div>
                  {p.openThreads > 0 ? <Badge tone="accent">{p.openThreads} open</Badge> : <Badge>No open threads</Badge>}
                </div>
                <div class="mt-4 flex flex-wrap gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <Badge>{MODE_LABELS[p.commentMode].label}</Badge>
                  <span class="truncate">
                    {p.allowedOrigins.length ? p.allowedOrigins.join(", ").replace(/https?:\/\//g, "") : "Any origin"}
                  </span>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};
