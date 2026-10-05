import type { Database } from "./db/client";
import type { IdentityProvider } from "./auth/identity";
import type { RateLimiter } from "./ratelimit";

export interface AppConfig {
  db: Database;
  /** Verifies dashboard sessions (Clerk in production). Dashboard and member sign-in are disabled when null. */
  identity: IdentityProvider | null;
  /** HMAC secret for widget session tokens. */
  widgetTokenSecret: string;
  /** Platform-admin bearer token for `/api/admin/*`. Disabled when unset. */
  adminToken?: string;
  /** Clerk publishable key handed to the dashboard and the member sign-in page. */
  clerkPublishableKey?: string;
  devAuth?: boolean;
  /** Rate limiter for widget writes and sign-ins (optional). */
  rateLimiter?: RateLimiter;
}

export interface Ctx extends AppConfig {
  origin: string | null;
  /** Origin this Worker is being addressed on (where the dashboard and sign-in page live). */
  selfOrigin: string;
}
