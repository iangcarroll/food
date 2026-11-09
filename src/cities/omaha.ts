import { arcgis, groupBy, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, nameMatch } from "../util";
import type { CityDef, Tone } from "./types";

const URL_ = "https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Restaurant_Inspections/FeatureServer/14";
const addr = (r: Json) => `${r.est_address}, ${r.est_city} ${r.est_zip ?? ""}`.trim();

const summary = (rows: Json[]): Json => ({
  id: rows[0].permit_number,
  name: rows[0].est_name,
  address: addr(rows[0]),
  current_grade: rows[0].rating ?? null,
  latest_inspection_date: rows[0].inspection_date,
  latest_report_url: rows[0].downloadDetailsUrl,
});

export const omaha: CityDef = {
  id: "omaha",
  label: "Omaha / Douglas County",
  region: "Nebraska, US",
  centers: [[41.2565, -95.9345]],
  ratingSystem:
    "Douglas County Health Department: letter grade A (best) through F after each inspection. There's no numeric score in the data, " +
    "and violation details are only in each inspection's PDF report (linked). The published data only starts Dec 4, 2025, when the county's new system went live, so a place that hasn't been inspected since then won't be found yet.",
  scale: [{ text: "A", tone: "blue" }, { text: "B", tone: "green" }, { text: "C", tone: "orange" }, { text: "D", tone: "red" }, { text: "F", tone: "red" }],
  scaleHint: "letter grade · A best",
  blurb: "Letter grades A through F. Only places inspected since Dec 2025 are published; violation details are in linked PDF reports.",
  source: { name: "Douglas County Health Dept.", url: "https://www.douglascountyhealth.com" },
  examples: ["Block 16", "Runza", "Dairy Chef"],
  idHint: "Douglas County permit number like FS-68561-25",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const where = [likeName("est_name", name)];
    if (zip && /^\d+$/.test(zip)) where.push(`est_zip = ${Number(zip)}`);
    if (address) where.push(likeAll("est_address", address));
    const rows = (await arcgis(URL_, { where: where.join(" AND "), orderByFields: "inspection_date DESC", resultRecordCount: 2000 })).filter((r) =>
      nameMatch(r.est_name, name),
    );
    return [...groupBy(rows, (r) => r.permit_number).values()].slice(0, limit).map(summary);
  },
  async history(_env, id, n) {
    const rows = await arcgis(URL_, { where: `permit_number = ${sqlStr(id)}`, orderByFields: "inspection_date DESC", resultRecordCount: n });
    if (!rows.length) return { error: `No Douglas County establishment with permit number ${id}` };
    return {
      ...summary(rows),
      inspections: rows.map((r) => ({ date: r.inspection_date, grade: r.rating ?? null, report_pdf: r.downloadDetailsUrl })),
    };
  },
  badge(s) {
    const g = String(s.current_grade ?? "");
    const tone: Tone = ({ A: "blue", B: "green", C: "orange", D: "red", F: "red" } as Record<string, Tone>)[g] ?? "gray";
    return { text: g || "?", tone };
  },
};
