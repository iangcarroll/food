import { CITY_LIST } from "./cities";

const NEAR_KM = 120;
const BY_COUNTRY: Record<string, string> = { GB: "uk", FR: "france", CA: "toronto" };
const FALLBACK = "nyc";

function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Pick the landing page's default city from Cloudflare's per-request geo data (derived from the
 * visitor's IP; finer-grained than the PoP): nearest supported city within NEAR_KM, else a
 * country default, else NYC.
 */
export function defaultCity(cf?: { latitude?: string; longitude?: string; country?: string } | null): string {
  const lat = Number(cf?.latitude), lon = Number(cf?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) {
    let best: { id: string; d: number } | null = null;
    for (const c of CITY_LIST) {
      for (const p of c.centers) {
        const d = km([lat, lon], p);
        if (!best || d < best.d) best = { id: c.id, d };
      }
    }
    if (best && best.d <= NEAR_KM) return best.id;
  }
  return BY_COUNTRY[cf?.country ?? ""] ?? FALLBACK;
}
