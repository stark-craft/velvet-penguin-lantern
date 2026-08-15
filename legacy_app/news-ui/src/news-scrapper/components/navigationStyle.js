const SUPPORTED_NAV_STYLES = new Set(["classic", "floating"]);

/**
 * The original command bar remains a maintained, production-safe fallback.
 * Set VITE_NEWSSCRAPPER_NAV_STYLE=classic before `npm run dev` or
 * `npm run build` to restore it without changing component code.
 */
export function resolveNewsScrapperNavStyle(value = import.meta.env.VITE_NEWSSCRAPPER_NAV_STYLE) {
  const requested = String(value || "floating").trim().toLowerCase();
  return SUPPORTED_NAV_STYLES.has(requested) ? requested : "floating";
}

export const NEWS_SCRAPPER_NAV_STYLE = resolveNewsScrapperNavStyle();
