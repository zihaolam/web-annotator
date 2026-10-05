import { beforeAll, describe, expect, test } from "bun:test";
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { createClerkProvider, frontendApiFromPublishableKey, orgFromClaims } from "../src/worker/auth/identity";

const FAPI = "example-app.clerk.accounts.dev";
const PUBLISHABLE_KEY = `pk_test_${btoa(`${FAPI}$`)}`;
const DASHBOARD = "https://annotator.example.com";

let privateKey: CryptoKey;
let pem: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  pem = await exportSPKI(pair.publicKey);
});

const sessionToken = (claims: Record<string, unknown>, opts: { iss?: string; exp?: string } = {}) =>
  new SignJWT({ azp: DASHBOARD, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "ins_test" })
    .setIssuer(opts.iss ?? `https://${FAPI}`)
    .setSubject("user_123")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1m")
    .sign(privateKey);

const request = new Request(`${DASHBOARD}/api/dashboard/workspace`);

/** Fake Clerk Backend API. */
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_test_secret");
  if (url.endsWith("/users/user_123")) {
    return Response.json({
      first_name: "Ada",
      last_name: "Lovelace",
      username: null,
      image_url: "https://img.clerk.com/ada.png",
      primary_email_address_id: "idn_2",
      email_addresses: [
        { id: "idn_1", email_address: "old@example.com" },
        { id: "idn_2", email_address: "ada@example.com" },
      ],
    });
  }
  if (url.includes("/users/user_123/organization_memberships")) {
    return Response.json({ data: [{ role: "org:member", organization: { id: "org_other" } }] });
  }
  if (url.endsWith("/organizations/org_acme")) return Response.json({ name: "Acme Inc" });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const provider = () =>
  createClerkProvider({
    secretKey: "sk_test_secret",
    publishableKey: PUBLISHABLE_KEY,
    jwtKey: pem,
    fetch: fakeFetch,
  });

describe("Clerk provider", () => {
  test("derives the Frontend API host from the publishable key", () => {
    expect(frontendApiFromPublishableKey(PUBLISHABLE_KEY)).toBe(FAPI);
  });

  test("reads v2 and v1 organization claims", () => {
    expect(orgFromClaims({ o: { id: "org_a", rol: "admin" } })).toEqual({ orgId: "org_a", orgRole: "admin" });
    expect(orgFromClaims({ org_id: "org_b", org_role: "org:member" })).toEqual({ orgId: "org_b", orgRole: "member" });
    expect(orgFromClaims({})).toEqual({ orgId: null, orgRole: null });
  });

  test("verifies a session token", async () => {
    const user = await provider().verifySession(await sessionToken({ o: { id: "org_acme", rol: "admin" }, v: 2 }), request);
    expect(user).toMatchObject({ userId: "user_123", orgId: "org_acme", orgRole: "admin" });
  });

  test("rejects tokens for another origin, issuer, or past expiry", async () => {
    const p = provider();
    await expect(p.verifySession(await sessionToken({ azp: "https://evil.example" }), request)).rejects.toMatchObject({ status: 401 });
    await expect(p.verifySession(await sessionToken({}, { iss: "https://other.clerk.accounts.dev" }), request)).rejects.toMatchObject({ status: 401 });
    await expect(p.verifySession(await sessionToken({}, { exp: "-1m" }), request)).rejects.toMatchObject({ status: 401 });
    await expect(p.verifySession("not-a-jwt", request)).rejects.toMatchObject({ status: 401 });
  });

  test("looks up profiles, memberships and org names via the Backend API", async () => {
    const p = provider();
    const user = await p.verifySession(await sessionToken({ o: { id: "org_acme", rol: "member" } }), request);
    expect(await p.getProfile(user)).toEqual({ name: "Ada Lovelace", avatarUrl: "https://img.clerk.com/ada.png", email: "ada@example.com" });
    // Active org comes from the token; other orgs from the memberships endpoint.
    expect(await p.getOrgRole(user, "org_acme")).toBe("member");
    expect(await p.getOrgRole(user, "org_other")).toBe("member");
    expect(await p.getOrgRole(user, "org_nope")).toBeNull();
    expect(await p.getOrgName(user, "org_acme")).toBe("Acme Inc");
  });
});
