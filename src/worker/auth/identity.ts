import { createRemoteJWKSet, decodeProtectedHeader, importSPKI, jwtVerify, type JWTPayload } from "jose";
import type { WorkspaceRole } from "../../shared/api";
import { parseDevToken, type DevClaims } from "../../shared/dev-token";
import { HttpError } from "../http";

export { createDevToken, type DevClaims } from "../../shared/dev-token";

/** A dashboard user, as asserted by a verified session token. */
export interface SessionUser {
  userId: string;
  /** Active organization (Clerk org) or null for the personal workspace. */
  orgId: string | null;
  orgRole: WorkspaceRole | null;
  claims: JWTPayload & Record<string, unknown>;
}

export interface Profile {
  name: string;
  avatarUrl: string | null;
  email: string | null;
}

/**
 * Where dashboard identities come from. Production uses Clerk; local
 * development and tests can use the dev provider.
 */
export interface IdentityProvider {
  verifySession(token: string, request: Request): Promise<SessionUser>;
  getProfile(user: SessionUser): Promise<Profile>;
  /** The user's role in an organization, or null when they are not a member. */
  getOrgRole(user: SessionUser, orgId: string): Promise<WorkspaceRole | null>;
  getOrgName(user: SessionUser, orgId: string): Promise<string>;
}

const unauthorized = (message = "Sign in required") => new HttpError(401, message, undefined, "auth_required");

// ---------------------------------------------------------------------------
// Clerk

export interface ClerkConfig {
  secretKey: string;
  publishableKey: string;
  /** Optional PEM public key for networkless verification (Clerk dashboard → API keys → JWT public key). */
  jwtKey?: string;
  /** Allowed `azp` values. Defaults to the origin the request was made to (dashboard and API share an origin). */
  authorizedParties?: string[];
  fetch?: typeof fetch;
}

/** `pk_test_<base64("foo.clerk.accounts.dev$")>` → `foo.clerk.accounts.dev`. */
export const frontendApiFromPublishableKey = (publishableKey: string): string => {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  const decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return decoded.replace(/\$$/, "");
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const roleFrom = (raw: unknown): WorkspaceRole | null => {
  if (typeof raw !== "string") return null;
  return raw.replace(/^org:/, "") === "admin" ? "admin" : "member";
};

/** Reads the active organization from v2 (`o: { id, rol }`) or v1 (`org_id`, `org_role`) session claims. */
export const orgFromClaims = (claims: Record<string, unknown>): { orgId: string | null; orgRole: WorkspaceRole | null } => {
  const o = claims.o as { id?: string; rol?: string } | undefined;
  if (o?.id) return { orgId: o.id, orgRole: roleFrom(o.rol) };
  if (typeof claims.org_id === "string") return { orgId: claims.org_id, orgRole: roleFrom(claims.org_role) };
  return { orgId: null, orgRole: null };
};

export const createClerkProvider = (config: ClerkConfig): IdentityProvider => {
  const frontendApi = frontendApiFromPublishableKey(config.publishableKey);
  const issuer = `https://${frontendApi}`;
  const doFetch = config.fetch ?? fetch;
  let pemKey: Promise<CryptoKey> | undefined;

  const keyFor = (token: string) => {
    if (config.jwtKey) {
      pemKey ??= importSPKI(config.jwtKey.replace(/\\n/g, "\n"), "RS256");
      return pemKey;
    }
    decodeProtectedHeader(token); // throws on malformed tokens before any network call
    let jwks = jwksCache.get(issuer);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
      jwksCache.set(issuer, jwks);
    }
    return jwks;
  };

  const backend = async <T>(path: string): Promise<T> => {
    const res = await doFetch(`https://api.clerk.com/v1${path}`, {
      headers: { authorization: `Bearer ${config.secretKey}` },
    });
    if (!res.ok) throw new HttpError(502, `Clerk API error (${res.status})`);
    return (await res.json()) as T;
  };

  return {
    async verifySession(token, request) {
      let payload: JWTPayload & Record<string, unknown>;
      try {
        const key = await keyFor(token);
        ({ payload } = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], {
          algorithms: ["RS256"],
          issuer,
          clockTolerance: 5,
        }));
      } catch {
        throw unauthorized("Invalid or expired session");
      }
      const parties = config.authorizedParties ?? [new URL(request.url).origin];
      if (typeof payload.azp === "string" && !parties.includes(payload.azp)) {
        throw unauthorized("Session was issued for a different origin");
      }
      if (!payload.sub) throw unauthorized();
      return { userId: payload.sub, ...orgFromClaims(payload), claims: payload };
    },

    async getProfile(user) {
      const u = await backend<{
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        image_url: string | null;
        primary_email_address_id: string | null;
        email_addresses: Array<{ id: string; email_address: string }>;
      }>(`/users/${encodeURIComponent(user.userId)}`);
      const email =
        u.email_addresses.find((e) => e.id === u.primary_email_address_id)?.email_address ??
        u.email_addresses[0]?.email_address ??
        null;
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || email?.split("@")[0] || "Member";
      return { name, avatarUrl: u.image_url, email };
    },

    async getOrgRole(user, orgId) {
      if (user.orgId === orgId) return user.orgRole;
      const memberships = await backend<{ data: Array<{ role: string; organization: { id: string } }> }>(
        `/users/${encodeURIComponent(user.userId)}/organization_memberships?limit=500`,
      );
      return roleFrom(memberships.data.find((m) => m.organization.id === orgId)?.role ?? null);
    },

    async getOrgName(_user, orgId) {
      const org = await backend<{ name: string }>(`/organizations/${encodeURIComponent(orgId)}`);
      return org.name;
    },
  };
};

// ---------------------------------------------------------------------------
// Dev provider (local development & tests only)

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Trusts unsigned `dev_` tokens. Enabled only with `DEV_AUTH=true`, and even then
 * only for requests addressed to localhost, so a misconfigured deploy can't use it.
 */
export const createDevProvider = (opts: { allowAnyHost?: boolean } = {}): IdentityProvider => {
  const parse = (user: SessionUser) => user.claims as unknown as DevClaims;
  return {
    async verifySession(token, request) {
      if (!opts.allowAnyHost && !LOCAL_HOSTS.has(new URL(request.url).hostname)) {
        throw unauthorized("Dev auth is only available on localhost");
      }
      const claims = parseDevToken(token);
      if (!claims) throw unauthorized("Invalid session");
      const orgId = claims.orgId ?? null;
      return {
        userId: claims.userId,
        orgId,
        orgRole: orgId ? (claims.orgs?.[orgId]?.role ?? "member") : null,
        claims: claims as unknown as SessionUser["claims"],
      };
    },
    async getProfile(user) {
      const c = parse(user);
      return { name: c.name, avatarUrl: c.avatarUrl ?? null, email: c.email ?? null };
    },
    async getOrgRole(user, orgId) {
      return parse(user).orgs?.[orgId]?.role ?? null;
    },
    async getOrgName(user, orgId) {
      return parse(user).orgs?.[orgId]?.name ?? orgId;
    },
  };
};
