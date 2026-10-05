import { z } from "zod";
import { COMMENT_MODES, PLAN_IDS } from "./db/schema";

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
});

export const updateThreadSchema = z.object({ status: z.enum(["open", "resolved"]) });

export const commentBodySchema = z.object({ body });

export const guestSessionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** An existing guest token, so renaming keeps the same guest identity. */
  token: z.string().max(4000).optional(),
});

export const verifiedSessionSchema = z.object({ token: z.string().min(1).max(4000) });

export const memberSessionSchema = z.object({ origin: z.url().max(300) });

/** `https://app.example.com` (no path, no trailing slash). */
const origin = z
  .url()
  .max(300)
  .transform((value) => new URL(value).origin)
  .refine((value) => value !== "null", "must be an http(s) origin");

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  allowedOrigins: z.array(origin).max(50).default([]),
  commentMode: z.enum(COMMENT_MODES).default("guests"),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    allowedOrigins: z.array(origin).max(50),
    commentMode: z.enum(COMMENT_MODES),
  })
  .partial();

export const rotateKeySchema = z.object({ key: z.enum(["publicKey", "identitySecret"]) });

export const updateWorkspaceSchema = z.object({ plan: z.enum(PLAN_IDS) });
