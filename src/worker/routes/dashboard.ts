import { and, count, eq, inArray } from "drizzle-orm";
import type { WidgetIdentity, WorkspaceDTO, WorkspaceRole } from "../../shared/api";
import type { SessionUser } from "../auth/identity";
import { randomKey } from "../auth/tokens";
import type { Ctx } from "../context";
import { projects, threads, workspaces, type Project, type Workspace } from "../db/schema";
import { bearerToken, HttpError, json, readJson, Router } from "../http";
import { PLANS, usagePeriodStart } from "../plans";
import { toProjectDTO } from "../serializers";
import * as svc from "../services";
import {
  commentBodySchema,
  createProjectSchema,
  rotateKeySchema,
  updateProjectSchema,
  updateThreadSchema,
} from "../validation";

/**
 * Dashboard API for site owners, authenticated with a Clerk session token.
 * The active Clerk organization is the workspace; with no active organization
 * the user works in their personal workspace. All data is scoped to it.
 */

interface Member {
  user: SessionUser;
  workspace: Workspace;
  role: WorkspaceRole;
}

/** Resolves the caller and their workspace, creating the workspace row on first use. */
const authenticate = async (ctx: Ctx, request: Request): Promise<Member> => {
  if (!ctx.identity) throw new HttpError(503, "Dashboard sign-in is not configured");
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, "Sign in required", undefined, "auth_required");
  const user = await ctx.identity.verifySession(token, request);

  const workspaceId = user.orgId ?? user.userId;
  let workspace = await ctx.db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!workspace) {
    const name = user.orgId
      ? await ctx.identity.getOrgName(user, user.orgId)
      : `${(await ctx.identity.getProfile(user)).name}'s workspace`;
    [workspace] = await ctx.db
      .insert(workspaces)
      .values({ id: workspaceId, kind: user.orgId ? "organization" : "personal", name })
      .onConflictDoNothing()
      .returning();
    workspace ??= await svc.loadWorkspace(ctx.db, workspaceId);
  }
  const role: WorkspaceRole = user.orgId ? (user.orgRole ?? "member") : "admin";
  return { user, workspace, role };
};

const requireAdmin = (member: Member) => {
  if (member.role !== "admin") throw new HttpError(403, "Only workspace admins can do this", undefined, "admin_required");
};

const loadProject = async (ctx: Ctx, member: Member, projectId: string): Promise<Project> => {
  const project = await ctx.db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.workspaceId, member.workspace.id)),
  });
  if (!project) throw new HttpError(404, "Project not found");
  return project;
};

const openThreadCounts = async (ctx: Ctx, projectIds: string[]) => {
  if (projectIds.length === 0) return new Map<string, number>();
  const rows = await ctx.db
    .select({ projectId: threads.projectId, n: count() })
    .from(threads)
    .where(and(inArray(threads.projectId, projectIds), eq(threads.status, "open")))
    .groupBy(threads.projectId);
  return new Map(rows.map((r) => [r.projectId, r.n]));
};

const projectResponse = async (ctx: Ctx, member: Member, project: Project) => {
  const counts = await openThreadCounts(ctx, [project.id]);
  return toProjectDTO(project, { openThreads: counts.get(project.id) ?? 0, includeSecret: member.role === "admin" });
};

/** `members` mode posts sign-in tokens back to the opener, so it needs an explicit origin allow-list. */
const assertModeIsSafe = (commentMode: Project["commentMode"], allowedOrigins: string[]) => {
  if (commentMode === "members" && allowedOrigins.length === 0) {
    throw new HttpError(422, "Add at least one allowed origin before enabling member sign-in", undefined, "origins_required");
  }
};

/** Dashboard users comment as workspace members. */
const memberIdentity = async (ctx: Ctx, member: Member): Promise<WidgetIdentity> => {
  const profile = await ctx.identity!.getProfile(member.user);
  return { id: `member:${member.user.userId}`, type: "member", name: profile.name, avatarUrl: profile.avatarUrl };
};

