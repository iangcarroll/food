// LA County + Las Vegas: bulk downloads, imported into D1 by the cron trigger.
import { unzipSync } from "fflate";
import { bytesStream, csvRecords } from "./csv";
import { CACHE_TTL_S, type Env, type Json, UA, compact, date10, tokens } from "./util";

type BulkCity = "la" | "las_vegas";

const LA_INSP_URL = "https://www.arcgis.com/sharing/rest/content/items/19b6607ac82c4512b10811870975dbdc/data";
const LA_VIOL_URL = "https://www.arcgis.com/sharing/rest/content/items/5eaea9f89b7549ee841da7617d3a9cba/data";
const LV_ZIP_URL = "https://www.southernnevadahealthdistrict.org/restaurants/download/restaurants.zip";

interface FacilityRow {
  id: string;
  nameKey: string;
  addressUp: string;
  zip: string;
  sortKey: string;
  summary: Json;
  inspections: Json[];
}

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

async function getMeta(db: D1Database, key: string): Promise<string | null> {
  return (await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<string>("value")) ?? null;
}

const setMeta = (db: D1Database, key: string, value: string) =>
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value);

const genCache = new Map<BulkCity, { gen: number | null; at: number }>();

async function currentGen(db: D1Database, city: BulkCity): Promise<number | null> {
  const c = genCache.get(city);
  if (c && Date.now() - c.at < 60_000) return c.gen;
  const v = await getMeta(db, `gen:${city}`);
  const gen = v ? Number(v) : null;
  genCache.set(city, { gen, at: Date.now() });
  return gen;
}

async function writeGeneration(db: D1Database, city: BulkCity, rows: Iterable<FacilityRow>): Promise<number> {
  const gen = Date.now();
  const stmt = db.prepare(
    "INSERT INTO facilities (city, gen, id, name_key, address_up, zip, sort_key, summary, inspections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  let batch: D1PreparedStatement[] = [];
  let bytes = 0;
  let count = 0;
  const flush = async () => {
    if (batch.length) await db.batch(batch);
    batch = [];
    bytes = 0;
  };
  try {
    for (const f of rows) {
      const insp = JSON.stringify(f.inspections);
      batch.push(stmt.bind(city, gen, f.id, f.nameKey, f.addressUp, f.zip, f.sortKey, JSON.stringify(f.summary), insp));
      bytes += insp.length;
      count++;
      if (batch.length >= 200 || bytes > 2_000_000) await flush();
    }
    await flush();
  } catch (e) {
    await db.prepare("DELETE FROM facilities WHERE city = ? AND gen = ?").bind(city, gen).run();
    throw e;
  }
  await db.batch([
    setMeta(db, `gen:${city}`, String(gen)),
    setMeta(db, `count:${city}`, String(count)),
    setMeta(db, `updated:${city}`, new Date().toISOString()),
  ]);
  genCache.delete(city);
  await db.prepare("DELETE FROM facilities WHERE city = ? AND gen <> ?").bind(city, gen).run();
  return count;
}

/** GET a source; returns null (and drops the body) if its validators match what we last imported. */
async function fetchIfChanged(db: D1Database, key: string, url: string, force: boolean) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
  const sig = [r.headers.get("etag"), r.headers.get("last-modified"), r.headers.get("content-length")].join("|");
  const unchanged = sig !== "||" && sig === (await getMeta(db, `sig:${key}`));
  return { res: r, sig, unchanged: unchanged && !force };
}

// ---------------------------------------------------------------------------
// LA County
// ---------------------------------------------------------------------------

function laDate(s: string): string {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : s.trim();
}

const laSummary = (f: { id: string; name: string; address: string; facility_type: string }, latest: Json): Json => ({
  id: f.id,
  name: f.name,
  address: f.address,
  facility_type: f.facility_type,
  current_grade: latest.grade,
  latest_score: latest.score,
  latest_inspection_date: latest.date,
});

