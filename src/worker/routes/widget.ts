import { eq } from "drizzle-orm";
import type { WidgetConfigDTO, WidgetIdentity, WidgetSessionDTO } from "../../shared/api";
import { signWidgetToken, verifyCustomerToken, verifyWidgetToken } from "../auth/tokens";
import type { Ctx } from "../context";
import { projects, workspaces, type Project } from "../db/schema";
import { bearerToken, HttpError, json, readJson, Router } from "../http";
import { clientIp, enforceRateLimit } from "../ratelimit";
import * as svc from "../services";
import {
  commentBodySchema,
  createThreadSchema,
  guestSessionSchema,
  memberSessionSchema,
  updateThreadSchema,
  verifiedSessionSchema,
} from "../validation";

/**
 * Public widget API, addressed by a project's publishable key:
 * `/api/w/:key/...`. Requests carry a widget session token once the visitor
 * has signed in (as a guest, a workspace member, or a customer-verified user).
 */

const loadProject = async (ctx: Ctx, key: string): Promise<Project> => {
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.publicKey, key) });
  if (!project) throw new HttpError(404, "Unknown project key", undefined, "project_not_found");
  if (project.allowedOrigins.length > 0 && (!ctx.origin || !project.allowedOrigins.includes(ctx.origin))) {
    throw new HttpError(403, "This site isn't allowed to use this project", undefined, "origin_not_allowed");
  }
  return project;
};

/** The visitor's identity from their widget token, or null when signed out. */
const optionalIdentity = async (ctx: Ctx, request: Request, project: Project): Promise<WidgetIdentity | null> => {
  const token = bearerToken(request);
  if (!token) return null;
  const identity = await verifyWidgetToken(ctx.widgetTokenSecret, token, project.id);
  // A token minted under a previous comment mode must not outlive the switch.
  const expected = { guests: "guest", members: "member", verified: "verified" }[project.commentMode];
  if (identity.type !== expected) throw new HttpError(401, "Please sign in again", undefined, "auth_required");
  return identity;
};

const requireIdentity = async (ctx: Ctx, request: Request, project: Project): Promise<WidgetIdentity> => {
  const identity = await optionalIdentity(ctx, request, project);
  if (!identity) throw new HttpError(401, "Sign in to comment", undefined, "auth_required");
  return identity;
};

/** Reading is public for guest projects; members/verified projects are private to signed-in visitors. */
const readerIdentity = async (ctx: Ctx, request: Request, project: Project) =>
  project.commentMode === "guests" ? optionalIdentity(ctx, request, project) : requireIdentity(ctx, request, project);

const session = async (ctx: Ctx, project: Project, identity: WidgetIdentity): Promise<WidgetSessionDTO> => ({
  ...(await signWidgetToken(ctx.widgetTokenSecret, project.id, identity)),
  identity,
});

const limitWrites = (ctx: Ctx, request: Request, project: Project, bucket: string) =>
  enforceRateLimit(ctx.rateLimiter, `${bucket}:${project.id}:${clientIp(request)}`);

const assertMode = (project: Project, mode: Project["commentMode"]) => {
  if (project.commentMode !== mode) {
    throw new HttpError(400, `This project doesn't use ${mode} sign-in`, undefined, "wrong_comment_mode");
  }
};

