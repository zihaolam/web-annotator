import { desc, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { workspaces } from "../db/schema";
import { HttpError, json, readJson, Router } from "../http";
import * as svc from "../services";
import { updateWorkspaceSchema } from "../validation";

/** Platform-operator endpoints (you, the host), guarded by `ADMIN_TOKEN`. */
const requireAdminToken = (ctx: Ctx, request: Request) => {
  if (!ctx.adminToken || request.headers.get("authorization") !== `Bearer ${ctx.adminToken}`) {
    throw new HttpError(401, "Admin token required");
  }
};

export const adminRoutes = (router: Router<Ctx>) =>
  router
    .get("/api/admin/workspaces", async (request, _p, ctx) => {
      requireAdminToken(ctx, request);
      const rows = await ctx.db.query.workspaces.findMany({ orderBy: [desc(workspaces.createdAt)], limit: 500 });
      return json(
        await Promise.all(
          rows.map(async (w) => ({
            ...w,
            projects: await svc.projectCount(ctx.db, w.id),
            commentsThisMonth: await svc.commentsThisMonth(ctx.db, w.id),
          })),
        ),
      );
    })

    .patch("/api/admin/workspaces/:workspaceId", async (request, { workspaceId }, ctx) => {
      requireAdminToken(ctx, request);
      const input = await readJson(request, updateWorkspaceSchema);
      await svc.loadWorkspace(ctx.db, workspaceId!);
      const [updated] = await ctx.db
        .update(workspaces)
        .set({ plan: input.plan, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId!))
        .returning();
      return json(updated);
    });
