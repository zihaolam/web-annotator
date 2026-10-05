import { and, asc, desc, eq } from "drizzle-orm";
import type { CommentDTO, ThreadDTO } from "../shared/api";
import type { Database } from "./db/client";
import { comments, projects, threads, type Comment, type Project, type Thread } from "./db/schema";
import { AUTHOR_HEADER, errorResponse, HttpError, json, readJson, requireAuthorId, Router } from "./http";
import {
  createCommentSchema,
  createProjectSchema,
  createThreadSchema,
  updateCommentSchema,
  updateThreadSchema,
} from "./validation";

export interface AppConfig {
  db: Database;
  /** Bearer token required to create projects. Project creation is disabled when unset. */
  adminToken?: string;
}

interface Ctx extends AppConfig {
  origin: string | null;
}

const newId = () => crypto.randomUUID();

const toCommentDTO = (c: Comment): CommentDTO => ({
  id: c.id,
  threadId: c.threadId,
  body: c.body,
  authorId: c.authorId,
  authorName: c.authorName,
  createdAt: c.createdAt.getTime(),
  updatedAt: c.updatedAt.getTime(),
});

const toThreadDTO = (t: Thread & { comments: Comment[] }): ThreadDTO => ({
  id: t.id,
  projectId: t.projectId,
  pageUrl: t.pageUrl,
  pageTitle: t.pageTitle,
  anchor: {
    selector: t.selector,
    domPath: t.domPath,
    tagName: t.tagName,
    textSnippet: t.textSnippet,
    offsetX: t.offsetX,
    offsetY: t.offsetY,
    viewportWidth: t.viewportWidth,
  },
  status: t.status,
  authorId: t.authorId,
  authorName: t.authorName,
  resolvedAt: t.resolvedAt?.getTime() ?? null,
  createdAt: t.createdAt.getTime(),
  updatedAt: t.updatedAt.getTime(),
  comments: t.comments.map(toCommentDTO),
});

/** Loads a project and enforces its origin allow-list. */
const loadProject = async (ctx: Ctx, projectId: string): Promise<Project> => {
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) throw new HttpError(404, "Project not found");
  if (project.allowedOrigins.length > 0 && (!ctx.origin || !project.allowedOrigins.includes(ctx.origin))) {
    throw new HttpError(403, "Origin not allowed for this project");
  }
  return project;
};

const loadThread = async (ctx: Ctx, projectId: string, threadId: string) => {
  const thread = await ctx.db.query.threads.findFirst({
    where: and(eq(threads.id, threadId), eq(threads.projectId, projectId)),
    with: { comments: { orderBy: [asc(comments.createdAt)] } },
  });
  if (!thread) throw new HttpError(404, "Thread not found");
  return thread;
};

