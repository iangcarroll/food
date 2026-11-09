import { type Row, groupBy, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, date10, nameMatch } from "../util";
import { soda } from "./socrata";
import { type CityDef, type Tone, viol } from "./types";

const URL_ = "https://data.sf.gov/resource/tvy3-wexg.json";

const inspection = (r: Row): Json => ({
  date: date10(r.inspection_date),
  rating: r.facility_rating_status,
  violation_count: Number(r.violation_count || 0),
  violations: r.violation_codes,
  permit_type: r.permit_type,
});

const summary = (rows: Row[]): Json => {
  const r0 = rows[0];
  return {
    id: r0.permit_number,
    name: r0.dba,
    address: r0.street_address_clean || r0.street_address,
    neighborhood: r0.analysis_neighborhood,
    current_rating: r0.facility_rating_status,
    latest_inspection_date: date10(r0.inspection_date),
    latest_violation_count: Number(r0.violation_count || 0),
  };
};

// The dataset contains some typo'd future dates (e.g. 2031); ignore them.
const notFuture = () => `inspection_date <= ${sqlStr(new Date().toISOString().slice(0, 10) + "T23:59:59")}`;

export const ratingTone = (s: string): Tone => (/closed/i.test(s) ? "red" : /cond/i.test(s) ? "yellow" : /pass/i.test(s) ? "green" : "gray");

export const sf: CityDef = {
  id: "sf",
  label: "San Francisco",
  region: "California, US",
  centers: [[37.7749, -122.4194]],
  ratingSystem: "SF DPH (2024+ placard system): Pass (green), Conditional Pass (yellow), Closed (red). No numeric score.",
  scale: [{ text: "Pass", tone: "green" }, { text: "Cond.", tone: "yellow" }, { text: "Closed", tone: "red" }],
  scaleHint: "placard · no score",
  blurb: "Green, yellow and red placards, from 2024 onward.",
  source: { name: "SF DPH", url: "https://data.sf.gov/d/tvy3-wexg" },
  examples: ["Tartine", "Swan Oyster", "House of Prime Rib"],
  idHint: "SF permit number",
  zipSupported: false,
  async search(env, { name, address, limit }) {
    const where = [likeName("dba", name), notFuture()];
    if (address?.trim()) where.push(likeAll("street_address", address));
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "inspection_date DESC", $limit: "2000" });
    const hits = rows.filter((r) => nameMatch(r.dba, name));
    return [...groupBy(hits, (r) => r.permit_number).values()].slice(0, limit).map(summary);
  },
  async history(env, id, n) {
    const rows = await soda(env, URL_, {
      $where: `permit_number = ${sqlStr(id)} AND ${notFuture()}`,
      $order: "inspection_date DESC",
      $limit: "500",
    });
    if (!rows.length) return { error: `No SF facility with permit number ${id}` };
    return { ...summary(rows), inspections: rows.slice(0, n).map(inspection) };
  },
  badge(s) {
    const r = String(s.current_rating ?? "");
    const v = s.latest_violation_count as number;
    return {
      text: r.replace("Conditional Pass", "Cond. Pass") || "?",
      sub: v == null ? undefined : viol(v),
      tone: ratingTone(r),
    };
  },
};
