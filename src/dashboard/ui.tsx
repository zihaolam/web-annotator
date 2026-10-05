import type { ButtonHTMLAttributes, ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";

export const Button = ({
  variant = "secondary",
  size = "md",
  class: cls,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) => (
  <button
    type="button"
    class={cx(
      "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
      size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
      variant === "primary" && "bg-stone-900 text-white hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200",
      variant === "secondary" &&
        "border border-stone-200 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800",
      variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
      variant === "ghost" && "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
      cls as string,
    )}
    {...rest}
  >
    {children}
  </button>
);

export const Card = ({ children, class: cls }: { children: ComponentChildren; class?: string }) => (
  <div class={cx("rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900", cls)}>{children}</div>
);

export const inputClass =
  "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-accent focus:outline-none dark:border-stone-700 dark:bg-stone-950";

export const Input = (props: JSX.IntrinsicElements["input"]) => <input {...props} class={cx(inputClass, props.class as string)} />;

export const Textarea = (props: JSX.IntrinsicElements["textarea"]) => (
  <textarea {...props} class={cx(inputClass, "resize-y", props.class as string)} />
);

export const Field = ({ label, hint, children }: { label: string; hint?: ComponentChildren; children: ComponentChildren }) => (
  <label class="grid gap-1.5">
    <span class="text-sm font-medium">{label}</span>
    {children}
    {hint && <span class="text-xs text-stone-500 dark:text-stone-400">{hint}</span>}
  </label>
);

export const Badge = ({ children, tone = "neutral" }: { children: ComponentChildren; tone?: "neutral" | "accent" | "green" | "amber" }) => (
  <span
    class={cx(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      tone === "neutral" && "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
      tone === "accent" && "bg-accent-soft text-accent",
      tone === "green" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
      tone === "amber" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    )}
  >
    {children}
  </span>
);

export const CopyButton = ({ text, label = "Copy" }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
};

export const Code = ({ code, copy = true }: { code: string; copy?: boolean }) => (
  <div class="group relative">
    <pre class="overflow-x-auto rounded-lg bg-stone-950 p-4 pr-20 font-mono text-[13px] leading-relaxed text-stone-100 dark:bg-black">
      <code>{code}</code>
    </pre>
    {copy && (
      <div class="absolute top-2.5 right-2.5">
        <CopyButton text={code} />
      </div>
    )}
  </div>
);

export const ErrorText = ({ error }: { error: string | null }) =>
  error ? <p class="text-sm text-red-600 dark:text-red-400">{error}</p> : null;

export const Spinner = () => (
  <div class="flex justify-center py-16 text-stone-400">
    <svg class="size-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12a9 9 0 1 1-6.22-8.56" stroke-linecap="round" />
    </svg>
  </div>
);

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export const Avatar = ({ name, url, size = 24 }: { name: string; url?: string | null; size?: number }) =>
  url ? (
    <img src={url} alt="" referrerpolicy="no-referrer" class="shrink-0 rounded-full object-cover" style={{ width: `${size}px`, height: `${size}px` }} />
  ) : (
    <span
      class="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white uppercase"
      style={{ width: `${size}px`, height: `${size}px`, background: `hsl(${hue(name)} 62% 48%)` }}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );

export const Meter = ({ label, used, limit }: { label: string; used: number; limit: number }) => {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div class="grid gap-1.5">
      <div class="flex justify-between text-xs">
        <span class="text-stone-500 dark:text-stone-400">{label}</span>
        <span class="tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div class={cx("h-full rounded-full", pct >= 90 ? "bg-red-500" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const relativeTime = (ms: number): string => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
