import { cachedJson } from "../lib/http";
import { type Json, date10, nameMatch, tokensMatch } from "../util";
import type { CityDef, Tone } from "./types";

// France Alim'confiance (DGAL), Opendatasoft API. Rolling 12 months; one summary level per inspection, no violation detail.
const API = "https://dgal.opendatasoft.com/api/explore/v2.1/catalog/datasets/export_alimconfiance/records";

type FRow = Record<string, any>;
const LEVEL: Record<string, { en: string; tone: Tone }> = {
  "Très satisfaisant": { en: "Very satisfactory", tone: "blue" },
  Satisfaisant: { en: "Satisfactory", tone: "green" },
  "A améliorer": { en: "Needs improvement", tone: "orange" },
  "A corriger de manière urgente": { en: "Urgent correction required", tone: "red" },
};
const odsStr = (s: string) => '"' + s.replace(/["\\]/g, "") + '"';

async function query(where: string, limit: number): Promise<FRow[]> {
  const u = new URL(API);
  u.searchParams.set("where", where);
  u.searchParams.set("order_by", "date_inspection desc");
  u.searchParams.set("limit", String(limit));
  return (await cachedJson<{ results: FRow[] }>(u)).results;
}

const addr = (r: FRow) => [r.adresse_2_ua, r.code_postal, r.com_name || r.libelle_commune].filter(Boolean).join(" ");

const summary = (r: FRow): Json => ({
  id: r.code_ua,
  name: r.app_libelle_etablissement || r.libelle_etablissement,
  address: addr(r),
  activity: (r.app_libelle_activite_etablissement ?? []).join(", ") || r.type_activite,
  siret: r.siret,
  rating: LEVEL[r.synthese_eval_sanit]?.en ?? r.synthese_eval_sanit,
  rating_fr: r.synthese_eval_sanit,
  latest_inspection_date: date10(r.date_inspection),
});

export const france: CityDef = {
  id: "france",
  label: "Paris & France",
  region: "Nationwide, France",
  centers: [[48.8566, 2.3522]],
  ratingSystem:
    "France Alim'confiance (Ministry of Agriculture, DGAL): each inspection gets one of 4 levels: Très satisfaisant (very satisfactory), " +
    "Satisfaisant (satisfactory), A améliorer (needs improvement), A corriger de manière urgente (urgent correction required). " +
    "No score or violation details. Covers restaurants, shops and food businesses inspected in the last 12 months. " +
    "Use zip_code (e.g. 75011) or address words to narrow to Paris or a city.",
  scale: [
    { text: "Très sat.", tone: "blue" },
    { text: "Sat.", tone: "green" },
    { text: "À amél.", tone: "orange" },
    { text: "Urgent", tone: "red" },
  ],
  scaleHint: "4 levels · no score",
  blurb: "Four levels from très satisfaisant to urgent correction. Inspections from the last 12 months.",
  source: { name: "Alim'confiance (DGAL)", url: "https://alim-confiance.gouv.fr" },
  examples: ["Septime", "Breizh Cafe", "Bouillon Chartier"],
  idHint: "Alim'confiance unit code like 43485195200433_00001",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const where = [`search(app_libelle_etablissement, ${odsStr(name)})`];
    if (zip) where.push(`code_postal = ${odsStr(zip)}`);
    const rows = (await query(where.join(" AND "), 100)).filter((r) => tokensMatch(addr(r), address));
    const strict = rows.filter((r) => nameMatch(r.app_libelle_etablissement || r.libelle_etablissement, name));
    const seen = new Set<string>();
    return (strict.length ? strict : rows)
      .filter((r) => !seen.has(r.code_ua) && seen.add(r.code_ua))
      .slice(0, limit)
      .map(summary);
  },
  async history(_env, id, n) {
    const rows = await query(`code_ua = ${odsStr(id)}`, Math.min(n, 100));
    if (!rows.length) return { error: `No Alim'confiance establishment with code ${id}` };
    return {
      ...summary(rows[0]),
      inspections: rows.map((r) => ({
        date: date10(r.date_inspection),
        rating: LEVEL[r.synthese_eval_sanit]?.en ?? r.synthese_eval_sanit,
        rating_fr: r.synthese_eval_sanit,
        context: r.contexte_inpection,
      })),
    };
  },
  badge(s) {
    const l = LEVEL[String(s.rating_fr)];
    return l ? { text: String(s.rating_fr), sub: undefined, tone: l.tone } : { text: "?", tone: "gray" };
  },
};
