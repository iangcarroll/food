import type { Env, Json } from "../util";

/** Placard colors used on the landing page. */
export type Tone = "blue" | "green" | "orange" | "red" | "yellow" | "gray";

export interface Badge {
  /** Big text on the placard: a letter, a word, or a number. */
  text: string;
  /** Exact score under the placard, e.g. "95/100" or "19 demerits". */
  sub?: string;
  tone: Tone;
}

export interface SearchArgs {
  name: string;
  address?: string;
  zip?: string;
  limit: number;
}

export interface CityDef {
  id: string;
  label: string;
  /** e.g. "Illinois, US". */
  region: string;
  /** [lat, lon] points used to pick the visitor's default city on the landing page. */
  centers: [number, number][];
  /** Explanation returned with every result. */
  ratingSystem: string;
  /** Landing page: scale chips, a direction hint, and one sentence. */
  scale: { text: string; tone: Tone }[];
  scaleHint: string;
  blurb: string;
  source: { name: string; url: string };
  examples: string[];
  /** Description of the id format for get_inspection_history. */
  idHint: string;
  zipSupported: boolean;
  search(env: Env, q: SearchArgs): Promise<Json[]>;
  history(env: Env, id: string, n: number): Promise<Json>;
  badge(summary: Json): Badge;
}

export const scoreTone = (score: number, cuts: [number, number, number], higherBetter: boolean): Tone => {
  const [a, b, c] = cuts;
  if (higherBetter) return score >= a ? "blue" : score >= b ? "green" : score >= c ? "orange" : "red";
  return score <= a ? "blue" : score <= b ? "green" : score <= c ? "orange" : "red";
};

export const gradeTone = (g: unknown): Tone =>
  ({ A: "blue", B: "green", C: "orange", X: "red" } as Record<string, Tone>)[String(g)] ?? "gray";

/** Count labels shown beside the placard: "2 violations", "19 demerits". */
export const viol = (n: number) => `${n} violation${n === 1 ? "" : "s"}`;
export const dem = (n: number) => `${n} demerit${n === 1 ? "" : "s"}`;
