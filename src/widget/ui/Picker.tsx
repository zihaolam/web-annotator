import { useEffect, useRef } from "preact/hooks";
import { createAnchor } from "../lib/selector";
import { describeElement, findScrollableAncestor, getElementAtPoint, isAnnotatable } from "../lib/hit-test";
import { rectOf } from "../lib/geometry";
import {
  hovered,
  keyboardLocked,
  layoutTick,
  pointer,
  requestCancelSelection,
  selectElement,
  selection,
} from "../store";
import { Anchored, Kbd, TagBadge } from "./primitives";

const DETECTION_THROTTLE_MS = 32;
const DRAG_THRESHOLD_PX = 2;
const KEYBOARD_UNLOCK_PX = 8;

/** react-grab disables page interaction with a transparent shield while picking. */
const CURSOR_STYLE_ID = "web-annotator-cursor";

const setPageCursor = (on: boolean) => {
  const existing = document.getElementById(CURSOR_STYLE_ID);
  if (!on) return existing?.remove();
  if (existing) return;
  const style = document.createElement("style");
  style.id = CURSOR_STYLE_ID;
  style.textContent = "*{cursor:crosshair!important}";
  document.head.appendChild(style);
};

const wheelDelta = (e: WheelEvent) => {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  return { dx: e.deltaX * unit, dy: e.deltaY * unit };
};

/**
 * Transparent full-viewport layer that swallows page hover/click while
 * picking, does the hit-testing, and forwards wheel scrolling to whatever
 * scroll container is under the cursor.
 */
export const Shield = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current!;
    let lastDetect = 0;
    let pending = 0;
    let down: { x: number; y: number } | null = null;
    let keyboardOrigin: { x: number; y: number } | null = null;

    const detect = (x: number, y: number) => {
      lastDetect = performance.now();
      if (selection.value) return;
      const el = getElementAtPoint(x, y);
      if (el !== hovered.value) hovered.value = el;
    };

    const onMove = (e: PointerEvent) => {
      pointer.value = { x: e.clientX, y: e.clientY };
      if (keyboardLocked.value) {
        keyboardOrigin ??= { x: e.clientX, y: e.clientY };
        if (Math.hypot(e.clientX - keyboardOrigin.x, e.clientY - keyboardOrigin.y) < KEYBOARD_UNLOCK_PX) return;
        keyboardLocked.value = false;
        keyboardOrigin = null;
      }
      const wait = DETECTION_THROTTLE_MS - (performance.now() - lastDetect);
      clearTimeout(pending);
      if (wait <= 0) detect(e.clientX, e.clientY);
      else pending = window.setTimeout(() => detect(e.clientX, e.clientY), wait);
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY };
    };

    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > DRAG_THRESHOLD_PX) return;

      const sel = selection.value;
      if (sel) {
        // Clicking the selected element keeps composing; clicking elsewhere starts a cancel.
        const r = sel.el.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) requestCancelSelection();
        return;
      }
      const el = keyboardLocked.value && hovered.value ? hovered.value : getElementAtPoint(e.clientX, e.clientY);
      if (!el) return;
      selectElement(el, createAnchor(el, e.clientX, e.clientY), e.metaKey || e.ctrlKey);
    };

    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { dx, dy } = wheelDelta(e);
      const under = getElementAtPoint(e.clientX, e.clientY);
      const scroller = findScrollableAncestor(under, dx, dy);
      if (scroller) scroller.scrollBy({ left: dx, top: dy, behavior: "instant" });
      else window.scrollBy({ left: dx, top: dy, behavior: "instant" });
      if (!selection.value) detect(e.clientX, e.clientY);
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerdown", onDown);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("click", swallow);
    node.addEventListener("contextmenu", swallow);
    node.addEventListener("wheel", onWheel, { passive: false });
    setPageCursor(true);
    if (pointer.value.x >= 0) detect(pointer.value.x, pointer.value.y);

    return () => {
      clearTimeout(pending);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("click", swallow);
      node.removeEventListener("contextmenu", swallow);
      node.removeEventListener("wheel", onWheel);
      setPageCursor(false);
    };
  }, []);

  return <div ref={ref} class="pointer-events-auto fixed inset-0 z-20 cursor-crosshair" data-annotator-shield />;
};

/** The pill under the hovered element: `tag.class` plus a hint, like react-grab's tag badge. */
export const HoverLabel = () => {
  void layoutTick.value;
  const el = hovered.value;
  if (!el || selection.value || !el.isConnected) return null;
  const rect = rectOf(el);
  const { tag, detail } = describeElement(el);
  const anchorX = keyboardLocked.value ? rect.left + rect.width / 2 : pointer.value.x;
  return (
    <Anchored target={rect} anchorX={anchorX}>
      <div class="flex items-center gap-2 rounded-full bg-panel px-2 py-1.5 whitespace-nowrap">
        <TagBadge tag={tag} detail={detail} />
        <Kbd>Click to comment</Kbd>
      </div>
    </Anchored>
  );
};

// ---------------------------------------------------------------------------
// Arrow-key traversal (react-grab: ↑ parent, ↓ back to child, ←/→ siblings)

const history: Element[] = [];

const nextAnnotatable = (el: Element, dir: "prev" | "next"): Element | null => {
  for (
    let sib = dir === "next" ? el.nextElementSibling : el.previousElementSibling;
    sib;
    sib = dir === "next" ? sib.nextElementSibling : sib.previousElementSibling
  ) {
    const r = sib.getBoundingClientRect();
    if (r.width >= 16 && r.height >= 16 && isAnnotatable(sib)) return sib;
  }
  return null;
};

export const navigate = (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): boolean => {
  const current = hovered.value;
  if (!current || selection.value) return false;
  let next: Element | null = null;
  if (key === "ArrowUp") {
    for (let p = current.parentElement; p; p = p.parentElement) {
      if (!isAnnotatable(p)) continue;
      const a = p.getBoundingClientRect();
      const b = current.getBoundingClientRect();
      // Skip wrappers that are pixel-identical to the child; they look like no-ops.
      if (a.width === b.width && a.height === b.height && a.top === b.top && a.left === b.left) continue;
      next = p;
      break;
    }
    if (next) history.push(current);
    if (history.length > 50) history.shift();
  } else if (key === "ArrowDown") {
    next = history.pop() ?? null;
    if (!next || !next.isConnected || !current.contains(next)) {
      history.length = 0;
      next = [...current.children].find((c) => isAnnotatable(c)) ?? null;
    }
  } else {
    history.length = 0;
    next = nextAnnotatable(current, key === "ArrowRight" ? "next" : "prev");
  }
  if (!next) return false;
  hovered.value = next;
  keyboardLocked.value = true;
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
};

/** Enter while an element is keyboard-selected opens the composer at its centre. */
export const selectHovered = (stayActive: boolean) => {
  const el = hovered.value;
  if (!el || selection.value) return;
  const r = el.getBoundingClientRect();
  selectElement(el, createAnchor(el, r.left + r.width / 2, r.top + r.height / 2), stayActive);
};
