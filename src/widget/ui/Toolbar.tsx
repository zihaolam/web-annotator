import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { safeGet, safeSet } from "../lib/identity";
import {
  getConfig,
  notice,
  listOpen,
  loadState,
  openCount,
  picking,
  pinsVisible,
  toggleList,
  togglePicking,
  togglePins,
} from "../store";
import { IconChevron, IconComment, IconEye, IconEyeOff, IconList } from "./icons";
import { IconButton, cx } from "./primitives";

type Edge = "top" | "bottom" | "left" | "right";
interface ToolbarState {
  edge: Edge;
  ratio: number;
  collapsed: boolean;
}

const STORAGE_KEY = "web-annotator:toolbar";
const SNAP_MARGIN = 16;
const DRAG_START_PX = 5;
const VELOCITY_PROJECTION_MS = 150;

const loadState_ = (): ToolbarState => {
  try {
    const parsed = JSON.parse(safeGet(STORAGE_KEY) ?? "") as ToolbarState;
    if (["top", "bottom", "left", "right"].includes(parsed.edge) && typeof parsed.ratio === "number") return parsed;
  } catch {
    /* default */
  }
  return { edge: "bottom", ratio: 0.5, collapsed: false };
};

/** Toolbar's viewport rect, so the thread list can attach to it. */
export const toolbarRect = signal<DOMRect | null>(null);
export const toolbarEdge = signal<Edge>("bottom");

const positionFor = (state: ToolbarState, w: number, h: number) => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const m = state.collapsed ? 0 : SNAP_MARGIN;
  const along = (len: number, size: number) => Math.min(Math.max(state.ratio * len - size / 2, SNAP_MARGIN), len - size - SNAP_MARGIN);
  switch (state.edge) {
    case "top":
      return { x: along(vw, w), y: m };
    case "bottom":
      return { x: along(vw, w), y: vh - h - m };
    case "left":
      return { x: m, y: along(vh, h) };
    case "right":
      return { x: vw - w - m, y: along(vh, h) };
  }
};

/** Nearest edge to a projected toolbar centre, plus the ratio along that edge. */
const snap = (cx: number, cy: number): Pick<ToolbarState, "edge" | "ratio"> => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const distances: Array<[Edge, number]> = [
    ["top", cy],
    ["bottom", vh - cy],
    ["left", cx],
    ["right", vw - cx],
  ];
  const [edge] = distances.sort((a, b) => a[1] - b[1])[0]!;
  const ratio = edge === "top" || edge === "bottom" ? cx / vw : cy / vh;
  return { edge, ratio: Math.min(Math.max(ratio, 0), 1) };
};

/** Transient message above (or beside) the toolbar: sign-in prompts, errors. */
export const Notice = () => {
  const n = notice.value;
  const tb = toolbarRect.value;
  if (!n || !tb) return null;
  const edge = toolbarEdge.value;
  const pos =
    edge === "top"
      ? { left: tb.left + tb.width / 2, top: tb.bottom + 10, transform: "translateX(-50%)" }
      : edge === "bottom"
        ? { left: tb.left + tb.width / 2, top: tb.top - 10, transform: "translate(-50%, -100%)" }
        : edge === "left"
          ? { left: tb.right + 10, top: tb.top + tb.height / 2, transform: "translateY(-50%)" }
          : { left: tb.left - 10, top: tb.top + tb.height / 2, transform: "translate(-100%, -50%)" };
  const style = { left: `${pos.left}px`, top: `${pos.top}px`, transform: pos.transform };
  return (
    <div class="pointer-events-none fixed z-50" style={style}>
      <div
        role={n.tone === "error" ? "alert" : "status"}
        class={cx(
          "max-w-[320px] animate-fade-in rounded-full bg-panel px-3 py-1.5 font-sans text-[12px] leading-4 font-medium shadow-panel",
          n.tone === "error" ? "text-danger" : "text-fg",
        )}
      >
        {n.text}
      </div>
    </div>
  );
};

