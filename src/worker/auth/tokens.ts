import { jwtVerify, SignJWT } from "jose";
import type { WidgetIdentity } from "../../shared/api";
import { HttpError } from "../http";

const WIDGET_AUDIENCE = "web-annotator:widget";
const WIDGET_TOKEN_TTL_S = 30 * 24 * 60 * 60;
/** Customer-signed identity tokens must be short-lived. */
const MAX_CUSTOMER_TOKEN_LIFETIME_S = 7 * 24 * 60 * 60;

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * Widget session tokens are what the embedded script sends on every request.
 * They bind an identity (guest, member or verified user) to one project.
 */
export const signWidgetToken = async (
  secret: string,
  projectId: string,
  identity: WidgetIdentity,
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> => {
  const exp = now + WIDGET_TOKEN_TTL_S;
  const token = await new SignJWT({
    typ: identity.type,
    name: identity.name,
    pic: identity.avatarUrl,
    pid: projectId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.id)
    .setAudience(WIDGET_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(keyOf(secret));
  return { token, expiresAt: exp * 1000 };
};

export const verifyWidgetToken = async (secret: string, token: string, projectId: string): Promise<WidgetIdentity> => {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), { algorithms: ["HS256"], audience: WIDGET_AUDIENCE });
    if (payload.pid !== projectId || !payload.sub) throw new Error("wrong project");
    const type = payload.typ;
    if (type !== "guest" && type !== "member" && type !== "verified") throw new Error("bad type");
    return {
      id: payload.sub,
      type,
      name: String(payload.name ?? "Anonymous"),
      avatarUrl: typeof payload.pic === "string" ? payload.pic : null,
    };
  } catch {
    throw new HttpError(401, "Your session has expired, sign in again", undefined, "auth_required");
  }
};

/**
 * Verifies a token minted by the customer's backend with the project's identity
 * secret (HS256), e.g. `jwt.sign({ sub: user.id, name: user.name }, secret, { expiresIn: "1h" })`.
 */
export const verifyCustomerToken = async (
  identitySecret: string,
  token: string,
): Promise<{ id: string; name: string; avatarUrl: string | null }> => {
  try {
    const { payload } = await jwtVerify(token, keyOf(identitySecret), {
      algorithms: ["HS256"],
      requiredClaims: ["sub", "exp"],
      clockTolerance: 5,
    });
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp! - (payload.iat ?? now) > MAX_CUSTOMER_TOKEN_LIFETIME_S) throw new Error("lifetime too long");
    const name = [payload.name, payload.email].find((v): v is string => typeof v === "string" && v.trim() !== "");
    const avatar = payload.avatar ?? payload.picture;
    return {
      id: String(payload.sub).slice(0, 128),
      name: (name ?? "User").slice(0, 80),
      avatarUrl: typeof avatar === "string" && /^https:\/\//.test(avatar) ? avatar : null,
    };
  } catch {
    throw new HttpError(401, "Invalid user token", undefined, "invalid_user_token");
  }
};

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const randomKey = (prefix: string, length = 24): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return prefix + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
};
