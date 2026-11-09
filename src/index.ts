import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { dataStatus, refreshAll } from "./bulk";
import { CITIES, CITY_LIST } from "./cities";
import { defaultCity } from "./geo";
import { renderLanding } from "./landing";
import { CACHE_TTL_S, type Env, type Json } from "./util";

// ---------------------------------------------------------------------------
// Core operations (shared by MCP tools and the landing page search API)
// ---------------------------------------------------------------------------

async function searchRestaurants(env: Env, city: string, name: string, address?: string, zip?: string, limit = 10) {
  const c = CITIES[city];
  if (!c) return { error: `Unknown city ${city}` };
  if (!name.trim()) return { error: "name is required" };
  limit = Math.max(1, Math.min(limit, 50));
  const results = await c.search(env, {
    name: name.trim(),
    address: address?.trim() || undefined,
    zip: c.zipSupported ? zip?.trim() || undefined : undefined,
    limit,
  });
  return { city, rating_system: c.ratingSystem, count: results.length, results };
}

async function inspectionHistory(env: Env, city: string, id: string, max = 10) {
  const c = CITIES[city];
  if (!c) return { error: `Unknown city ${city}` };
  const result: Json = await c.history(env, id.trim(), Math.max(1, Math.min(max, 100)));
  return { city, rating_system: c.ratingSystem, ...result };
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

const ids = CITY_LIST.map((c) => c.id) as [string, ...string[]];
const citySchema = z.enum(ids).describe(CITY_LIST.map((c) => `"${c.id}" (${c.label}, ${c.region})`).join(", "));
const cityNames = CITY_LIST.map((c) => c.label).join(", ");

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "restaurant-health", version: "1.1.0", websiteUrl: "https://food.ian.sh" },
    {
      instructions:
        `Health inspection results for restaurants in ${cityNames}. ` +
        "Use search_restaurants to find a place, then get_inspection_history with its id for details. " +
        "Grading systems differ by city; results include an explanation. " +
        "Data is cached and can be up to a day old; the latest inspection date is included in every result.",
    },
  );

  server.registerTool(
    "search_restaurants",
    {
      title: "Search restaurants",
      description:
        "Find restaurants by name and get their current health grade / rating. " +
        "Returns matching establishments with an `id` to pass to get_inspection_history.",
      inputSchema: {
        city: citySchema,
        name: z
          .string()
          .describe(
            'Restaurant name or part of it, as a phrase. Case, spaces and punctuation are ignored, so "in n out" matches "IN-N-OUT BURGER" and "katzs" matches "KATZ\'S".',
          ),
        address: z.string().optional().describe('Optional words that must appear in the street address (e.g. "broadway").'),
        zip_code: z
          .string()
          .optional()
          .describe(`Optional ZIP/postal code filter (ignored for: ${CITY_LIST.filter((c) => !c.zipSupported).map((c) => c.id).join(", ") || "none"}).`),
        limit: z.number().int().optional().describe("Max results (default 10, max 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ city, name, address, zip_code, limit }) => {
      try {
        return ok(await searchRestaurants(env, city, name, address, zip_code, limit ?? 10));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_inspection_history",
    {
      title: "Inspection history",
      description: "Get the inspection history (dates, scores/grades/results, and violations where published) for one restaurant.",
      inputSchema: {
        city: citySchema,
        restaurant_id: z
          .string()
          .describe(`The \`id\` from search_restaurants (${CITY_LIST.map((c) => `${c.id}: ${c.idHint}`).join("; ")}).`),
        max_inspections: z.number().int().optional().describe("Max inspections to return, newest first (default 10)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ city, restaurant_id, max_inspections }) => {
      try {
        return ok(await inspectionHistory(env, city, restaurant_id, max_inspections ?? 10));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "rating_systems",
    {
      title: "Rating systems",
      description: "List the supported cities and explain how each one's health grades, scores or results work (they differ a lot).",
      annotations: { readOnlyHint: true },
    },
    async () =>
      ok(Object.fromEntries(CITY_LIST.map((c) => [c.id, { name: c.label, region: c.region, rating_system: c.ratingSystem, source: c.source.url }]))),
  );

  return server;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

async function handleMcp(req: Request, env: Env): Promise<Response> {
  // Stateless: a fresh server + transport per request, JSON responses (no SSE streams to hold open).
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(env);
  await server.connect(transport);
  return transport.handleRequest(req);
}

// ---------------------------------------------------------------------------
// HTTP entry
// ---------------------------------------------------------------------------

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extra } });

/**
 * Bump when /api/search or /api/history output changes (e.g. badge wording). It's part of the
 * Cloudflare cache key and of the page's API URLs, so both edge and browser caches turn over.
 */
const API_CACHE_VERSION = "5";

const landingCache = new Map<string, string>();
const landing = (id: string) => {
  let html = landingCache.get(id);
  if (!html) landingCache.set(id, (html = renderLanding(CITY_LIST, id, API_CACHE_VERSION)));
  return html;
};


export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/mcp" || path === "/sse") {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html")) {
        return Response.redirect(new URL("/", url).toString(), 302);
      }
      return withCors(await handleMcp(req, env));
    }

    if (path === "/" && (req.method === "GET" || req.method === "HEAD")) {
      const pick = url.searchParams.get("city");
      const id = pick && CITIES[pick] ? pick : defaultCity(req.cf as IncomingRequestCfProperties | undefined);
      return new Response(landing(id), {
        // Varies by visitor location, so don't let shared caches store it.
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=300" },
      });
    }

    if (path === "/api/search" && req.method === "GET") {
      const city = CITIES[url.searchParams.get("city") ?? ""];
      const name = url.searchParams.get("name") ?? "";
      if (!city) return json({ error: "unknown city" }, 400);
      if (name.trim().length < 2) return json({ error: "name too short" }, 400);
      const cache = caches.default;
      const ck = new URL(url);
      ck.searchParams.set("_v", API_CACHE_VERSION);
      const key = new Request(ck.toString(), { method: "GET" });
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const r = await searchRestaurants(env, city.id, name, undefined, undefined, 8);
        const results = ((r as { results?: Json[] }).results ?? []).map((s) => ({ ...s, badge: city.badge(s) }));
        const res = json({ ...r, results }, 200, { "Cache-Control": `public, max-age=${CACHE_TTL_S}` });
        ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    if (path === "/api/history" && req.method === "GET") {
      const city = CITIES[url.searchParams.get("city") ?? ""];
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!city) return json({ error: "unknown city" }, 400);
      if (!id || id.length > 80) return json({ error: "bad id" }, 400);
      const ck = new URL(url);
      ck.searchParams.set("_v", API_CACHE_VERSION);
      const key = new Request(ck.toString(), { method: "GET" });
      const hit = await caches.default.match(key);
      if (hit) return hit;
      try {
        const res = json(await inspectionHistory(env, city.id, id, 8), 200, { "Cache-Control": `public, max-age=${CACHE_TTL_S}` });
        ctx.waitUntil(caches.default.put(key, res.clone()));
        return res;
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    if (path === "/api/status") return json(await dataStatus(env));

    // Manual re-import: curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://food.ian.sh/admin/refresh?force=1
    if (path === "/admin/refresh" && req.method === "POST") {
      if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return json({ error: "unauthorized" }, 401);
      }
      return json({ result: await refreshAll(env, url.searchParams.has("force")) });
    }

    if (path === "/favicon.ico") return new Response(null, { status: 204 });
    return json({ error: "not found", hint: "The MCP endpoint is /mcp" }, 404);
  },

  async scheduled(_event, env, _ctx): Promise<void> {
    const result = await refreshAll(env);
    console.log(JSON.stringify({ refresh: result }));
    if (result.some((r) => r.includes("FAILED"))) throw new Error(result.join("\n"));
  },
} satisfies ExportedHandler<Env>;
