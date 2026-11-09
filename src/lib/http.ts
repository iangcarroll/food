import { CACHE_TTL_S, UA } from "../util";

/** GET JSON through the Cloudflare Cache API (per location) for CACHE_TTL_S. */
export async function cachedJson<T = unknown>(url: URL | string, headers: Record<string, string> = {}): Promise<T> {
  const u = url.toString();
  const key = new Request(u);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
  const body = await r.text();
  if (!r.ok) throw new Error(`${new URL(u).host} returned HTTP ${r.status}: ${body.slice(0, 300)}`);
  await cache.put(
    key,
    new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_S}` } }),
  );
  return JSON.parse(body);
}

export type Row = Record<string, string | undefined>;

export function groupBy<K, R>(rows: R[], key: (r: R) => K): Map<K, R[]> {
  const m = new Map<K, R[]>();
  for (const r of rows) {
    const k = key(r);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(r);
  }
  return m;
}

/** SQL string literal (works for SoQL and PostgreSQL). */
export const sqlStr = (s: string) => "'" + s.replace(/'/g, "''") + "'";

/** Every whitespace-separated token must appear (case-insensitive). */
export const likeAll = (field: string, text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `upper(${field}) like ${sqlStr("%" + t.toUpperCase().replace(/[%_]/g, "") + "%")}`)
    .join(" AND ");

/**
 * SoQL / ArcGIS SQL can't strip punctuation, so this is a coarse server-side prefilter that callers
 * refine locally with nameMatch. Each word must appear, either as-is or with one extra character
 * inside it (so "katzs" finds "KATZ'S" and "original joes" finds "ORIGINAL JOE'S").
 */
export const likeName = (field: string, name: string) => {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (!words.length) return "1=0";
  return words
    .map((w) => {
      const pats = ["%" + w + "%"];
      if (w.length >= 3 && w.length <= 16) for (let i = 1; i < w.length; i++) pats.push("%" + w.slice(0, i) + "_" + w.slice(i) + "%");
      return "(" + pats.map((p) => `upper(${field}) like ${sqlStr(p)}`).join(" OR ") + ")";
    })
    .join(" AND ");
};

// ---------------------------------------------------------------------------
// ArcGIS REST (FeatureServer / MapServer layer /query)
// ---------------------------------------------------------------------------

export type Attrs = Record<string, any>;

export async function arcgis(
  layerUrl: string,
  q: { where: string; outFields?: string; orderByFields?: string; resultRecordCount?: number },
): Promise<Attrs[]> {
  const u = new URL(layerUrl + "/query");
  u.searchParams.set("where", q.where);
  u.searchParams.set("outFields", q.outFields ?? "*");
  u.searchParams.set("returnGeometry", "false");
  if (q.orderByFields) u.searchParams.set("orderByFields", q.orderByFields);
  u.searchParams.set("resultRecordCount", String(q.resultRecordCount ?? 1000));
  u.searchParams.set("f", "json");
  const d = await cachedJson<{ features?: { attributes: Attrs }[]; error?: { message: string; details?: string[] } }>(u);
  if (d.error) throw new Error(`ArcGIS ${u.host}: ${d.error.message} ${(d.error.details ?? []).join(" ")}`.trim());
  return (d.features ?? []).map((f) => f.attributes);
}

/** ArcGIS dates arrive as epoch ms (or already as strings). */
export const msDate = (v: unknown): string | null =>
  v == null || v === "" ? null : typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : String(v).slice(0, 10);

/** SQL IN (...) list of string literals. */
export const inList = (vals: (string | number)[]) => "(" + vals.map((v) => (typeof v === "number" ? String(v) : sqlStr(v))).join(",") + ")";

/** Strip stray wrapping quotes some portals leave in values ("\"NAME\""). */
export const unq = (s: string | null | undefined): string | undefined => (s == null ? undefined : s.replace(/^"+|"+$/g, "").trim());

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
