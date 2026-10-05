import { and, asc, count, desc, eq, gte } from "drizzle-orm";
import type { Anchor, ElementContext, WidgetIdentity } from "../shared/api";
import type { Database } from "./db/client";
import { comments, projects, threads, workspaces, type Project, type Workspace } from "./db/schema";
import { HttpError } from "./http";
import { PLANS, usagePeriodStart } from "./plans";
import { toCommentDTO, toThreadDTO } from "./serializers";

export const newId = () => crypto.randomUUID();

const authorColumns = (author: WidgetIdentity) => ({
  authorType: author.type,
  authorId: author.id,
  authorName: author.name,
  authorAvatarUrl: author.avatarUrl,
});

export const commentsThisMonth = async (db: Database, workspaceId: string): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(comments)
    .where(and(eq(comments.workspaceId, workspaceId), gte(comments.createdAt, usagePeriodStart())));
  return row?.n ?? 0;
};

export const projectCount = async (db: Database, workspaceId: string): Promise<number> => {
  const [row] = await db.select({ n: count() }).from(projects).where(eq(projects.workspaceId, workspaceId));
  return row?.n ?? 0;
};

export const loadWorkspace = async (db: Database, workspaceId: string): Promise<Workspace> => {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws) throw new HttpError(404, "Workspace not found");
  return ws;
};

/** Rejects new comments once the workspace has used its monthly allowance. */
export const assertCommentQuota = async (db: Database, workspaceId: string) => {
  const ws = await loadWorkspace(db, workspaceId);
  const limit = PLANS[ws.plan].commentsPerMonth;
  if ((await commentsThisMonth(db, workspaceId)) >= limit) {
    throw new HttpError(
      402,
      "This workspace has reached its monthly comment limit",
      { limit, plan: ws.plan },
      "quota_exceeded",
    );
  }
};

export const loadThread = async (db: Database, projectId: string, threadId: string) => {
  const thread = await db.query.threads.findFirst({
    where: and(eq(threads.id, threadId), eq(threads.projectId, projectId)),
    with: { comments: { orderBy: [asc(comments.createdAt)] } },
  });
  if (!thread) throw new HttpError(404, "Thread not found");
  return thread;
};

export const listThreads = async (
  db: Database,
  projectId: string,
  filters: { pageUrl?: string | null; status?: string | null; limit?: number },
) => {
  const where = [eq(threads.projectId, projectId)];
  if (filters.pageUrl) where.push(eq(threads.pageUrl, filters.pageUrl));
  if (filters.status === "open" || filters.status === "resolved") where.push(eq(threads.status, filters.status));
  const rows = await db.query.threads.findMany({
    where: and(...where),
    orderBy: [desc(threads.updatedAt)],
    with: { comments: { orderBy: [asc(comments.createdAt)] } },
    limit: filters.limit ?? 500,
  });
  return rows.map(toThreadDTO);
};

export const createThread = async (
  db: Database,
  project: Project,
  input: { pageUrl: string; pageTitle?: string | null; anchor: Anchor; context?: ElementContext | null; body: string },
  author: WidgetIdentity,
) => {
  await assertCommentQuota(db, project.workspaceId);
  const threadId = newId();
  const now = new Date();
  const [thread] = await db
    .insert(threads)
    .values({
      id: threadId,
      projectId: project.id,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle ?? null,
      ...input.anchor,
      context: input.context ?? null,
      ...authorColumns(author),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [comment] = await db
    .insert(comments)
    .values({
      id: newId(),
      threadId,
      workspaceId: project.workspaceId,
      body: input.body,
      ...authorColumns(author),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toThreadDTO({ ...thread!, comments: [comment!] });
};

export const addComment = async (db: Database, project: Project, threadId: string, body: string, author: WidgetIdentity) => {
  await loadThread(db, project.id, threadId);
  await assertCommentQuota(db, project.workspaceId);
  const now = new Date();
  const [comment] = await db
    .insert(comments)
    .values({
      id: newId(),
      threadId,
      workspaceId: project.workspaceId,
      body,
      ...authorColumns(author),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db.update(threads).set({ updatedAt: now }).where(eq(threads.id, threadId));
  return toCommentDTO(comment!);
};

export const setThreadStatus = async (db: Database, projectId: string, threadId: string, status: "open" | "resolved") => {
  await loadThread(db, projectId, threadId);
  const now = new Date();
  await db
    .update(threads)
    .set({ status, resolvedAt: status === "resolved" ? now : null, updatedAt: now })
    .where(eq(threads.id, threadId));
  return toThreadDTO(await loadThread(db, projectId, threadId));
};

export const deleteThread = async (db: Database, threadId: string) => {
  await db.delete(comments).where(eq(comments.threadId, threadId));
  await db.delete(threads).where(eq(threads.id, threadId));
};

export const editComment = async (
  db: Database,
  projectId: string,
  threadId: string,
  commentId: string,
  body: string,
  authorId: string,
) => {
  const thread = await loadThread(db, projectId, threadId);
  const comment = thread.comments.find((c) => c.id === commentId);
  if (!comment) throw new HttpError(404, "Comment not found");
  if (comment.authorId !== authorId) throw new HttpError(403, "Only the author can edit this comment");
  const [updated] = await db
    .update(comments)
    .set({ body, updatedAt: new Date() })
    .where(eq(comments.id, comment.id))
    .returning();
  return toCommentDTO(updated!);
};

/** Deletes a comment; `authorId: null` skips the author check (workspace admin moderation). */
export const deleteComment = async (
  db: Database,
  projectId: string,
  threadId: string,
  commentId: string,
  authorId: string | null,
) => {
  const thread = await loadThread(db, projectId, threadId);
  const comment = thread.comments.find((c) => c.id === commentId);
  if (!comment) throw new HttpError(404, "Comment not found");
  if (authorId !== null && comment.authorId !== authorId) {
    throw new HttpError(403, "Only the author can delete this comment");
  }
  await db.delete(comments).where(eq(comments.id, comment.id));
  // A thread without comments has nothing left to say; remove it too.
  if (thread.comments.length === 1) await db.delete(threads).where(eq(threads.id, thread.id));
};
