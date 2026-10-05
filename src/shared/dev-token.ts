import type { WorkspaceRole } from "./api";

/**
 * Unsigned identity for local development (DEV_AUTH=true). The Worker accepts
 * these only on localhost; production uses Clerk session tokens.
 */
export interface DevClaims {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  email?: string | null;
  /** Active organization (the workspace being viewed). */
  orgId?: string | null;
  /** All organizations the user belongs to, with role and name. */
  orgs?: Record<string, { role: WorkspaceRole; name: string }>;
}

const b64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export const createDevToken = (claims: DevClaims): string => `dev_${b64url(JSON.stringify(claims))}`;

export const parseDevToken = (token: string): DevClaims | null => {
  if (!token.startsWith("dev_")) return null;
  try {
    const claims = JSON.parse(fromB64url(token.slice(4))) as DevClaims;
    return claims.userId ? claims : null;
  } catch {
    return null;
  }
};
