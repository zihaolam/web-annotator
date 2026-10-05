export interface AnnotatorConfig {
  /** Project id the comments are stored under. */
  projectId: string;
  /** Base URL of the annotator Worker (defaults to the origin serving script.js). */
  apiBase: string;
  /** Key that toggles comment mode (no modifiers). Set to "" to disable. */
  hotkey: string;
  /** How a page is identified: `path` (origin + pathname), `hash` (+ #hash), `full` (+ ?query + #hash). */
  urlMode: "path" | "hash" | "full";
  /** Force the panel theme instead of auto-detecting it from the host page. */
  theme: "auto" | "light" | "dark";
}

const readScriptTag = (): HTMLScriptElement | null => {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement) return current;
  return document.querySelector<HTMLScriptElement>("script[data-project][src*='script.js']");
};

/**
 * Reads configuration from the `<script>` tag's data attributes, e.g.
 * `<script src="https://annotator.example.com/script.js" data-project="acme"></script>`,
 * optionally overridden by `window.WebAnnotatorConfig`.
 */
export const readConfig = (): AnnotatorConfig | null => {
  const script = readScriptTag();
  const overrides = (window as unknown as { WebAnnotatorConfig?: Partial<AnnotatorConfig> }).WebAnnotatorConfig ?? {};
  const data = script?.dataset ?? {};
  const projectId = overrides.projectId ?? data.project;
  if (!projectId) {
    console.warn("[web-annotator] missing data-project on the script tag; annotator disabled.");
    return null;
  }
  const scriptOrigin = script?.src ? new URL(script.src, location.href).origin : location.origin;
  const urlMode = overrides.urlMode ?? data.urlMode;
  const theme = overrides.theme ?? data.theme;
  return {
    projectId,
    apiBase: (overrides.apiBase ?? data.api ?? scriptOrigin).replace(/\/+$/, ""),
    hotkey: (overrides.hotkey ?? data.hotkey ?? "c").toLowerCase(),
    urlMode: urlMode === "hash" || urlMode === "full" ? urlMode : "path",
    theme: theme === "light" || theme === "dark" ? theme : "auto",
  };
};
