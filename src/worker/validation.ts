import { z } from "zod";

const author = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
});

const body = z.string().trim().min(1).max(5000);

export const anchorSchema = z.object({
  selector: z.string().min(1).max(2000),
  domPath: z.string().min(1).max(2000),
  tagName: z.string().min(1).max(64),
  textSnippet: z.string().max(200).nullable(),
  offsetX: z.number().min(0).max(1),
  offsetY: z.number().min(0).max(1),
  viewportWidth: z.number().int().positive().max(100_000).nullable(),
});

export const createThreadSchema = z.object({
  pageUrl: z.url().max(2000),
  pageTitle: z.string().max(300).nullish(),
  anchor: anchorSchema,
  body,
  author,
});

export const updateThreadSchema = z.object({
  status: z.enum(["open", "resolved"]),
});

export const createCommentSchema = z.object({ body, author });

export const updateCommentSchema = z.object({ body });

export const createProjectSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase letters, digits and dashes")
    .optional(),
  name: z.string().trim().min(1).max(120),
  allowedOrigins: z.array(z.url()).max(50).default([]),
});
