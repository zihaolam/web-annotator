import { useLayoutEffect, useRef } from "preact/hooks";
import { VIEWPORT_MARGIN, relativeTime } from "../lib/geometry";
import {
  commentMode,
  focusThread,
  highlightThreadId,
  identity,
  listFilter,
  listOpen,
  loadError,
  loadState,
  loadThreads,
  orderedThreads,
  pageUrl,
  pinNumbers,
  resolved,
  signingIn,
  signInMember,
  signOut,
  toggleList,
  widgetConfig,
} from "../store";
import { IconX } from "./icons";
import { toolbarEdge, toolbarRect } from "./Toolbar";
import { Avatar, IconButton, cx } from "./primitives";

const WIDTH = 320;
const GAP = 10;

/** Panel listing every thread on the current page, attached to the toolbar. */
export const ThreadList = () => {
  const ref = useRef<HTMLDivElement>(null);
  const tb = toolbarRect.value;
  const edge = toolbarEdge.value;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !tb) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const h = node.offsetHeight;
    let left = tb.left + tb.width / 2 - WIDTH / 2;
    let top = tb.top - h - GAP;
    if (edge === "top") top = tb.bottom + GAP;
    if (edge === "left") [left, top] = [tb.right + GAP, tb.top + tb.height / 2 - h / 2];
    if (edge === "right") [left, top] = [tb.left - WIDTH - GAP, tb.top + tb.height / 2 - h / 2];
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), vw - WIDTH - VIEWPORT_MARGIN);
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), vh - h - VIEWPORT_MARGIN);
    node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  if (!listOpen.value) return null;

  const all = orderedThreads.value;
  const filter = listFilter.value;
  const shown = all.filter((t) => t.status === filter);
  const counts = {
    open: all.filter((t) => t.status === "open").length,
    resolved: all.filter((t) => t.status === "resolved").length,
  };
  const path = (() => {
    try {
      return new URL(pageUrl.value).pathname;
    } catch {
      return pageUrl.value;
    }
  })();

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Comments on this page"
      class="pointer-events-auto fixed top-0 left-0 z-40 flex max-h-[min(520px,calc(100vh-96px))] animate-fade-in flex-col overflow-hidden rounded-[14px] bg-panel font-sans text-[13px] leading-[18px] font-medium text-fg antialiased shadow-panel"
      style={{ width: `${WIDTH}px` }}
    >
      <header class="flex items-center gap-2 border-b-[0.5px] border-line py-1.5 pr-1.5 pl-3">
        <div class="min-w-0 flex-1">
          <div class="font-semibold">Comments</div>
          <div class="truncate text-[11px] text-fg-muted" title={pageUrl.value}>
            {path}
          </div>
        </div>
        <div class="flex rounded-md bg-hover p-0.5 text-[12px]">
          {(["open", "resolved"] as const).map((f) => (
            <button
              type="button"
              key={f}
              class={cx("rounded-[5px] px-2 py-0.5 capitalize", filter === f ? "bg-panel shadow-panel" : "text-fg-muted")}
              onClick={() => (listFilter.value = f)}
            >
              {f} <span class="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
        <IconButton label="Close" onClick={toggleList}>
          <IconX size={13} />
        </IconButton>
      </header>

      <ul class="min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-width:thin]">
        {loadState.value === "error" && (
          <li class="flex items-center gap-2 px-3 py-3 text-danger">
            <span class="flex-1">{loadError.value}</span>
            <button type="button" class="underline" onClick={() => void loadThreads()}>
              Retry
            </button>
          </li>
        )}
        {loadState.value === "signed-out" && (
          <li class="flex flex-col items-center gap-2 px-3 py-6 text-center text-fg-muted">
            {commentMode.value === "members" ? (
              <>
                <span>Comments on this site are private to the {widgetConfig.value?.projectName} team.</span>
                <button
                  type="button"
                  disabled={signingIn.value}
                  class="press rounded-full bg-submit px-3 py-1 text-submit-fg disabled:opacity-50"
                  onClick={() => void signInMember()}
                >
                  {signingIn.value ? "Signing in…" : "Sign in to see comments"}
                </button>
              </>
            ) : (
              <span>Sign in to {widgetConfig.value?.projectName ?? "this site"} to see and leave comments.</span>
            )}
          </li>
        )}
        {loadState.value !== "error" && loadState.value !== "signed-out" && shown.length === 0 && (
          <li class="px-3 py-6 text-center text-fg-muted">
            {filter === "open" ? "No open comments. Press the comment button and click any element." : "Nothing resolved yet."}
          </li>
        )}
        {shown.map((t) => {
          const first = t.comments[0];
          const replies = t.comments.length - 1;
          const detached = resolved.value.get(t.id) === null;
          return (
            <li key={t.id}>
              <button
                type="button"
                class="flex w-full gap-2.5 px-3 py-2 text-left hover:bg-hover"
                onClick={() => focusThread(t.id)}
                onPointerEnter={() => (highlightThreadId.value = t.id)}
                onPointerLeave={() => highlightThreadId.value === t.id && (highlightThreadId.value = null)}
              >
                <span
                  class={cx(
                    "mt-px flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full rounded-bl-none px-1 text-[10px] font-semibold text-white tabular-nums",
                    t.status === "resolved" ? "bg-fg-muted" : "bg-accent",
                  )}
                >
                  {pinNumbers.value.get(t.id)}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <Avatar name={t.author.name} url={t.author.avatarUrl} size={16} />
                    <span class="truncate font-semibold">{t.author.name}</span>
                    <span class="shrink-0 text-[11px] text-fg-muted">{relativeTime(t.createdAt)}</span>
                  </span>
                  <span class="mt-0.5 line-clamp-2 break-words text-fg">{first?.body}</span>
                  <span class="mt-0.5 flex gap-2 text-[11px] text-fg-muted">
                    {replies > 0 && <span>{replies === 1 ? "1 reply" : `${replies} replies`}</span>}
                    {detached && <span class="text-danger">element not found</span>}
                    <span class="truncate">&lt;{t.anchor.tagName}&gt;</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {identity.value && (
        <footer class="flex items-center gap-1.5 border-t-[0.5px] border-line px-3 py-1.5 text-[12px] text-fg-muted">
          <Avatar name={identity.value.name} url={identity.value.avatarUrl} size={16} />
          <span class="min-w-0 flex-1 truncate">
            {identity.value.type === "guest" ? "Commenting as " : "Signed in as "}
            <span class="text-fg">{identity.value.name}</span>
          </span>
          {identity.value.type !== "verified" && (
            <button type="button" class="hover:text-fg" onClick={() => void signOut()}>
              {identity.value.type === "guest" ? "Change name" : "Sign out"}
            </button>
          )}
        </footer>
      )}
    </div>
  );
};
