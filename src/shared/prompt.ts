import type { ThreadDTO } from "./api";

/**
 * Renders annotations as Markdown a coding agent can act on directly: what was
 * asked, where the element lives (component, source file, selector, HTML) and
 * how it rendered. Used by the dashboard's and the widget's "Copy for agent".
 */

const INSTRUCTIONS =
  "These are UI feedback comments left on specific elements of a website. For each one, find the element in the codebase " +
  "(start from the component and source file when given, otherwise search for its classes, attributes or text), make the " +
  "change the comments ask for, and keep the fix scoped to that element.";

const fence = (lang: string, body: string) => {
  const ticks = body.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${body}\n${ticks}`;
};

const quote = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

const pagePath = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
};

export const threadToPrompt = (thread: ThreadDTO, number?: number): string => {
  const { anchor, context } = thread;
  const out: string[] = [`## ${number ? `${number}. ` : ""}\`<${anchor.tagName}>\` on ${pagePath(thread.pageUrl)}`, ""];

  out.push(`- **Page:** ${thread.pageUrl}${thread.pageTitle ? ` (“${thread.pageTitle}”)` : ""}`);
  out.push(`- **Status:** ${thread.status}`);
  if (context?.components.length) out.push(`- **Component:** ${context.components.map((c) => `\`${c}\``).join(" ← ")}`);
  if (context?.source) {
    const { file, line, column } = context.source;
    out.push(`- **Source:** \`${file}${line != null ? `:${line}` : ""}${line != null && column != null ? `:${column}` : ""}\``);
  }
  out.push(`- **Selector:** \`${anchor.selector}\``);
  if (anchor.domPath !== anchor.selector) out.push(`- **DOM path:** \`${anchor.domPath}\``);
  if (anchor.textSnippet) out.push(`- **Text:** “${anchor.textSnippet}”`);
  if (context) {
    const { rect, viewport } = context;
    out.push(`- **Rendered:** ${rect.width}×${rect.height}px in a ${viewport.width}×${viewport.height} viewport (@${viewport.dpr}x)`);
  } else if (anchor.viewportWidth) {
    out.push(`- **Viewport width:** ${anchor.viewportWidth}px`);
  }

  out.push("", "**Feedback:**", "");
  for (const c of thread.comments) {
    out.push(`**${c.author.name}** · ${new Date(c.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC`, quote(c.body), "");
  }

  if (context?.html) out.push("**Element HTML:**", "", fence("html", context.html), "");
  if (context?.ancestors.length) {
    out.push("**Inside:**", "", fence("html", context.ancestors.map((a, i) => `${"  ".repeat(i)}${a}`).join("\n")), "");
  }
  const styles = context ? Object.entries(context.styles) : [];
  if (styles.length) out.push("**Computed styles:**", "", fence("css", styles.map(([k, v]) => `${k}: ${v};`).join("\n")), "");
  if (context?.userAgent) out.push(`<sub>User agent: ${context.userAgent}</sub>`, "");

  return out.join("\n").trimEnd();
};

export const threadsToPrompt = (threads: ThreadDTO[], projectName?: string): string => {
  const title = `# UI feedback${projectName ? ` for ${projectName}` : ""} (${threads.length} ${threads.length === 1 ? "item" : "items"})`;
  return [title, INSTRUCTIONS, ...threads.map((t, i) => threadToPrompt(t, i + 1))].join("\n\n");
};

/** A single thread, with the instructions so it can be pasted on its own. */
export const singleThreadPrompt = (thread: ThreadDTO): string =>
  ["# UI feedback", INSTRUCTIONS, threadToPrompt(thread)].join("\n\n");
