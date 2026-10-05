/**
 * Tailwind v4 registers its internal variables (`--tw-shadow`, `--tw-translate-x`, ...)
 * with `@property`, which is ignored inside shadow roots. Tailwind ships a fallback
 * that sets the initial values on `*` but gates it behind an `@supports` query that
 * only matches old browsers; unwrap it so the fallback always applies.
 */
export const shadowSafe = (css: string): string => {
  const layerAt = css.indexOf("@layer properties{");
  if (layerAt === -1) return css;
  const supportsAt = css.indexOf("@supports", layerAt);
  if (supportsAt === -1) return css;
  const open = css.indexOf("{", supportsAt);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      return css.slice(0, supportsAt) + css.slice(open + 1, i) + css.slice(i + 1);
    }
  }
  return css;
};
