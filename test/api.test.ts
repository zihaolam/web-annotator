import { Database as SQLite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Anchor, CommentDTO, ThreadDTO } from "../src/shared/api";
import { createApp } from "../src/worker/app";
import { schema } from "../src/worker/db/client";

const ADMIN = "test-admin";
const ORIGIN = "https://app.example.com";
const PAGE = "https://app.example.com/dashboard";

const anchor: Anchor = {
  selector: "#save-button",
  domPath: "body > main > button:nth-child(2)",
  tagName: "button",
  textSnippet: "Save",
  offsetX: 0.5,
  offsetY: 0.25,
  viewportWidth: 1280,
};

const alice = { id: "alice-id", name: "Alice" };
const bob = { id: "bob-id", name: "Bob" };

let app: ReturnType<typeof createApp>;

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app(
    new Request(`http://annotator.test${path}`, {
      method,
      headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res) throw new Error(`no API route for ${path}`);
  return res;
};

const createThread = async (body = "This button is misaligned", author = alice) => {
  const res = await call("POST", "/api/projects/demo/threads", { pageUrl: PAGE, pageTitle: "Dash", anchor, body, author });
  expect(res.status).toBe(201);
  return (await res.json()) as ThreadDTO;
};

beforeEach(async () => {
  const sqlite = new SQLite(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  app = createApp({ db, adminToken: ADMIN });
  const res = await call(
    "POST",
    "/api/projects",
    { id: "demo", name: "Demo", allowedOrigins: [ORIGIN] },
    { authorization: `Bearer ${ADMIN}` },
  );
  expect(res.status).toBe(201);
});

describe("projects", () => {
  test("creating a project requires the admin token", async () => {
    const res = await call("POST", "/api/projects", { name: "Nope" });
    expect(res.status).toBe(401);
  });

  test("origin allow-list is enforced", async () => {
    const res = await call("GET", "/api/projects/demo/threads", undefined, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  test("unknown project is 404", async () => {
    expect((await call("GET", "/api/projects/missing/threads")).status).toBe(404);
  });
});

describe("threads", () => {
  test("create and list threads for a page", async () => {
    const created = await createThread();
    expect(created.anchor).toEqual(anchor);
    expect(created.status).toBe("open");
    expect(created.comments).toHaveLength(1);
    expect(created.comments[0]!.body).toBe("This button is misaligned");

    await call("POST", "/api/projects/demo/threads", {
      pageUrl: "https://app.example.com/other",
      anchor,
      body: "elsewhere",
      author: alice,
    });

    const res = await call("GET", `/api/projects/demo/threads?url=${encodeURIComponent(PAGE)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const list = (await res.json()) as ThreadDTO[];
    expect(list.map((t) => t.id)).toEqual([created.id]);
  });

  test("validates input", async () => {
    const res = await call("POST", "/api/projects/demo/threads", { pageUrl: "nope", anchor, body: "", author: alice });
    expect(res.status).toBe(422);
  });

  test("resolve and reopen", async () => {
    const t = await createThread();
    let res = await call("PATCH", `/api/projects/demo/threads/${t.id}`, { status: "resolved" });
    let updated = (await res.json()) as ThreadDTO;
    expect(updated.status).toBe("resolved");
    expect(updated.resolvedAt).toBeNumber();

    res = await call("PATCH", `/api/projects/demo/threads/${t.id}`, { status: "open" });
    updated = (await res.json()) as ThreadDTO;
    expect(updated.status).toBe("open");
    expect(updated.resolvedAt).toBeNull();

    const openOnly = (await (await call("GET", "/api/projects/demo/threads?status=resolved")).json()) as ThreadDTO[];
    expect(openOnly).toHaveLength(0);
  });

  test("only the author may delete a thread", async () => {
    const t = await createThread();
    expect((await call("DELETE", `/api/projects/demo/threads/${t.id}`)).status).toBe(401);
    expect(
      (await call("DELETE", `/api/projects/demo/threads/${t.id}`, undefined, { "x-annotator-author-id": bob.id })).status,
    ).toBe(403);
    expect(
      (await call("DELETE", `/api/projects/demo/threads/${t.id}`, undefined, { "x-annotator-author-id": alice.id }))
        .status,
    ).toBe(204);
    expect((await call("GET", `/api/projects/demo/threads/${t.id}`)).status).toBe(404);
  });
});

describe("comments", () => {
  test("reply, edit, delete", async () => {
    const t = await createThread();
    const res = await call("POST", `/api/projects/demo/threads/${t.id}/comments`, { body: "Fixed in #42", author: bob });
    expect(res.status).toBe(201);
    const reply = (await res.json()) as CommentDTO;

    const path = `/api/projects/demo/threads/${t.id}/comments/${reply.id}`;
    expect((await call("PATCH", path, { body: "hack" }, { "x-annotator-author-id": alice.id })).status).toBe(403);
    const edited = (await (
      await call("PATCH", path, { body: "Fixed in #43" }, { "x-annotator-author-id": bob.id })
    ).json()) as CommentDTO;
    expect(edited.body).toBe("Fixed in #43");

    expect((await call("DELETE", path, undefined, { "x-annotator-author-id": bob.id })).status).toBe(204);
    const thread = (await (await call("GET", `/api/projects/demo/threads/${t.id}`)).json()) as ThreadDTO;
    expect(thread.comments).toHaveLength(1);
  });

  test("deleting the last comment removes the thread", async () => {
    const t = await createThread();
    const path = `/api/projects/demo/threads/${t.id}/comments/${t.comments[0]!.id}`;
    expect((await call("DELETE", path, undefined, { "x-annotator-author-id": alice.id })).status).toBe(204);
    expect((await call("GET", `/api/projects/demo/threads/${t.id}`)).status).toBe(404);
  });
});

test("CORS preflight", async () => {
  const res = await call("OPTIONS", "/api/projects/demo/threads");
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-headers")).toContain("x-annotator-author-id");
});

test("non-API paths fall through to assets", async () => {
  expect(await app(new Request("http://annotator.test/script.js"))).toBeNull();
});