export const Toolbar = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ToolbarState>(loadState_);
  const [dragging, setDragging] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [hover, setHover] = useState(false);
  const [mounted, setMounted] = useState(false);
  const vertical = state.edge === "left" || state.edge === "right";
  const hotkey = getConfig().hotkey;

  useEffect(() => {
    safeSet(STORAGE_KEY, JSON.stringify(state));
    toolbarEdge.value = state.edge;
  }, [state]);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 300);
    return () => clearTimeout(t);
  }, []);

  // Place the toolbar from (edge, ratio); re-run on resize.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || dragging) return;
    const apply = () => {
      const { x, y } = positionFor(state, node.offsetWidth, node.offsetHeight);
      node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      toolbarRect.value = new DOMRect(x, y, node.offsetWidth, node.offsetHeight);
    };
    // Two frames: switching to a side edge flips orientation, so measure after layout settles.
    let f2 = 0;
    const f1 = requestAnimationFrame(() => (f2 = requestAnimationFrame(apply)));
    apply();
    window.addEventListener("resize", apply);
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
      window.removeEventListener("resize", apply);
    };
  }, [state, dragging, openCount.value]);

  // Drag with velocity projection and edge snapping (react-grab's create-toolbar-drag).
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const node = ref.current!;
    const start = { x: e.clientX, y: e.clientY };
    const rect = node.getBoundingClientRect();
    const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    let started = false;
    let last = { x: e.clientX, y: e.clientY, t: performance.now() };
    let velocity = { x: 0, y: 0 };

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_START_PX) return;
        started = true;
        setDragging(true);
        setAnimate(false);
        node.setPointerCapture(e.pointerId);
      }
      const now = performance.now();
      const dt = Math.max(1, now - last.t);
      velocity = { x: (ev.clientX - last.x) / dt, y: (ev.clientY - last.y) / dt };
      last = { x: ev.clientX, y: ev.clientY, t: now };
      node.style.transform = `translate(${ev.clientX - offset.x}px, ${ev.clientY - offset.y}px)`;
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!started) return;
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2 + velocity.x * VELOCITY_PROJECTION_MS;
      const cy = r.top + r.height / 2 + velocity.y * VELOCITY_PROJECTION_MS;
      // Swallow the click that ends a drag.
      const swallow = (ce: Event) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      node.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => node.removeEventListener("click", swallow, { capture: true }), 0);
      setAnimate(true);
      setDragging(false);
      setState((s) => ({ ...s, ...snap(cx, cy) }));
      void ev;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dimmed = picking.value && !hover && !dragging;
  const count = openCount.value;
  const collapsedEdgeRadius: Record<Edge, string> = {
    top: "rounded-t-none",
    bottom: "rounded-b-none",
    left: "rounded-l-none",
    right: "rounded-r-none",
  };

  return (
    <div
      ref={ref}
      data-annotator-toolbar
      class={cx(
        "pointer-events-auto fixed top-0 left-0 z-50 font-sans text-fg antialiased select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        animate && "transition-transform duration-300 ease-out",
      )}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onTransitionEnd={() => setAnimate(false)}
    >
      <div
        class={cx(
          "bg-panel shadow-panel transition-[opacity,transform,scale] duration-400 ease-drawer",
          mounted ? "opacity-100" : "opacity-0",
          dimmed && "scale-[0.97] opacity-55",
          state.collapsed
            ? cx("flex items-center justify-center rounded-[10px]", collapsedEdgeRadius[state.edge], vertical ? "h-[30px] w-4" : "h-4 w-[30px]")
            : cx("flex items-center gap-0.5 rounded-[14px] p-1", vertical ? "flex-col" : "flex-row"),
        )}
      >
        {state.collapsed ? (
          <button
            type="button"
            aria-label="Expand annotator toolbar"
            class="flex size-full items-center justify-center text-fg-muted hover:text-fg"
            onClick={() => setState((s) => ({ ...s, collapsed: false }))}
          >
            <IconChevron
              size={12}
              dir={{ top: "down", bottom: "up", left: "right", right: "left" }[state.edge] as "up"}
            />
          </button>
        ) : (
          <>
            <IconButton
              label={picking.value ? `Stop commenting (Esc)` : `Comment${hotkey ? ` (${hotkey.toUpperCase()})` : ""}`}
              active={picking.value}
              class={cx("size-7", picking.value && "!bg-accent text-white")}
              onClick={togglePicking}
            >
              <IconComment size={15} />
            </IconButton>
            <IconButton label="All comments on this page" active={listOpen.value} class="size-7" onClick={toggleList}>
              <IconList size={15} />
              {count > 0 && (
                <span class="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] leading-none font-semibold text-white tabular-nums">
                  {count > 99 ? "99+" : count}
                </span>
              )}
              {loadState.value === "error" && (
                <span class="absolute top-0 right-0 size-1.5 rounded-full bg-danger" />
              )}
            </IconButton>
            <IconButton label={pinsVisible.value ? "Hide pins" : "Show pins"} class="size-7" onClick={togglePins}>
              {pinsVisible.value ? <IconEye size={15} /> : <IconEyeOff size={15} />}
            </IconButton>
            <span class={cx("bg-line", vertical ? "my-0.5 h-px w-4" : "mx-0.5 h-4 w-px")} />
            <IconButton
              label="Collapse toolbar"
              class={cx("text-fg-muted", vertical ? "h-5 w-7" : "h-7 w-5")}
              onClick={() => setState((s) => ({ ...s, collapsed: true }))}
            >
              <IconChevron size={12} dir={{ top: "up", bottom: "down", left: "left", right: "right" }[state.edge] as "up"} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
};
