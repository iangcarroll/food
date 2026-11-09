import { arcgis, groupBy, inList, likeAll, likeName, msDate, sqlStr } from "../lib/http";
import { type Json, nameMatch } from "../util";
import { type CityDef, scoreTone } from "./types";

const BASE = "https://maps.wake.gov/arcgis/rest/services/Inspections/RestaurantInspectionsOpenData/MapServer";
const ncGrade = (s: number | null) => (s == null ? null : s >= 90 ? "A" : s >= 80 ? "B" : s >= 70 ? "C" : "Fail");

export const wake: CityDef = {
  id: "raleigh",
  label: "Raleigh / Wake County",
  region: "North Carolina, US",
  centers: [[35.7796, -78.6382]],
  ratingSystem:
    "Wake County (NC) Environmental Health: score out of 100, HIGHER is better. NC grade cards: A = 90+, B = 80-89.5, C = 70-79.5; " +
    "below 70 the permit is revoked. Covers Raleigh, Cary, Durham-adjacent Wake County towns.",
  scale: [{ text: "A", tone: "blue" }, { text: "B", tone: "green" }, { text: "C", tone: "orange" }],
  scaleHint: "score /100 · higher = better",
  blurb: "A is 90+, B is 80–89.5, C is 70–79.5. Below 70 the permit is revoked.",
  source: { name: "Wake County", url: "https://data-wake.opendata.arcgis.com" },
  examples: ["Poole's", "Clyde Cooper's", "Char-Grill"],
  idHint: "Wake County HSISID",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const where = [likeName("NAME", name)];
    if (zip) where.push(`POSTALCODE LIKE ${sqlStr(zip + "%")}`);
    if (address) where.push(likeAll("ADDRESS1", address));
    const ests = (await arcgis(`${BASE}/0`, { where: where.join(" AND "), resultRecordCount: 200 })).filter((e) => nameMatch(e.NAME, name));
    if (!ests.length) return [];
    const ids = ests.slice(0, 100).map((e) => e.HSISID as string);
    const insp = await arcgis(`${BASE}/1`, { where: `HSISID IN ${inList(ids)}`, orderByFields: "DATE_ DESC", resultRecordCount: 2000 });
    const latest = new Map<string, Json>();
    for (const i of insp) if (!latest.has(i.HSISID)) latest.set(i.HSISID, i);
    return ests
      .slice(0, 100)
      .map((e) => {
        const l = latest.get(e.HSISID) as Json | undefined;
        const score = (l?.SCORE as number) ?? null;
        return {
          id: e.HSISID,
          name: e.NAME?.trim(),
          address: `${e.ADDRESS1?.trim()}, ${e.CITY} ${e.POSTALCODE}`,
          facility_type: e.FACILITYTYPE,
          current_grade: ncGrade(score),
          latest_score: score,
          latest_inspection_date: msDate(l?.DATE_),
        } as Json;
      })
      .sort((a, b) => String(b.latest_inspection_date ?? "").localeCompare(String(a.latest_inspection_date ?? "")))
      .slice(0, limit);
  },
  async history(_env, id, n) {
    const [est] = await arcgis(`${BASE}/0`, { where: `HSISID = ${sqlStr(id)}` });
    if (!est) return { error: `No Wake County establishment with HSISID ${id}` };
    const [insp, viol] = await Promise.all([
      arcgis(`${BASE}/1`, { where: `HSISID = ${sqlStr(id)}`, orderByFields: "DATE_ DESC", resultRecordCount: n }),
      arcgis(`${BASE}/2`, { where: `HSISID = ${sqlStr(id)}`, orderByFields: "INSPECTDATE DESC", resultRecordCount: 2000 }),
    ]);
    const vByDate = groupBy(viol, (v) => msDate(v.INSPECTDATE));
    const inspections = insp.map((i) => ({
      date: msDate(i.DATE_),
      type: i.TYPE,
      score: i.SCORE,
      grade: ncGrade(i.SCORE),
      violations: (vByDate.get(msDate(i.DATE_)) ?? []).map((v) => ({
        code: String(v.VIOLATIONCODE ?? "").split(/\s+/)[0] || null,
        description: v.SHORTDESC,
        points: v.POINTVALUE,
        critical: v.CRITICAL === "Yes" || undefined,
        comments: v.COMMENTS?.slice(0, 600),
      })),
    }));
    const score = (insp[0]?.SCORE as number) ?? null;
    return {
      id,
      name: est.NAME?.trim(),
      address: `${est.ADDRESS1?.trim()}, ${est.CITY} ${est.POSTALCODE}`,
      facility_type: est.FACILITYTYPE,
      current_grade: ncGrade(score),
      latest_score: score,
      latest_inspection_date: inspections[0]?.date ?? null,
      inspections,
    };
  },
  badge(s) {
    const score = s.latest_score as number | null;
    if (score == null) return { text: "?", tone: "gray" };
    return { text: String(s.current_grade), sub: `${score}/100`, tone: scoreTone(score, [90, 80, 70], true) };
  },
};
