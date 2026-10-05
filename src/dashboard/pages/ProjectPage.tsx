import { useEffect, useState } from "preact/hooks";
import type { CommentMode, ProjectDTO, ThreadDTO } from "../../shared/api";
import type { AppContext } from "../main";
import { navigate } from "../main";
import { Avatar, Badge, Button, Card, Code, CopyButton, cx, ErrorText, Field, Input, relativeTime, Spinner, Textarea } from "../ui";
import { MODE_LABELS, parseOrigins } from "./ProjectsPage";

const TABS = [
  ["install", "Install"],
  ["inbox", "Inbox"],
  ["settings", "Settings"],
] as const;

export const ProjectPage = ({ ctx, projectId, tab }: { ctx: AppContext; projectId: string; tab: string }) => {
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ctx.api.project(projectId).then(setProject, (err: Error) => setError(err.message));
  }, [projectId]);

  if (error) return <ErrorText error={error} />;
  if (!project) return <Spinner />;

  return (
    <div class="grid gap-6">
      <div>
        <a href="#/" class="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
          ← Projects
        </a>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge>{MODE_LABELS[project.commentMode].label}</Badge>
        </div>
      </div>
      <nav class="flex gap-1 border-b border-stone-200 dark:border-stone-800">
        {TABS.map(([id, label]) => (
          <a
            key={id}
            href={`#/p/${project.id}/${id}`}
            class={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === id ? "border-accent text-stone-900 dark:text-stone-100" : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200",
            )}
          >
            {label}
            {id === "inbox" && project.openThreads > 0 && <span class="ml-1.5 text-accent">{project.openThreads}</span>}
          </a>
        ))}
      </nav>
      {tab === "inbox" ? (
        <InboxTab ctx={ctx} project={project} />
      ) : tab === "settings" ? (
        <SettingsTab ctx={ctx} project={project} onChange={setProject} />
      ) : (
        <InstallTab project={project} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Install

const InstallTab = ({ project }: { project: ProjectDTO }) => {
  const snippet = `<script src="${location.origin}/script.js" data-project="${project.publicKey}" defer></script>`;
  return (
    <div class="grid gap-6">
      <section class="grid gap-3">
        <h2 class="font-semibold">1. Add the script to your site</h2>
        <p class="text-sm text-stone-500 dark:text-stone-400">
          Paste this before <code>&lt;/body&gt;</code> (or in <code>&lt;head&gt;</code>) on every page that should be commentable.
        </p>
        <Code code={snippet} />
      </section>

      {project.allowedOrigins.length === 0 && (
        <Card class="border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          Any website can currently load this project. Add your site's origin under <a class="underline" href={`#/p/${project.id}/settings`}>Settings</a> to lock it down.
        </Card>
      )}

      {project.commentMode === "guests" && (
        <section class="grid gap-2">
          <h2 class="font-semibold">2. That's it</h2>
          <p class="text-sm text-stone-500 dark:text-stone-400">
            Visitors press <kbd>C</kbd> or click the comment button, pick an element and type a name with their first comment.
          </p>
        </section>
      )}

      {project.commentMode === "members" && (
        <section class="grid gap-2">
          <h2 class="font-semibold">2. Invite your team</h2>
          <p class="text-sm text-stone-500 dark:text-stone-400">
            Commenters sign in with their account in a popup. Only members of this workspace can see or leave comments; invite them
            from the workspace switcher → <em>Manage</em>.
          </p>
        </section>
      )}

      {project.commentMode === "verified" && (
        <section class="grid gap-3">
          <h2 class="font-semibold">2. Identify your users</h2>
          <p class="text-sm text-stone-500 dark:text-stone-400">
            On your server, sign a short-lived token for the logged-in user with this project's identity secret (Settings → Keys),
            then hand it to the widget. Never expose the secret in the browser.
          </p>
          <Code
            code={`// Node.js (jsonwebtoken) — any HS256 JWT library works
import jwt from "jsonwebtoken";

const userToken = jwt.sign(
  { sub: user.id, name: user.name, avatar: user.avatarUrl /* optional, https */ },
  process.env.ANNOTATOR_IDENTITY_SECRET,
  { algorithm: "HS256", expiresIn: "1h" },
);`}
          />
          <Code
            code={`<!-- Before the script tag -->
<script>window.WebAnnotatorConfig = { userToken: "{{ userToken }}" };</script>

<!-- …or later, e.g. after your app logs in -->
<script>WebAnnotator.identify(userToken);</script>`}
          />
        </section>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inbox

const ThreadCard = ({ ctx, project, thread, onChange, onRemove }: {
  ctx: AppContext;
  project: ProjectDTO;
  thread: ThreadDTO;
  onChange: (t: ThreadDTO) => void;
  onRemove: () => void;
}) => {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = ctx.workspace.role === "admin";
  const page = (() => {
    try {
      const u = new URL(thread.pageUrl);
      return u.pathname + u.hash;
    } catch {
      return thread.pageUrl;
    }
  })();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card class="overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-stone-50/60 px-4 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900/60">
        <a href={thread.pageUrl} target="_blank" rel="noreferrer" class="truncate font-medium hover:underline" title={thread.pageUrl}>
          {thread.pageTitle || page}
        </a>
        <span class="truncate font-mono text-xs text-stone-500">{page}</span>
        <span class="font-mono text-xs text-stone-400">&lt;{thread.anchor.tagName}&gt;</span>
        <div class="ml-auto flex gap-1.5">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(async () => onChange(await ctx.api.setStatus(project.id, thread.id, thread.status === "open" ? "resolved" : "open")))
            }
          >
            {thread.status === "open" ? "Resolve" : "Reopen"}
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (confirm("Delete this thread and all its comments?")) void run(async () => {
                  await ctx.api.deleteThread(project.id, thread.id);
                  onRemove();
                });
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      <ul class="divide-y divide-stone-100 dark:divide-stone-800">
        {thread.comments.map((c) => (
          <li key={c.id} class="flex gap-3 px-4 py-3">
            <Avatar name={c.author.name} url={c.author.avatarUrl} />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-medium">{c.author.name}</span>
                {c.author.type !== "guest" && <Badge>{c.author.type === "member" ? "member" : "verified"}</Badge>}
                <span class="text-xs text-stone-500">{relativeTime(c.createdAt)}</span>
              </div>
              <p class="mt-1 text-sm break-words whitespace-pre-wrap">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form
        class="flex gap-2 border-t border-stone-100 px-4 py-3 dark:border-stone-800"
        onSubmit={(e) => {
          e.preventDefault();
          const body = reply.trim();
          if (!body) return;
          void run(async () => {
            const comment = await ctx.api.reply(project.id, thread.id, body);
            onChange({ ...thread, comments: [...thread.comments, comment] });
            setReply("");
          });
        }}
      >
        <Input value={reply} placeholder="Reply…" onInput={(e) => setReply(e.currentTarget.value)} />
        <Button type="submit" disabled={busy || !reply.trim()}>
          Reply
        </Button>
      </form>
      {error && <div class="px-4 pb-3"><ErrorText error={error} /></div>}
    </Card>
  );
};

const InboxTab = ({ ctx, project }: { ctx: AppContext; project: ProjectDTO }) => {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [threads, setThreads] = useState<ThreadDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setThreads(null);
    ctx.api.threads(project.id, status).then(setThreads, (err: Error) => setError(err.message));
  }, [status]);

  return (
    <div class="grid gap-4">
      <div class="flex gap-1 self-start rounded-lg bg-stone-100 p-1 text-sm dark:bg-stone-900">
        {(["open", "resolved"] as const).map((s) => (
          <button
            key={s}
            type="button"
            class={cx("rounded-md px-3 py-1 capitalize", status === s ? "bg-white shadow-sm dark:bg-stone-800" : "text-stone-500")}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      {!threads && !error && <Spinner />}
      {threads?.length === 0 && (
        <Card class="p-10 text-center text-sm text-stone-500">
          {status === "open" ? "No open threads. Comments left on your site show up here." : "Nothing resolved yet."}
        </Card>
      )}
      {threads?.map((t) => (
        <ThreadCard
          key={t.id}
          ctx={ctx}
          project={project}
          thread={t}
          onChange={(next) =>
            setThreads((list) => (next.status !== status ? list!.filter((x) => x.id !== next.id) : list!.map((x) => (x.id === next.id ? next : x))))
          }
          onRemove={() => setThreads((list) => list!.filter((x) => x.id !== t.id))}
        />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Settings

const SecretRow = ({ label, value, hint, onRotate, reveal = true }: {
  label: string;
  value: string;
  hint: string;
  onRotate?: () => void;
  reveal?: boolean;
}) => {
  const [shown, setShown] = useState(!reveal);
  return (
    <div class="grid gap-2">
      <div class="text-sm font-medium">{label}</div>
      <div class="flex flex-wrap items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs dark:bg-stone-800">
          {shown ? value : "•".repeat(Math.min(value.length, 32))}
        </code>
        {reveal && (
          <Button size="sm" variant="ghost" onClick={() => setShown(!shown)}>
            {shown ? "Hide" : "Reveal"}
          </Button>
        )}
        <CopyButton text={value} />
        {onRotate && (
          <Button size="sm" variant="ghost" onClick={onRotate}>
            Rotate
          </Button>
        )}
      </div>
      <p class="text-xs text-stone-500 dark:text-stone-400">{hint}</p>
    </div>
  );
};

const SettingsTab = ({ ctx, project, onChange }: { ctx: AppContext; project: ProjectDTO; onChange: (p: ProjectDTO) => void }) => {
  const isAdmin = ctx.workspace.role === "admin";
  const [name, setName] = useState(project.name);
  const [origins, setOrigins] = useState(project.allowedOrigins.join("\n"));
  const [mode, setMode] = useState<CommentMode>(project.commentMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: Event) => {
    e.preventDefault();
    void run(async () => {
      const updated = await ctx.api.updateProject(project.id, { name, allowedOrigins: parseOrigins(origins), commentMode: mode });
      onChange(updated);
      setOrigins(updated.allowedOrigins.join("\n"));
      setSaved(true);
    });
  };

  const rotate = (key: "publicKey" | "identitySecret") => {
    const what =
      key === "publicKey"
        ? "The current script tag will stop working until you update it on your site."
        : "Tokens signed with the old secret will stop working.";
    if (confirm(`Rotate this key? ${what}`)) void run(async () => onChange(await ctx.api.rotate(project.id, key)));
  };

  return (
    <div class="grid gap-8">
      {!isAdmin && (
        <Card class="p-4 text-sm text-stone-500">Only workspace admins can change project settings.</Card>
      )}
      <form class="grid gap-5" onSubmit={save}>
        <fieldset disabled={!isAdmin || busy} class="grid gap-5">
          <Field label="Name">
            <Input value={name} required onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Field
            label="Allowed origins"
            hint="Sites allowed to load this project, one per line. Required for workspace-member sign-in."
          >
            <Textarea rows={3} value={origins} placeholder="https://app.example.com" onInput={(e) => setOrigins(e.currentTarget.value)} />
          </Field>
          <div class="grid gap-2">
            <span class="text-sm font-medium">Who can comment</span>
            {(Object.keys(MODE_LABELS) as CommentMode[]).map((m) => (
              <label
                key={m}
                class={cx(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm",
                  mode === m ? "border-accent bg-accent-soft/40" : "border-stone-200 dark:border-stone-800",
                )}
              >
                <input type="radio" name="mode" class="mt-0.5 accent-[rgb(210_57_192)]" checked={mode === m} onChange={() => setMode(m)} />
                <span>
                  <span class="font-medium">{MODE_LABELS[m].label}</span>
                  <span class="block text-stone-500 dark:text-stone-400">{MODE_LABELS[m].description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText error={error} />
        {isAdmin && (
          <div class="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={busy}>
              Save changes
            </Button>
            {saved && <span class="text-sm text-emerald-600">Saved</span>}
          </div>
        )}
      </form>

      <Card class="grid gap-5 p-5">
        <h2 class="font-semibold">Keys</h2>
        <SecretRow
          label="Publishable key"
          value={project.publicKey}
          reveal={false}
          hint="Goes in the script tag. Safe to expose."
          onRotate={isAdmin ? () => rotate("publicKey") : undefined}
        />
        {project.identitySecret && (
          <SecretRow
            label="Identity secret"
            value={project.identitySecret}
            hint="Server-side only: signs user tokens in “Your app's users” mode."
            onRotate={() => rotate("identitySecret")}
          />
        )}
      </Card>

      {isAdmin && (
        <Card class="flex flex-wrap items-center justify-between gap-3 border-red-200 p-5 dark:border-red-950">
          <div>
            <h2 class="font-semibold">Delete project</h2>
            <p class="text-sm text-stone-500">Removes the project and every comment in it. This can't be undone.</p>
          </div>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (prompt(`Type "${project.name}" to delete this project`) === project.name) {
                void run(async () => {
                  await ctx.api.deleteProject(project.id);
                  await ctx.refreshWorkspace();
                  navigate("#/");
                });
              }
            }}
          >
            Delete project
          </Button>
        </Card>
      )}
    </div>
  );
};
