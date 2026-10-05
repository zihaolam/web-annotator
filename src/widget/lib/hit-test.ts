/** Attribute that makes an element (and its subtree) invisible to the picker. */
export const IGNORE_ATTRIBUTE = "data-annotator-ignore";

let hostElement: Element | null = null;
export const setHostElement = (el: Element) => {
  hostElement = el;
};

const isVisible = (el: Element): boolean => {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
};

/** Full-viewport transparent layers (modal backdrops, dev overlays) are never useful targets. */
const isTransparentOverlay = (el: Element): boolean => {
  const rect = el.getBoundingClientRect();
  if (rect.width < innerWidth * 0.95 || rect.height < innerHeight * 0.95) return false;
  const style = getComputedStyle(el);
  if (style.position !== "fixed" && style.position !== "absolute") return false;
  const bg = style.backgroundColor;
  return (bg === "transparent" || bg.endsWith(", 0)")) && el.children.length === 0;
};

export const isAnnotatable = (el: Element): boolean => {
  if (el === document.documentElement || el === document.body) return false;
  if (hostElement && (el === hostElement || hostElement.contains(el))) return false;
  if (el.closest(`[${IGNORE_ATTRIBUTE}]`)) return false;
  return isVisible(el) && !isTransparentOverlay(el);
};

/** Topmost annotatable element under a viewport point, skipping the widget itself. */
export const getElementAtPoint = (x: number, y: number): Element | null => {
  for (const el of document.elementsFromPoint(x, y)) {
    if (isAnnotatable(el)) return el;
  }
  return null;
};

/** All annotatable elements stacked under a point, topmost first (used for parent traversal). */
export const getElementStackAtPoint = (x: number, y: number): Element[] =>
  document.elementsFromPoint(x, y).filter(isAnnotatable);

export const findScrollableAncestor = (el: Element | null, dx: number, dy: number): Element | null => {
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    const canY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const canX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (dy !== 0 && canY) {
      const atEdge = dy < 0 ? node.scrollTop <= 0 : node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      if (!atEdge) return node;
    }
    if (dx !== 0 && canX) {
      const atEdge = dx < 0 ? node.scrollLeft <= 0 : node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
      if (!atEdge) return node;
    }
  }
  return null;
};

export const describeElement = (el: Element): { tag: string; detail: string } => {
  const tag = el.tagName.toLowerCase();
  if (el.id) return { tag, detail: `#${el.id}` };
  const cls = [...el.classList].find((c) => /^[a-zA-Z][\w-]{2,}$/.test(c) && !/\d{3,}/.test(c));
  return { tag, detail: cls ? `.${cls}` : "" };
};

export const getBorderRadius = (el: Element, w: number, h: number): number => {
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return Math.min(r, w / 2, h / 2);
};
