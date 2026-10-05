import type { Anchor } from "../../shared/api";

/**
 * Element anchoring, modelled on react-grab's `create-element-selector`:
 *  1. fast path: a unique stable `#id` or preferred attribute,
 *  2. a penalty-ranked ancestor walk producing the shortest unique selector,
 *  3. a structural `nth-child` path stored alongside as a fallback.
 */

const PREFERRED_ATTRIBUTES = [
  "data-annotate-id",
  "data-testid",
  "data-test-id",
  "data-test",
  "data-cy",
  "data-qa",
  "aria-label",
  "name",
  "href",
  "src",
  "title",
  "alt",
] as const;

const MAX_ATTR_LENGTH = 120;
const MAX_DEPTH = 12;

/** Rejects generated names such as `css-1x2y3z`, `sc-bdVaJa`, `:r1:` or Tailwind utilities. */
export const isWordLike = (value: string): boolean =>
  /^[a-zA-Z][a-zA-Z_-]{2,}$/.test(value) && !/[bcdfghjklmnpqrstvwxz]{4,}/i.test(value);

const esc = (value: string) => CSS.escape(value);

const isUnique = (selector: string, el: Element): boolean => {
  try {
    const matches = el.ownerDocument.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
};

const countMatches = (selector: string): number => {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return Infinity;
  }
};

const tagOf = (el: Element) => el.tagName.toLowerCase();

const nthOfType = (el: Element): number => {
  let n = 1;
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.tagName === el.tagName) n++;
  }
  return n;
};

const nthChild = (el: Element): number => {
  let n = 1;
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) n++;
  return n;
};

const attrSelector = (el: Element, attr: string): string | null => {
  const value = el.getAttribute(attr);
  if (!value || value.length > MAX_ATTR_LENGTH) return null;
  return `${tagOf(el)}[${attr}="${CSS.escape(value)}"]`;
};

/** Candidate segments for one element, cheapest first. */
const segmentsFor = (el: Element): string[] => {
  const tag = tagOf(el);
  const out: string[] = [];
  if (el.id && isWordLike(el.id)) out.push(`#${esc(el.id)}`);
  const classes = [...el.classList].filter(isWordLike).slice(0, 3);
  if (classes.length) {
    out.push(`${tag}.${esc(classes[0]!)}`);
    if (classes.length > 1) out.push(`${tag}.${classes.map(esc).join(".")}`);
  }
  for (const attr of PREFERRED_ATTRIBUTES) {
    const s = attrSelector(el, attr);
    if (s) out.push(s);
  }
  out.push(tag);
  out.push(`${tag}:nth-of-type(${nthOfType(el)})`);
  return out;
};

export const getDomPath = (el: Element): string => {
  const parts: string[] = [];
  for (let node: Element | null = el; node && node !== document.body && node !== document.documentElement; ) {
    parts.unshift(`${tagOf(node)}:nth-child(${nthChild(node)})`);
    node = node.parentElement;
  }
  return ["body", ...parts].join(" > ");
};

export const getUniqueSelector = (el: Element): string => {
  // 1. Fast path
  if (el.id && isWordLike(el.id) && isUnique(`#${esc(el.id)}`, el)) return `#${esc(el.id)}`;
  for (const attr of PREFERRED_ATTRIBUTES) {
    const s = attrSelector(el, attr);
    if (s && isUnique(s, el)) return s;
  }

  // 2. Greedy ancestor walk: at each level pick the segment that narrows the match the most.
  let suffix = "";
  let node: Element | null = el;
  for (let depth = 0; node && node !== document.documentElement && depth < MAX_DEPTH; depth++) {
    const candidates = segmentsFor(node).map((seg) => (suffix ? `${seg} > ${suffix}` : seg));
    const unique = candidates.find((s) => isUnique(s, el));
    if (unique) return unique;
    let best = candidates[0]!;
    let bestCount = Infinity;
    for (const c of candidates) {
      const count = countMatches(c);
      if (count > 0 && count < bestCount) {
        best = c;
        bestCount = count;
      }
    }
    suffix = best;
    node = node.parentElement;
  }

  // 3. Structural fallback
  return getDomPath(el);
};

export const getTextSnippet = (el: Element): string | null => {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
};

export const createAnchor = (el: Element, clientX: number, clientY: number): Anchor => {
  const rect = el.getBoundingClientRect();
  const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  return {
    selector: getUniqueSelector(el),
    domPath: getDomPath(el),
    tagName: tagOf(el),
    textSnippet: getTextSnippet(el),
    offsetX: clamp((clientX - rect.left) / rect.width),
    offsetY: clamp((clientY - rect.top) / rect.height),
    viewportWidth: window.innerWidth,
  };
};

const query = (selector: string): Element[] => {
  try {
    return [...document.querySelectorAll(selector)];
  } catch {
    return [];
  }
};

/** Finds the element an anchor points at, or `null` when it no longer exists on the page. */
export const resolveAnchor = (anchor: Anchor): Element | null => {
  const tagMatches = (el: Element) => tagOf(el) === anchor.tagName;

  const bySelector = query(anchor.selector).filter(tagMatches);
  if (bySelector.length === 1) return bySelector[0]!;

  const byPath = query(anchor.domPath)[0];
  if (byPath && tagMatches(byPath)) {
    if (!anchor.textSnippet || getTextSnippet(byPath) === anchor.textSnippet) return byPath;
  }

  if (anchor.textSnippet) {
    const candidates = (bySelector.length ? bySelector : query(anchor.tagName)).filter(
      (el) => getTextSnippet(el) === anchor.textSnippet,
    );
    if (candidates.length === 1) return candidates[0]!;
  }

  return byPath && tagMatches(byPath) ? byPath : null;
};
