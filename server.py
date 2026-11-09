# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=2.3,<3", "httpx>=0.27"]
# ///
"""MCP server: restaurant health inspection ratings for NYC, San Francisco,
Los Angeles County, and Las Vegas (Southern Nevada Health District).

Run:  uv run server.py
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server.mcpserver import MCPServer

logging.getLogger("httpx").setLevel(logging.WARNING)

mcp = MCPServer("restaurant-health")

City = Literal["nyc", "sf", "la", "las_vegas"]

CACHE_DIR = Path(os.environ.get("RESTAURANT_HEALTH_CACHE", Path.home() / ".cache" / "restaurant-health-mcp"))
CACHE_TTL = 24 * 3600
SOCRATA_TOKEN = os.environ.get("SOCRATA_APP_TOKEN")  # optional, raises rate limits

NYC_URL = "https://data.cityofnewyork.us/resource/43nn-pn8j.json"
SF_URL = "https://data.sf.gov/resource/tvy3-wexg.json"
LA_INSP_URL = "https://www.arcgis.com/sharing/rest/content/items/19b6607ac82c4512b10811870975dbdc/data"
LA_VIOL_URL = "https://www.arcgis.com/sharing/rest/content/items/5eaea9f89b7549ee841da7617d3a9cba/data"
LV_ZIP_URL = "https://www.southernnevadahealthdistrict.org/restaurants/download/restaurants.zip"

RATING_SYSTEMS = {
    "nyc": "NYC DOHMH: score = violation points, LOWER is better. A = 0-13, B = 14-27, C = 28+. "
    "Grade 'N' = not yet graded, 'Z'/'P' = grade pending.",
    "sf": "SF DPH (2024+ placard system): Pass (green), Conditional Pass (yellow), Closed (red). No numeric score.",
    "la": "LA County DPH: score out of 100, HIGHER is better. A = 90-100, B = 80-89, C = 70-79. "
    "Excludes Pasadena, Long Beach and Vernon (own health depts). Published data lags by weeks.",
    "las_vegas": "Southern Nevada Health District: demerits, LOWER is better. A = 0-10, B = 11-20, C = 21-40, "
    "X = closed (imminent health hazard).",
}

_http: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=120, follow_redirects=True, headers={"User-Agent": "restaurant-health-mcp/1.0"})
    return _http


def _soql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def _like_all(field: str, text: str) -> str:
    """Every whitespace-separated token must appear (case-insensitive)."""
    return " AND ".join(f"upper({field}) like {_soql_str('%' + t.upper() + '%')}" for t in text.split())


async def socrata(url: str, params: dict[str, str]) -> list[dict[str, Any]]:
    headers = {"X-App-Token": SOCRATA_TOKEN} if SOCRATA_TOKEN else {}
    r = await http().get(url, params=params, headers=headers)
    r.raise_for_status()
    return r.json()


def _date(s: str | None) -> str | None:
    return s[:10] if s else None


def _compact(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def _name_match(haystack: str | None, needle: str) -> bool:
    """Punctuation/space-insensitive phrase match: 'in n out' matches 'IN-N-OUT BURGER'."""
    return _compact(needle) in _compact(haystack or "")


def _like_name(field: str, name: str) -> str:
    """Coarse server-side prefilter (words in order); refined locally with _name_match."""
    words = re.findall(r"[A-Za-z0-9]+", name.upper())
    return f"upper({field}) like {_soql_str('%' + '%'.join(words) + '%')}"


def _tokens_match(haystack: str, needle: str | None) -> bool:
    if not needle:
        return True
    h = haystack.upper()
    return all(t in h for t in needle.upper().split())


# ---------------------------------------------------------------------------
# Download cache for bulk files (LA, Las Vegas)
# ---------------------------------------------------------------------------

_locks: dict[str, asyncio.Lock] = {}


async def cached_download(name: str, url: str) -> bytes:
    path = CACHE_DIR / name
    lock = _locks.setdefault(name, asyncio.Lock())
    async with lock:
        if path.exists() and time.time() - path.stat().st_mtime < CACHE_TTL:
            return path.read_bytes()
        try:
            r = await http().get(url)
            r.raise_for_status()
        except httpx.HTTPError:
            if path.exists():  # serve stale data rather than fail
                return path.read_bytes()
            raise
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)
        return r.content


class BulkDataset:
    """Holds parsed data in memory and reloads when the cache file expires."""

    def __init__(self) -> None:
        self.loaded_at = 0.0
        self.data: Any = None
        self.lock = asyncio.Lock()

    async def get(self, loader) -> Any:
        async with self.lock:
            if self.data is None or time.time() - self.loaded_at > CACHE_TTL:
                self.data = await loader()
                self.loaded_at = time.time()
            return self.data


# ---------------------------------------------------------------------------
# NYC
# ---------------------------------------------------------------------------

def _nyc_address(r: dict) -> str:
    return " ".join(x for x in [r.get("building"), r.get("street"), r.get("boro"), r.get("zipcode")] if x)


def _nyc_group_inspections(rows: list[dict]) -> list[dict]:
    insp: dict[tuple, dict] = {}
    for r in rows:
        if (r.get("inspection_date") or "").startswith("1900"):
            continue  # placeholder: not yet inspected
        key = (r.get("inspection_date"), r.get("inspection_type"))
        i = insp.setdefault(key, {
            "date": _date(r.get("inspection_date")),
            "type": r.get("inspection_type"),
            "score": r.get("score"),
            "grade": r.get("grade"),
            "action": r.get("action"),
            "violations": [],
        })
        i["grade"] = i["grade"] or r.get("grade")
        if r.get("violation_code"):
            i["violations"].append({
                "code": r["violation_code"],
                "critical": r.get("critical_flag") == "Critical",
                "description": r.get("violation_description"),
            })
    return sorted(insp.values(), key=lambda x: x["date"] or "", reverse=True)


def _nyc_summary(camis: str, rows: list[dict]) -> dict:
    r0 = rows[0]
    insps = _nyc_group_inspections(rows)
    graded = [r for r in rows if r.get("grade")]
    graded.sort(key=lambda r: r.get("grade_date") or r.get("inspection_date") or "", reverse=True)
    return {
        "id": camis,
        "name": r0.get("dba"),
        "address": _nyc_address(r0),
        "cuisine": r0.get("cuisine_description"),
        "current_grade": graded[0]["grade"] if graded else None,
        "grade_date": _date(graded[0].get("grade_date")) if graded else None,
        "latest_inspection_date": insps[0]["date"] if insps else None,
        "latest_score": insps[0]["score"] if insps else None,
    }


async def nyc_search(name: str, address: str | None, zip_code: str | None, limit: int) -> list[dict]:
    where = [_like_name("dba", name)]
    if zip_code:
        where.append(f"zipcode = {_soql_str(zip_code)}")
    rows = await socrata(NYC_URL, {"$where": " AND ".join(where), "$order": "inspection_date DESC", "$limit": "5000"})
    by_id: dict[str, list[dict]] = {}
    for r in rows:
        if _name_match(r.get("dba"), name) and _tokens_match(_nyc_address(r), address):
            by_id.setdefault(r["camis"], []).append(r)
    return [_nyc_summary(k, v) for k, v in list(by_id.items())[:limit]]


async def nyc_history(rid: str, n: int) -> dict:
    rows = await socrata(NYC_URL, {"$where": f"camis = {_soql_str(rid)}", "$order": "inspection_date DESC", "$limit": "2000"})
    if not rows:
        return {"error": f"No NYC restaurant with CAMIS id {rid}"}
    return {**_nyc_summary(rid, rows), "inspections": _nyc_group_inspections(rows)[:n]}


# ---------------------------------------------------------------------------
# San Francisco
# ---------------------------------------------------------------------------

def _sf_inspection(r: dict) -> dict:
    return {
        "date": _date(r.get("inspection_date")),
        "rating": r.get("facility_rating_status"),
        "violation_count": int(r.get("violation_count") or 0),
        "violations": r.get("violation_codes"),
        "permit_type": r.get("permit_type"),
    }


def _sf_summary(rows: list[dict]) -> dict:
    r0 = rows[0]
    return {
        "id": r0.get("permit_number"),
        "name": r0.get("dba"),
        "address": r0.get("street_address_clean") or r0.get("street_address"),
        "neighborhood": r0.get("analysis_neighborhood"),
        "current_rating": r0.get("facility_rating_status"),
        "latest_inspection_date": _date(r0.get("inspection_date")),
        "latest_violation_count": int(r0.get("violation_count") or 0),
    }


def _sf_not_future() -> str:
    # The dataset contains some typo'd future dates (e.g. 2031); ignore them.
    return f"inspection_date <= {_soql_str(datetime.now().strftime('%Y-%m-%dT23:59:59'))}"


async def sf_search(name: str, address: str | None, zip_code: str | None, limit: int) -> list[dict]:
    where = [_like_name("dba", name), _sf_not_future()]
    if address:
        where.append(_like_all("street_address", address))
    rows = await socrata(SF_URL, {"$where": " AND ".join(where), "$order": "inspection_date DESC", "$limit": "2000"})
    by_id: dict[str, list[dict]] = {}
    for r in rows:
        if _name_match(r.get("dba"), name):
            by_id.setdefault(r.get("permit_number"), []).append(r)
    return [_sf_summary(v) for v in list(by_id.values())[:limit]]


async def sf_history(rid: str, n: int) -> dict:
    where = f"permit_number = {_soql_str(rid)} AND {_sf_not_future()}"
    rows = await socrata(SF_URL, {"$where": where, "$order": "inspection_date DESC", "$limit": "500"})
    if not rows:
        return {"error": f"No SF facility with permit number {rid}"}
    return {**_sf_summary(rows), "inspections": [_sf_inspection(r) for r in rows[:n]]}


# ---------------------------------------------------------------------------
# Los Angeles County
# ---------------------------------------------------------------------------

_la = BulkDataset()
_la_viol = BulkDataset()


def _la_date(s: str) -> str:
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return s.strip()


async def _load_la() -> dict[str, dict]:
    raw = await cached_download("la_inspections.csv", LA_INSP_URL)

    def parse() -> dict[str, dict]:
        facilities: dict[str, dict] = {}
        for r in csv.DictReader(io.StringIO(raw.decode("cp1252", errors="replace"))):
            rid = r["RECORD ID"].strip()
            f = facilities.setdefault(rid, {
                "id": rid,
                "name": r["PROGRAM NAME"].strip() or r["FACILITY NAME"].strip(),
                "address": f'{r["FACILITY ADDRESS"].strip()}, {r["FACILITY CITY"].strip()} {r["FACILITY ZIP"].strip()}',
                "zip": r["FACILITY ZIP"].strip()[:5],
                "facility_type": r["PE DESCRIPTION"].strip(),
                "inspections": [],
            })
            f["inspections"].append({
                "date": _la_date(r["ACTIVITY DATE"]),
                "type": r["SERVICE DESCRIPTION"].strip(),
                "score": int(r["SCORE"]) if r["SCORE"].strip().isdigit() else None,
                "grade": r["GRADE"].strip() or None,
                "serial_number": r["SERIAL NUMBER"].strip(),
            })
        for f in facilities.values():
            f["inspections"].sort(key=lambda i: i["date"], reverse=True)
            f["search"] = f'{f["name"]} {f["address"]}'.upper()
        return facilities

    return await asyncio.to_thread(parse)


async def _load_la_violations() -> dict[str, list[dict]]:
    raw = await cached_download("la_violations.csv", LA_VIOL_URL)

    def parse() -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for r in csv.DictReader(io.StringIO(raw.decode("cp1252", errors="replace"))):
            out.setdefault(r["SERIAL NUMBER"].strip(), []).append({
                "code": r["VIOLATION CODE"].strip(),
                "points": r["POINTS"].strip(),
                "status": r["VIOLATION STATUS"].strip(),
                "description": r["VIOLATION DESCRIPTION"].strip(),
            })
        return out

    return await asyncio.to_thread(parse)


def _la_summary(f: dict) -> dict:
    latest = f["inspections"][0]
    return {
        "id": f["id"], "name": f["name"], "address": f["address"], "facility_type": f["facility_type"],
        "current_grade": latest["grade"], "latest_score": latest["score"],
        "latest_inspection_date": latest["date"],
    }


async def la_search(name: str, address: str | None, zip_code: str | None, limit: int) -> list[dict]:
    facilities = await _la.get(_load_la)
    hits = [
        f for f in facilities.values()
        if _name_match(f["name"], name)
        and _tokens_match(f["address"], address)
        and (not zip_code or f["zip"] == zip_code)
    ]
    hits.sort(key=lambda f: f["inspections"][0]["date"], reverse=True)
    return [_la_summary(f) for f in hits[:limit]]


async def la_history(rid: str, n: int) -> dict:
    facilities = await _la.get(_load_la)
    f = facilities.get(rid.strip().upper())
    if not f:
        return {"error": f"No LA County facility with record id {rid}"}
    viols = await _la_viol.get(_load_la_violations)
    insps = [{**i, "violations": viols.get(i["serial_number"], [])} for i in f["inspections"][:n]]
    return {**_la_summary(f), "inspections": insps}


# ---------------------------------------------------------------------------
# Las Vegas (Southern Nevada Health District)
# ---------------------------------------------------------------------------

_lv = BulkDataset()
LV_STATUS = {"01": "active", "02": "inactive"}


async def _load_lv() -> dict:
    raw = await cached_download("snhd_restaurants.zip", LV_ZIP_URL)

    def parse() -> dict:
        z = zipfile.ZipFile(io.BytesIO(raw))

        def rows(fname: str):
            text = z.read(fname).decode("cp1252", errors="replace")
            return csv.DictReader(io.StringIO(text), delimiter=";")

        itypes = {r["inspection_type_id"]: r["inspection_type"] for r in rows("restaurant_inspection_types.csv")}
        vdesc = {r["violation_id"]: r["violation_description"] for r in rows("restaurant_violations.csv")}
        ests: dict[str, dict] = {}
        for r in rows("restaurant_establishments.csv"):
            pid = (r.get("permit_number") or "").strip()
            if not pid:
                continue
            grade = (r.get("current_grade") or "").strip()
            ests[pid] = {
                "id": pid,
                "name": (r.get("restaurant_name") or "").strip(),
                "location": (r.get("location_name") or "").strip(),
                "address": f'{(r.get("address") or "").strip()}, {(r.get("city_name") or "").strip()} {(r.get("zip_code") or "").strip()}',
                "zip": (r.get("zip_code") or "").strip()[:5],
                "status": LV_STATUS.get((r.get("record_status") or "").strip(), r.get("record_status")),
                # guard against rows with shifted columns
                "current_grade": grade if grade in {"A", "B", "C", "X"} else None,
                "current_demerits": (r.get("current_demerits") or "").strip() or None,
                "grade_date": _date(r.get("date_current")),
                "inspections": [],
            }
        for r in rows("restaurant_inspections.csv"):
            e = ests.get((r.get("permit_number") or "").strip())
            if not e:
                continue
            vids = [v for v in (r.get("violations") or "").split(",") if v]
            e["inspections"].append({
                "date": _date(r.get("inspection_date")),
                "type": itypes.get(r.get("inspection_type_id"), r.get("inspection_type_id")),
                "demerits": r.get("inspection_demerits"),
                "grade": r.get("inspection_grade") or None,
                "result": r.get("inspection_result"),
                "violations": [{"code": v, "description": vdesc.get(v)} for v in vids],
            })
        for e in ests.values():
            e["inspections"].sort(key=lambda i: i["date"] or "", reverse=True)
        return {"ests": ests}

    return await asyncio.to_thread(parse)


def _lv_summary(e: dict) -> dict:
    latest = e["inspections"][0] if e["inspections"] else None
    return {
        "id": e["id"], "name": e["name"], "location": e["location"], "address": e["address"],
        "status": e["status"],
        "current_grade": e["current_grade"] or (latest and latest["grade"]),
        "current_demerits": e["current_demerits"] if e["current_grade"] else (latest and latest["demerits"]),
        "latest_inspection_date": (latest and latest["date"]) or e["grade_date"],
    }


async def lv_search(name: str, address: str | None, zip_code: str | None, limit: int) -> list[dict]:
    ests = (await _lv.get(_load_lv))["ests"]
    hits = [
        e for e in ests.values()
        if (_name_match(e["name"], name) or _name_match(e["location"], name))
        and _tokens_match(e["address"], address)
        and (not zip_code or e["zip"] == zip_code)
    ]
    # active first, then most recently inspected
    hits.sort(key=lambda e: (e["status"] == "active", _lv_summary(e)["latest_inspection_date"] or ""), reverse=True)
    return [_lv_summary(e) for e in hits[:limit]]


async def lv_history(rid: str, n: int) -> dict:
    ests = (await _lv.get(_load_lv))["ests"]
    e = ests.get(rid.strip())
    if not e:
        return {"error": f"No Southern Nevada establishment with permit number {rid}"}
    return {**_lv_summary(e), "inspections": e["inspections"][:n]}


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

SEARCH = {"nyc": nyc_search, "sf": sf_search, "la": la_search, "las_vegas": lv_search}
HISTORY = {"nyc": nyc_history, "sf": sf_history, "la": la_history, "las_vegas": lv_history}


@mcp.tool()
async def search_restaurants(
    city: City,
    name: str,
    address: str | None = None,
    zip_code: str | None = None,
    limit: int = 10,
) -> dict:
    """Find restaurants by name and get their current health grade / rating.

    Args:
        city: "nyc" (New York City), "sf" (San Francisco), "la" (Los Angeles County),
              or "las_vegas" (Clark County / Southern Nevada).
        name: Restaurant name or part of it, as a phrase. Case, spaces and punctuation are
              ignored, so "in n out" matches "IN-N-OUT BURGER" and "katzs" matches "KATZ'S".
        address: Optional words that must appear in the street address (e.g. "broadway").
        zip_code: Optional 5-digit ZIP filter (not supported for sf).
        limit: Max results (default 10).

    Returns matching establishments with an `id` to pass to get_inspection_history.
    """
    if not name.strip():
        return {"error": "name is required"}
    limit = max(1, min(limit, 50))
    results = await SEARCH[city](name.strip(), address, zip_code, limit)
    return {"city": city, "rating_system": RATING_SYSTEMS[city], "count": len(results), "results": results}


@mcp.tool()
async def get_inspection_history(city: City, restaurant_id: str, max_inspections: int = 10) -> dict:
    """Get the inspection history (dates, scores/grades, and violations) for one restaurant.

    Args:
        city: "nyc", "sf", "la", or "las_vegas".
        restaurant_id: The `id` from search_restaurants (NYC CAMIS, SF permit number,
                       LA record id like PR0012345, or Las Vegas permit number).
        max_inspections: Max inspections to return, newest first (default 10).
    """
    n = max(1, min(max_inspections, 100))
    result = await HISTORY[city](restaurant_id.strip(), n)
    return {"city": city, "rating_system": RATING_SYSTEMS[city], **result}


@mcp.tool()
def rating_systems() -> dict:
    """Explain how each city's health grades and scores work (they differ a lot)."""
    return RATING_SYSTEMS


if __name__ == "__main__":
    mcp.run()
