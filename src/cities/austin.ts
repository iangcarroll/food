import { type Row, groupBy, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, date10, nameMatch } from "../util";
import { soda } from "./socrata";
import { type CityDef, scoreTone } from "./types";

const URL_ = "https://data.austintexas.gov/resource/ecmv-9xxi.json";
const num = (s?: string) => (s == null || s === "" ? null : Math.round(Number(s)));

const summary = (rows: Row[]): Json => {
  const r0 = rows[0];
  return {
    id: r0.facility_id,
    name: r0.restaurant_name,
    address: r0.address,
    latest_score: num(r0.score),
    latest_inspection_date: date10(r0.inspection_date),
    latest_inspection_type: r0.process_description,
  };
};

export const austin: CityDef = {
  id: "austin",
  label: "Austin",
  region: "Texas, US",
  centers: [[30.2672, -97.7431]],
  ratingSystem:
    "Austin Public Health: score out of 100, HIGHER is better. Below 70 is a failing score and requires a re-inspection. " +
    "No letter grades. The published data covers roughly the last 3 years and has no violation details.",
  scale: [{ text: "90+", tone: "blue" }, { text: "80s", tone: "green" }, { text: "70s", tone: "orange" }, { text: "<70", tone: "red" }],
  scaleHint: "score /100 · higher = better",
  blurb: "Scores out of 100; under 70 fails. The data has no violation details.",
  source: { name: "Austin Public Health", url: "https://data.austintexas.gov/d/ecmv-9xxi" },
  examples: ["Franklin Barbecue", "Torchy's", "Uchi"],
  idHint: "Austin facility id",
  zipSupported: true,
  async search(env, { name, address, zip, limit }) {
    const where = [likeName("restaurant_name", name)];
    if (zip) where.push(`zip_code = ${sqlStr(zip)}`);
    if (address?.trim()) where.push(likeAll("address", address));
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "inspection_date DESC", $limit: "2000" });
    const hits = rows.filter((r) => nameMatch(r.restaurant_name, name));
    return [...groupBy(hits, (r) => r.facility_id).values()].slice(0, limit).map(summary);
  },
  async history(env, id, n) {
    const rows = await soda(env, URL_, { $where: `facility_id = ${sqlStr(id)}`, $order: "inspection_date DESC", $limit: "200" });
    if (!rows.length) return { error: `No Austin facility with id ${id}` };
    return {
      ...summary(rows),
      inspections: rows.slice(0, n).map((r) => ({ date: date10(r.inspection_date), type: r.process_description, score: num(r.score) })),
    };
  },
  badge(s) {
    const score = s.latest_score as number | null;
    return score == null
      ? { text: "?", tone: "gray" }
      : { text: score >= 70 ? "Pass" : "Fail", sub: `${score}/100`, tone: scoreTone(score, [90, 80, 70], true) };
  },
};
