import { arcgis, inList, likeAll, likeName, msDate, sqlStr } from "../lib/http";
import { type Json, nameMatch } from "../util";
import type { CityDef, Tone } from "./types";

const BASE = "https://www.fairfaxcounty.gov/gispub2/rest/services/Health/PermittedFoodEstablishments/FeatureServer";
const addr = (e: Json) => `${e.PERMIT_ADDRESS}, ${e.PERMIT_CITY} ${e.PERMIT_ZIP}`;

export const fairfax: CityDef = {
  id: "fairfax",
  label: "Fairfax County",
  region: "Northern Virginia, US",
  centers: [[38.8462, -77.3064]],
  ratingSystem:
    "Fairfax County Health Department: each inspection is Passed, Partial Pass, or Failed. No score or letter grade, and " +
    "violation details aren't published as data (each inspection links to a report page). Data starts Nov 2024.",
  scale: [{ text: "Passed", tone: "green" }, { text: "Partial", tone: "yellow" }, { text: "Failed", tone: "red" }],
  scaleHint: "result · no score",
  blurb: "Passed, partial pass, or failed. Violation details are only on linked report pages.",
  source: { name: "Fairfax County Health Dept.", url: "https://www.fairfaxcounty.gov/health/food-safety" },
  examples: ["Pupatella", "Peking Gourmet Inn", "Chutzpah"],
  idHint: "Fairfax record id like HFOOD-000009369",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const where = [likeName("ESTABLISHMENT_NAME", name)];
    if (zip) where.push(`PERMIT_ZIP = ${sqlStr(zip)}`);
    if (address) where.push(likeAll("PERMIT_ADDRESS", address));
    const ests = (await arcgis(`${BASE}/0`, { where: where.join(" AND "), resultRecordCount: 200 }))
      .filter((e) => nameMatch(e.ESTABLISHMENT_NAME, name))
      .slice(0, 100);
    if (!ests.length) return [];
    const insp = await arcgis(`${BASE}/1`, {
      where: `RECORDID IN ${inList(ests.map((e) => e.RECORDID))}`,
      orderByFields: "INSPECTIONDATE DESC",
      resultRecordCount: 2000,
    });
    const latest = new Map<string, Json>();
    for (const i of insp) if (!latest.has(i.RECORDID)) latest.set(i.RECORDID, i);
    return ests
      .map((e) => {
        const l = latest.get(e.RECORDID);
        return {
          id: e.RECORDID,
          name: e.ESTABLISHMENT_NAME,
          address: addr(e),
          category: e.CATEGORY_TYPE,
          status: e.ESTABLISHMENT_STATUS,
          current_result: l?.INSPECTIONRESULT ?? null,
          latest_inspection_date: msDate(l?.INSPECTIONDATE ?? e.LAST_INSPECTION_DATE),
        } as Json;
      })
      .sort((a, b) => String(b.latest_inspection_date ?? "").localeCompare(String(a.latest_inspection_date ?? "")))
      .slice(0, limit);
  },
  async history(_env, id, n) {
    const [est] = await arcgis(`${BASE}/0`, { where: `RECORDID = ${sqlStr(id)}` });
    if (!est) return { error: `No Fairfax County establishment with record id ${id}` };
    const insp = await arcgis(`${BASE}/1`, { where: `RECORDID = ${sqlStr(id)}`, orderByFields: "INSPECTIONDATE DESC", resultRecordCount: n });
    return {
      id,
      name: est.ESTABLISHMENT_NAME,
      address: addr(est),
      category: est.CATEGORY_TYPE,
      status: est.ESTABLISHMENT_STATUS,
      current_result: insp[0]?.INSPECTIONRESULT ?? null,
      latest_inspection_date: msDate(insp[0]?.INSPECTIONDATE),
      inspections: insp.map((i) => ({ date: msDate(i.INSPECTIONDATE), result: i.INSPECTIONRESULT, report_url: i.WEBSITE_LINK })),
    };
  },
  badge(s) {
    const r = String(s.current_result ?? "");
    const tone: Tone = /fail/i.test(r) ? "red" : /partial/i.test(r) ? "yellow" : /pass/i.test(r) ? "green" : "gray";
    return { text: r || "?", tone };
  },
};
