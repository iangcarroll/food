import { cachedJson, groupBy, sqlStr } from "../lib/http";
import { type Json, compact, date10, tokens } from "../util";
import { resultTone } from "./chicago";
import { type CityDef, viol } from "./types";

// Boston publishes through CKAN; datastore_search_sql is PostgreSQL, so we can match on
// punctuation-stripped names server-side.
const API = "https://data.boston.gov/api/3/action/datastore_search_sql";
const RES = '"4582bec6-2b4f-4f9e-bc55-cbaa73117f4c"';
const COLS =
  "licenseno, businessname, dbaname, address, city, zip, licstatus, descript, result, resultdttm, violation, viol_level, violdesc, viol_status, comments";

type BRow = Record<string, string | null>;

async function sql(q: string): Promise<BRow[]> {
  const u = new URL(API);
  u.searchParams.set("sql", q);
  const d = await cachedJson<{ success: boolean; result: { records: BRow[] }; error?: unknown }>(u);
  if (!d.success) throw new Error(`Boston data API error: ${JSON.stringify(d.error).slice(0, 200)}`);
  return d.result.records;
}

const RESULTS: Record<string, string> = {
  HE_Pass: "Pass", Pass: "Pass", HE_Fail: "Fail", Fail: "Fail", HE_FailExt: "Fail (extension granted)",
  HE_Filed: "Filed", HE_Hearing: "Hearing", HE_NotReq: "Not required", HE_TSOP: "Permit suspended",
  HE_VolClos: "Voluntary closure", HE_OutBus: "Out of business", HE_Closure: "Closed",
};
const label = (r: string | null) => (r ? RESULTS[r] ?? r : null);
const LEVEL: Record<string, string> = { "*": "minor", "**": "major", "***": "critical" };

function inspections(rows: BRow[]) {
  const dated = rows.filter((r) => r.resultdttm);
  return [...groupBy(dated, (r) => `${r.resultdttm}|${r.result}`).values()].map((g) => ({
    date: date10(g[0].resultdttm),
    result: label(g[0].result),
    violations: g
      .filter((r) => r.violation)
      .map((r) => ({
        code: r.violation,
        level: r.viol_level ? LEVEL[r.viol_level] ?? r.viol_level : null,
        description: r.violdesc,
        status: r.viol_status,
        comments: r.comments,
      })),
  }));
}

function summary(rows: BRow[]): Json {
  const r0 = rows[0];
  const insp = inspections(rows);
  return {
    id: r0.licenseno,
    name: r0.businessname,
    dba: r0.dbaname || undefined,
    address: [r0.address?.replace(/\s+/g, " ").trim(), r0.city?.replace(/\/$/, ""), r0.zip].filter(Boolean).join(" "),
    license_status: r0.licstatus,
    category: r0.descript,
    current_result: insp[0]?.result ?? null,
    latest_inspection_date: insp[0]?.date ?? null,
    latest_violation_count: insp[0]?.violations.length ?? 0,
  };
}

export const boston: CityDef = {
  id: "boston",
  label: "Boston",
  region: "Massachusetts, US",
  centers: [[42.3601, -71.0589]],
  ratingSystem:
    "Boston ISD: each inspection is Pass or Fail (also: Fail with extension, Filed, Hearing, Permit suspended, Closed). " +
    "No score or letter grade. Violations are rated minor (*), major (**) or critical (***).",
  scale: [{ text: "Pass", tone: "green" }, { text: "Fail", tone: "red" }],
  scaleHint: "pass/fail · violations rated * to ***",
  blurb: "Pass or fail, with each violation rated minor, major or critical.",
  source: { name: "Boston ISD", url: "https://data.boston.gov/dataset/food-establishment-inspections" },
  examples: ["Legal Sea Foods", "Regina", "Mike's Pastry"],
  idHint: "Boston license number",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const key = compact(name);
    if (!key) return [];
    const strip = (f: string) => `upper(regexp_replace(${f}, '[^A-Za-z0-9]', '', 'g'))`;
    const where = [`(${strip("businessname")} LIKE ${sqlStr(`%${key}%`)} OR ${strip("dbaname")} LIKE ${sqlStr(`%${key}%`)})`];
    for (const t of tokens(address)) where.push(`address ILIKE ${sqlStr(`%${t.replace(/[%_]/g, "")}%`)}`);
    if (zip) where.push(`zip = ${sqlStr(zip.padStart(5, "0"))}`);
    const rows = await sql(`SELECT ${COLS} FROM ${RES} WHERE ${where.join(" AND ")} ORDER BY resultdttm DESC NULLS LAST LIMIT 5000`);
    return [...groupBy(rows, (r) => r.licenseno).values()].slice(0, limit).map(summary);
  },
  async history(_env, id, n) {
    const rows = await sql(`SELECT ${COLS} FROM ${RES} WHERE licenseno = ${sqlStr(id)} ORDER BY resultdttm DESC NULLS LAST LIMIT 3000`);
    if (!rows.length) return { error: `No Boston establishment with license number ${id}` };
    return { ...summary(rows), inspections: inspections(rows).slice(0, n) };
  },
  badge(s) {
    const r = String(s.current_result ?? "");
    const v = s.latest_violation_count as number;
    return { text: r.replace(" (extension granted)", "") || "?", sub: viol(v), tone: resultTone(r) };
  },
};
