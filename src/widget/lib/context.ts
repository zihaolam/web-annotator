import type { ElementContext } from "../../shared/api";

/**
 * Captures what an agent needs to locate and fix an annotated element: a trimmed
 * HTML snippet, nearby ancestors, framework component names and (in dev builds)
 * the source file, plus the computed styles that usually matter for visual feedback.
 */

const HTML_MAX = 3000;
const HTML_DEPTH = 3;
const MAX_CHILDREN = 8;
const ATTR_MAX = 100;
const TEXT_MAX = 80;
const ANCESTORS = 4;
const COMPONENTS = 8;

const STYLE_PROPS = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "flex-direction",
  "align-items",
  "justify-content",
  "color",
  "background-color",
  "border",
  "border-radius",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "opacity",
  "overflow",
  "z-index",
] as const;

/** Values that are the CSS default for most elements and only add noise. */
const STYLE_DEFAULTS = new Set(["", "none", "normal", "auto", "0px", "static", "visible", "rgba(0, 0, 0, 0)", "1", "start", "stretch", "row", "content-box"]);

/** Elements whose content is never useful in a snippet. */
const OPAQUE = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe"]);

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const escAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const isSecretInput = (el: Element) =>
  el instanceof HTMLInputElement && (el.type === "password" || el.type === "hidden" || el.autocomplete.includes("cc-"));

export const openingTag = (el: Element): string => {
  const tag = el.tagName.toLowerCase();
  const attrs = [...el.attributes]
    .filter((a) => !a.name.startsWith("on"))
    .map((a) => {
      if (a.name === "value" && isSecretInput(el)) return `${a.name}="[redacted]"`;
      return a.value === "" ? a.name : `${a.name}="${escAttr(clip(a.value, ATTR_MAX))}"`;
    });
  return `<${[tag, ...attrs].join(" ")}>`;
};

const serialize = (el: Element, depth: number, indent: string): string => {
  const tag = el.tagName.toLowerCase();
  const open = openingTag(el);
  if (el.hasAttribute("data-annotator-ignore")) return `${indent}${open}…</${tag}>`;
  if (OPAQUE.has(tag)) return `${indent}${open}…</${tag}>`;
  if (el instanceof HTMLTextAreaElement) return `${indent}${open}</${tag}>`;

  const parts: string[] = [];
  let elements = 0;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) parts.push(`${indent}  ${escText(clip(text, TEXT_MAX))}`);
    } else if (node instanceof Element) {
      if (++elements > MAX_CHILDREN) continue;
      parts.push(depth >= HTML_DEPTH ? `${indent}  ${openingTag(node)}…</${node.tagName.toLowerCase()}>` : serialize(node, depth + 1, `${indent}  `));
    }
  }
  if (elements > MAX_CHILDREN) parts.push(`${indent}  <!-- ${elements - MAX_CHILDREN} more -->`);

  const voidTag = !el.childNodes.length && /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/.test(tag);
  if (voidTag) return `${indent}${open}`;
  if (!parts.length) return `${indent}${open}</${tag}>`;
  // Keep a lone short text child on one line: `<button>Save</button>`.
  if (parts.length === 1 && !elements) return `${indent}${open}${parts[0]!.trim()}</${tag}>`;
  return [`${indent}${open}`, ...parts, `${indent}</${tag}>`].join("\n");
};

export const getHtmlSnippet = (el: Element): string => clip(serialize(el, 1, ""), HTML_MAX);

// ---------------------------------------------------------------------------
// Frameworks. All of this reads private, dev-oriented fields, so every access is
// defensive and anything missing simply yields fewer details.

type Source = ElementContext["source"];
type AnyRecord = Record<string, any>;

const ownKey = (el: Element, prefix: string): unknown => {
  for (const key of Object.keys(el)) if (key.startsWith(prefix)) return (el as unknown as AnyRecord)[key];
  return undefined;
};

const reactName = (type: any): string | null => {
  if (!type || typeof type === "string") return null;
  if (typeof type === "function") return type.displayName || type.name || null;
  // forwardRef / memo / lazy wrappers
  return type.displayName || reactName(type.render) || reactName(type.type) || null;
};

const reactDetails = (el: Element): { components: string[]; source: Source } | null => {
  let fiber = (ownKey(el, "__reactFiber$") ?? ownKey(el, "__reactInternalInstance$")) as AnyRecord | undefined;
  if (!fiber) return null;
  const components: string[] = [];
  let source: Source = null;
  for (let i = 0; fiber && i < 200 && components.length < COMPONENTS; i++, fiber = fiber.return) {
    const ds = fiber._debugSource as AnyRecord | undefined;
    if (!source && ds?.fileName) source = { file: String(ds.fileName), line: ds.lineNumber ?? null, column: ds.columnNumber ?? null };
    const name = reactName(fiber.type);
    if (name && !components.includes(name)) components.push(name);
  }
  return { components, source };
};

const vueDetails = (el: Element): { components: string[]; source: Source } | null => {
  let node: Element | null = el;
  let instance: AnyRecord | undefined;
  while (node && !(instance = (node as unknown as AnyRecord).__vueParentComponent)) node = node.parentElement;
  if (!instance) return null;
  const components: string[] = [];
  let source: Source = null;
  for (let i = 0; instance && i < 50 && components.length < COMPONENTS; i++, instance = instance.parent) {
    const type = instance.type ?? {};
    if (!source && type.__file) source = { file: String(type.__file), line: null, column: null };
    const name = type.name || type.__name || (type.__file ? String(type.__file).split("/").pop()!.replace(/\.vue$/, "") : null);
    if (name && !components.includes(name)) components.push(name);
  }
  return { components, source };
};

const svelteDetails = (el: Element): { components: string[]; source: Source } | null => {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const loc = (node as unknown as AnyRecord).__svelte_meta?.loc;
    if (loc?.file) {
      const file = String(loc.file);
      return {
        components: [file.split("/").pop()!.replace(/\.svelte$/, "")],
        source: { file, line: typeof loc.line === "number" ? loc.line + 1 : null, column: loc.column ?? null },
      };
    }
  }
  return null;
};

const frameworkDetails = (el: Element) => {
  try {
    return reactDetails(el) ?? vueDetails(el) ?? svelteDetails(el) ?? { components: [], source: null };
  } catch {
    return { components: [], source: null };
  }
};

// ---------------------------------------------------------------------------

const getStyles = (el: Element): Record<string, string> => {
  const computed = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop).trim();
    if (!STYLE_DEFAULTS.has(value) && !value.startsWith("0px none")) out[prop] = clip(value, 200);
  }
  return out;
};

const getAncestors = (el: Element): string[] => {
  const out: string[] = [];
  for (let node = el.parentElement; node && node !== document.body && out.length < ANCESTORS; node = node.parentElement) {
    out.unshift(clip(openingTag(node), 300));
  }
  return out;
};

export const captureContext = (el: Element): ElementContext => {
  const rect = el.getBoundingClientRect();
  const { components, source } = frameworkDetails(el);
  return {
    html: getHtmlSnippet(el),
    ancestors: getAncestors(el),
    components,
    source: source && { ...source, file: clip(source.file, 500) },
    rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
    styles: getStyles(el),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    userAgent: clip(navigator.userAgent, 400),
  };
};
