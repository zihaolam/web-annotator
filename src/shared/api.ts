/**
 * Wire types shared by the Worker API, the embeddable widget and the dashboard.
 * Timestamps are epoch milliseconds.
 */

export type ThreadStatus = "open" | "resolved";
export type CommentMode = "guests" | "members" | "verified";
export type AuthorType = "guest" | "member" | "verified";
export type PlanId = "free" | "pro" | "business";
export type WorkspaceRole = "admin" | "member";

export interface Anchor {
  selector: string;
  domPath: string;
  tagName: string;
  textSnippet: string | null;
  offsetX: number;
  offsetY: number;
  viewportWidth: number | null;
}

/**
 * What the element looked like when it was annotated, captured so a person or a
 * coding agent can find and fix it without opening the page. Everything is
 * best-effort: framework details are only present in builds that expose them.
 */
export interface ElementContext {
  /** Trimmed `outerHTML`: deep children collapsed, long attributes and text shortened. */
  html: string;
  /** Opening tags of the closest ancestors, outermost first. */
  ancestors: string[];
  /** Framework component names (React, Vue, Svelte), innermost first. */
  components: string[];
  /** Source location of the nearest component, when a dev build exposes it. */
  source: { file: string; line: number | null; column: number | null } | null;
  /** Rendered size in CSS pixels. */
  rect: { width: number; height: number };
  /** Computed styles that usually matter for visual feedback (defaults omitted). */
  styles: Record<string, string>;
  viewport: { width: number; height: number; dpr: number };
  userAgent: string;
}

export interface AuthorDTO {
  type: AuthorType;
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface CommentDTO {
  id: string;
  threadId: string;
  body: string;
  author: AuthorDTO;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadDTO {
  id: string;
  projectId: string;
  pageUrl: string;
  pageTitle: string | null;
  anchor: Anchor;
  /** `null` for threads created before context capture existed. */
  context: ElementContext | null;
  status: ThreadStatus;
  author: AuthorDTO;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  comments: CommentDTO[];
}

export interface CreateThreadInput {
  pageUrl: string;
  pageTitle?: string | null;
  anchor: Anchor;
  context?: ElementContext | null;
  body: string;
}

export interface ApiError {
  error: string;
  /** Machine-readable reason, e.g. `auth_required`, `quota_exceeded`, `origin_not_allowed`. */
  code?: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Widget

/** Public, per-project widget configuration (`GET /api/w/:key/config`). */
export interface WidgetConfigDTO {
  projectName: string;
  commentMode: CommentMode;
  /** Page on the annotator origin that signs workspace members in (members mode). */
  signInUrl: string | null;
}

/** Identity carried by a widget session token. */
export interface WidgetIdentity {
  id: string;
  type: AuthorType;
  name: string;
  avatarUrl: string | null;
}

export interface WidgetSessionDTO {
  token: string;
  expiresAt: number;
  identity: WidgetIdentity;
}

// ---------------------------------------------------------------------------
// Dashboard

export interface UsageDTO {
  projects: number;
  commentsThisMonth: number;
  periodStart: number;
  limits: { projects: number; commentsPerMonth: number };
}

export interface WorkspaceDTO {
  id: string;
  kind: "organization" | "personal";
  name: string;
  plan: PlanId;
  planLabel: string;
  role: WorkspaceRole;
  usage: UsageDTO;
}

export interface ProjectDTO {
  id: string;
  name: string;
  publicKey: string;
  commentMode: CommentMode;
  allowedOrigins: string[];
  openThreads: number;
  createdAt: number;
  /** Only returned to workspace admins. */
  identitySecret?: string;
}

export interface CreateProjectInput {
  name: string;
  allowedOrigins?: string[];
  commentMode?: CommentMode;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;
