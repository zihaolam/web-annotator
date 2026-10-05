import type { ThreadDTO } from "../../shared/api";
import { inViewport, rectOf, relativeTime } from "../lib/geometry";
import {
  activeThreadId,
  highlightThreadId,
  layoutTick,
  listFilter,
  listOpen,
  openThread,
  orderedThreads,
  picking,
  pinNumbers,
  pinsVisible,
  resolved,
} from "../store";
import { Avatar, cx } from "./primitives";

export const PIN_SIZE = 24;

/** Viewport point a thread's pin points at, or null when its element is gone. */
export const pinPoint = (thread: ThreadDTO): { x: number; y: number; visible: boolean } | null => {
  const el = resolved.value.get(thread.id);
  if (!el || !el.isConnected) return null;
  const r = rectOf(el);
  return {
    x: r.left + r.width * thread.anchor.offsetX,
    y: r.top + r.height * thread.anchor.offsetY,
    visible: inViewport(r),
  };
};

const STACK_OFFSET = 18;

const Pin = ({ thread, number, point }: { thread: ThreadDTO; number: number; point: { x: number; y: number } }) => {
  const active = activeThreadId.value === thread.id;
  const highlighted = highlightThreadId.value === thread.id;
  const resolvedThread = thread.status === "resolved";
  const first = thread.comments[0];
  const replies = thread.comments.length - 1;

  return (
    <div
      class="group absolute top-0 left-0"
      style={{ transform: `translate(${Math.round(point.x)}px, ${Math.round(point.y - PIN_SIZE)}px)` }}
    >
      <button
        type="button"
        aria-label={`Comment ${number} by ${thread.author.name}`}
        class={cx(
          "press pointer-events-auto flex size-6 animate-pop items-center justify-center rounded-full rounded-bl-none text-[11px] font-semibold tabular-nums shadow-panel",
          "ring-2 ring-white/90 transition-transform hover:scale-110",
          resolvedThread ? "bg-panel text-fg-muted" : "bg-accent text-white",
          (active || highlighted) && "scale-110",
        )}
        onClick={(e) => {
          e.stopPropagation();
          openThread(active ? null : thread.id);
        }}
        onPointerEnter={() => (highlightThreadId.value = thread.id)}
        onPointerLeave={() => highlightThreadId.value === thread.id && (highlightThreadId.value = null)}
      >
        {number}
      </button>
      {!active && first && (
        <div class="pointer-events-none invisible absolute top-0 left-[30px] w-max max-w-[240px] rounded-xl bg-panel px-2 py-1.5 font-sans text-[12px] leading-4 text-fg opacity-0 shadow-panel transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
          <div class="flex items-center gap-1.5">
            <Avatar name={first.author.name} url={first.author.avatarUrl} size={16} />
            <span class="font-semibold">{first.author.name}</span>
            <span class="text-fg-muted">{relativeTime(first.createdAt)}</span>
          </div>
          <p class="mt-1 line-clamp-2 break-words text-fg">{first.body}</p>
          {replies > 0 && (
            <p class="mt-0.5 text-[11px] text-fg-muted">
              {replies} {replies === 1 ? "reply" : "replies"}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const Pins = () => {
  void layoutTick.value;
  if (!pinsVisible.value) return null;
  const showResolved = listOpen.value && listFilter.value === "resolved";
  const numbers = pinNumbers.value;
  // Pins landing on the same spot (several threads on one element) fan out sideways.
  const placed: Array<{ thread: ThreadDTO; point: { x: number; y: number } }> = [];
  for (const t of orderedThreads.value) {
    if (t.status !== "open" && !showResolved && t.id !== activeThreadId.value) continue;
    const p = pinPoint(t);
    if (!p || !p.visible) continue;
    const point = { x: p.x, y: p.y };
    while (placed.some((o) => Math.abs(o.point.x - point.x) < 8 && Math.abs(o.point.y - point.y) < 8)) {
      point.x += STACK_OFFSET;
    }
    placed.push({ thread: t, point });
  }
  return (
    <div class={cx("pointer-events-none fixed inset-0 font-sans", picking.value ? "z-10 opacity-60" : "z-30")}>
      {placed.map(({ thread, point }) => (
        <Pin key={thread.id} thread={thread} number={numbers.get(thread.id) ?? 0} point={point} />
      ))}
    </div>
  );
};
