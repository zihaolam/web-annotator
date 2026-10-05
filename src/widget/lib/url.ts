import type { AnnotatorConfig } from "../config";

export const normalizePageUrl = (mode: AnnotatorConfig["urlMode"], href = location.href): string => {
  const url = new URL(href);
  const base = url.origin + (url.pathname.replace(/\/+$/, "") || "/");
  if (mode === "hash") return base + url.hash;
  if (mode === "full") return base + url.search + url.hash;
  return base;
};

/** Calls `onChange` whenever the SPA navigates (pushState/replaceState/popstate/hashchange). */
export const watchNavigation = (onChange: () => void): (() => void) => {
  let last = location.href;
  const check = () => {
    if (location.href === last) return;
    last = location.href;
    onChange();
  };
  const wrap = (key: "pushState" | "replaceState") => {
    const original = history[key];
    history[key] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      queueMicrotask(check);
      return result;
    } as History["pushState"];
    return () => {
      history[key] = original;
    };
  };
  const unwrapPush = wrap("pushState");
  const unwrapReplace = wrap("replaceState");
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
  return () => {
    unwrapPush();
    unwrapReplace();
    window.removeEventListener("popstate", check);
    window.removeEventListener("hashchange", check);
  };
};