const router = new Router<Ctx>()
  .get("/api/health", () => json({ ok: true }))

  .post("/api/projects", async (request, _params, ctx) => {
    if (!ctx.adminToken || request.headers.get("authorization") !== `Bearer ${ctx.adminToken}`) {
      throw new HttpError(401, "Admin token required");
    }
    const input = await readJson(request, createProjectSchema);
    const id = input.id ?? newId().slice(0, 8);
    const existing = await ctx.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (existing) throw new HttpError(409, "Project id already exists");
    const [project] = await ctx.db
      .insert(projects)
      .values({ id, name: input.name, allowedOrigins: input.allowedOrigins })
      .returning();
    return json(project, { status: 201 });
  })

  .get("/api/projects/:projectId", async (_request, { projectId }, ctx) => {
    const project = await loadProject(ctx, projectId!);
    return json({ id: project.id, name: project.name });
  })

  .get("/api/projects/:projectId/threads", async (request, { projectId }, ctx) => {
    await loadProject(ctx, projectId!);
    const url = new URL(request.url);
    const pageUrl = url.searchParams.get("url");
    const status = url.searchParams.get("status");
    const filters = [eq(threads.projectId, projectId!)];
    if (pageUrl) filters.push(eq(threads.pageUrl, pageUrl));
    if (status === "open" || status === "resolved") filters.push(eq(threads.status, status));
    const rows = await ctx.db.query.threads.findMany({
      where: and(...filters),
      orderBy: [desc(threads.createdAt)],
      with: { comments: { orderBy: [asc(comments.createdAt)] } },
      limit: 500,
    });
    return json(rows.map(toThreadDTO));
  })

  .post("/api/projects/:projectId/threads", async (request, { projectId }, ctx) => {
    await loadProject(ctx, projectId!);
    const input = await readJson(request, createThreadSchema);
    const threadId = newId();
    const now = new Date();
    const [thread] = await ctx.db
      .insert(threads)
      .values({
        id: threadId,
        projectId: projectId!,
        pageUrl: input.pageUrl,
        pageTitle: input.pageTitle ?? null,
        ...input.anchor,
        authorId: input.author.id,
        authorName: input.author.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [comment] = await ctx.db
      .insert(comments)
      .values({
        id: newId(),
        threadId,
        body: input.body,
        authorId: input.author.id,
        authorName: input.author.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return json(toThreadDTO({ ...thread!, comments: [comment!] }), { status: 201 });
  })

  .get("/api/projects/:projectId/threads/:threadId", async (_request, { projectId, threadId }, ctx) => {
    await loadProject(ctx, projectId!);
    return json(toThreadDTO(await loadThread(ctx, projectId!, threadId!)));
  })

  .patch("/api/projects/:projectId/threads/:threadId", async (request, { projectId, threadId }, ctx) => {
    await loadProject(ctx, projectId!);
    const input = await readJson(request, updateThreadSchema);
    await loadThread(ctx, projectId!, threadId!);
    const now = new Date();
    await ctx.db
      .update(threads)
      .set({ status: input.status, resolvedAt: input.status === "resolved" ? now : null, updatedAt: now })
      .where(eq(threads.id, threadId!));
    return json(toThreadDTO(await loadThread(ctx, projectId!, threadId!)));
  })

  .delete("/api/projects/:projectId/threads/:threadId", async (request, { projectId, threadId }, ctx) => {
    await loadProject(ctx, projectId!);
    const authorId = requireAuthorId(request);
    const thread = await loadThread(ctx, projectId!, threadId!);
    if (thread.authorId !== authorId) throw new HttpError(403, "Only the thread author can delete it");
    await ctx.db.delete(comments).where(eq(comments.threadId, thread.id));
    await ctx.db.delete(threads).where(eq(threads.id, thread.id));
    return new Response(null, { status: 204 });
  })

  .post("/api/projects/:projectId/threads/:threadId/comments", async (request, { projectId, threadId }, ctx) => {
    await loadProject(ctx, projectId!);
    const input = await readJson(request, createCommentSchema);
    await loadThread(ctx, projectId!, threadId!);
    const now = new Date();
    const [comment] = await ctx.db
      .insert(comments)
      .values({
        id: newId(),
        threadId: threadId!,
        body: input.body,
        authorId: input.author.id,
        authorName: input.author.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await ctx.db.update(threads).set({ updatedAt: now }).where(eq(threads.id, threadId!));
    return json(toCommentDTO(comment!), { status: 201 });
  })

  .patch(
    "/api/projects/:projectId/threads/:threadId/comments/:commentId",
    async (request, { projectId, threadId, commentId }, ctx) => {
      await loadProject(ctx, projectId!);
      const authorId = requireAuthorId(request);
      const input = await readJson(request, updateCommentSchema);
      const comment = await ctx.db.query.comments.findFirst({
        where: and(eq(comments.id, commentId!), eq(comments.threadId, threadId!)),
      });
      if (!comment) throw new HttpError(404, "Comment not found");
      if (comment.authorId !== authorId) throw new HttpError(403, "Only the author can edit this comment");
      const [updated] = await ctx.db
        .update(comments)
        .set({ body: input.body, updatedAt: new Date() })
        .where(eq(comments.id, comment.id))
        .returning();
      return json(toCommentDTO(updated!));
    },
  )

  .delete(
    "/api/projects/:projectId/threads/:threadId/comments/:commentId",
    async (request, { projectId, threadId, commentId }, ctx) => {
      await loadProject(ctx, projectId!);
      const authorId = requireAuthorId(request);
      const thread = await loadThread(ctx, projectId!, threadId!);
      const comment = thread.comments.find((c) => c.id === commentId);
      if (!comment) throw new HttpError(404, "Comment not found");
      if (comment.authorId !== authorId) throw new HttpError(403, "Only the author can delete this comment");
      await ctx.db.delete(comments).where(eq(comments.id, comment.id));
      // A thread without comments has nothing left to say; remove it too.
      if (thread.comments.length === 1) await ctx.db.delete(threads).where(eq(threads.id, thread.id));
      return new Response(null, { status: 204 });
    },
  );

const corsHeaders = (origin: string | null): Record<string, string> => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": `content-type, authorization, ${AUTHOR_HEADER}`,
  "access-control-max-age": "86400",
  vary: "Origin",
});

/** Builds the API request handler. Returns `null` for non-API paths so the caller can serve assets. */
export const createApp = (config: AppConfig) => {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return null;

    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    let response: Response;
    try {
      response = (await router.handle(request, { ...config, origin })) ?? json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      response = errorResponse(err);
    }
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  };
};
