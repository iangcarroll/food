export interface Env {
  DB: D1Database;
  SOCRATA_APP_TOKEN?: string;
  ADMIN_TOKEN?: string;
}

export type Json = Record<string, unknown>;

/** How long any upstream data is reused before re-fetching, on every surface. */
export const CACHE_TTL_S = 24 * 3600;

export const UA = "restaurant-health-mcp/1.0 (+https://food.ian.sh)";

export const date10 = (s: string | null | undefined): string | null => (s ? s.slice(0, 10) : null);

/** Uppercase alphanumerics only: "In-N-Out" -> "INNOUT". */
export const compact = (s: string | null | undefined): string => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Punctuation/space-insensitive phrase match: 'in n out' matches 'IN-N-OUT BURGER'. */
export const nameMatch = (haystack: string | null | undefined, needle: string): boolean =>
  compact(haystack).includes(compact(needle));

/** Every whitespace-separated token of `needle` appears in `haystack` (case-insensitive). */
export const tokensMatch = (haystack: string, needle: string | null | undefined): boolean => {
  if (!needle) return true;
  const h = haystack.toUpperCase();
  return needle.toUpperCase().split(/\s+/).filter(Boolean).every((t) => h.includes(t));
};

export const tokens = (s: string | null | undefined): string[] => (s ?? "").toUpperCase().split(/\s+/).filter(Boolean);
