import { type Row, groupBy, likeName, sqlStr, unq } from "../lib/http";
import { type Json, date10, nameMatch, tokensMatch } from "../util";
import { calcode } from "./calcode";
import { soda } from "./socrata";
import { type CityDef, type Tone, viol } from "./types";

const URL_ = "https://data.marincounty.gov/resource/73zb-z5me.json"; // one row per violation

const PLACARD: Record<string, string> = { GREEN: "Pass (green)", YELLOW: "Conditional Pass (yellow)", RED: "Closed (red)" };

function inspections(rows: Row[]) {
  return [...groupBy(rows, (r) => r.inspection_id).values()].map((g) => ({
    date: date10(g[0].inspection_date),
    type: g[0].inspection_type,
    placard: g[0].placard ? PLACARD[g[0].placard] ?? g[0].placard : null,
    result: unq(g[0].inspection_description) ?? g[0].inspection_result,
    violations: g
      .filter((r) => r.violation_code)
      .map((r) => ({ ...calcode(r.violation_code), corrected_on_site: r.corrected_on_site === "Yes" })),
  }));
}

function summary(rows: Row[]): Json {
  const r0 = rows[0];
  const insp = inspections(rows);
  return {
    id: r0.business_id,
    name: unq(r0.business_name),
    address: unq(r0.formatted_address),
    current_placard: insp[0]?.placard ?? null,
    latest_result: insp[0]?.result ?? null,
    latest_inspection_date: insp[0]?.date ?? null,
    latest_violation_count: insp[0]?.violations.length ?? 0,
  };
}

export const placardTone = (p: string): Tone =>
  p.startsWith("Pass") ? "green" : p.startsWith("Cond") ? "yellow" : p.startsWith("Closed") ? "red" : "gray";
export const placardText = (p: string) => (p ? p.replace(/ \(.*\)/, "").replace("Conditional Pass", "Cond. Pass") : "?");

export const marin: CityDef = {
  id: "marin",
  label: "Marin County",
  region: "California, US",
  centers: [[37.9735, -122.5311]],
  ratingSystem:
    "Marin County EHS: color placard after each inspection (Green = Pass, Yellow = Conditional Pass, Red = Closed). No numeric score. " +
    "Violations are published as CalCode (Health & Safety Code) section numbers only; descriptions are the section's topic, not the inspector's notes.",
  scale: [{ text: "Green", tone: "green" }, { text: "Yellow", tone: "yellow" }, { text: "Red", tone: "red" }],
  scaleHint: "placard · no score",
  blurb: "Green, yellow or red placards. Covers San Rafael, Sausalito, Mill Valley and the rest of the county.",
  source: { name: "Marin County EHS", url: "https://data.marincounty.gov/d/73zb-z5me" },
  examples: ["Super Duper", "Sol Food", "Fish."],
  idHint: "Marin business id",
  zipSupported: true,
  async search(env, { name, address, zip, limit }) {
    const where = [likeName("business_name", name)];
    if (zip) where.push(`business_postal_code = ${sqlStr(zip)}`);
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "inspection_date DESC", $limit: "3000" });
    const hits = rows.filter((r) => nameMatch(r.business_name, name) && tokensMatch(r.formatted_address ?? "", address));
    return [...groupBy(hits, (r) => r.business_id).values()].slice(0, limit).map(summary);
  },
  async history(env, id, n) {
    const rows = await soda(env, URL_, { $where: `business_id = ${sqlStr(id)}`, $order: "inspection_date DESC", $limit: "2000" });
    if (!rows.length) return { error: `No Marin County business with id ${id}` };
    return { ...summary(rows), inspections: inspections(rows).slice(0, n) };
  },
  badge: (s) => ({ text: placardText(String(s.current_placard ?? "")), sub: viol(Number(s.latest_violation_count ?? 0)), tone: placardTone(String(s.current_placard ?? "")) }),
};
