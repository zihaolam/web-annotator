import { expect, test } from "bun:test";
import type { ThreadDTO } from "../src/shared/api";
import { singleThreadPrompt, threadsToPrompt } from "../src/shared/prompt";

const author = { type: "guest" as const, id: "guest:1", name: "Alice", avatarUrl: null };

const thread: ThreadDTO = {
  id: "t1",
  projectId: "p1",
  pageUrl: "https://app.example.com/settings?tab=billing",
  pageTitle: "Settings",
  anchor: {
    selector: "#save-button",
    domPath: "body > main > button:nth-child(2)",
    tagName: "button",
    textSnippet: "Save",
    offsetX: 0.5,
    offsetY: 0.5,
    viewportWidth: 1280,
  },
  context: {
    html: '<button id="save-button" class="btn">Save</button>',
    ancestors: ['<main class="settings">'],
    components: ["SaveButton", "SettingsForm"],
    source: { file: "src/components/SaveButton.tsx", line: 12, column: 5 },
    rect: { width: 96, height: 32 },
    styles: { "background-color": "rgb(37, 99, 235)" },
    viewport: { width: 1280, height: 800, dpr: 2 },
    userAgent: "Mozilla/5.0 (test)",
  },
  status: "open",
  author,
  resolvedAt: null,
  createdAt: Date.UTC(2026, 9, 5, 10, 0),
  updatedAt: Date.UTC(2026, 9, 5, 10, 0),
  comments: [
    { id: "c1", threadId: "t1", body: "Make this green\nand bigger", author, createdAt: Date.UTC(2026, 9, 5, 10, 0), updatedAt: 0 },
  ],
};

test("a thread renders everything an agent needs to find and fix the element", () => {
  const md = singleThreadPrompt(thread);
  expect(md).toContain("## `<button>` on /settings?tab=billing");
  expect(md).toContain("- **Component:** `SaveButton` ← `SettingsForm`");
  expect(md).toContain("- **Source:** `src/components/SaveButton.tsx:12:5`");
  expect(md).toContain("- **Selector:** `#save-button`");
  expect(md).toContain("> Make this green\n> and bigger");
  expect(md).toContain('```html\n<button id="save-button" class="btn">Save</button>\n```');
  expect(md).toContain("background-color: rgb(37, 99, 235);");
  expect(md).toContain("96×32px in a 1280×800 viewport (@2x)");
});

test("threads without captured context still render their locator", () => {
  const md = singleThreadPrompt({ ...thread, context: null });
  expect(md).toContain("- **Selector:** `#save-button`");
  expect(md).toContain("- **Viewport width:** 1280px");
  expect(md).not.toContain("Component");
  expect(md).not.toContain("```html");
});

test("several threads are numbered under one set of instructions", () => {
  const md = threadsToPrompt([thread, { ...thread, id: "t2" }], "Marketing site");
  expect(md).toStartWith("# UI feedback for Marketing site (2 items)");
  expect(md).toContain("## 1. `<button>`");
  expect(md).toContain("## 2. `<button>`");
  expect(md.match(/These are UI feedback comments/g)).toHaveLength(1);
});
