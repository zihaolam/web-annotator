import type { PlanId } from "./db/schema";

export interface PlanLimits {
  label: string;
  projects: number;
  commentsPerMonth: number;
}

/**
 * Plan limits enforced server-side. Billing isn't wired up yet: platform admins
 * set a workspace's plan with `PATCH /api/admin/workspaces/:id`.
 */
export const PLANS: Record<PlanId, PlanLimits> = {
  free: { label: "Free", projects: 2, commentsPerMonth: 500 },
  pro: { label: "Pro", projects: 20, commentsPerMonth: 10_000 },
  business: { label: "Business", projects: 200, commentsPerMonth: 200_000 },
};

/** Start of the current calendar month in UTC; usage windows reset then. */
export const usagePeriodStart = (now = new Date()): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
