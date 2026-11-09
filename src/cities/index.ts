import { austin } from "./austin";
import { boston } from "./boston";
import { la, lasVegas } from "./bulk-cities";
import { chicago } from "./chicago";
import { nyc } from "./nyc";
import { sf } from "./sf";
import { cincinnati } from "./cincinnati";
import { detroit } from "./detroit";
import { fairfax } from "./fairfax";
import { france } from "./france";
import { louisville } from "./louisville";
import { marin } from "./marin";
import { nys } from "./nys";
import { omaha } from "./omaha";
import { sacramento } from "./sacramento";
import { santaClara } from "./santa-clara";
import { toronto } from "./toronto";
import type { CityDef } from "./types";
import { uk } from "./uk";
import { wake } from "./wake";

/** Every supported jurisdiction, in display order. Add a city by writing a CityDef and listing it here. */
export const CITY_LIST: CityDef[] = [
  nyc, sf, la, lasVegas, chicago, boston, austin,
  santaClara, marin, sacramento, wake, louisville, detroit, cincinnati, nys, omaha, fairfax,
  uk, toronto, france,
];

export const CITIES: Record<string, CityDef> = Object.fromEntries(CITY_LIST.map((c) => [c.id, c]));
export type { CityDef } from "./types";
