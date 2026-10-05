import { createApp } from "./app";
import { createClerkProvider, createDevProvider, type IdentityProvider } from "./auth/identity";
import { createD1Database } from "./db/client";
import type { RateLimiter } from "./ratelimit";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Secret used to sign widget session tokens (`wrangler secret put WIDGET_TOKEN_SECRET`). */
  WIDGET_TOKEN_SECRET: string;
  /** Platform-admin token for /api/admin/*. */
  ADMIN_TOKEN?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  /** Optional PEM public key for networkless Clerk token verification. */
  CLERK_JWT_KEY?: string;
  /** Comma-separated extra origins allowed as Clerk `azp` (defaults to this Worker's origin). */
  CLERK_AUTHORIZED_PARTIES?: string;
  /** "true" to accept unsigned dev sessions on localhost (never set in production). */
  DEV_AUTH?: string;
  RATE_LIMITER?: RateLimiter;
}

const identityFor = (env: Env, selfOrigin: string): IdentityProvider | null => {
  if (env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY) {
    const extra = env.CLERK_AUTHORIZED_PARTIES?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    return createClerkProvider({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
      jwtKey: env.CLERK_JWT_KEY,
      authorizedParties: [selfOrigin, ...extra],
    });
  }
  if (env.DEV_AUTH === "true") return createDevProvider();
  return null;
};

export default {
  async fetch(request, env): Promise<Response> {
    if (!env.WIDGET_TOKEN_SECRET) return new Response("WIDGET_TOKEN_SECRET is not configured", { status: 500 });
    const app = createApp({
      db: createD1Database(env.DB),
      identity: identityFor(env, new URL(request.url).origin),
      widgetTokenSecret: env.WIDGET_TOKEN_SECRET,
      adminToken: env.ADMIN_TOKEN,
      clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY,
      devAuth: env.DEV_AUTH === "true" && !env.CLERK_SECRET_KEY,
      rateLimiter: env.RATE_LIMITER,
    });
    return (await app(request)) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
