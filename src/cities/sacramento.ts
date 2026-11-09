import { arcgis, groupBy, likeAll, likeName, msDate } from "../lib/http";
import { type Json, nameMatch } from "../util";
import { placardTone } from "./marin";
import { type CityDef, viol } from "./types";

const URL_ = "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Food_Inspections/FeatureServer/1"; // row per violation
const RESULT: Record<string, string> = { PASS: "Pass (green)", "CONDITIONAL PASS": "Conditional Pass (yellow)", CLOSED: "Closed (red)" };
const res = (r?: string) => (r ? RESULT[r.trim().toUpperCase()] ?? r : null);

function inspections(rows: Json[]) {
  return [...groupBy(rows, (r) => `${r.Inspection_Date}|${r.Inspection_Type}`).values()].map((g) => ({
    date: msDate(g[0].Inspection_Date),
    type: g[0].Inspection_Type,
    result: res(g[0].Inspection_Result as string),
    report_url: g[0].Inspection_Report,
    violations: g.filter((r) => r.Violation_Description).map((r) => ({ description: r.Violation_Description })),
  }));
}

function summary(rows: Json[]): Json {
  const r0 = rows[0];
  const i = inspections(rows);
  return {
    id: r0.Facility_ID,
    name: r0.Facility_Name,
    address: r0.Facility_Address,
    facility_type: (r0.Description as string)?.trim(),
    current_result: i[0]?.result ?? null,
    latest_inspection_date: i[0]?.date ?? null,
    latest_violation_count: i[0]?.violations.length ?? 0,
  };
}

export const sacramento: CityDef = {
  id: "sacramento",
  label: "Sacramento County",
  region: "California, US",
  centers: [[38.5816, -121.4944]],
  ratingSystem:
    "Sacramento County EMD: color placard after each inspection (Green = Pass, Yellow = Conditional Pass, Red = Closed). No numeric score. " +
    "Each inspection links to its full PDF report. Data starts Nov 2023.",
  scale: [{ text: "Green", tone: "green" }, { text: "Yellow", tone: "yellow" }, { text: "Red", tone: "red" }],
  scaleHint: "placard · no score",
  blurb: "Green, yellow or red placards, with a link to every inspection report.",
  source: { name: "Sacramento County EMD", url: "https://emd.saccounty.gov" },
  examples: ["Tower Cafe", "Zocalo", "Shoki"],
  idHint: "Sacramento facility id like FA0001195",
  zipSupported: false,
  async search(_env, { name, address, limit }) {
    const where = [likeName("Facility_Name", name)];
    if (address) where.push(likeAll("Facility_Address", address));
    const rows = (await arcgis(URL_, { where: where.join(" AND "), orderByFields: "Inspection_Date DESC", resultRecordCount: 2000 })).filter((r) =>
      nameMatch(r.Facility_Name, name),
    );
    return [...groupBy(rows, (r) => r.Facility_ID).values()].slice(0, limit).map(summary);
  },
  async history(_env, id, n) {
    const rows = await arcgis(URL_, { where: `Facility_ID = '${id.replace(/'/g, "''")}'`, orderByFields: "Inspection_Date DESC", resultRecordCount: 2000 });
    if (!rows.length) return { error: `No Sacramento County facility with id ${id}` };
    return { ...summary(rows), inspections: inspections(rows).slice(0, n) };
  },
  badge(s) {
    const r = String(s.current_result ?? "");
    return {
      text: r ? r.replace(/ \(.*\)/, "").replace("Conditional Pass", "Cond. Pass") : "?",
      sub: viol(Number(s.latest_violation_count ?? 0)),
      tone: placardTone(r),
    };
  },
};
