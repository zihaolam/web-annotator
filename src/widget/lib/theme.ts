/**
 * Detects whether the host app is dark or light. The widget then uses the
 * opposite panel theme so it contrasts with the page (react-grab's approach).
 */
const luminance = (color: string): number | null => {
  const m = color.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const THEME_ATTRIBUTES = ["data-theme", "data-mode", "data-color-scheme", "data-bs-theme", "data-mantine-color-scheme"];

export const detectAppIsDark = (): boolean => {
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    if (el.classList.contains("dark")) return true;
    if (el.classList.contains("light")) return false;
    for (const attr of THEME_ATTRIBUTES) {
      const v = el.getAttribute(attr)?.toLowerCase();
      if (v === "dark") return true;
      if (v === "light") return false;
    }
  }
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const lum = luminance(getComputedStyle(el).backgroundColor);
    if (lum !== null) return lum < 0.18;
  }
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  if (scheme.includes("dark") && !scheme.includes("light")) return true;
  return false;
};

/** Keeps `host[data-wa-theme]` in sync with the app's theme. */
export const watchTheme = (host: HTMLElement, forced: "auto" | "light" | "dark"): (() => void) => {
  const apply = () => {
    const theme = forced === "auto" ? (detectAppIsDark() ? "light" : "dark") : forced;
    if (host.dataset.waTheme !== theme) host.dataset.waTheme = theme;
  };
  apply();
  if (forced !== "auto") return () => {};
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  const observer = new MutationObserver(schedule);
  const opts = { attributes: true, attributeFilter: ["class", "style", ...THEME_ATTRIBUTES] };
  observer.observe(document.documentElement, opts);
  if (document.body) observer.observe(document.body, opts);
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", schedule);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", schedule);
  };
};
