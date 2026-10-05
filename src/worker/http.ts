import type { ZodType } from "zod";
import type { ApiError } from "../shared/api";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...init.headers },
  });

export const errorResponse = (err: unknown): Response => {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.message, code: err.code, details: err.details };
    return json(body, { status: err.status });
  }
  console.error(err);
  return json({ error: "Internal server error" } satisfies ApiError, { status: 500 });
};

export const readJson = async <T>(request: Request, schema: ZodType<T>): Promise<T> => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(422, "Invalid request body", parsed.error.issues, "invalid_body");
  }
  return parsed.data;
};

export const bearerToken = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
};

type Params = Record<string, string>;
export type Handler<Ctx> = (request: Request, params: Params, ctx: Ctx) => Promise<Response> | Response;

interface Route<Ctx> {
  method: string;
  pattern: URLPattern;
  handler: Handler<Ctx>;
}

/** Minimal method + URLPattern router; no framework needed on top of `fetch`. */
export class Router<Ctx> {
  private routes: Route<Ctx>[] = [];

  on(method: string, pathname: string, handler: Handler<Ctx>): this {
    this.routes.push({ method, pattern: new URLPattern({ pathname }), handler });
    return this;
  }

  get = (p: string, h: Handler<Ctx>) => this.on("GET", p, h);
  post = (p: string, h: Handler<Ctx>) => this.on("POST", p, h);
  patch = (p: string, h: Handler<Ctx>) => this.on("PATCH", p, h);
  delete = (p: string, h: Handler<Ctx>) => this.on("DELETE", p, h);

  async handle(request: Request, ctx: Ctx): Promise<Response | null> {
    const url = new URL(request.url);
    let pathMatched = false;
    for (const route of this.routes) {
      const match = route.pattern.exec({ pathname: url.pathname });
      if (!match) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;
      const params = Object.fromEntries(
        Object.entries(match.pathname.groups).filter((e): e is [string, string] => e[1] != null),
      );
      return route.handler(request, params, ctx);
    }
    if (pathMatched) throw new HttpError(405, "Method not allowed");
    return null;
  }
}
