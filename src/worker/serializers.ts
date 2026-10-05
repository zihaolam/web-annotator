import type { AuthorDTO, CommentDTO, ProjectDTO, ThreadDTO } from "../shared/api";
import type { Comment, Project, Thread } from "./db/schema";

type WithAuthor = Pick<Comment, "authorType" | "authorId" | "authorName" | "authorAvatarUrl">;

const toAuthor = (r: WithAuthor): AuthorDTO => ({
  type: r.authorType,
  id: r.authorId,
  name: r.authorName,
  avatarUrl: r.authorAvatarUrl,
});

export const toCommentDTO = (c: Comment): CommentDTO => ({
  id: c.id,
  threadId: c.threadId,
  body: c.body,
  author: toAuthor(c),
  createdAt: c.createdAt.getTime(),
  updatedAt: c.updatedAt.getTime(),
});

export const toThreadDTO = (t: Thread & { comments: Comment[] }): ThreadDTO => ({
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
  author: toAuthor(t),
  resolvedAt: t.resolvedAt?.getTime() ?? null,
  createdAt: t.createdAt.getTime(),
  updatedAt: t.updatedAt.getTime(),
  comments: t.comments.map(toCommentDTO),
});

export const toProjectDTO = (p: Project, opts: { openThreads: number; includeSecret: boolean }): ProjectDTO => ({
  id: p.id,
  name: p.name,
  publicKey: p.publicKey,
  commentMode: p.commentMode,
  allowedOrigins: p.allowedOrigins,
  openThreads: opts.openThreads,
  createdAt: p.createdAt.getTime(),
  ...(opts.includeSecret ? { identitySecret: p.identitySecret } : {}),
});
