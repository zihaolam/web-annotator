/**
 * End-to-end smoke test against a running `wrangler dev` with DEV_AUTH=true
 * (default http://127.0.0.1:8787). Drives the dashboard and the demo page in
 * Chromium through every comment mode and saves screenshots.
 *
 *   bun run dev            # in one terminal
 *   bun e2e/smoke.ts       # in another
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { SignJWT } from "jose";
import { chromium, type Page } from "playwright-core";
import type { ProjectDTO, ThreadDTO } from "../src/shared/api";
import { createDevToken, type DevClaims } from "../src/shared/dev-token";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const OUT = process.env.SCREENSHOT_DIR ?? "e2e/screenshots";
const executablePath = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p));

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

// A fresh dashboard user (and so a fresh personal workspace) per run keeps the test repeatable.
const owner: DevClaims = { userId: `user_e2e_${Date.now().toString(36)}`, name: "Zi Hao", email: "e2e@example.dev", orgs: {} };
const ownerToken = createDevToken(owner);
const dashboardApi = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${BASE}/api/dashboard${path}`, {
    method,
    headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath, channel: executablePath ? undefined : "chromium" });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
context.on("weberror", (err) => console.error("pageerror:", err.error()));

const shotOf = (page: Page) => (name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

// ---------------------------------------------------------------------------
console.log("dashboard");

const dash = await context.newPage();
const dashShot = shotOf(dash);
await dash.goto(`${BASE}/app/`);
await dash.getByLabel("Name").fill(owner.name);
await dash.getByLabel("User id").fill(owner.userId);
await dashShot("01-dashboard-sign-in");
await dash.getByRole("button", { name: "Continue" }).click();
await dash.getByRole("heading", { name: "Projects" }).waitFor();
assert(await dash.getByText(`${owner.name}'s workspace`).isVisible(), "personal workspace created on first sign-in");

await dash.getByRole("button", { name: "New project" }).click();
await dash.getByLabel("Name").fill("Acme Dashboard");
await dash.getByLabel("Allowed origins").fill(BASE);
await dash.getByRole("button", { name: "Create project" }).click();
await dash.getByRole("heading", { name: "1. Add the script to your site" }).waitFor();
await dashShot("02-dashboard-install");

const [project] = await dashboardApi<ProjectDTO[]>("GET", "/projects");
assert(project?.publicKey.startsWith("pk_"), "project created with a publishable key");
assert(await dash.getByText(`data-project="${project!.publicKey}"`).isVisible(), "install snippet shows the key");

// ---------------------------------------------------------------------------
console.log("widget: guests mode");

const site = await context.newPage();
const shot = shotOf(site);
const shadow = (selector: string) => site.locator(`[data-web-annotator] >> ${selector}`);
await site.addInitScript((key) => {
  (window as unknown as { WebAnnotatorConfig: object }).WebAnnotatorConfig = { projectKey: key };
}, project!.publicKey);

await site.goto(`${BASE}/`);
await site.waitForFunction(() => !!window.WebAnnotator);
assert(await shadow("[data-annotator-toolbar]").isVisible(), "toolbar mounted in shadow root");
await site.waitForTimeout(600);

await site.keyboard.press("c");
const button = site.locator("#new-claim");
const box = (await button.boundingBox())!;
await site.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
await site.waitForTimeout(150);
assert(await shadow("text=Click to comment").isVisible(), "hover label shows while picking");
await shot("03-hover");

let alerted = false;
site.on("dialog", (d) => {
  alerted = true;
  void d.dismiss();
});
await site.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
await site.waitForTimeout(100);
assert(!alerted, "page click handler is blocked while picking");
const nameField = shadow("input[placeholder='Your name']");
assert(await nameField.isVisible(), "guests are asked for a name");
await nameField.fill("Gina Guest");
await shadow("textarea[placeholder='Add a comment']").fill("Make this button use the brand colour.");
await site.keyboard.press("Escape");
assert(await shadow("text=Discard comment?").isVisible(), "escape with a draft asks to discard");
await shadow("button:has-text('No')").click();
await shadow("textarea[placeholder='Add a comment']").press("Enter");
await shadow("text=Comment added").waitFor();
await shot("04-guest-posted");
await site.waitForTimeout(1700);

await site.reload();
await site.waitForFunction(() => !!window.WebAnnotator);
await shadow("button[aria-label^='Comment 1 by Gina Guest']").waitFor();
assert(true, "guest thread restored after reload");

// ---------------------------------------------------------------------------
console.log("widget: members mode");

await dash.goto(`${BASE}/app/#/p/${project!.id}/settings`);
await dash.getByText("Workspace members").click();
await dash.getByRole("button", { name: "Save changes" }).click();
await dash.getByText("Saved").waitFor();
await dashShot("05-dashboard-settings");

await site.reload();
await site.waitForFunction(() => !!window.WebAnnotator);
await site.waitForTimeout(400);
assert((await shadow("button[aria-label*=' by ']").count()) === 0, "members mode hides comments from signed-out visitors");
await shadow("button[aria-label='All comments on this page']").click();
await shadow("text=Sign in to see comments").waitFor();
await shot("06-members-signed-out");

// The popup shares the dashboard's (dev) session, so it signs straight in and closes.
const popupPromise = site.waitForEvent("popup");
await shadow("button:has-text('Sign in to see comments')").click();
const popup = await popupPromise;
await popup.waitForEvent("close", { timeout: 15_000 });
await shadow(`text=Signed in as ${owner.name}`).first().waitFor();
assert(true, "member sign-in popup returns a session");
await shot("07-members-signed-in");
await site.keyboard.press("Escape");

const card = (await site.locator("[data-testid=stat-cycle]").boundingBox())!;
await site.keyboard.press("c");
await site.mouse.move(card.x + 30, card.y + 20, { steps: 3 });
await site.waitForTimeout(100);
await site.mouse.click(card.x + 30, card.y + 20);
assert(!(await shadow("input[placeholder='Your name']").isVisible()), "members aren't asked for a name");
await shadow("textarea[placeholder='Add a comment']").fill("Cycle time went up — can we add a tooltip?");
await site.keyboard.press("Enter");
await shadow("text=Comment added").waitFor();
await site.waitForTimeout(1700);

// ---------------------------------------------------------------------------
console.log("widget: verified mode");

await dashboardApi("PATCH", `/projects/${project!.id}`, { commentMode: "verified" });
const userToken = await new SignJWT({ name: "Vera Verified" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("customer-user-7")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(project!.identitySecret!));

const verified = await context.newPage();
const vShadow = (selector: string) => verified.locator(`[data-web-annotator] >> ${selector}`);
await verified.addInitScript(
  ([key, token]) => {
    (window as unknown as { WebAnnotatorConfig: object }).WebAnnotatorConfig = { projectKey: key, userToken: token };
  },
  [project!.publicKey, userToken] as const,
);
await verified.goto(`${BASE}/`);
await verified.waitForFunction(() => !!window.WebAnnotator);
await vShadow("button[aria-label='All comments on this page']").click();
await vShadow("text=Signed in as Vera Verified").waitFor();
assert(true, "customer-signed token identifies the visitor");
await verified.keyboard.press("Escape");
const table = (await verified.locator("table").boundingBox())!;
await verified.keyboard.press("c");
await verified.mouse.move(table.x + 40, table.y + 20, { steps: 3 });
await verified.waitForTimeout(100);
await verified.mouse.click(table.x + 40, table.y + 20);
await vShadow("textarea[placeholder='Add a comment']").fill("Can we sort this table by amount?");
await verified.keyboard.press("Enter");
await vShadow("text=Comment added").waitFor();
assert(true, "verified user posted a comment");
await verified.close();

// ---------------------------------------------------------------------------
console.log("dashboard inbox");

await dash.goto(`${BASE}/app/#/p/${project!.id}/inbox`);
await dash.getByText("Can we sort this table by amount?").waitFor();
assert(await dash.getByText("Make this button use the brand colour.").isVisible(), "inbox lists guest comments");
assert(await dash.getByText("Cycle time went up").isVisible(), "inbox lists member comments");
await dash.locator("form").filter({ hasText: "Reply" }).first().getByPlaceholder("Reply…").fill("Thanks, on it!");
await dash.getByRole("button", { name: "Reply", exact: true }).first().click();
await dash.getByText("Thanks, on it!").waitFor();
assert(true, "replied from the dashboard");
const inbox = await dashboardApi<ThreadDTO[]>("GET", `/projects/${project!.id}/threads`);
const brand = inbox.find((t) => t.comments[0]?.body.startsWith("Make this button"));
assert(brand?.context?.html.startsWith(`<${brand.anchor.tagName}`), "threads carry the element's HTML for coding agents");
assert(await dash.getByRole("button", { name: "Copy for agent" }).first().isVisible(), "threads can be copied as an agent prompt");
await dash.locator("summary", { hasText: "Element" }).first().click();
await dashShot("08-dashboard-inbox");

await dash.goto(`${BASE}/app/`);
await dash.getByText("Acme Dashboard").waitFor();
await dash.waitForTimeout(200);
await dashShot("09-dashboard-projects");

await browser.close();
console.log(`screenshots saved to ${OUT}/`);
