import { type Row, groupBy, likeAll, likeName, sqlStr } from "../lib/http";
import { type Json, nameMatch } from "../util";
import { soda } from "./socrata";
import { type CityDef, type Tone } from "./types";

const BIZ = "https://data.sccgov.org/resource/vuw7-jmjk.json";
const INSP = "https://data.sccgov.org/resource/2u2d-8jej.json";
const VIOL = "https://data.sccgov.org/resource/wkaa-4ccv.json";

const PLACARD: Record<string, string> = { G: "Pass (green)", Y: "Conditional Pass (yellow)", R: "Closed (red)" };
const ymd = (s?: string) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s ?? null);
const num = (s?: string) => (s == null || s === "" ? null : Number(s));
const inq = (vals: string[]) => "(" + vals.map(sqlStr).join(",") + ")";
const addr = (b: Row) => `${b.address}, ${b.city} ${b.postal_code ?? ""}`.trim();

export const santaClara: CityDef = {
  id: "santa_clara",
  label: "Santa Clara County",
  region: "San Jose & Silicon Valley, California, US",
  centers: [[37.3382, -121.8863], [37.4419, -122.143]],
  ratingSystem:
    "Santa Clara County DEH: color placard (Green = Pass, Yellow = Conditional Pass, Red = Closed) plus a score out of 100 " +
    "(HIGHER is better) on routine inspections. Covers San Jose, Palo Alto, Mountain View, Sunnyvale, etc. Data starts Oct 2024.",
  scale: [{ text: "Green", tone: "green" }, { text: "Yellow", tone: "yellow" }, { text: "Red", tone: "red" }],
  scaleHint: "placard + score /100",
  blurb: "Green, yellow or red placard, plus a score out of 100 on routine visits. Covers San Jose and Silicon Valley.",
  source: { name: "Santa Clara County DEH", url: "https://data.sccgov.org" },
  examples: ["Falafel's", "Original Joe's", "Pho Queen"],
  idHint: "Santa Clara business id like PR0300002",
  zipSupported: true,
  async search(env, { name, address, zip, limit }) {
    const where = [likeName("name", name)];
    if (zip) where.push(`postal_code = ${sqlStr(zip)}`);
    if (address) where.push(likeAll("address", address));
    const biz = (await soda(env, BIZ, { $where: where.join(" AND "), $limit: "200" })).filter((b) => nameMatch(b.name, name)).slice(0, 80);
    if (!biz.length) return [];
    const insp = await soda(env, INSP, {
      $where: `business_id in ${inq(biz.map((b) => b.business_id!))}`,
      $order: "date DESC",
      $limit: "3000",
    });
    const byBiz = groupBy(insp, (i) => i.business_id);
    return biz
      .map((b) => {
        const is = byBiz.get(b.business_id) ?? [];
        const scored = is.find((i) => i.score);
        return {
          id: b.business_id,
          name: b.name,
          address: addr(b),
          current_placard: is[0]?.result ? PLACARD[is[0].result] ?? is[0].result : null,
          latest_score: num(scored?.score),
          latest_inspection_date: ymd(is[0]?.date),
        } as Json;
      })
      .sort((a, b) => String(b.latest_inspection_date ?? "").localeCompare(String(a.latest_inspection_date ?? "")))
      .slice(0, limit);
  },
  async history(env, id, n) {
    const [biz] = await soda(env, BIZ, { $where: `business_id = ${sqlStr(id)}` });
    if (!biz) return { error: `No Santa Clara County business with id ${id}` };
    const insp = await soda(env, INSP, { $where: `business_id = ${sqlStr(id)}`, $order: "date DESC", $limit: String(n) });
    const viols = insp.length
      ? await soda(env, VIOL, { $where: `inspection_id in ${inq(insp.map((i) => i.inpsection_id!))}`, $limit: "2000" })
      : [];
    const vBy = groupBy(viols, (v) => v.inspection_id);
    const scored = insp.find((i) => i.score);
    return {
      id,
      name: biz.name,
      address: addr(biz),
      current_placard: insp[0]?.result ? PLACARD[insp[0].result] ?? insp[0].result : null,
      latest_score: num(scored?.score),
      latest_inspection_date: ymd(insp[0]?.date),
      inspections: insp.map((i) => ({
        date: ymd(i.date),
        type: i.type,
        placard: i.result ? PLACARD[i.result] ?? i.result : null,
        score: num(i.score),
        comment: i.inspection_comment?.slice(0, 600) || null,
        violations: (vBy.get(i.inpsection_id) ?? []).map((v) => ({
          code: v.code,
          description: v.description,
          critical: String(v.critical) === "true",
          comments: v.violation_comment?.slice(0, 600) || null,
        })),
      })),
    };
  },
  badge(s) {
    const p = String(s.current_placard ?? "");
    const tone: Tone = p.startsWith("Pass") ? "green" : p.startsWith("Cond") ? "yellow" : p.startsWith("Closed") ? "red" : "gray";
    const score = s.latest_score as number | null;
    return { text: p ? p.replace(/ \(.*\)/, "").replace("Conditional Pass", "Cond. Pass") : "?", sub: score != null ? `${score}/100` : undefined, tone };
  },
};
