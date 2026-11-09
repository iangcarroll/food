import { bulkHistory, bulkSearch } from "../bulk";
import { type CityDef, dem, gradeTone, scoreTone } from "./types";

export const la: CityDef = {
  id: "la",
  label: "Los Angeles County",
  region: "California, US",
  centers: [[34.0522, -118.2437]],
  ratingSystem:
    "LA County DPH: score out of 100, HIGHER is better. A = 90-100, B = 80-89, C = 70-79. " +
    "Excludes Pasadena, Long Beach and Vernon (own health depts). Published data lags by weeks.",
  scale: [{ text: "A", tone: "blue" }, { text: "B", tone: "green" }, { text: "C", tone: "orange" }],
  scaleHint: "score /100 · higher = better",
  blurb: "A is 90+, B is 80–89, C is 70–79. Doesn't cover Pasadena, Long Beach or Vernon; published with a few weeks' lag.",
  source: { name: "LA County DPH", url: "https://data.lacounty.gov" },
  examples: ["In-N-Out", "Langer's", "Philippe"],
  idHint: "LA record id like PR0012345",
  zipSupported: true,
  search: (env, q) => bulkSearch(env, "la", q.name, q.address, q.zip, q.limit),
  history: (env, id, n) => bulkHistory(env, "la", id, n),
  badge(s) {
    const score = s.latest_score as number | null;
    const g = s.current_grade as string | null;
    return {
      text: g || (score != null ? String(score) : "?"),
      sub: score != null ? `${score}/100` : undefined,
      tone: g ? gradeTone(g) : score != null ? scoreTone(score, [90, 80, 70], true) : "gray",
    };
  },
};

export const lasVegas: CityDef = {
  id: "las_vegas",
  label: "Las Vegas",
  region: "Clark County, Nevada, US",
  centers: [[36.1699, -115.1398]],
  ratingSystem:
    "Southern Nevada Health District: demerits, LOWER is better. A = 0-10, B = 11-20, C = 21-40, " +
    "X = closed (imminent health hazard).",
  scale: [{ text: "A", tone: "blue" }, { text: "B", tone: "green" }, { text: "C", tone: "orange" }, { text: "X", tone: "red" }],
  scaleHint: "demerits · lower = better",
  blurb: "A is 0–10 demerits, B is 11–20, C is 21–40, and X means closed.",
  source: { name: "SNHD", url: "https://www.southernnevadahealthdistrict.org/permits-and-regulations/restaurant-inspections/" },
  examples: ["Lotus of Siam", "Earl of Sandwich", "Secret Pizza"],
  idHint: "Southern Nevada permit number",
  zipSupported: true,
  search: (env, q) => bulkSearch(env, "las_vegas", q.name, q.address, q.zip, q.limit),
  history: (env, id, n) => bulkHistory(env, "las_vegas", id, n),
  badge(s) {
    const d = s.current_demerits == null ? null : Number(s.current_demerits);
    const g = s.current_grade as string | null;
    return {
      text: g || "?",
      sub: d == null ? undefined : dem(d),
      tone: g ? gradeTone(g) : d != null ? scoreTone(d, [10, 20, 40], false) : "gray",
    };
  },
};
