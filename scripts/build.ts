/**
 * Builds everything served from `dist/public`:
 *
 *  - `script.js`: the embeddable widget, one self-contained IIFE. Tailwind is
 *    compiled, patched to work inside a shadow root (see `shadowSafe`) and
 *    inlined as a string.
 *  - `app/`: the dashboard (Preact + Tailwind) and `widget-auth.html`, the
 *    member sign-in popup.
 *  - the demo page.
 *
 * Usage: bun scripts/build.ts [--watch]
 */
import { $ } from "bun";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { shadowSafe } from "./build-lib";

const root = path.resolve(import.meta.dir, "..");
const outDir = path.join(root, "dist/public");
const cssOut = path.join(root, "dist/build/widget.css");
const pkg = (await Bun.file(path.join(root, "package.json")).json()) as { version?: string };

const minify = process.env.NODE_ENV !== "development";

const buildDashboard = async () => {
  const appDir = path.join(outDir, "app");
  await mkdir(appDir, { recursive: true });
  await $`bunx @tailwindcss/cli -i ${path.join(root, "src/dashboard/styles.css")} -o ${path.join(appDir, "app.css")} ${minify ? "--minify" : ""}`.quiet();
  const result = await Bun.build({
    entrypoints: [path.join(root, "src/dashboard/main.tsx"), path.join(root, "src/dashboard/widget-auth.tsx")],
    outdir: appDir,
    naming: "[name].js",
    target: "browser",
    format: "esm",
    splitting: true,
    minify,
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("dashboard build failed");
  }
  await cp(path.join(root, "src/dashboard/index.html"), path.join(appDir, "index.html"));
  await cp(path.join(root, "src/dashboard/widget-auth.html"), path.join(outDir, "widget-auth.html"));
};

const build = async () => {
  const started = performance.now();
  await mkdir(path.dirname(cssOut), { recursive: true });
  await $`bunx @tailwindcss/cli -i ${path.join(root, "src/widget/styles.css")} -o ${cssOut} --minify`.quiet();
  await writeFile(cssOut, shadowSafe(await Bun.file(cssOut).text()));

  const result = await Bun.build({
    entrypoints: [path.join(root, "src/widget/index.tsx")],
    outdir: outDir,
    naming: "script.js",
    target: "browser",
    format: "iife",
    minify,
    sourcemap: "linked",
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "process.env.WEB_ANNOTATOR_VERSION": JSON.stringify(pkg.version ?? "0.0.0"),
    },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("widget build failed");
  }

  await buildDashboard();
  await cp(path.join(root, "demo"), outDir, { recursive: true });
  const size = (Bun.file(path.join(outDir, "script.js")).size / 1024).toFixed(1);
  console.log(`built dist/public (script.js ${size} KiB, dashboard) in ${(performance.now() - started).toFixed(0)}ms`);
};

await build();

if (process.argv.includes("--watch")) {
  let timer: Timer | undefined;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((err) => console.error(err)), 50);
  };
  watch(path.join(root, "src/widget"), { recursive: true }, rebuild);
  watch(path.join(root, "src/shared"), { recursive: true }, rebuild);
  watch(path.join(root, "src/dashboard"), { recursive: true }, rebuild);
  watch(path.join(root, "demo"), { recursive: true }, rebuild);
  console.log("watching src/widget, src/dashboard, src/shared and demo for changes…");
}
