import { arcgis, groupBy, inList, likeName, msDate, sqlStr } from "../lib/http";
import { type Json, nameMatch, tokensMatch } from "../util";
import { type CityDef, gradeTone, scoreTone } from "./types";

const S = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services";
const RECENT = `${S}/FoodServiceData/FeatureServer/0`; // flat, rolling 12 months, has grade
const INSP = `${S}/Louisville_Metro_KY_Environmental_Health_Bulk_Data_Inspections/FeatureServer/0`;
const EST = `${S}/Louisville_Metro_KY_Environmental_Health_Bulk_Data_Establishments/FeatureServer/0`;
const VIOL = `${S}/Louisville_Metro_KY_Environmental_Health_Bulk_Data_Inspection_Violations/FeatureServer/0`;

const addr = (r: Json) => [r.Address, r.City, r.Zip].filter(Boolean).join(" ");

export const louisville: CityDef = {
  id: "louisville",
  label: "Louisville",
  region: "Kentucky, US",
  centers: [[38.2527, -85.7585]],
  ratingSystem:
    "Louisville Metro Public Health: score out of 100 (HIGHER is better) plus a letter grade A/B/C on regular inspections. " +
    "The grade also reflects whether critical violations were corrected, so a high score can still carry a B or C.",
  scale: [{ text: "A", tone: "blue" }, { text: "B", tone: "green" }, { text: "C", tone: "orange" }],
  scaleHint: "score /100 + letter grade",
  blurb: "A score out of 100 plus a letter grade that also counts uncorrected critical violations.",
  source: { name: "Louisville Metro", url: "https://data.louisvilleky.gov" },
  examples: ["Hammerheads", "Hell or High Water", "Jack Fry's"],
  idHint: "Louisville establishment id",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const where = [likeName("EstablishmentName", name)];
    if (zip && /^\d+$/.test(zip)) where.push(`Zip = ${Number(zip)}`);
    const rows = await arcgis(RECENT, { where: where.join(" AND "), orderByFields: "InspectionDate DESC", resultRecordCount: 2000 });
    const hits = rows.filter((r) => nameMatch(r.EstablishmentName, name) && tokensMatch(addr(r), address));
    return [...groupBy(hits, (r) => r.EstablishmentID).values()].slice(0, limit).map((g) => {
      const graded = g.find((r) => r.Grade);
      return {
        id: String(g[0].EstablishmentID),
        name: g[0].EstablishmentName,
        address: addr(g[0]) || null,
        facility_type: g[0].TypeDescription,
        current_grade: graded?.Grade ?? null,
        latest_score: g[0].score,
        latest_inspection_date: msDate(g[0].InspectionDate),
      };
    });
  },
  async history(_env, id, n) {
    if (!/^\d+$/.test(id)) return { error: `Louisville establishment ids are numeric; got ${id}` };
    const [est, insp, recent] = await Promise.all([
      arcgis(EST, { where: `EstablishmentID = ${id}` }).then((r) => r[0]),
      arcgis(INSP, { where: `EstablishmentID = ${id}`, orderByFields: "InspectionDate DESC", resultRecordCount: n }),
      arcgis(RECENT, { where: `EstablishmentID = ${id}`, orderByFields: "InspectionDate DESC", resultRecordCount: 50 }),
    ]);
    if (!est && !insp.length) return { error: `No Louisville establishment with id ${id}` };
    const grades = new Map(recent.map((r) => [r.InspectionID, r.Grade]));
    // The bulk table lags the 12-month table by days to weeks; fold in anything it's missing.
    const have = new Set(insp.map((i) => i.InspectionID));
    for (const r of recent) {
      if (!have.has(r.InspectionID)) insp.push({ InspectionID: r.InspectionID, InspectionDate: r.InspectionDate, InspectionType: r.Ins_TypeDesc, score: r.score });
    }
    insp.sort((a, b) => String(msDate(b.InspectionDate)).localeCompare(String(msDate(a.InspectionDate))));
    insp.splice(n);
    const viols = insp.length
      ? await arcgis(VIOL, { where: `inspection_id IN ${inList(insp.map((i) => i.InspectionID))}`, resultRecordCount: 2000 })
      : [];
    const vBy = groupBy(viols, (v) => v.inspection_id);
    const inspections = insp.map((i) => ({
      date: msDate(i.InspectionDate),
      type: i.InspectionType,
      score: i.score,
      grade: grades.get(i.InspectionID) ?? null,
      violations: (vBy.get(i.InspectionID) ?? []).map((v) => ({
        description: v.ViolationDesc,
        weight: v.weight,
        critical: v.critical_yn === "Yes",
        comments: v.comments?.trim() || null,
      })),
    }));
    return {
      id,
      name: est?.PremiseName ?? recent[0]?.EstablishmentName ?? null,
      address: est ? [est.PermiseStreetNo, est.PremiseStreet, est.PremiseCity, est.PremiseZip].filter(Boolean).join(" ") : null,
      facility_type: est?.EstType ?? null,
      status: est?.Status ?? null,
      current_grade: recent.find((r) => r.Grade)?.Grade ?? null,
      latest_score: insp[0]?.score ?? null,
      latest_inspection_date: inspections[0]?.date ?? null,
      inspections,
    };
  },
  badge(s) {
    const score = s.latest_score as number | null;
    const g = s.current_grade as string | null;
    return {
      text: g || (score != null ? String(score) : "?"),
      sub: score != null ? `${score}/100` : undefined,
      tone: g ? gradeTone(g) : score != null ? scoreTone(score, [85, 75, 70], true) : "gray",
    };
  },
};
