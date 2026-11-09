import { type Row, groupBy, likeName, sqlStr } from "../lib/http";
import { type Json, date10, nameMatch, tokensMatch } from "../util";
import { soda } from "./socrata";
import { type CityDef, gradeTone, scoreTone } from "./types";

const URL_ = "https://data.cityofnewyork.us/resource/43nn-pn8j.json";

const address = (r: Row) => [r.building, r.street, r.boro, r.zipcode].filter(Boolean).join(" ");

function groupInspections(rows: Row[]) {
  const insp = new Map<string, Json & { date: string | null; grade?: string; violations: Json[] }>();
  for (const r of rows) {
    if ((r.inspection_date ?? "").startsWith("1900")) continue; // placeholder: not yet inspected
    const key = `${r.inspection_date}\u0000${r.inspection_type}`;
    let i = insp.get(key);
    if (!i) {
      i = { date: date10(r.inspection_date), type: r.inspection_type, score: r.score, grade: r.grade, action: r.action, violations: [] };
      insp.set(key, i);
    }
    i.grade = i.grade || r.grade;
    if (r.violation_code) {
      i.violations.push({ code: r.violation_code, critical: r.critical_flag === "Critical", description: r.violation_description });
    }
  }
  return [...insp.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function summary(camis: string, rows: Row[]): Json {
  const r0 = rows[0];
  const insps = groupInspections(rows);
  const graded = rows
    .filter((r) => r.grade)
    .sort((a, b) => (b.grade_date || b.inspection_date || "").localeCompare(a.grade_date || a.inspection_date || ""));
  return {
    id: camis,
    name: r0.dba,
    address: address(r0),
    cuisine: r0.cuisine_description,
    current_grade: graded[0]?.grade ?? null,
    grade_date: graded[0] ? date10(graded[0].grade_date) : null,
    latest_inspection_date: insps[0]?.date ?? null,
    latest_score: insps[0]?.score ?? null,
  };
}

export const nyc: CityDef = {
  id: "nyc",
  label: "New York City",
  region: "New York, US",
  centers: [[40.7831, -73.9712], [40.6782, -73.9442], [40.7282, -73.7949], [40.8448, -73.8648], [40.5795, -74.1502]],
  ratingSystem:
    "NYC DOHMH: score = violation points, LOWER is better. A = 0-13, B = 14-27, C = 28+. " +
    "Grade 'N' = not yet graded, 'Z'/'P' = grade pending.",
  scale: [{ text: "A", tone: "blue" }, { text: "B", tone: "green" }, { text: "C", tone: "orange" }],
  scaleHint: "points · lower = better",
  blurb: "A is 0–13 points, B is 14–27, and C is 28 or more.",
  source: { name: "NYC DOHMH", url: "https://data.cityofnewyork.us/d/43nn-pn8j" },
  examples: ["Katz's", "Joe's Pizza", "Peter Luger"],
  idHint: "NYC CAMIS number",
  zipSupported: true,
  async search(env, { name, address: addr, zip, limit }) {
    const where = [likeName("dba", name)];
    if (zip) where.push(`zipcode = ${sqlStr(zip)}`);
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "inspection_date DESC", $limit: "5000" });
    const hits = rows.filter((r) => nameMatch(r.dba, name) && tokensMatch(address(r), addr));
    return [...groupBy(hits, (r) => r.camis!).entries()].slice(0, limit).map(([k, v]) => summary(k, v));
  },
  async history(env, id, n) {
    const rows = await soda(env, URL_, { $where: `camis = ${sqlStr(id)}`, $order: "inspection_date DESC", $limit: "2000" });
    if (!rows.length) return { error: `No NYC restaurant with CAMIS id ${id}` };
    return { ...summary(id, rows), inspections: groupInspections(rows).slice(0, n) };
  },
  badge(s) {
    const score = s.latest_score == null ? null : Number(s.latest_score);
    const g = s.current_grade as string | null;
    const letter = g && "ABC".includes(g);
    return {
      text: letter ? g! : g === "Z" || g === "P" ? "Pend." : "?",
      sub: score == null ? undefined : `${score} pts`,
      tone: letter ? gradeTone(g) : score == null ? "gray" : scoreTone(score, [13, 27, 1e9], false),
    };
  },
};
