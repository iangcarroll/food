import { cachedJson } from "../lib/http";
import { type Json, date10 } from "../util";
import type { CityDef, Tone } from "./types";

// UK Food Standards Agency, Food Hygiene Rating Scheme API (no key). Latest rating only; no history.
const API = "https://api.ratings.food.gov.uk";
const H = { "x-api-version": "2" };

type Est = Record<string, any>;

const summary = (e: Est): Json => ({
  id: String(e.FHRSID),
  name: e.BusinessName,
  address: [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.AddressLine4, e.PostCode].filter((x: string) => x?.trim()).join(", "),
  business_type: e.BusinessType,
  local_authority: e.LocalAuthorityName,
  scheme: e.SchemeType === "FHIS" ? "FHIS (Scotland)" : "FHRS",
  rating: e.RatingValue,
  rating_date: date10(e.RatingDate),
  latest_inspection_date: date10(e.RatingDate),
  new_rating_pending: e.NewRatingPending || undefined,
  // Penalty points from the last inspection: LOWER is better.
  scores: e.scores && Object.values(e.scores).some((v) => v != null) ? e.scores : undefined,
});

export const uk: CityDef = {
  id: "uk",
  label: "London & the UK",
  region: "England, Wales, Scotland & Northern Ireland",
  centers: [[51.5074, -0.1278]],
  ratingSystem:
    "UK Food Standards Agency. England, Wales & Northern Ireland use the Food Hygiene Rating Scheme: 0 to 5, HIGHER is better " +
    "(5 very good, 4 good, 3 generally satisfactory, 2 improvement necessary, 1 major improvement necessary, 0 urgent improvement necessary). " +
    "Scotland uses FHIS: Pass or Improvement Required. 'scores' are penalty points from the last inspection (LOWER is better). " +
    "Only the current rating is published, not inspection history or violation text. Use `address` (e.g. 'London' or a postcode) to narrow by place.",
  scale: [{ text: "5", tone: "blue" }, { text: "4", tone: "green" }, { text: "3", tone: "yellow" }, { text: "2", tone: "orange" }, { text: "0–1", tone: "red" }],
  scaleHint: "0–5 · higher = better",
  blurb: "Ratings from 0 to 5 (Pass / Improvement Required in Scotland). Covers all of London and the UK.",
  source: { name: "Food Standards Agency", url: "https://ratings.food.gov.uk" },
  examples: ["Dishoom", "St. John", "Padella"],
  idHint: "FHRS id",
  zipSupported: true,
  async search(_env, { name, address, zip, limit }) {
    const u = new URL(`${API}/Establishments`);
    u.searchParams.set("name", name);
    const where = [address, zip].filter(Boolean).join(" ");
    if (where) u.searchParams.set("address", where);
    u.searchParams.set("pageSize", String(limit));
    const d = await cachedJson<{ establishments: Est[] }>(u, H);
    return d.establishments.map(summary);
  },
  async history(_env, id, _n) {
    if (!/^\d+$/.test(id)) return { error: `FHRS ids are numeric; got ${id}` };
    try {
      const e = await cachedJson<Est>(`${API}/Establishments/${id}`, H);
      const s = summary(e);
      return {
        ...s,
        note: "The FSA publishes only the current rating; past inspections and violation details aren't available.",
        inspections: [{ date: s.rating_date, rating: s.rating, scores: s.scores }],
      };
    } catch {
      return { error: `No UK establishment with FHRS id ${id}` };
    }
  },
  badge(s) {
    const r = String(s.rating ?? "");
    if (/^\d$/.test(r)) {
      const n = Number(r);
      const tone: Tone = n === 5 ? "blue" : n === 4 ? "green" : n === 3 ? "yellow" : n === 2 ? "orange" : "red";
      const label = ["Urgent improvement necessary", "Major improvement necessary", "Improvement necessary", "Generally satisfactory", "Good", "Very good"][n];
      return { text: r, sub: label, tone };
    }
    if (/improvement/i.test(r)) return { text: "Improvement Required", tone: "red" };
    if (/pass/i.test(r)) return { text: r.replace("and Eat Safe", "& Eat Safe"), tone: r.includes("Eat Safe") ? "blue" : "green" };
    return { text: r.replace(/([a-z])([A-Z])/g, "$1 $2") || "?", tone: "gray" };
  },
};