async function refreshLA(env: Env, force: boolean): Promise<string> {
  const db = env.DB;
  const insp = await fetchIfChanged(db, "la_insp", LA_INSP_URL, force);
  const viol = await fetchIfChanged(db, "la_viol", LA_VIOL_URL, force);
  if (insp.unchanged && viol.unchanged) {
    await Promise.all([insp.res.body?.cancel(), viol.res.body?.cancel()]);
    return "la: unchanged";
  }

  // Violations, keyed by inspection serial number. Descriptions are interned to save memory.
  const descs: string[] = [];
  const descIdx = new Map<string, number>();
  const bySerial = new Map<string, string>(); // serial -> "code\x1fpoints\x1fdescIdx\x1fstatus\x1e..."
  for await (const r of csvRecords(viol.res.body!)) {
    const d = r["VIOLATION DESCRIPTION"].trim();
    let di = descIdx.get(d);
    if (di === undefined) descIdx.set(d, (di = descs.push(d) - 1));
    const v = [r["VIOLATION CODE"].trim(), r["POINTS"].trim(), di, r["VIOLATION STATUS"].trim()].join("\x1f");
    const s = r["SERIAL NUMBER"].trim();
    const prev = bySerial.get(s);
    bySerial.set(s, prev === undefined ? v : prev + "\x1e" + v);
  }

  type LAFac = { id: string; name: string; address: string; zip: string; facility_type: string; insp: Json[] };
  const facilities = new Map<string, LAFac>();
  for await (const r of csvRecords(insp.res.body!)) {
    const rid = r["RECORD ID"].trim();
    let f = facilities.get(rid);
    if (!f) {
      const zip = r["FACILITY ZIP"].trim();
      f = {
        id: rid,
        name: r["PROGRAM NAME"].trim() || r["FACILITY NAME"].trim(),
        address: `${r["FACILITY ADDRESS"].trim()}, ${r["FACILITY CITY"].trim()} ${zip}`,
        zip: zip.slice(0, 5),
        facility_type: r["PE DESCRIPTION"].trim(),
        insp: [],
      };
      facilities.set(rid, f);
    }
    const score = r["SCORE"].trim();
    f.insp.push({
      date: laDate(r["ACTIVITY DATE"]),
      type: r["SERVICE DESCRIPTION"].trim(),
      score: /^\d+$/.test(score) ? Number(score) : null,
      grade: r["GRADE"].trim() || null,
      serial_number: r["SERIAL NUMBER"].trim(),
    });
  }

  function* rows(): Generator<FacilityRow> {
    for (const f of facilities.values()) {
      f.insp.sort((a, b) => (b.date as string).localeCompare(a.date as string));
      const inspections = f.insp.map((i) => ({
        ...i,
        violations: (bySerial.get(i.serial_number as string)?.split("\x1e") ?? []).map((v) => {
          const [code, points, di, status] = v.split("\x1f");
          return { code, points, status, description: descs[Number(di)] };
        }),
      }));
      yield {
        id: f.id,
        nameKey: compact(f.name),
        addressUp: f.address.toUpperCase(),
        zip: f.zip,
        sortKey: (f.insp[0].date as string) ?? "",
        summary: laSummary(f, f.insp[0]),
        inspections,
      };
    }
  }

  const n = await writeGeneration(db, "la", rows());
  await db.batch([setMeta(db, "sig:la_insp", insp.sig), setMeta(db, "sig:la_viol", viol.sig)]);
  return `la: imported ${n} facilities`;
}

// ---------------------------------------------------------------------------
// Las Vegas (Southern Nevada Health District)
// ---------------------------------------------------------------------------

const LV_STATUS: Record<string, string> = { "01": "active", "02": "inactive" };
const LV_FILES = [
  "restaurant_inspection_types.csv",
  "restaurant_violations.csv",
  "restaurant_establishments.csv",
  "restaurant_inspections.csv",
];

type LVEst = {
  id: string;
  name: string;
  location: string;
  address: string;
  zip: string;
  status: string;
  current_grade: string | null;
  current_demerits: string | null;
  grade_date: string | null;
  insp: Json[];
};

function lvSummary(e: LVEst): Json {
  const latest = e.insp[0] as Json | undefined;
  return {
    id: e.id,
    name: e.name,
    location: e.location,
    address: e.address,
    status: e.status,
    current_grade: e.current_grade || (latest?.grade ?? null),
    current_demerits: e.current_grade ? e.current_demerits : (latest?.demerits ?? null),
    latest_inspection_date: latest?.date || e.grade_date,
  };
}

