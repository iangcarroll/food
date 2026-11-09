import { cachedJson, groupBy } from "../lib/http";
import { type Json, compact, nameMatch, tokensMatch } from "../util";
import { placardTone } from "./marin";
import { type CityDef, viol } from "./types";

// Toronto DineSafe via CKAN datastore_search (SQL isn't exposed). One row per infraction;
// clean inspections have a single row whose fields are the string "None". Rolling ~2 years.
const API = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search";
const RES = "75dbb3ff-8281-4f03-9de2-bd1214761302";

type TRow = Record<string, string | null>;
const none = (v: string | null | undefined) => (v == null || v === "None" ? null : v);

async function rows(params: Record<string, string>): Promise<TRow[]> {
  const u = new URL(API);
  u.searchParams.set("id", RES);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const d = await cachedJson<{ success: boolean; result: { records: TRow[] } }>(u);
  if (!d.success) throw new Error("Toronto DineSafe query failed");
  return d.result.records;
}

const STATUS: Record<string, string> = { Pass: "Pass (green)", "Conditional Pass": "Conditional Pass (yellow)", Closed: "Closed (red)" };

function inspections(rs: TRow[]) {
  return [...groupBy(rs, (r) => r.inspectionDate).values()].map((g) => ({
    date: g[0].inspectionDate,
    status: STATUS[g[0].inspectionStatus ?? ""] ?? g[0].inspectionStatus,
    infractions: g
      .filter((r) => none(r.typeDesc))
      .map((r) => ({
        description: r.typeDesc,
        category: none(r.deficiencyDesc),
        severity: none(r.severity),
        outcome: none(r.OutcomeDesc),
        fine: r.amountFined ? Number(r.amountFined) : undefined,
      })),
  }));
}

function summary(rs: TRow[]): Json {
  const i = inspections(rs);
  return {
    id: rs[0].estId,
    name: rs[0].estName,
    address: rs[0].address?.replace(/\bNone\b\s*/g, "").trim(),
    current_status: i[0]?.status ?? null,
    latest_inspection_date: i[0]?.date ?? null,
    latest_violation_count: i[0]?.infractions.length ?? 0,
  };
}

export const toronto: CityDef = {
  id: "toronto",
  label: "Toronto",
  region: "Ontario, Canada",
  centers: [[43.6532, -79.3832]],
  ratingSystem:
    "Toronto Public Health DineSafe: Pass (green sign), Conditional Pass (yellow), or Closed (red) after each inspection. No numeric score. " +
    "Infractions are rated Minor, Significant or Crucial, and any court outcome/fine is included. Data covers about the last 2 years.",
  scale: [{ text: "Pass", tone: "green" }, { text: "Cond.", tone: "yellow" }, { text: "Closed", tone: "red" }],
  scaleHint: "sign colour · no score",
  blurb: "Green, yellow or red DineSafe signs. Infractions are minor, significant or crucial.",
  source: { name: "Toronto Public Health", url: "https://open.toronto.ca/dataset/dinesafe/" },
  examples: ["Pai Northern Thai", "Pizzeria Libretto", "Banh Mi Boys"],
  idHint: "DineSafe establishment id",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (!words.length) return [];
    const q = words.map((w) => `${w}:*`).join(" & ");
    const rs = await rows({ q: JSON.stringify({ estName: q }), plain: "false", sort: "inspectionDate desc", limit: "5000" });
    const z = zip ? compact(zip) : "";
    const hits = rs.filter(
      (r) => nameMatch(r.estName, name) && tokensMatch(r.address ?? "", address) && (!z || compact(r.address).includes(z)),
    );
    // Fall back to the full-text match when punctuation/stemming defeats the strict local check.
    const use = hits.length ? hits : rs.filter((r) => tokensMatch(r.address ?? "", address));
    return [...groupBy(use, (r) => r.estId).values()].slice(0, limit).map(summary);
  },
  async history(_env, id, n) {
    const rs = await rows({ filters: JSON.stringify({ estId: id }), sort: "inspectionDate desc", limit: "2000" });
    if (!rs.length) return { error: `No Toronto DineSafe establishment with id ${id}` };
    return { ...summary(rs), inspections: inspections(rs).slice(0, n) };
  },
  badge(s) {
    const st = String(s.current_status ?? "");
    return {
      text: st ? st.replace(/ \(.*\)/, "").replace("Conditional Pass", "Cond. Pass") : "?",
      sub: viol(Number(s.latest_violation_count ?? 0)),
      tone: placardTone(st),
    };
  },
};
