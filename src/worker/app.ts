import type { AppConfig, Ctx } from "./context";
import { errorResponse, json, Router } from "./http";
import { adminRoutes } from "./routes/admin";
import { dashboardRoutes } from "./routes/dashboard";
import { widgetRoutes } from "./routes/widget";

export type { AppConfig } from "./context";

const router = new Router<Ctx>()
  .get("/api/health", () => json({ ok: true }))
  // Public bootstrap config for the dashboard and the member sign-in page.
  .get("/api/config", (_req, _p, ctx) =>
    json({ clerkPublishableKey: ctx.clerkPublishableKey || null, devAuth: !!ctx.devAuth }),
  );
widgetRoutes(router);
dashboardRoutes(router);
adminRoutes(router);

/** Widget endpoints are called cross-origin from customer sites; everything else is same-origin only. */
const corsHeaders = (origin: string | null): Record<string, string> => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
  vary: "Origin",
});

/**
 * Browsers omit `Origin` on same-origin GETs (e.g. a page hosted on the
 * annotator's own domain), so fall back to the Referer's origin.
 */
const requestOrigin = (request: Request): string | null => {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
};

/** Builds the API request handler. Returns `null` for non-API paths so the caller can serve assets. */
export const createApp = (config: AppConfig) => {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return null;

    const origin = requestOrigin(request);
    const cors = url.pathname.startsWith("/api/w/") ? corsHeaders(origin) : null;
    if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 405, headers: cors ?? {} });

    let response: Response;
    try {
      response =
        (await router.handle(request, { ...config, origin, selfOrigin: url.origin })) ??
        json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      response = errorResponse(err);
    }
    if (cors) for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  };
};
