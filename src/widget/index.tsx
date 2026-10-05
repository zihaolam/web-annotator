import { render } from "preact";
import css from "../../dist/build/widget.css" with { type: "text" };
import { createApi } from "./api";
import { readConfig, type AnnotatorConfig } from "./config";
import { setHostElement } from "./lib/hit-test";
import { watchTheme } from "./lib/theme";
import { getConfig, init, loadThreads, startPicking, stopPicking } from "./store";
import { App } from "./ui/App";

const HOST_ATTRIBUTE = "data-web-annotator";

declare global {
  interface Window {
    WebAnnotator?: {
      version: string;
      open: () => void;
      close: () => void;
      reload: () => Promise<void>;
      destroy: () => void;
    };
  }
}

/**
 * Mounts the widget into an open shadow root on a fixed, pointer-transparent
 * host so neither the page's CSS nor ours leaks across. The host is re-appended
 * if the app wipes <body> (e.g. during hydration) and kept last in DOM order.
 */
const mount = (config: AnnotatorConfig | null) => {
  if (window.WebAnnotator || !config) return;
  init(createApi(config), config);

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;background:none;";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  const nonce = document.querySelector<HTMLElement>("script[nonce],style[nonce]")?.nonce;
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  shadow.appendChild(style);

  const root = document.createElement("div");
  shadow.appendChild(root);

  // Keep keystrokes typed into the widget away from the host app's shortcuts.
  for (const type of ["keydown", "keyup", "keypress"]) {
    host.addEventListener(type, (e) => {
      if (e.composedPath()[0] instanceof HTMLElement && (e.composedPath()[0] as HTMLElement).closest("[data-annotator-input]")) {
        e.stopPropagation();
      }
    });
  }

  setHostElement(host);
  document.body.appendChild(host);
  const unwatchTheme = watchTheme(host, getConfig().theme);
  render(<App host={host} />, root);

  const keepMounted = new MutationObserver(() => {
    if (!host.isConnected || host.nextElementSibling) document.body.appendChild(host);
  });
  keepMounted.observe(document.body, { childList: true });
  const keepMountedHtml = new MutationObserver(() => {
    if (!host.isConnected && document.body) {
      document.body.appendChild(host);
      keepMounted.disconnect();
      keepMounted.observe(document.body, { childList: true });
    }
  });
  keepMountedHtml.observe(document.documentElement, { childList: true });

  window.WebAnnotator = {
    version: process.env.WEB_ANNOTATOR_VERSION as string,
    open: startPicking,
    close: stopPicking,
    reload: loadThreads,
    destroy: () => {
      keepMounted.disconnect();
      keepMountedHtml.disconnect();
      unwatchTheme();
      render(null, root);
      host.remove();
      delete window.WebAnnotator;
    },
  };
};

// `document.currentScript` is only available while the script first executes.
const config = readConfig();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mount(config), { once: true });
else mount(config);
