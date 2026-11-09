import { type Row, groupBy, likeAll, likeName, sqlStr, unq } from "../lib/http";
import { type Json, date10, nameMatch } from "../util";
import { soda } from "./socrata";
import { type CityDef, type Tone, viol } from "./types";

const URL_ = "https://data.cincinnati-oh.gov/resource/rg6p-b3h3.json"; // one row per violation / action

// Inspection-level statuses (vs per-violation ones like "Abated" / "Not Abated").
const OUTCOME = /^(Approved|CLOS|Not In Compliance|Closed|Cancelled|No Access)/i;

function inspections(rows: Row[]) {
  return [...groupBy(rows, (r) => r.recordnum_insp).values()].map((g) => {
    const outcome = g.find((r) => OUTCOME.test(r.action_status ?? ""))?.action_status ?? null;
    const viols = g.filter((r) => r.code);
    return {
      date: date10(g[0].action_date),
      type: [g[0].insp_type, g[0].insp_subtype].filter(Boolean).join(" / "),
      outcome: outcome?.replace(/^CLOS-NO\s+-\s+/, ""),
      violations: viols.map((r) => ({
        code: r.code,
        description: unq(r.violation_description)?.replace(/^\S+ - Violation - /, "").replace(/\s+/g, " ").slice(0, 400),
        status: r.action_status,
        comments: unq(r.violation_comments) || null,
      })),
    };
  });
}

function summary(rows: Row[]): Json {
  const r0 = rows[0];
  const insp = inspections(rows);
  const open = insp[0]?.violations.filter((v) => v.status === "Not Abated").length ?? 0;
  return {
    id: r0.license_no,
    name: unq(r0.business_name),
    address: `${r0.address}, ${r0.city} ${r0.postal_code ?? ""}`.trim(),
    neighborhood: r0.neighborhood,
    license_status: r0.license_status,
    latest_outcome: insp[0]?.outcome ?? null,
    latest_inspection_date: insp[0]?.date ?? null,
    latest_violation_count: insp[0]?.violations.length ?? 0,
    latest_uncorrected_violations: open,
  };
}

export const cincinnati: CityDef = {
  id: "cincinnati",
  label: "Cincinnati",
  region: "Ohio, US",
  centers: [[39.1031, -84.512]],
  ratingSystem:
    "Cincinnati Health Department (Ohio Uniform Food Safety Code): no score or grade. Each inspection lists violations, each marked " +
    "Abated (corrected), Abated On-Site, or Not Abated; some inspections carry an outcome such as 'Approved - No Violations' or 'Not In Compliance'.",
  scale: [{ text: "None", tone: "green" }, { text: "Some", tone: "yellow" }, { text: "Not abated", tone: "orange" }],
  scaleHint: "violations · no score",
  blurb: "No grade: you get the violations from each inspection and whether they were corrected.",
  source: { name: "Cincinnati Health Dept.", url: "https://data.cincinnati-oh.gov/d/rg6p-b3h3" },
  examples: ["Skyline Chili", "Camp Washington", "Graeter's"],
  idHint: "Cincinnati license number like FSO-013375-C4S",
  zipSupported: true,
  async search(env, { name, address, zip, limit }) {
    const where = [likeName("business_name", name), "action_date IS NOT NULL"];
    if (zip) where.push(`postal_code = ${sqlStr(zip)}`);
    if (address) where.push(likeAll("address", address));
    const rows = await soda(env, URL_, { $where: where.join(" AND "), $order: "action_date DESC, recordnum_insp DESC", $limit: "4000" });
    const hits = rows.filter((r) => nameMatch(r.business_name, name));
    return [...groupBy(hits, (r) => r.license_no).values()].slice(0, limit).map(summary);
  },
  async history(env, id, n) {
    const rows = await soda(env, URL_, { $where: `license_no = ${sqlStr(id)} AND action_date IS NOT NULL`, $order: "action_date DESC, recordnum_insp DESC", $limit: "3000" });
    if (!rows.length) return { error: `No Cincinnati establishment with license number ${id}` };
    return { ...summary(rows), inspections: inspections(rows).slice(0, n) };
  },
  badge(s) {
    const v = Number(s.latest_violation_count ?? 0);
    const open = Number(s.latest_uncorrected_violations ?? 0);
    const bad = /not in compliance/i.test(String(s.latest_outcome ?? ""));
    const tone: Tone = bad ? "red" : v === 0 ? "green" : open > 0 ? "orange" : "yellow";
    const text = bad ? "Not in compliance" : v === 0 ? "No violations" : open ? "Uncorrected" : "Corrected";
    return { text, sub: v === 0 ? undefined : open ? `${viol(v)} · ${open} open` : viol(v), tone };
  },
};
