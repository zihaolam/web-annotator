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

const size = z.number().nonnegative().max(1_000_000);

export const elementContextSchema = z.object({
  html: z.string().max(4000),
  ancestors: z.array(z.string().max(400)).max(10),
  components: z.array(z.string().max(120)).max(20),
  source: z
    .object({
      file: z.string().min(1).max(500),
      line: z.number().int().nonnegative().nullable(),
      column: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  rect: z.object({ width: size, height: size }),
  styles: z.record(z.string().max(40), z.string().max(200)).refine((s) => Object.keys(s).length <= 40, "too many styles"),
  viewport: z.object({ width: size, height: size, dpr: z.number().positive().max(10) }),
  userAgent: z.string().max(400),
});

export const createThreadSchema = z.object({
  pageUrl: z.url().max(2000),
  pageTitle: z.string().max(300).nullish(),
  anchor: anchorSchema,
  context: elementContextSchema.nullish(),
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
