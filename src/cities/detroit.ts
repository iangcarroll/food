import { arcgis, groupBy, inList, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, nameMatch } from "../util";
import type { CityDef } from "./types";

const BASE = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/food_service_establishment_inspections/FeatureServer";

const insSummary = (i: Json | undefined) => {
  if (!i) return { current_result: null, latest_inspection_date: null };
  const p = Number(i.num_priority_violations ?? 0), f = Number(i.num_foundation_violations ?? 0), c = Number(i.num_core_violations ?? 0);
  return {
    current_result: i.is_in_compliance === "True" ? "In compliance" : "Not in compliance",
    latest_inspection_date: i.inspection_date,
    latest_priority_violations: p,
    latest_foundation_violations: f,
    latest_core_violations: c,
    latest_violation_count: p + f + c,
  };
};

export const detroit: CityDef = {
  id: "detroit",
  label: "Detroit",
  region: "Michigan, US",
  centers: [[42.3314, -83.0458]],
  ratingSystem:
    "Detroit Health Department (Michigan Food Code): each inspection is In compliance or Not in compliance, with counts of " +
    "Priority (most serious), Priority Foundation, and Core violations. No score or letter grade. Data starts late 2021.",
  scale: [{ text: "In compl.", tone: "green" }, { text: "Not in compl.", tone: "red" }],
  scaleHint: "compliance · no score",
  blurb: "In or out of compliance, with violations counted as priority, priority foundation, or core.",
  source: { name: "Detroit Health Dept.", url: "https://data.detroitmi.gov" },
  examples: ["Buddy's", "Supino", "Mudgie's"],
  idHint: "Detroit establishment id",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const where = [likeName("establishment_name", name)];
    if (zip) where.push(`zip_code = ${sqlStr(zip)}`);
    if (address) where.push(likeAll("address", address));
    const ests = (await arcgis(`${BASE}/0`, { where: where.join(" AND "), resultRecordCount: 200 }))
      .filter((e) => nameMatch(e.establishment_name, name))
      .slice(0, 100);
    if (!ests.length) return [];
    const insp = await arcgis(`${BASE}/1`, {
      where: `establishment_id IN ${inList(ests.map((e) => e.establishment_id))}`,
      orderByFields: "inspection_date DESC",
      resultRecordCount: 2000,
    });
    const latest = new Map<number, Json>();
    for (const i of insp) if (!latest.has(i.establishment_id)) latest.set(i.establishment_id, i);
    return ests
      .map((e) => ({
        id: String(e.establishment_id),
        name: e.establishment_name,
        address: [e.address, e.city, e.zip_code].filter(Boolean).join(" "),
        status: e.establishment_status,
        ...insSummary(latest.get(e.establishment_id)),
      }))
      .sort((a, b) => String(b.latest_inspection_date ?? "").localeCompare(String(a.latest_inspection_date ?? "")))
      .slice(0, limit) as Json[];
  },
  async history(_env, id, n) {
    if (!/^\d+$/.test(id)) return { error: `Detroit establishment ids are numeric; got ${id}` };
    const [est] = await arcgis(`${BASE}/0`, { where: `establishment_id = ${id}` });
    if (!est) return { error: `No Detroit establishment with id ${id}` };
    const insp = await arcgis(`${BASE}/1`, { where: `establishment_id = ${id}`, orderByFields: "inspection_date DESC", resultRecordCount: n });
    const viols = insp.length
      ? await arcgis(`${BASE}/2`, { where: `inspection_id IN ${inList(insp.map((i) => i.inspection_id))}`, resultRecordCount: 2000 })
      : [];
    const vBy = groupBy(viols, (v) => v.inspection_id);
    return {
      id,
      name: est.establishment_name,
      address: [est.address, est.city, est.zip_code].filter(Boolean).join(" "),
      status: est.establishment_status,
      ...insSummary(insp[0]),
      inspections: insp.map((i) => ({
        date: i.inspection_date,
        type: i.inspection_type,
        result: i.is_in_compliance === "True" ? "In compliance" : "Not in compliance",
        violations: (vBy.get(i.inspection_id) ?? []).map((v) => ({
          code: v.violation_code,
          type: v.violation_type,
          problem: v.problem_description,
          corrected: v.is_corrected,
          description: String(v.violation_description ?? "").replace(/\s+/g, " ").slice(0, 400),
        })),
      })),
    };
  },
  badge(s) {
    const ok = s.current_result === "In compliance";
    const p = s.latest_priority_violations as number | undefined;
    return {
      text: s.current_result ? (ok ? "In compliance" : "Not in compliance") : "?",
      sub: p == null ? undefined : `${p} priority`,
      tone: s.current_result ? (ok ? "green" : "red") : "gray",
    };
  },
};
