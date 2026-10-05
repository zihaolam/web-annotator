import { Database as SQLite } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { SignJWT } from "jose";
import type { Anchor, ElementContext, ProjectDTO, ThreadDTO, WidgetConfigDTO, WidgetSessionDTO, WorkspaceDTO } from "../src/shared/api";
import { createApp } from "../src/worker/app";
import { createDevProvider, createDevToken, type DevClaims } from "../src/worker/auth/identity";
import { schema } from "../src/worker/db/client";
import { PLANS } from "../src/worker/plans";

const BASE = "http://localhost:8787";
const SITE = "https://app.example.com";
const PAGE = `${SITE}/dashboard`;
const ADMIN = "test-admin";

const anchor: Anchor = {
  selector: "#save-button",
  domPath: "body > main > button:nth-child(2)",
  tagName: "button",
  textSnippet: "Save",
  offsetX: 0.5,
  offsetY: 0.25,
  viewportWidth: 1280,
};

const context: ElementContext = {
  html: '<button id="save-button" class="btn btn-primary">Save</button>',
  ancestors: ['<main class="settings">', '<div class="actions">'],
  components: ["SaveButton", "SettingsForm"],
  source: { file: "src/components/SaveButton.tsx", line: 12, column: 5 },
  rect: { width: 96, height: 32 },
  styles: { "background-color": "rgb(37, 99, 235)", "font-size": "14px" },
  viewport: { width: 1280, height: 800, dpr: 2 },
  userAgent: "Mozilla/5.0 (test)",
};

// Dashboard identities
const alice: DevClaims = { userId: "user_alice", name: "Alice" }; // personal workspace
const bob: DevClaims = { userId: "user_bob", name: "Bob" }; // someone else's personal workspace
const acmeAdmin: DevClaims = {
  userId: "user_carol",
  name: "Carol",
  orgId: "org_acme",
  orgs: { org_acme: { role: "admin", name: "Acme Inc" } },
};
const acmeMember: DevClaims = {
  userId: "user_dave",
  name: "Dave",
  orgId: "org_acme",
  orgs: { org_acme: { role: "member", name: "Acme Inc" } },
};

let app: ReturnType<typeof createApp>;
const originalFree = { ...PLANS.free };

type Init = { body?: unknown; token?: string; origin?: string | null; headers?: Record<string, string> };

