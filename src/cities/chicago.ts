import { type Row, groupBy, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, date10, nameMatch, tokensMatch } from "../util";
import { soda } from "./socrata";
import { type CityDef, type Tone, viol } from "./types";

const URL_ = "https://data.cityofchicago.org/resource/4ijn-s7e5.json";
const address = (r: Row) => [r.address?.trim(), r.city, r.zip].filter(Boolean).join(" ");

/** "16. TITLE - Comments: text | 39. TITLE - Comments: ..." -> structured list */
function parseViolations(v?: string): Json[] {
  if (!v) return [];
  return v.split(" | ").map((s) => {
    const m = s.match(/^\s*(\d+)\.\s*([\s\S]*?)(?:\s+-\s+Comments:\s*([\s\S]*))?$/);
    return m ? { code: m[1], description: m[2].trim(), comments: m[3]?.trim() || null } : { description: s.trim() };
  });
}

const inspection = (r: Row): Json => ({
  date: date10(r.inspection_date),
  type: r.inspection_type,
  result: r.results,
  violations: parseViolations(r.violations),
});

const summary = (rows: Row[]): Json => {
  const r0 = rows[0];
  return {
    id: r0.license_,
    name: r0.dba_name,
    aka: r0.aka_name && r0.aka_name !== r0.dba_name ? r0.aka_name : undefined,
    address: address(r0),
    facility_type: r0.facility_type,
    risk: r0.risk,
    current_result: r0.results,
    latest_inspection_date: date10(r0.inspection_date),
    latest_violation_count: parseViolations(r0.violations).length,
  };
};

export const resultTone = (s: string): Tone =>
  /fail|closed|suspend/i.test(s) ? "red" : /condition/i.test(s) ? "yellow" : /pass/i.test(s) ? "green" : "gray";

export const chicago: CityDef = {
  id: "chicago",
  label: "Chicago",
  region: "Illinois, US",
  centers: [[41.8781, -87.6298]],
  ratingSystem:
    "Chicago CDPH: each inspection is Pass, Pass w/ Conditions (serious or critical violations corrected during the inspection), " +
    "or Fail (critical/priority violations not corrected; a re-inspection follows). No numeric score or letter grade. " +
    "Other results: Out of Business, No Entry, Not Ready, Business Not Located.",
  scale: [{ text: "Pass", tone: "green" }, { text: "Cond.", tone: "yellow" }, { text: "Fail", tone: "red" }],
  scaleHint: "result · no score",
  blurb: "Each inspection passes, passes with conditions, or fails.",
  source: { name: "Chicago CDPH", url: "https://data.cityofchicago.org/d/4ijn-s7e5" },
  examples: ["Au Cheval", "Portillo's", "Lou Malnati's"],
  idHint: "Chicago license number",
  zipSupported: true,
  async search(env, { name, address: addr, zip, limit }) {
    const where = [`(${likeName("dba_name", name)} OR ${likeName("aka_name", name)})`];
    if (zip) where.push(`zip = ${Number(zip) || 0}`);
    if (addr?.trim()) where.push(likeAll("address", addr));
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "inspection_date DESC", $limit: "3000" });
    const hits = rows.filter((r) => (nameMatch(r.dba_name, name) || nameMatch(r.aka_name, name)) && tokensMatch(address(r), addr));
    return [...groupBy(hits, (r) => r.license_ || `${r.dba_name}|${r.address}`).values()].slice(0, limit).map(summary);
  },
  async history(env, id, n) {
    if (!/^\d+$/.test(id)) return { error: `Chicago license numbers are numeric; got ${id}` };
    const rows = await soda(env, URL_, { $where: `license_ = ${id}`, $order: "inspection_date DESC", $limit: String(Math.min(n, 100)) });
    if (!rows.length) return { error: `No Chicago establishment with license number ${id}` };
    return { ...summary(rows), inspections: rows.map(inspection) };
  },
  badge(s) {
    const r = String(s.current_result ?? "");
    const v = s.latest_violation_count as number;
    return {
      text: r.replace("Pass w/ Conditions", "Cond. Pass") || "?",
      sub: viol(v),
      tone: resultTone(r),
    };
  },
};
