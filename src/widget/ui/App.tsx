import { useEffect } from "preact/hooks";
import {
  activeThreadId,
  cancelSelection,
  getConfig,
  highlightThreadId,
  layoutTick,
  listOpen,
  loadThreads,
  openThread,
  picking,
  requestCancelSelection,
  reresolve,
  retrySelection,
  selection,
  stopPicking,
  threads,
  togglePicking,
} from "../store";
import { watchNavigation } from "../lib/url";
import { Overlay } from "./Overlay";
import { HoverLabel, navigate, selectHovered, Shield } from "./Picker";
import { Pins } from "./Pins";
import { SelectionPanel } from "./SelectionPanel";
import { ThreadList } from "./ThreadList";
import { ThreadPopover } from "./ThreadPopover";
import { Toolbar } from "./Toolbar";

/** True when the key event comes from something the user is typing into (page or widget). */
const isTypingTarget = (e: KeyboardEvent): boolean => {
  const target = e.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || document.designMode === "on") return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  const role = target.getAttribute("role");
  return !!role && ["textbox", "combobox", "searchbox", "spinbutton"].includes(role);
};

const useKeyboard = (host: HTMLElement) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Widget inputs handle their own keys.
      if (e.composedPath().includes(host) && isTypingTarget(e)) return;

      const sel = selection.value;
      if (sel) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          requestCancelSelection();
        } else if (e.key === "Enter" && sel.phase === "discard") {
          e.preventDefault();
          cancelSelection();
        } else if (e.key === "Enter" && sel.phase === "error") {
          e.preventDefault();
          retrySelection();
        }
        return;
      }

      if (e.key === "Escape") {
        if (activeThreadId.value) openThread(null);
        else if (listOpen.value) listOpen.value = false;
        else if (picking.value) stopPicking();
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (picking.value) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (navigate(e.key)) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopImmediatePropagation();
          selectHovered(e.metaKey || e.ctrlKey);
          return;
        }
      }

      const hotkey = getConfig().hotkey;
      if (
        hotkey &&
        e.key.toLowerCase() === hotkey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.repeat &&
        !isTypingTarget(e)
      ) {
        e.preventDefault();
        togglePicking();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [host]);
};

/** Close popovers when clicking anywhere outside the widget. */
const useOutsideClick = (host: HTMLElement) => {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.composedPath().includes(host)) return;
      if (activeThreadId.value) openThread(null);
      if (listOpen.value) listOpen.value = false;
    };
    window.addEventListener("pointerdown", onDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true });
  }, [host]);
};

/** Re-measure positioned UI on scroll/resize and re-anchor threads when the DOM changes. */
const useLayoutTracking = (host: HTMLElement) => {
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        layoutTick.value++;
      });
    };
    window.addEventListener("scroll", bump, { capture: true, passive: true });
    window.addEventListener("resize", bump, { passive: true });
    // Layout can shift without scrolling (images loading, accordions…); poll lightly.
    const interval = setInterval(() => {
      if (threads.value.length || picking.value) bump();
    }, 250);

    let resolveTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver((records) => {
      if (records.every((r) => host.contains(r.target) || r.target === host)) return;
      clearTimeout(resolveTimer);
      resolveTimer = setTimeout(() => {
        reresolve();
        bump();
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const unwatch = watchNavigation(() => {
      stopPicking();
      void loadThreads();
    });

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      clearTimeout(resolveTimer);
      observer.disconnect();
      window.removeEventListener("scroll", bump, { capture: true });
      window.removeEventListener("resize", bump);
      unwatch();
    };
  }, [host]);
};

export const App = ({ host }: { host: HTMLElement }) => {
  useKeyboard(host);
  useOutsideClick(host);
  useLayoutTracking(host);

  useEffect(() => {
    void loadThreads();
  }, []);

  const active = picking.value;
  return (
    <>
      {(active || selection.value) && <Shield />}
      {(active || selection.value || highlightThreadId.value) && <Overlay />}
      <Pins />
      {active && <HoverLabel />}
      <SelectionPanel />
      <ThreadPopover />
      <ThreadList />
      <Toolbar />
    </>
  );
};