export const widgetRoutes = (router: Router<Ctx>) =>
  router
    .get("/api/w/:key/config", async (_req, { key }, ctx) => {
      const project = await loadProject(ctx, key!);
      const config: WidgetConfigDTO = {
        projectName: project.name,
        commentMode: project.commentMode,
        signInUrl:
          project.commentMode === "members" ? `${ctx.selfOrigin}/widget-auth?key=${encodeURIComponent(project.publicKey)}` : null,
      };
      return json(config);
    })

    // --- Sign-in: one endpoint per comment mode, each returning a widget session token.

    .post("/api/w/:key/session/guest", async (request, { key }, ctx) => {
      const project = await loadProject(ctx, key!);
      assertMode(project, "guests");
      await limitWrites(ctx, request, project, "session");
      const input = await readJson(request, guestSessionSchema);
      let id = `guest:${svc.newId()}`;
      if (input.token) {
        const previous = await verifyWidgetToken(ctx.widgetTokenSecret, input.token, project.id).catch(() => null);
        if (previous?.type === "guest") id = previous.id;
      }
      return json(await session(ctx, project, { id, type: "guest", name: input.name, avatarUrl: null }));
    })

    .post("/api/w/:key/session/verified", async (request, { key }, ctx) => {
      const project = await loadProject(ctx, key!);
      assertMode(project, "verified");
      await limitWrites(ctx, request, project, "session");
      const input = await readJson(request, verifiedSessionSchema);
      const user = await verifyCustomerToken(project.identitySecret, input.token);
      return json(
        await session(ctx, project, { id: `verified:${user.id}`, type: "verified", name: user.name, avatarUrl: user.avatarUrl }),
      );
    })

    /**
     * Called by the sign-in popup (served from this Worker, so `ctx.origin` is our
     * own origin) with a Clerk session. `origin` is the customer site that opened
     * the popup; the token is only ever posted back to an allow-listed origin.
     */
    .post("/api/w/:key/session/member", async (request, { key }, ctx) => {
      const project = await ctx.db.query.projects.findFirst({ where: eq(projects.publicKey, key!) });
      if (!project) throw new HttpError(404, "Unknown project key", undefined, "project_not_found");
      assertMode(project, "members");
      if (!ctx.identity) throw new HttpError(503, "Member sign-in is not configured");
      if (ctx.origin !== ctx.selfOrigin) throw new HttpError(403, "Member sign-in must come from the sign-in page");
      await limitWrites(ctx, request, project, "session");
      const input = await readJson(request, memberSessionSchema);
      const target = new URL(input.origin).origin;
      if (!project.allowedOrigins.includes(target)) {
        throw new HttpError(403, `${target} is not an allowed origin for this project`, undefined, "origin_not_allowed");
      }

      const token = bearerToken(request);
      if (!token) throw new HttpError(401, "Sign in required", undefined, "auth_required");
      const user = await ctx.identity.verifySession(token, request);
      const workspace = await ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, project.workspaceId) });
      const isMember =
        workspace?.kind === "personal"
          ? workspace.id === user.userId
          : (await ctx.identity.getOrgRole(user, project.workspaceId)) !== null;
      if (!isMember) {
        throw new HttpError(403, "You're not a member of the workspace that owns this project", undefined, "not_a_member");
      }
      const profile = await ctx.identity.getProfile(user);
      return json(
        await session(ctx, project, {
          id: `member:${user.userId}`,
          type: "member",
          name: profile.name,
          avatarUrl: profile.avatarUrl,
        }),
      );
    })

    // --- Threads & comments

    .get("/api/w/:key/threads", async (request, { key }, ctx) => {
      const project = await loadProject(ctx, key!);
      await readerIdentity(ctx, request, project);
      const url = new URL(request.url);
      return json(await svc.listThreads(ctx.db, project.id, { pageUrl: url.searchParams.get("url"), status: url.searchParams.get("status") }));
    })

    .post("/api/w/:key/threads", async (request, { key }, ctx) => {
      const project = await loadProject(ctx, key!);
      const identity = await requireIdentity(ctx, request, project);
      await limitWrites(ctx, request, project, "write");
      const input = await readJson(request, createThreadSchema);
      return json(await svc.createThread(ctx.db, project, input, identity), { status: 201 });
    })

    .patch("/api/w/:key/threads/:threadId", async (request, { key, threadId }, ctx) => {
      const project = await loadProject(ctx, key!);
      await requireIdentity(ctx, request, project);
      const input = await readJson(request, updateThreadSchema);
      return json(await svc.setThreadStatus(ctx.db, project.id, threadId!, input.status));
    })

    .delete("/api/w/:key/threads/:threadId", async (request, { key, threadId }, ctx) => {
      const project = await loadProject(ctx, key!);
      const identity = await requireIdentity(ctx, request, project);
      const thread = await svc.loadThread(ctx.db, project.id, threadId!);
      if (thread.authorId !== identity.id) throw new HttpError(403, "Only the thread author can delete it");
      await svc.deleteThread(ctx.db, thread.id);
      return new Response(null, { status: 204 });
    })

    .post("/api/w/:key/threads/:threadId/comments", async (request, { key, threadId }, ctx) => {
      const project = await loadProject(ctx, key!);
      const identity = await requireIdentity(ctx, request, project);
      await limitWrites(ctx, request, project, "write");
      const input = await readJson(request, commentBodySchema);
      return json(await svc.addComment(ctx.db, project, threadId!, input.body, identity), { status: 201 });
    })

    .patch("/api/w/:key/threads/:threadId/comments/:commentId", async (request, { key, threadId, commentId }, ctx) => {
      const project = await loadProject(ctx, key!);
      const identity = await requireIdentity(ctx, request, project);
      const input = await readJson(request, commentBodySchema);
      return json(await svc.editComment(ctx.db, project.id, threadId!, commentId!, input.body, identity.id));
    })

    .delete("/api/w/:key/threads/:threadId/comments/:commentId", async (request, { key, threadId, commentId }, ctx) => {
      const project = await loadProject(ctx, key!);
      const identity = await requireIdentity(ctx, request, project);
      await svc.deleteComment(ctx.db, project.id, threadId!, commentId!, identity.id);
      return new Response(null, { status: 204 });
    });
