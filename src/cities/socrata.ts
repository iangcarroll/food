import { type Row, cachedJson } from "../lib/http";
import type { Env } from "../util";

/** Query a Socrata (SODA) dataset, cached. Uses SOCRATA_APP_TOKEN when set (one token works on every portal). */
export function soda(env: Env, url: string, params: Record<string, string>): Promise<Row[]> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return cachedJson<Row[]>(u, env.SOCRATA_APP_TOKEN ? { "X-App-Token": env.SOCRATA_APP_TOKEN } : {});
}
