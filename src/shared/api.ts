/**
 * Wire types shared by the Worker API and the embeddable widget.
 * Timestamps are epoch milliseconds.
 */

export type ThreadStatus = "open" | "resolved";

export interface Anchor {
  selector: string;
  domPath: string;
  tagName: string;
  textSnippet: string | null;
  offsetX: number;
  offsetY: number;
  viewportWidth: number | null;
}

export interface CommentDTO {
  id: string;
  threadId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadDTO {
  id: string;
  projectId: string;
  pageUrl: string;
  pageTitle: string | null;
  anchor: Anchor;
  status: ThreadStatus;
  authorId: string;
  authorName: string;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  comments: CommentDTO[];
}

export interface Author {
  id: string;
  name: string;
}

export interface CreateThreadInput {
  pageUrl: string;
  pageTitle?: string | null;
  anchor: Anchor;
  body: string;
  author: Author;
}

export interface UpdateThreadInput {
  status: ThreadStatus;
}

export interface CreateCommentInput {
  body: string;
  author: Author;
}

export interface UpdateCommentInput {
  body: string;
  authorId: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
