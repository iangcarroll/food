# restaurant-health MCP server

Look up restaurant health inspection results in **20 places**:

- **US:** New York City, New York State (outside NYC), San Francisco, LA County, Santa Clara County, Marin County, Sacramento County, Las Vegas, Chicago, Boston, Austin, Raleigh / Wake County, Louisville, Detroit, Cincinnati, Omaha / Douglas County, Fairfax County
- **Elsewhere:** London & the UK, Toronto, Paris & France

It uses public government data and needs no API keys.

**Hosted at <https://food.ian.sh>.** The MCP endpoint is `https://food.ian.sh/mcp` (Streamable HTTP, no auth).

```sh
claude mcp add --transport http restaurant-health https://food.ian.sh/mcp
```

## Tools

| Tool | What it does |
|---|---|
| `search_restaurants(city, name, address?, zip_code?, limit?)` | Find restaurants and show their current grade, score or result |
| `get_inspection_history(city, restaurant_id, max_inspections?)` | Past inspections with scores and violations, where the city publishes them |
| `rating_systems()` | Lists the cities and explains how each one grades |

Every city's id, grading system, and data source lives in its module under `src/cities/`. `rating_systems` returns the same information.

## How data is fetched

- **Live APIs, cached for 1 day** (Cloudflare Cache API, per location). This covers everything except LA and Las Vegas:
  - Socrata: NYC, SF, Chicago, Austin, Santa Clara, Marin, Cincinnati, NY State
  - ArcGIS: Raleigh, Louisville, Detroit, Sacramento, Omaha, Fairfax
  - CKAN: Boston, Toronto
  - Opendatasoft: France
  - The FSA ratings API: UK
- **Bulk imports into D1:** LA County and Las Vegas only publish large CSV and zip files (about 75 MB). A daily cron re-imports a file when it changes.

**Known limits:**
- The UK publishes only the current rating, with no inspection history.
- France publishes only a summary level, and only for the last 12 months.
- Omaha only has inspections since Dec 2025, with violations in linked PDFs.
- Fairfax publishes no violation details.
- LA County excludes Pasadena, Long Beach and Vernon.

The landing page picks a default city from Cloudflare's request geolocation (`src/geo.ts`). `?city=<id>` overrides it.

## Hosted deployment (Cloudflare Workers)

| Path | What it is |
|---|---|
| `src/index.ts` | Routing, MCP tools (stateless Streamable HTTP via `@modelcontextprotocol/sdk`), cron handler |
| `src/cities/` | One module per city: search, history, rating text, and landing page badge (`index.ts` is the registry) |
| `src/lib/http.ts` | Cached fetch, plus Socrata/ArcGIS query helpers |
| `src/geo.ts` | Picks the default city from the visitor's location |
| `src/bulk.ts` | LA + Las Vegas import into D1 and the queries against it |
| `src/landing.ts` | Landing page at `/`. Its search box calls `/api/search`, and expanding a result calls `/api/history` |
| `migrations/` | D1 schema |

```sh
npm install
npm run dev                  # local; apply schema first: npx wrangler d1 migrations apply restaurant-health --local
npm run deploy
```

Each import writes a new generation of rows, switches `meta.gen:<city>` to it, and then deletes the old rows. A failed import never leaves partial data. To force a re-import, run:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://food.ian.sh/admin/refresh?force=1"
```

Pushes to `main` deploy automatically via `.github/workflows/deploy.yml`. It applies D1 migrations, then runs `wrangler deploy`. It needs the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

`ADMIN_TOKEN` is a Worker secret (`wrangler secret put ADMIN_TOKEN`). `SOCRATA_APP_TOKEN` is an optional secret that raises the NYC and SF rate limits. `/api/status` shows when each bulk city was last imported.

## Local stdio version (Python)

`server.py` is the original standalone version. It downloads and caches the bulk files in `~/.cache/restaurant-health-mcp` itself.


Requires [uv](https://docs.astral.sh/uv/). Dependencies are declared inline in `server.py`.

**Claude Code:**

```sh
claude mcp add restaurant-health --scope user -- uv run --script /path/to/server.py
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "restaurant-health": {
      "command": "uv",
      "args": ["run", "--script", "/path/to/server.py"]
    }
  }
}
```

Optional: set `SOCRATA_APP_TOKEN` to get higher rate limits on NYC and SF. You can also set `RESTAURANT_HEALTH_CACHE` to change where the cache is stored.