export const dashboardRoutes = (router: Router<Ctx>) =>
  router
    .get("/api/dashboard/workspace", async (request, _p, ctx) => {
      const member = await authenticate(ctx, request);
      const plan = PLANS[member.workspace.plan];
      const body: WorkspaceDTO = {
        id: member.workspace.id,
        kind: member.workspace.kind,
        name: member.workspace.name,
        plan: member.workspace.plan,
        planLabel: plan.label,
        role: member.role,
        usage: {
          projects: await svc.projectCount(ctx.db, member.workspace.id),
          commentsThisMonth: await svc.commentsThisMonth(ctx.db, member.workspace.id),
          periodStart: usagePeriodStart().getTime(),
          limits: { projects: plan.projects, commentsPerMonth: plan.commentsPerMonth },
        },
      };
      return json(body);
    })

    .get("/api/dashboard/projects", async (request, _p, ctx) => {
      const member = await authenticate(ctx, request);
      const rows = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, member.workspace.id),
        orderBy: (p, { asc }) => [asc(p.createdAt)],
      });
      const counts = await openThreadCounts(
        ctx,
        rows.map((p) => p.id),
      );
      return json(
        rows.map((p) => toProjectDTO(p, { openThreads: counts.get(p.id) ?? 0, includeSecret: member.role === "admin" })),
      );
    })

    .post("/api/dashboard/projects", async (request, _p, ctx) => {
      const member = await authenticate(ctx, request);
      requireAdmin(member);
      const input = await readJson(request, createProjectSchema);
      assertModeIsSafe(input.commentMode, input.allowedOrigins);
      const limit = PLANS[member.workspace.plan].projects;
      if ((await svc.projectCount(ctx.db, member.workspace.id)) >= limit) {
        throw new HttpError(402, `Your plan allows ${limit} projects`, { limit }, "quota_exceeded");
      }
      const [project] = await ctx.db
        .insert(projects)
        .values({
          id: svc.newId(),
          workspaceId: member.workspace.id,
          name: input.name,
          publicKey: randomKey("pk_"),
          identitySecret: randomKey("sk_", 40),
          commentMode: input.commentMode,
          allowedOrigins: input.allowedOrigins,
        })
        .returning();
      return json(await projectResponse(ctx, member, project!), { status: 201 });
    })

    .get("/api/dashboard/projects/:projectId", async (request, { projectId }, ctx) => {
      const member = await authenticate(ctx, request);
      return json(await projectResponse(ctx, member, await loadProject(ctx, member, projectId!)));
    })

    .patch("/api/dashboard/projects/:projectId", async (request, { projectId }, ctx) => {
      const member = await authenticate(ctx, request);
      requireAdmin(member);
      const project = await loadProject(ctx, member, projectId!);
      const input = await readJson(request, updateProjectSchema);
      assertModeIsSafe(input.commentMode ?? project.commentMode, input.allowedOrigins ?? project.allowedOrigins);
      const [updated] = await ctx.db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, project.id))
        .returning();
      return json(await projectResponse(ctx, member, updated!));
    })

    .post("/api/dashboard/projects/:projectId/rotate", async (request, { projectId }, ctx) => {
      const member = await authenticate(ctx, request);
      requireAdmin(member);
      const project = await loadProject(ctx, member, projectId!);
      const { key } = await readJson(request, rotateKeySchema);
      const value = key === "publicKey" ? randomKey("pk_") : randomKey("sk_", 40);
      const [updated] = await ctx.db
        .update(projects)
        .set({ [key]: value, updatedAt: new Date() })
        .where(eq(projects.id, project.id))
        .returning();
      return json(await projectResponse(ctx, member, updated!));
    })

    .delete("/api/dashboard/projects/:projectId", async (request, { projectId }, ctx) => {
      const member = await authenticate(ctx, request);
      requireAdmin(member);
      const project = await loadProject(ctx, member, projectId!);
      const threadIds = await ctx.db.select({ id: threads.id }).from(threads).where(eq(threads.projectId, project.id));
      for (const { id } of threadIds) await svc.deleteThread(ctx.db, id);
      await ctx.db.delete(projects).where(eq(projects.id, project.id));
      return new Response(null, { status: 204 });
    })

    // --- Inbox: every thread in a project, across pages

    .get("/api/dashboard/projects/:projectId/threads", async (request, { projectId }, ctx) => {
      const member = await authenticate(ctx, request);
      const project = await loadProject(ctx, member, projectId!);
      const url = new URL(request.url);
      return json(
        await svc.listThreads(ctx.db, project.id, { status: url.searchParams.get("status"), pageUrl: url.searchParams.get("url"), limit: 200 }),
      );
    })

    .patch("/api/dashboard/projects/:projectId/threads/:threadId", async (request, { projectId, threadId }, ctx) => {
      const member = await authenticate(ctx, request);
      const project = await loadProject(ctx, member, projectId!);
      const input = await readJson(request, updateThreadSchema);
      return json(await svc.setThreadStatus(ctx.db, project.id, threadId!, input.status));
    })

    .post("/api/dashboard/projects/:projectId/threads/:threadId/comments", async (request, { projectId, threadId }, ctx) => {
      const member = await authenticate(ctx, request);
      const project = await loadProject(ctx, member, projectId!);
      const input = await readJson(request, commentBodySchema);
      return json(await svc.addComment(ctx.db, project, threadId!, input.body, await memberIdentity(ctx, member)), {
        status: 201,
      });
    })

    .delete("/api/dashboard/projects/:projectId/threads/:threadId", async (request, { projectId, threadId }, ctx) => {
      const member = await authenticate(ctx, request);
      requireAdmin(member);
      const project = await loadProject(ctx, member, projectId!);
      await svc.loadThread(ctx.db, project.id, threadId!);
      await svc.deleteThread(ctx.db, threadId!);
      return new Response(null, { status: 204 });
    })

    .delete(
      "/api/dashboard/projects/:projectId/threads/:threadId/comments/:commentId",
      async (request, { projectId, threadId, commentId }, ctx) => {
        const member = await authenticate(ctx, request);
        requireAdmin(member);
        const project = await loadProject(ctx, member, projectId!);
        await svc.deleteComment(ctx.db, project.id, threadId!, commentId!, null);
        return new Response(null, { status: 204 });
      },
    );
