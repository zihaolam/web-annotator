/**
 * End-to-end smoke test: drives the demo page in Chromium against a running
 * `wrangler dev` (default http://127.0.0.1:8787) and saves screenshots. Needs
 * ADMIN_TOKEN to match .dev.vars (defaults to "dev-admin") to create a scratch project.
 *
 *   bun run dev            # in one terminal
 *   bun e2e/smoke.ts       # in another
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const OUT = process.env.SCREENSHOT_DIR ?? "e2e/screenshots";
const executablePath = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find(
  (p) => p && existsSync(p),
);

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

// Each run gets a fresh project so the test is repeatable.
const projectId = `e2e-${Date.now().toString(36)}`;
const created = await fetch(`${BASE}/api/projects`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ADMIN_TOKEN ?? "dev-admin"}` },
  body: JSON.stringify({ id: projectId, name: "E2E" }),
});
if (!created.ok) throw new Error(`could not create project: ${created.status} ${await created.text()}`);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath, channel: executablePath ? undefined : "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await page.addInitScript((id) => {
  (window as unknown as { WebAnnotatorConfig: object }).WebAnnotatorConfig = { projectId: id };
}, projectId);
page.on("pageerror", (err) => console.error("pageerror:", err));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));

const shot = (name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const shadow = (selector: string) => page.locator(`[data-web-annotator] >> ${selector}`);

await page.goto(`${BASE}/`);
await page.waitForFunction(() => !!window.WebAnnotator);
assert(await shadow("[data-annotator-toolbar]").isVisible(), "toolbar mounted in shadow root");
await page.waitForTimeout(600);
await shot("01-idle");

// Enter comment mode with the hotkey and hover an element.
await page.keyboard.press("c");
const button = page.locator("#new-claim");
const box = (await button.boundingBox())!;
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
await page.waitForTimeout(150);
assert(await shadow("text=Click to comment").isVisible(), "hover label shows while picking");
await shot("02-hover");

// Arrow up walks to the parent.
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(100);
await shot("03-arrow-parent");
await page.keyboard.press("ArrowDown");

// Clicking must not trigger the page's own click handler.
let alerted = false;
page.on("dialog", (d) => {
  alerted = true;
  void d.dismiss();
});
await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
await page.waitForTimeout(100);
assert(!alerted, "page click handler is blocked while picking");
const nameField = shadow("input[placeholder='Your name']");
assert(await nameField.isVisible(), "first comment asks for a name");
await nameField.fill("Zi Hao");
await shadow("textarea[placeholder='Add a comment']").fill("Make this button use the brand colour.");
await shot("04-compose");

// Escape with a draft asks to discard; "No" goes back.
await page.keyboard.press("Escape");
assert(await shadow("text=Discard comment?").isVisible(), "escape with a draft asks to discard");
await shot("05-discard");
await shadow("button:has-text('No')").click();

await shadow("textarea[placeholder='Add a comment']").press("Enter");
await shadow("text=Comment added").waitFor();
await shot("06-done");
await page.waitForTimeout(1800);
assert(!(await page.evaluate(() => !!document.getElementById("web-annotator-cursor"))), "comment mode exits after posting");

// Second comment on a stat card via Cmd-click keeps comment mode on.
await page.keyboard.press("c");
const card = (await page.locator("[data-testid=stat-cycle]").boundingBox())!;
await page.mouse.move(card.x + 30, card.y + 20);
await page.waitForTimeout(80);
await page.keyboard.down("Control");
await page.mouse.click(card.x + 30, card.y + 20);
await page.keyboard.up("Control");
await shadow("textarea[placeholder='Add a comment']").fill("Cycle time went up — can we add a tooltip explaining why?");
await page.keyboard.press("Enter");
await shadow("text=Comment added").waitFor();
await page.waitForTimeout(1700);
await page.keyboard.press("Escape");

// Reload: threads come back from D1 and pins re-anchor.
await page.reload();
await page.waitForFunction(() => !!window.WebAnnotator);
await shadow("button[aria-label^='Comment 1 by']").waitFor();
assert((await shadow("button[aria-label^='Comment ']").count()) >= 2, "pins restored after reload");
await shadow("button[aria-label^='Comment 1 by']").hover();
await page.waitForTimeout(200);
await shot("07-pins-hover");

// Open a thread, reply, resolve.
await shadow("button[aria-label^='Comment 1 by']").click();
await shadow("textarea[placeholder='Reply']").fill("Agreed, I'll pick this up.");
await page.keyboard.press("Enter");
await shadow("text=I'll pick this up").waitFor();
await shot("08-thread");
await shadow("button[aria-label='Resolve']").click();
await shadow("text=Resolved").waitFor();
assert(true, "thread resolved");
await page.keyboard.press("Escape");

// Comment list.
await shadow("button[aria-label='All comments on this page']").click();
await page.waitForTimeout(200);
await shot("09-list-open");
await shadow("button:has-text('resolved')").click();
await page.waitForTimeout(150);
await shot("10-list-resolved");

// Dark app => light panels.
await page.keyboard.press("Escape");
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
  document.body.style.background = "#0c0a09";
  document.body.style.color = "#fafaf9";
});
await page.waitForTimeout(100);
assert(
  (await page.locator("[data-web-annotator]").getAttribute("data-wa-theme")) === "light",
  "panel theme inverts on dark apps",
);
await page.keyboard.press("c");
await page.mouse.move(box.x + 20, box.y + 10, { steps: 3 });
await page.waitForTimeout(150);
assert(await shadow("text=Click to comment").isVisible(), "hover label shows on dark app");
await shot("11-dark-app");

await browser.close();
console.log(`screenshots saved to ${OUT}/`);
