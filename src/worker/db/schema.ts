import { relations, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ElementContext } from "../../shared/api";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
};

export const PLAN_IDS = ["free", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const COMMENT_MODES = ["guests", "members", "verified"] as const;
export type CommentMode = (typeof COMMENT_MODES)[number];

export const AUTHOR_TYPES = ["guest", "member", "verified"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

/**
 * A tenant. Its id is the Clerk organization id (`org_…`) for team workspaces,
 * or the Clerk user id (`user_…`) for a personal workspace. Membership and
 * roles live in Clerk; this table only holds what Clerk doesn't (plan, name).
 */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["organization", "personal"] }).notNull(),
  name: text("name").notNull(),
  plan: text("plan", { enum: PLAN_IDS }).notNull().default("free"),
  ...timestamps,
});

/**
 * One site (or group of sites) embedding the widget. The script tag carries the
 * public key; `identitySecret` is only shown to workspace admins and is used by
 * the customer's backend to sign user tokens in `verified` mode.
 */
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    identitySecret: text("identity_secret").notNull(),
    /** Who may comment: anyone with a name, workspace members, or users verified by the customer's backend. */
    commentMode: text("comment_mode", { enum: COMMENT_MODES }).notNull().default("guests"),
    /** Origins allowed to load and use the widget. Empty = any origin (only honoured in `guests` mode). */
    allowedOrigins: text("allowed_origins", { mode: "json" }).$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("projects_public_key_idx").on(t.publicKey), index("projects_workspace_idx").on(t.workspaceId)],
);

const author = {
  authorType: text("author_type", { enum: AUTHOR_TYPES }).notNull(),
  /** Namespaced id: `guest:<uuid>`, `member:<clerk user id>` or `verified:<customer user id>`. */
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  authorAvatarUrl: text("author_avatar_url"),
};

/**
 * A thread is a conversation pinned to one element on one page.
 * The anchor columns describe how to find the element again on reload.
 */
export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Normalized page URL (origin + pathname by default). */
    pageUrl: text("page_url").notNull(),
    pageTitle: text("page_title"),
    /** Unique CSS selector for the annotated element. */
    selector: text("selector").notNull(),
    /** Structural fallback path (`body > div:nth-child(2) > ...`). */
    domPath: text("dom_path").notNull(),
    tagName: text("tag_name").notNull(),
    /** Short text snippet used to disambiguate / show detached threads. */
    textSnippet: text("text_snippet"),
    /** Pin position inside the element, as a 0..1 fraction of its box. */
    offsetX: real("offset_x").notNull().default(1),
    offsetY: real("offset_y").notNull().default(0),
    viewportWidth: integer("viewport_width"),
    /** HTML snippet, component/source and styles captured at annotation time, for humans and coding agents. */
    context: text("context", { mode: "json" }).$type<ElementContext>(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    ...author,
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("threads_project_page_idx").on(t.projectId, t.pageUrl), index("threads_project_idx").on(t.projectId)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** Denormalized so monthly usage can be counted per workspace without joins. */
    workspaceId: text("workspace_id").notNull(),
    body: text("body").notNull(),
    ...author,
    ...timestamps,
  },
  (t) => [index("comments_thread_idx").on(t.threadId), index("comments_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  threads: many(threads),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  project: one(projects, { fields: [threads.projectId], references: [projects.id] }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  thread: one(threads, { fields: [comments.threadId], references: [threads.id] }),
}));

export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Comment = typeof comments.$inferSelect;
