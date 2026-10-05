import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { DevClaims } from "../shared/dev-token";
import type { WorkspaceDTO } from "../shared/api";
import { createDashboardApi, type DashboardApi } from "./api";
import { createAuthClient, fetchPublicConfig, type AuthClient } from "./auth";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { Badge, Button, Card, Field, Input, Spinner } from "./ui";

export interface AppContext {
  auth: AuthClient;
  api: DashboardApi;
  workspace: WorkspaceDTO;
  refreshWorkspace: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Routing (hash based so the dashboard is static files)

type Route = { page: "projects" } | { page: "project"; id: string; tab: string };

const parseRoute = (): Route => {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1]) return { page: "project", id: parts[1], tab: parts[2] ?? "install" };
  return { page: "projects" };
};

export const navigate = (hash: string) => {
  location.hash = hash;
};

const useRoute = () => {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
};

// ---------------------------------------------------------------------------
// Clerk component mounts

const ClerkMount = ({
  auth,
  kind,
  props,
}: {
  auth: AuthClient;
  kind: "SignIn" | "UserButton" | "OrganizationSwitcher";
  props?: Record<string, unknown>;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clerk = auth.clerk;
    const el = ref.current;
    if (!clerk || !el) return;
    clerk[`mount${kind}`](el, props);
    return () => clerk[`unmount${kind}`](el);
  }, [auth, kind]);
  return <div ref={ref} />;
};

// ---------------------------------------------------------------------------
// Dev sign-in (DEV_AUTH=true, no Clerk configured)

const DevSignIn = ({ auth }: { auth: AuthClient }) => {
  const [name, setName] = useState("Dev User");
  const [userId, setUserId] = useState("user_dev");
  const [orgName, setOrgName] = useState("");
  const submit = (e: Event) => {
    e.preventDefault();
    const orgId = orgName.trim() ? `org_${orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : null;
    const claims: DevClaims = {
      userId: userId.trim(),
      name: name.trim(),
      email: `${userId.trim()}@example.dev`,
      orgId,
      orgs: orgId ? { [orgId]: { role: "admin", name: orgName.trim() } } : {},
    };
    auth.devSignIn!(claims);
  };
  return (
    <Card class="w-full max-w-sm p-6">
      <form class="grid gap-4" onSubmit={submit}>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-semibold">Sign in</h1>
            <Badge tone="amber">dev mode</Badge>
          </div>
          <p class="mt-1 text-sm text-stone-500">
            Clerk isn't configured, so local identities are trusted. Set <code>CLERK_PUBLISHABLE_KEY</code> and{" "}
            <code>CLERK_SECRET_KEY</code> to use real sign-in.
          </p>
        </div>
        <Field label="Name">
          <Input value={name} onInput={(e) => setName(e.currentTarget.value)} required />
        </Field>
        <Field label="User id">
          <Input value={userId} onInput={(e) => setUserId(e.currentTarget.value)} required pattern="user_[a-z0-9_]+" />
        </Field>
        <Field label="Organization (optional)" hint="Leave empty to use a personal workspace.">
          <Input value={orgName} placeholder="Acme Inc" onInput={(e) => setOrgName(e.currentTarget.value)} />
        </Field>
        <Button variant="primary" type="submit">
          Continue
        </Button>
      </form>
    </Card>
  );
};

const SignInScreen = ({ auth }: { auth: AuthClient }) => (
  <div class="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
    <Logo />
    {auth.kind === "clerk" ? (
      <ClerkMount auth={auth} kind="SignIn" props={{ forceRedirectUrl: location.href, signUpForceRedirectUrl: location.href }} />
    ) : (
      <DevSignIn auth={auth} />
    )}
  </div>
);

const Logo = () => (
  <a href="#/" class="flex items-center gap-2 font-semibold tracking-tight">
    <span class="flex size-7 items-center justify-center rounded-lg rounded-bl-none bg-accent text-sm text-white">✎</span>
    Annotator
  </a>
);

// ---------------------------------------------------------------------------
// Shell

const Header = ({ ctx }: { ctx: AppContext }) => {
  const { auth, workspace } = ctx;
  const user = auth.user();
  return (
    <header class="sticky top-0 z-10 border-b border-stone-200 bg-white/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <span class="text-stone-300 dark:text-stone-700">/</span>
        {auth.kind === "clerk" ? (
          <ClerkMount
            auth={auth}
            kind="OrganizationSwitcher"
            props={{
              hidePersonal: false,
              afterSelectOrganizationUrl: "/app/",
              afterSelectPersonalUrl: "/app/",
              afterCreateOrganizationUrl: "/app/",
            }}
          />
        ) : (
          <span class="text-sm font-medium">{workspace.name}</span>
        )}
        <Badge tone={workspace.plan === "free" ? "neutral" : "accent"}>{workspace.planLabel}</Badge>
        <div class="ml-auto flex items-center gap-3">
          {auth.kind === "clerk" ? (
            <ClerkMount auth={auth} kind="UserButton" />
          ) : (
            <>
              <span class="hidden text-sm text-stone-500 sm:inline">{user?.name}</span>
              <Button size="sm" variant="ghost" onClick={() => void auth.signOut()}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

const Dashboard = ({ auth }: { auth: AuthClient }) => {
  const route = useRoute();
  const [api] = useState(() => createDashboardApi(auth));
  const [workspace, setWorkspace] = useState<WorkspaceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspace = async () => {
    try {
      setWorkspace(await api.workspace());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // The active organization is the workspace; refetch when it changes.
  const orgId = auth.orgId();
  useEffect(() => {
    setWorkspace(null);
    void refreshWorkspace();
  }, [orgId]);

  if (error) {
    return (
      <div class="flex min-h-screen items-center justify-center p-6">
        <Card class="max-w-md p-6">
          <p class="text-sm text-red-600">{error}</p>
          <Button class="mt-4" onClick={() => void refreshWorkspace()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }
  if (!workspace) return <Spinner />;

  const ctx: AppContext = { auth, api, workspace, refreshWorkspace };
  return (
    <div class="min-h-screen">
      <Header ctx={ctx} />
      <main class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {route.page === "project" ? (
          <ProjectPage key={`${workspace.id}:${route.id}`} ctx={ctx} projectId={route.id} tab={route.tab} />
        ) : (
          <ProjectsPage key={workspace.id} ctx={ctx} />
        )}
      </main>
    </div>
  );
};

const App = ({ auth }: { auth: AuthClient }) => {
  const [, force] = useState(0);
  useEffect(() => auth.onChange(() => force((n) => n + 1)), [auth]);
  return auth.isSignedIn() ? <Dashboard auth={auth} /> : <SignInScreen auth={auth} />;
};

const boot = async () => {
  const root = document.getElementById("app")!;
  try {
    const auth = await createAuthClient(await fetchPublicConfig());
    render(<App auth={auth} />, root);
  } catch (err) {
    render(
      <div class="flex min-h-screen items-center justify-center p-6">
        <Card class="max-w-md p-6 text-sm text-red-600">{err instanceof Error ? err.message : String(err)}</Card>
      </div>,
      root,
    );
  }
};

void boot();
