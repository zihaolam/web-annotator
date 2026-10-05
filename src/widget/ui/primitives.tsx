import type { ButtonHTMLAttributes, ComponentChildren, Ref } from "preact";
import { forwardRef } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import { ARROW_H, placeLabel, type Rect } from "../lib/geometry";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * A panel positioned against an element the way react-grab positions its
 * selection label: below the target at the cursor x, flipping above, with an
 * arrow pointing at the anchor point.
 */
export const Anchored = ({
  target,
  anchorX,
  children,
  interactive = false,
  class: cls,
}: {
  target: Rect;
  anchorX: number;
  children: ComponentChildren;
  interactive?: boolean;
  class?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<SVGSVGElement>(null);
  // The ResizeObserver outlives renders, so read the latest props through a ref.
  const latest = useRef({ target, anchorX });
  latest.current = { target, anchorX };

  const place = () => {
    const { target, anchorX } = latest.current;
    const node = ref.current;
    const arrow = arrowRef.current;
    if (!node || !arrow) return;
    const pos = placeLabel(target, anchorX, node.offsetWidth, node.offsetHeight);
    node.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
    node.style.visibility = pos.hidden ? "hidden" : "visible";
    arrow.style.display = pos.side === "inside" ? "none" : "block";
    arrow.style.left = `${pos.arrowX - ARROW_H}px`;
    arrow.style.top = pos.side === "below" ? `${-ARROW_H + 1}px` : "";
    arrow.style.bottom = pos.side === "above" ? `${-ARROW_H + 1}px` : "";
    arrow.style.transform = pos.side === "above" ? "rotate(180deg)" : "";
  };

  useLayoutEffect(place);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const ro = new ResizeObserver(place);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      class={cx(
        "fixed left-0 top-0 z-40 font-sans text-[13px] leading-4 font-medium text-fg antialiased",
        "drop-shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
        interactive ? "pointer-events-auto" : "pointer-events-none",
        cls,
      )}
      style={{ visibility: "hidden" }}
    >
      <svg
        ref={arrowRef}
        width={ARROW_H * 2}
        height={ARROW_H}
        viewBox="0 0 12 6"
        class="absolute text-panel"
        aria-hidden="true"
      >
        <path d="M0 6 L5.2 0.6 Q6 -0.2 6.8 0.6 L12 6 Z" fill="currentColor" />
      </svg>
      {children}
    </div>
  );
};

export const TagBadge = ({ tag, detail }: { tag: string; detail: string }) => (
  <span class="flex min-w-0 max-w-[260px] items-center gap-0 truncate">
    <span class="text-fg">{tag}</span>
    {detail && <span class="truncate text-fg-muted">{detail}</span>}
  </span>
);

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "danger" | "primary" };

/** Small inline button, react-grab "chip" style. */
export const Chip = ({ tone = "default", class: cls, children, ...rest }: ChipProps) => (
  <button
    type="button"
    class={cx(
      "press inline-flex h-[18px] items-center gap-1 rounded-[4px] px-1.5 text-[12px] leading-none font-medium whitespace-nowrap",
      tone === "default" && "border-[0.5px] border-line-strong text-fg hover:bg-hover",
      tone === "danger" && "bg-danger-bg text-danger hover:bg-danger-bg-hover",
      tone === "primary" && "bg-submit text-submit-fg hover:opacity-90",
      cls as string,
    )}
    {...rest}
  >
    {children}
  </button>
);

export const IconButton = ({
  label,
  active = false,
  class: cls,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={active}
    class={cx(
      "press relative inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg",
      active ? "bg-active" : "hover:bg-hover",
      rest.disabled && "pointer-events-none opacity-40",
      cls as string,
    )}
    {...rest}
  >
    {children}
  </button>
);

export const Kbd = ({ children }: { children: ComponentChildren }) => (
  <span class="text-[11px] leading-none text-fg-muted">{children}</span>
);

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export const Avatar = ({ name, size = 20 }: { name: string; size?: number }) => (
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white uppercase"
    style={{ width: size, height: size, background: `hsl(${hue(name)} 62% 48%)` }}
    aria-hidden="true"
  >
    {name.trim().charAt(0) || "?"}
  </span>
);

/** Auto-growing textarea (field-sizing with a JS fallback). Enter submits, Shift+Enter adds a newline. */
export const AutoTextarea = forwardRef(
  (
    {
      value,
      onValue,
      onSubmit,
      onEscape,
      placeholder,
      maxHeight = 120,
      class: cls,
      autoFocus,
    }: {
      value: string;
      onValue: (v: string) => void;
      onSubmit: () => void;
      onEscape?: () => void;
      placeholder: string;
      maxHeight?: number;
      class?: string;
      autoFocus?: boolean;
    },
    ref: Ref<HTMLTextAreaElement>,
  ) => {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
      const node = inner.current;
      if (!node) return;
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
    }, [value, maxHeight]);
    useLayoutEffect(() => {
      if (autoFocus) queueMicrotask(() => inner.current?.focus({ preventScroll: true }));
    }, [autoFocus]);
    return (
      <textarea
        ref={(node) => {
          inner.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={1}
        value={value}
        placeholder={placeholder}
        data-annotator-input
        class={cx(
          "block w-full min-h-4 overflow-y-auto bg-transparent text-[13px] leading-4 font-medium text-fg [scrollbar-width:none]",
          cls,
        )}
        style={{ maxHeight }}
        onInput={(e) => onValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape" && onEscape) {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
          }
        }}
      />
    );
  },
);

export const SubmitButton = ({ disabled, onClick, label = "Submit" }: { disabled?: boolean; onClick: () => void; label?: string }) => (
  <button
    type="button"
    aria-label={label}
    title={`${label} (Enter)`}
    disabled={disabled}
    onClick={onClick}
    class={cx(
      "press inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-submit text-submit-fg",
      disabled && "opacity-30",
    )}
  >
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  </button>
);

export const NameField = ({ value, onValue }: { value: string; onValue: (v: string) => void }) => (
  <input
    ref={(node) => {
      if (!node || node.dataset.focused) return;
      node.dataset.focused = "1";
      queueMicrotask(() => node.focus({ preventScroll: true }));
    }}
    value={value}
    placeholder="Your name"
    maxLength={80}
    data-annotator-input
    class="block w-full border-b-[0.5px] border-line pb-1.5 text-[12px] leading-4 font-medium text-fg"
    onInput={(e) => onValue(e.currentTarget.value)}
  />
);