const call = async (method: string, path: string, init: Init = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.origin !== null) headers.origin = init.origin ?? SITE;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await app(
    new Request(BASE + path, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  if (!res) throw new Error(`no API route for ${path}`);
  return res;
};

const dash = (method: string, path: string, who: DevClaims, body?: unknown) =>
  call(method, `/api/dashboard${path}`, { body, token: createDevToken(who), origin: BASE });

const createProject = async (who: DevClaims, body: Record<string, unknown> = {}) => {
  const res = await dash("POST", "/projects", who, { name: "Marketing site", allowedOrigins: [SITE], ...body });
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectDTO;
};

const guestSession = async (key: string, name = "Guest") => {
  const res = await call("POST", `/api/w/${key}/session/guest`, { body: { name } });
  expect(res.status).toBe(200);
  return (await res.json()) as WidgetSessionDTO;
};

const postThread = (key: string, token?: string, body = "This button is misaligned") =>
  call("POST", `/api/w/${key}/threads`, { token, body: { pageUrl: PAGE, pageTitle: "Dash", anchor, body } });

beforeEach(() => {
  const sqlite = new SQLite(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  app = createApp({
    db,
    identity: createDevProvider(),
    widgetTokenSecret: "test-widget-secret",
    adminToken: ADMIN,
  });
});

afterEach(() => {
  Object.assign(PLANS.free, originalFree);
});

describe("dashboard", () => {
  test("requires a session", async () => {
    expect((await call("GET", "/api/dashboard/workspace", { origin: BASE })).status).toBe(401);
  });

  test("dev sessions are rejected off localhost", async () => {
    const res = await app(
      new Request("https://annotator.example.com/api/dashboard/workspace", {
        headers: { authorization: `Bearer ${createDevToken(alice)}` },
      }),
    );
    expect(res!.status).toBe(401);
  });

  test("a personal workspace is created on first use", async () => {
    const ws = (await (await dash("GET", "/workspace", alice)).json()) as WorkspaceDTO;
    expect(ws).toMatchObject({ id: "user_alice", kind: "personal", name: "Alice's workspace", plan: "free", role: "admin" });
    expect(ws.usage).toMatchObject({ projects: 0, commentsThisMonth: 0, limits: { projects: PLANS.free.projects, commentsPerMonth: PLANS.free.commentsPerMonth } });
  });

  test("the active Clerk organization is the workspace", async () => {
    const ws = (await (await dash("GET", "/workspace", acmeMember)).json()) as WorkspaceDTO;
    expect(ws).toMatchObject({ id: "org_acme", kind: "organization", name: "Acme Inc", role: "member" });
  });

  test("creates projects with keys and enforces the plan's project limit", async () => {
    const p = await createProject(alice);
    expect(p.publicKey).toStartWith("pk_");
    expect(p.identitySecret).toStartWith("sk_");
    await createProject(alice);
    const third = await dash("POST", "/projects", alice, { name: "Too many" });
    expect(third.status).toBe(402);
    expect(((await third.json()) as { code: string }).code).toBe("quota_exceeded");
  });

  test("workspaces are isolated from each other", async () => {
    const p = await createProject(alice);
    expect((await dash("GET", `/projects/${p.id}`, bob)).status).toBe(404);
    expect((await dash("PATCH", `/projects/${p.id}`, bob, { name: "pwned" })).status).toBe(404);
    expect((await dash("GET", `/projects/${p.id}/threads`, bob)).status).toBe(404);
    expect((await (await dash("GET", "/projects", bob)).json()) as unknown[]).toEqual([]);
  });

  test("org members can read but only admins manage projects or see the identity secret", async () => {
    expect((await dash("POST", "/projects", acmeMember, { name: "Nope" })).status).toBe(403);
    const p = await createProject(acmeAdmin);
    const seen = (await (await dash("GET", `/projects/${p.id}`, acmeMember)).json()) as ProjectDTO;
    expect(seen.name).toBe("Marketing site");
    expect(seen.identitySecret).toBeUndefined();
    expect((await dash("PATCH", `/projects/${p.id}`, acmeMember, { name: "x" })).status).toBe(403);
    expect((await dash("DELETE", `/projects/${p.id}`, acmeMember)).status).toBe(403);
  });

  test("member sign-in requires an origin allow-list", async () => {
    const res = await dash("POST", "/projects", alice, { name: "Internal", commentMode: "members" });
    expect(res.status).toBe(422);
    const p = await createProject(alice);
    expect((await dash("PATCH", `/projects/${p.id}`, alice, { allowedOrigins: [], commentMode: "members" })).status).toBe(422);
    expect((await dash("PATCH", `/projects/${p.id}`, alice, { commentMode: "members" })).status).toBe(200);
  });

  test("normalizes allowed origins", async () => {
    const p = await createProject(alice, { allowedOrigins: ["https://app.example.com/some/path"] });
    expect(p.allowedOrigins).toEqual([SITE]);
  });

  test("rotating the public key retires the old one", async () => {
    const p = await createProject(alice);
    const rotated = (await (await dash("POST", `/projects/${p.id}/rotate`, alice, { key: "publicKey" })).json()) as ProjectDTO;
    expect(rotated.publicKey).not.toBe(p.publicKey);
    expect((await call("GET", `/api/w/${p.publicKey}/config`)).status).toBe(404);
    expect((await call("GET", `/api/w/${rotated.publicKey}/config`)).status).toBe(200);
  });

  test("inbox: list threads across pages, reply as a member, moderate", async () => {
    const p = await createProject(acmeAdmin);
    const guest = await guestSession(p.publicKey);
    const thread = (await (await postThread(p.publicKey, guest.token)).json()) as ThreadDTO;

    const inbox = (await (await dash("GET", `/projects/${p.id}/threads`, acmeMember)).json()) as ThreadDTO[];
    expect(inbox.map((t) => t.id)).toEqual([thread.id]);

    const reply = await dash("POST", `/projects/${p.id}/threads/${thread.id}/comments`, acmeMember, { body: "On it" });
    expect(reply.status).toBe(201);
    expect(await reply.json()).toMatchObject({ author: { type: "member", id: "member:user_dave", name: "Dave" } });

    const resolved = await dash("PATCH", `/projects/${p.id}/threads/${thread.id}`, acmeMember, { status: "resolved" });
    expect(((await resolved.json()) as ThreadDTO).status).toBe("resolved");

    expect((await dash("DELETE", `/projects/${p.id}/threads/${thread.id}`, acmeMember)).status).toBe(403);
    expect((await dash("DELETE", `/projects/${p.id}/threads/${thread.id}`, acmeAdmin)).status).toBe(204);
  });

  test("deleting a project removes its threads", async () => {
    const p = await createProject(alice);
    const guest = await guestSession(p.publicKey);
    await postThread(p.publicKey, guest.token);
    expect((await dash("DELETE", `/projects/${p.id}`, alice)).status).toBe(204);
    expect((await call("GET", `/api/w/${p.publicKey}/threads`)).status).toBe(404);
  });
});

describe("widget: guests mode", () => {
  test("config", async () => {
    const p = await createProject(alice);
    const config = (await (await call("GET", `/api/w/${p.publicKey}/config`)).json()) as WidgetConfigDTO;
    expect(config).toEqual({ projectName: "Marketing site", commentMode: "guests", signInUrl: null });
  });

  test("enforces the origin allow-list", async () => {
    const p = await createProject(alice);
    const res = await call("GET", `/api/w/${p.publicKey}/threads`, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  test("reading is public, writing needs a guest session", async () => {
    const p = await createProject(alice);
    expect((await call("GET", `/api/w/${p.publicKey}/threads?url=${encodeURIComponent(PAGE)}`)).status).toBe(200);
    expect((await postThread(p.publicKey)).status).toBe(401);

    const guest = await guestSession(p.publicKey, "Gina");
    expect(guest.identity).toMatchObject({ type: "guest", name: "Gina" });
    const res = await postThread(p.publicKey, guest.token);
    expect(res.status).toBe(201);
    const thread = (await res.json()) as ThreadDTO;
    expect(thread.author).toMatchObject({ type: "guest", id: guest.identity.id, name: "Gina" });

    const list = (await (await call("GET", `/api/w/${p.publicKey}/threads?url=${encodeURIComponent(PAGE)}`)).json()) as ThreadDTO[];
    expect(list.map((t) => t.id)).toEqual([thread.id]);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
  });

  test("renaming keeps the same guest identity", async () => {
    const p = await createProject(alice);
    const first = await guestSession(p.publicKey, "Gina");
    const res = await call("POST", `/api/w/${p.publicKey}/session/guest`, { body: { name: "Gina B", token: first.token } });
    const renamed = (await res.json()) as WidgetSessionDTO;
    expect(renamed.identity.id).toBe(first.identity.id);
    expect(renamed.identity.name).toBe("Gina B");
  });

  test("only authors can edit or delete", async () => {
    const p = await createProject(alice);
    const gina = await guestSession(p.publicKey, "Gina");
    const hal = await guestSession(p.publicKey, "Hal");
    const thread = (await (await postThread(p.publicKey, gina.token)).json()) as ThreadDTO;
    const base = `/api/w/${p.publicKey}/threads/${thread.id}`;
    const commentPath = `${base}/comments/${thread.comments[0]!.id}`;

    expect((await call("PATCH", commentPath, { token: hal.token, body: { body: "hack" } })).status).toBe(403);
    expect((await call("DELETE", base, { token: hal.token })).status).toBe(403);
    const edited = await call("PATCH", commentPath, { token: gina.token, body: { body: "edited" } });
    expect(((await edited.json()) as { body: string }).body).toBe("edited");

    // Anyone signed in can reply and resolve.
    expect((await call("POST", `${base}/comments`, { token: hal.token, body: { body: "agreed" } })).status).toBe(201);
    expect((await call("PATCH", base, { token: hal.token, body: { status: "resolved" } })).status).toBe(200);

    expect((await call("DELETE", base, { token: gina.token })).status).toBe(204);
  });

  test("deleting the last comment removes the thread", async () => {
    const p = await createProject(alice);
    const gina = await guestSession(p.publicKey);
    const thread = (await (await postThread(p.publicKey, gina.token)).json()) as ThreadDTO;
    const path = `/api/w/${p.publicKey}/threads/${thread.id}/comments/${thread.comments[0]!.id}`;
    expect((await call("DELETE", path, { token: gina.token })).status).toBe(204);
    expect((await call("GET", `/api/w/${p.publicKey}/threads`)).json()).resolves.toEqual([]);
  });

  test("tokens are bound to their project", async () => {
    const a = await createProject(alice);
    const b = await createProject(alice, { name: "Other" });
    const guest = await guestSession(a.publicKey);
    expect((await postThread(b.publicKey, guest.token)).status).toBe(401);
  });

  test("stores the element context and returns it to the widget and the dashboard", async () => {
    const p = await createProject(alice);
    const guest = await guestSession(p.publicKey);
    const res = await call("POST", `/api/w/${p.publicKey}/threads`, {
      token: guest.token,
      body: { pageUrl: PAGE, anchor, context, body: "Make this green" },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ThreadDTO).context).toEqual(context);
    const [listed] = (await (await dash("GET", `/projects/${p.id}/threads`, alice)).json()) as ThreadDTO[];
    expect(listed!.context).toEqual(context);

    // Older widgets don't send it.
    const legacy = (await (await postThread(p.publicKey, guest.token)).json()) as ThreadDTO;
    expect(legacy.context).toBeNull();
  });

  test("rejects oversized element context", async () => {
    const p = await createProject(alice);
    const guest = await guestSession(p.publicKey);
    const res = await call("POST", `/api/w/${p.publicKey}/threads`, {
      token: guest.token,
      body: { pageUrl: PAGE, anchor, context: { ...context, html: "x".repeat(10_000) }, body: "hi" },
    });
    expect(res.status).toBe(422);
  });

  test("validates input", async () => {
    const p = await createProject(alice);
    const guest = await guestSession(p.publicKey);
    const res = await call("POST", `/api/w/${p.publicKey}/threads`, {
      token: guest.token,
      body: { pageUrl: "nope", anchor, body: "" },
    });
    expect(res.status).toBe(422);
  });

  test("monthly comment quota", async () => {
    PLANS.free.commentsPerMonth = 2;
    const p = await createProject(alice);
    const guest = await guestSession(p.publicKey);
    const thread = (await (await postThread(p.publicKey, guest.token)).json()) as ThreadDTO;
    expect((await call("POST", `/api/w/${p.publicKey}/threads/${thread.id}/comments`, { token: guest.token, body: { body: "2" } })).status).toBe(201);
    const over = await postThread(p.publicKey, guest.token);
    expect(over.status).toBe(402);

    // Platform admin upgrades the plan.
    const upgrade = await call("PATCH", "/api/admin/workspaces/user_alice", {
      headers: { authorization: `Bearer ${ADMIN}` },
      body: { plan: "pro" },
    });
    expect(upgrade.status).toBe(200);
    expect((await postThread(p.publicKey, guest.token)).status).toBe(201);
  });
});

describe("widget: verified mode", () => {
  const sign = (secret: string, claims: Record<string, unknown>, expiresIn: string | number = "1h") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(new TextEncoder().encode(secret));

  test("exchanges a customer-signed token for a widget session", async () => {
    const p = await createProject(alice, { commentMode: "verified" });
    const userToken = await sign(p.identitySecret!, { sub: "42", name: "Ivy", avatar: "https://img.example/ivy.png" });
    const res = await call("POST", `/api/w/${p.publicKey}/session/verified`, { body: { token: userToken } });
    expect(res.status).toBe(200);
    const session = (await res.json()) as WidgetSessionDTO;
    expect(session.identity).toEqual({ id: "verified:42", type: "verified", name: "Ivy", avatarUrl: "https://img.example/ivy.png" });

    // Reads are private in verified mode.
    expect((await call("GET", `/api/w/${p.publicKey}/threads`)).status).toBe(401);
    expect((await call("GET", `/api/w/${p.publicKey}/threads`, { token: session.token })).status).toBe(200);
    expect((await postThread(p.publicKey, session.token)).status).toBe(201);
  });

  test("rejects tokens signed with the wrong secret, without expiry, or too long-lived", async () => {
    const p = await createProject(alice, { commentMode: "verified" });
    const exchange = (token: string) => call("POST", `/api/w/${p.publicKey}/session/verified`, { body: { token } });
    expect((await exchange(await sign("not-the-secret", { sub: "42" }))).status).toBe(401);
    const noExp = await new SignJWT({ sub: "42" }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(p.identitySecret!));
    expect((await exchange(noExp)).status).toBe(401);
    expect((await exchange(await sign(p.identitySecret!, { sub: "42" }, "30d"))).status).toBe(401);
  });

  test("guest sign-in is refused and old guest tokens stop working after a mode switch", async () => {
    const p = await createProject(alice);
    const guest = await guestSession(p.publicKey);
    await dash("PATCH", `/projects/${p.id}`, alice, { commentMode: "verified" });
    expect((await call("POST", `/api/w/${p.publicKey}/session/guest`, { body: { name: "x" } })).status).toBe(400);
    expect((await postThread(p.publicKey, guest.token)).status).toBe(401);
  });
});

describe("widget: members mode", () => {
  const memberExchange = (key: string, who: DevClaims | null, opts: { origin?: string; target?: string } = {}) =>
    call("POST", `/api/w/${key}/session/member`, {
      origin: opts.origin ?? BASE,
      token: who ? createDevToken(who) : undefined,
      body: { origin: opts.target ?? SITE },
    });

  test("config points at the sign-in page", async () => {
    const p = await createProject(acmeAdmin, { commentMode: "members" });
    const config = (await (await call("GET", `/api/w/${p.publicKey}/config`)).json()) as WidgetConfigDTO;
    expect(config.signInUrl).toBe(`${BASE}/widget-auth?key=${p.publicKey}`);
  });

  test("workspace members get a session; others don't", async () => {
    const p = await createProject(acmeAdmin, { commentMode: "members" });

    const ok = await memberExchange(p.publicKey, acmeMember);
    expect(ok.status).toBe(200);
    const session = (await ok.json()) as WidgetSessionDTO;
    expect(session.identity).toMatchObject({ id: "member:user_dave", type: "member", name: "Dave" });
    expect((await postThread(p.publicKey, session.token)).status).toBe(201);

    expect((await memberExchange(p.publicKey, bob)).status).toBe(403);
    expect((await memberExchange(p.publicKey, null)).status).toBe(401);
  });

  test("a member whose active org is different is still recognised", async () => {
    const p = await createProject(acmeAdmin, { commentMode: "members" });
    const elsewhere: DevClaims = { ...acmeMember, orgId: null };
    expect((await memberExchange(p.publicKey, elsewhere)).status).toBe(200);
  });

  test("personal workspaces only admit their owner", async () => {
    const p = await createProject(alice, { commentMode: "members" });
    expect((await memberExchange(p.publicKey, alice)).status).toBe(200);
    expect((await memberExchange(p.publicKey, bob)).status).toBe(403);
  });

  test("must come from the sign-in page and target an allowed origin", async () => {
    const p = await createProject(acmeAdmin, { commentMode: "members" });
    expect((await memberExchange(p.publicKey, acmeMember, { origin: SITE })).status).toBe(403);
    expect((await memberExchange(p.publicKey, acmeMember, { target: "https://evil.example" })).status).toBe(403);
  });

  test("reads require a session", async () => {
    const p = await createProject(acmeAdmin, { commentMode: "members" });
    expect((await call("GET", `/api/w/${p.publicKey}/threads`)).status).toBe(401);
  });
});

describe("plumbing", () => {
  test("CORS preflight only on widget routes", async () => {
    const widget = await call("OPTIONS", "/api/w/pk_x/threads");
    expect(widget.status).toBe(204);
    expect(widget.headers.get("access-control-allow-headers")).toContain("authorization");
    const dashboard = await call("OPTIONS", "/api/dashboard/projects");
    expect(dashboard.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("admin routes need the admin token", async () => {
    expect((await call("GET", "/api/admin/workspaces")).status).toBe(401);
    expect((await call("GET", "/api/admin/workspaces", { headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(200);
  });

  test("public config", async () => {
    expect((await (await call("GET", "/api/config")).json()) as object).toEqual({ clerkPublishableKey: null, devAuth: false });
  });

  test("non-API paths fall through to assets", async () => {
    expect(await app(new Request(`${BASE}/script.js`))).toBeNull();
  });
});

test("same-origin GETs without an Origin header use the Referer", async () => {
  const sqlite = new SQLite(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  app = createApp({ db, identity: createDevProvider(), widgetTokenSecret: "s" });
  const p = await createProject(alice);
  const res = await call("GET", `/api/w/${p.publicKey}/config`, { origin: null, headers: { referer: `${SITE}/pricing` } });
  expect(res.status).toBe(200);
  const denied = await call("GET", `/api/w/${p.publicKey}/config`, { origin: null, headers: { referer: "https://evil.example/" } });
  expect(denied.status).toBe(403);
});
