export const VIEWPORT_MARGIN = 8;
export const LABEL_GAP = 4;
export const ARROW_H = 6;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Arrow tip x, relative to the label's left edge. */
  arrowX: number;
  side: "below" | "above" | "inside";
  hidden: boolean;
}

/**
 * react-grab's label placement: horizontally centred on the cursor x (not the
 * element centre), below the element, flipping above when there is no room,
 * clamped to the viewport.
 */
export const placeLabel = (target: Rect, anchorX: number, w: number, h: number): Placement => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const bottom = target.top + target.height;
  const hidden = bottom < 0 || target.top > vh || target.left + target.width < 0 || target.left > vw;

  const x = Math.min(Math.max(anchorX, target.left), target.left + target.width);
  const left = Math.min(Math.max(x - w / 2, VIEWPORT_MARGIN), vw - w - VIEWPORT_MARGIN);
  const arrowX = Math.min(Math.max(x - left, 14), w - 14);

  let top = bottom + ARROW_H + LABEL_GAP;
  let side: Placement["side"] = "below";
  if (top + h > vh - VIEWPORT_MARGIN) {
    const above = target.top - h - ARROW_H - LABEL_GAP;
    if (above >= VIEWPORT_MARGIN) {
      top = above;
      side = "above";
    } else {
      top = Math.min(Math.max(top, VIEWPORT_MARGIN), vh - h - VIEWPORT_MARGIN);
      side = "inside";
    }
  }
  return { left, top, arrowX, side, hidden };
};

export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export const inViewport = (r: Rect) =>
  r.top + r.height > 0 && r.left + r.width > 0 && r.top < innerHeight && r.left < innerWidth;

export const relativeTime = (ms: number): string => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
