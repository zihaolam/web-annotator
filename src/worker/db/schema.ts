import { relations, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
};

/**
 * A project is one site (or group of sites) that embeds the annotator script.
 * `allowedOrigins` restricts which origins may read/write its threads; an empty
 * list allows any origin (handy for local development).
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  allowedOrigins: text("allowed_origins", { mode: "json" }).$type<string[]>().notNull().default([]),
  ...timestamps,
});

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
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("threads_project_page_idx").on(t.projectId, t.pageUrl)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull(),
    ...timestamps,
  },
  (t) => [index("comments_thread_idx").on(t.threadId)],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  threads: many(threads),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  project: one(projects, { fields: [threads.projectId], references: [projects.id] }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  thread: one(threads, { fields: [comments.threadId], references: [threads.id] }),
}));

export type Project = typeof projects.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Comment = typeof comments.$inferSelect;
