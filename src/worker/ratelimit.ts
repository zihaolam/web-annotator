import { HttpError } from "./http";

/** Subset of the Workers Rate Limiting binding we use (`ratelimits` in wrangler.jsonc). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Throws 429 when the binding says `key` is over its limit. A missing binding disables limiting. */
export const enforceRateLimit = async (limiter: RateLimiter | undefined, key: string) => {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "Too many requests, slow down", undefined, "rate_limited");
};

export const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