async function refreshLV(env: Env, force: boolean): Promise<string> {
  const db = env.DB;
  const src = await fetchIfChanged(db, "lv_zip", LV_ZIP_URL, force);
  if (src.unchanged) {
    await src.res.body?.cancel();
    return "las_vegas: unchanged";
  }
  let files: Record<string, Uint8Array> | null = unzipSync(new Uint8Array(await src.res.arrayBuffer()), {
    filter: (f) => LV_FILES.includes(f.name),
  });
  const take = (name: string) => {
    const b = files![name];
    if (!b) throw new Error(`SNHD zip is missing ${name}`);
    delete files![name]; // let it be GC'd once parsed
    return csvRecords(bytesStream(b), ";");
  };

  const itypes = new Map<string, string>();
  for await (const r of take("restaurant_inspection_types.csv")) itypes.set(r.inspection_type_id, r.inspection_type);
  const vdesc = new Map<string, string>();
  for await (const r of take("restaurant_violations.csv")) vdesc.set(r.violation_id, r.violation_description);

  const ests = new Map<string, LVEst>();
  for await (const r of take("restaurant_establishments.csv")) {
    const pid = (r.permit_number ?? "").trim();
    if (!pid) continue;
    const grade = (r.current_grade ?? "").trim();
    const status = (r.record_status ?? "").trim();
    const zip = (r.zip_code ?? "").trim();
    ests.set(pid, {
      id: pid,
      name: (r.restaurant_name ?? "").trim(),
      location: (r.location_name ?? "").trim(),
      address: `${(r.address ?? "").trim()}, ${(r.city_name ?? "").trim()} ${zip}`,
      zip: zip.slice(0, 5),
      status: LV_STATUS[status] ?? r.record_status,
      // guard against rows with shifted columns
      current_grade: ["A", "B", "C", "X"].includes(grade) ? grade : null,
      current_demerits: (r.current_demerits ?? "").trim() || null,
      grade_date: date10(r.date_current),
      insp: [],
    });
  }
  for await (const r of take("restaurant_inspections.csv")) {
    const e = ests.get((r.permit_number ?? "").trim());
    if (!e) continue;
    e.insp.push({
      date: date10(r.inspection_date),
      type: itypes.get(r.inspection_type_id) ?? r.inspection_type_id,
      demerits: r.inspection_demerits,
      grade: r.inspection_grade || null,
      result: r.inspection_result,
      violations: (r.violations ?? "").split(",").filter(Boolean),
    });
  }
  files = null;

  function* rows(): Generator<FacilityRow> {
    for (const e of ests.values()) {
      e.insp.sort((a, b) => ((b.date as string) ?? "").localeCompare((a.date as string) ?? ""));
      const s = lvSummary(e);
      yield {
        id: e.id,
        nameKey: compact(e.name) + "|" + compact(e.location),
        addressUp: e.address.toUpperCase(),
        zip: e.zip,
        sortKey: (e.status === "active" ? "1" : "0") + ((s.latest_inspection_date as string) ?? ""),
        summary: s,
        inspections: e.insp.map((i) => ({
          ...i,
          violations: (i.violations as string[]).map((v) => ({ code: v, description: vdesc.get(v) ?? null })),
        })),
      };
    }
  }

  const n = await writeGeneration(db, "las_vegas", rows());
  await setMeta(db, "sig:lv_zip", src.sig).run();
  return `las_vegas: imported ${n} establishments`;
}

export async function refreshAll(env: Env, force = false): Promise<string[]> {
  const out: string[] = [];
  for (const [city, fn] of [
    ["la", refreshLA],
    ["las_vegas", refreshLV],
  ] as const) {
    try {
      // Re-import at most once a day (1h slack so the daily cron never skips a day); failures retry next run.
      const last = await getMeta(env.DB, `updated:${city}`);
      const age = last ? Date.now() - Date.parse(last) : Infinity;
      if (!force && age < CACHE_TTL_S * 1000 - 3_600_000) {
        out.push(`${city}: fresh (imported ${Math.floor(age / 3_600_000)}h ago)`);
        continue;
      }
      out.push(await fn(env, force));
    } catch (e) {
      out.push(`${city}: FAILED ${e instanceof Error ? e.stack ?? e.message : e}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

const NOT_LOADED = (city: BulkCity) =>
  new Error(`${city} data hasn't been imported yet (the first import runs within an hour of deploy). Try again shortly.`);

export async function bulkSearch(
  env: Env,
  city: BulkCity,
  name: string,
  address?: string,
  zip?: string,
  limit = 10,
): Promise<Json[]> {
  const gen = await currentGen(env.DB, city);
  if (gen === null) throw NOT_LOADED(city);
  const key = compact(name);
  if (!key) return [];
  const where = ["city = ?", "gen = ?", "name_key LIKE ?"];
  const args: (string | number)[] = [city, gen, `%${key}%`];
  for (const t of tokens(address)) {
    where.push("address_up LIKE ? ESCAPE '\\'");
    args.push(`%${likeEsc(t)}%`);
  }
  if (zip) {
    where.push("zip = ?");
    args.push(zip);
  }
  const { results } = await env.DB.prepare(
    `SELECT summary FROM facilities WHERE ${where.join(" AND ")} ORDER BY sort_key DESC LIMIT ?`,
  )
    .bind(...args, limit)
    .all<{ summary: string }>();
  return results.map((r) => JSON.parse(r.summary));
}

export async function bulkHistory(env: Env, city: BulkCity, id: string, n: number): Promise<Json> {
  const gen = await currentGen(env.DB, city);
  if (gen === null) throw NOT_LOADED(city);
  const rid = city === "la" ? id.trim().toUpperCase() : id.trim();
  const row = await env.DB.prepare("SELECT summary, inspections FROM facilities WHERE city = ? AND gen = ? AND id = ?")
    .bind(city, gen, rid)
    .first<{ summary: string; inspections: string }>();
  if (!row) {
    return {
      error: city === "la" ? `No LA County facility with record id ${id}` : `No Southern Nevada establishment with permit number ${id}`,
    };
  }
  return { ...JSON.parse(row.summary), inspections: (JSON.parse(row.inspections) as Json[]).slice(0, n) };
}

export async function dataStatus(env: Env): Promise<Json> {
  const { results } = await env.DB.prepare("SELECT key, value FROM meta WHERE key LIKE 'updated:%' OR key LIKE 'count:%'").all<{
    key: string;
    value: string;
  }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}
