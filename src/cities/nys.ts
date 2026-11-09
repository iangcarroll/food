import { type Row, groupBy, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, date10, nameMatch } from "../util";
import { soda } from "./socrata";
import type { CityDef } from "./types";

const URL_ = "https://health.data.ny.gov/resource/2hcc-shji.json"; // one row per violation

function inspections(rows: Row[]) {
  return [...groupBy(rows, (r) => `${r.date_of_inspection}|${r.inspection_type}`).values()].map((g) => ({
    date: date10(g[0].date_of_inspection),
    type: g[0].inspection_type,
    critical_violations: Number(g[0].total_critical_violations ?? 0),
    critical_not_corrected: Number(g[0].total_crit_not_corrected ?? 0),
    noncritical_violations: Number(g[0].total_noncritical_violations ?? 0),
    comments: g[0].inspection_comments?.slice(0, 600) || null,
    violations: g
      .filter((r) => r.violation_item)
      .map((r) => ({ code: r.violation_item, critical: r.critical_violation === "Critical Violation", description: r.violation_description })),
  }));
}

function summary(rows: Row[]): Json {
  const r0 = rows[0];
  const i0 = inspections(rows)[0];
  return {
    id: r0.nys_health_operation_id,
    name: r0.operation_name || r0.facility,
    address: `${r0.facility_address}, ${r0.facility_city} ${r0.facility_postal_zipcode ?? ""}`.trim(),
    county: r0.county,
    type: r0.food_service_description,
    latest_inspection_date: i0?.date ?? null,
    latest_critical_violations: i0?.critical_violations ?? null,
    latest_noncritical_violations: i0?.noncritical_violations ?? null,
    latest_violation_count: i0 ? i0.critical_violations + i0.noncritical_violations : null,
  };
}

export const nys: CityDef = {
  id: "ny_state",
  label: "New York State",
  region: "Rochester, Syracuse, Albany, Westchester, Nassau & more (not NYC)",
  centers: [[43.1566, -77.6088], [43.0481, -76.1474], [42.6526, -73.7562], [41.034, -73.7629], [40.7682, -73.5251]],
  ratingSystem:
    "New York State DOH and county health departments: no score or grade. Each inspection counts critical (public-health hazard) and " +
    "non-critical violations, and whether critical ones were corrected. Covers most counties outside NYC, including Monroe (Rochester), " +
    "Onondaga (Syracuse), Albany, Westchester and Nassau; NOT Erie (Buffalo), Suffolk or NYC.",
  scale: [{ text: "0 crit.", tone: "green" }, { text: "Critical", tone: "red" }],
  scaleHint: "violation counts · no score",
  blurb: "Counts of critical and non-critical violations. Most counties outside NYC; not Buffalo or Suffolk.",
  source: { name: "NYS Dept. of Health", url: "https://health.data.ny.gov/d/2hcc-shji" },
  examples: ["Dinosaur Bar-B-Que", "Nick Tahou", "Peter Luger"],
  idHint: "NYS health operation id",
  zipSupported: true,
  async search(env, { name, address, zip, limit }) {
    const where = [`(${likeName("operation_name", name)} OR ${likeName("facility", name)})`];
    if (zip) where.push(`facility_postal_zipcode = ${sqlStr(zip)}`);
    if (address) where.push(likeAll("facility_address", address));
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "date_of_inspection DESC", $limit: "4000" });
    const hits = rows.filter((r) => nameMatch(r.operation_name, name) || nameMatch(r.facility, name));
    return [...groupBy(hits, (r) => r.nys_health_operation_id).values()].slice(0, limit).map(summary);
  },
  async history(env, id, n) {
    const rows = await soda(env, URL_, {
      $where: `nys_health_operation_id = ${sqlStr(id)}`,
      $order: "date_of_inspection DESC",
      $limit: "3000",
    });
    if (!rows.length) return { error: `No NY State food service operation with id ${id}` };
    return { ...summary(rows), inspections: inspections(rows).slice(0, n) };
  },
  badge(s) {
    const c = s.latest_critical_violations as number | null;
    if (c == null) return { text: "?", tone: "gray" };
    const nc = Number(s.latest_noncritical_violations ?? 0);
    return { text: c === 0 ? "No critical" : "Critical", sub: `${c} critical · ${nc} other`, tone: c === 0 ? "green" : "red" };
  },
};
