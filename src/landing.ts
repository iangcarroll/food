import type { CityDef } from "./cities";
import type { Tone } from "./cities/types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const TONE: Record<Tone, string> = { blue: "var(--a)", green: "var(--b)", orange: "var(--c)", red: "var(--x)", yellow: "var(--cond)", gray: "var(--muted)" };
const nb = (s: string) => esc(s).replace(/ /g, "&nbsp;");

function cityList(cities: CityDef[]): string {
  const names = cities.map((c) => `<b>${nb(c.label)}</b>`);
  if (names.length <= 6) return names.slice(0, -1).join(", ") + " and " + names.at(-1);
  return names.slice(0, 5).join(", ") + ` and ${names.length - 5} more`;
}

export function renderLanding(cities: CityDef[], defaultId = cities[0].id, apiVersion = "1"): string {
  const plain = cities.map((c) => c.label).join(", ");
  const country = (c: CityDef) =>
    c.id === "uk" ? "United Kingdom" : c.id === "france" ? "France" : c.region.includes("Canada") ? "Canada" : "United States";
  const groups = new Map<string, CityDef[]>();
  for (const c of cities) groups.set(country(c), [...(groups.get(country(c)) ?? []), c]);
  const options = [...groups.entries()]
    .map(
      ([g, cs]) =>
        `<optgroup label="${esc(g)}">` +
        [...cs]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((c) => `<option value="${c.id}"${c.id === defaultId ? " selected" : ""}>${esc(c.label)}</option>`)
          .join("") +
        "</optgroup>",
    )
    .join("");
  const grid = cities
    .map(
      (c) => `<div class="city"><h3>${esc(c.label)}</h3><div class="region">${esc(c.region)}</div><span class="dir">${esc(c.scaleHint)}</span>
        <div class="scale">${c.scale.map((s) => `<span style="background:${TONE[s.tone]}">${esc(s.text)}</span>`).join("")}</div>
        <p>${esc(c.blurb)}</p></div>`,
    )
    .join("\n      ");
  const sources = cities.map((c) => `<a href="${esc(c.source.url)}">${esc(c.source.name)}</a>`);
  const examples = JSON.stringify(Object.fromEntries(cities.map((c) => [c.id, c.examples]))).replace(/</g, "\\u003c");
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grade Check: restaurant health grades for your AI</title>
<meta name="description" content="A remote MCP server that lets Claude and other AI assistants look up restaurant health inspection grades in ${esc(plain)}.">
<meta property="og:title" content="food.ian.sh: should you eat there?">
<meta property="og:description" content="Restaurant health inspection grades for your AI. ${esc(plain)}.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='8' y='4' width='84' height='92' rx='10' fill='%232a5db0'/><text x='50' y='76' font-size='72' font-family='Arial Black,Arial' font-weight='900' text-anchor='middle' fill='white'>A</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #fbf5e9; --card: #fffdf8; --ink: #1d1a14; --muted: #6b6457; --line: #e6dccb;
  --a: #2a5db0; --b: #2e8b57; --c: #e07a1f; --x: #c8322b; --cond: #d9a400;
  --shadow: 0 1px 0 rgba(0,0,0,.04), 0 8px 24px -12px rgba(60,40,10,.25);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #15130f; --card: #1f1c17; --ink: #f3ecdf; --muted: #a59d8e; --line: #34302a;
    --shadow: 0 1px 0 rgba(255,255,255,.03), 0 10px 30px -14px rgba(0,0,0,.8); color-scheme: dark; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; }
html, body { overflow-x: hidden; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.55 "Bricolage Grotesque", system-ui, sans-serif; }
body::before { /* subtle checkered tablecloth */
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: .045;
  background: repeating-conic-gradient(var(--ink) 0 25%, transparent 0 50%) 0 0 / 44px 44px;
}
a { color: inherit; }
code, pre, .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: .86em; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }

header.top { display: flex; justify-content: space-between; align-items: center; padding: 22px 0; }
.logo { font-weight: 800; letter-spacing: -.02em; text-decoration: none; display: flex; gap: 10px; align-items: center; }
.logo .mini { width: 26px; height: 30px; border-radius: 5px; background: var(--a); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 19px; }
.top nav a { color: var(--muted); text-decoration: none; margin-left: 18px; font-size: 15px; }
.top nav a:hover { color: var(--ink); }

.hero > *, .panel, .grid > *, .tools > * { min-width: 0; }
.hero { display: grid; grid-template-columns: 1.15fr .85fr; gap: 40px; align-items: center; padding: 30px 0 60px; }
h1 { font-size: clamp(44px, 7.5vw, 86px); line-height: .95; letter-spacing: -.045em; margin: 0 0 20px; font-weight: 800; }
h1 em { font-style: normal; color: var(--a); position: relative; white-space: nowrap; }
h1 em::after { content: ""; position: absolute; left: -2%; right: -2%; bottom: .12em; height: .16em; background: var(--c); opacity: .35; border-radius: 4px; z-index: -1; }
.lede { font-size: 20px; color: var(--muted); max-width: 34ch; margin: 0 0 28px; }
.lede b { color: var(--ink); font-weight: 600; }

.endpoint { display: inline-flex; align-items: center; gap: 4px; background: var(--card); border: 2px solid var(--ink); border-radius: 14px; padding: 6px 6px 6px 16px; box-shadow: 4px 4px 0 var(--ink); max-width: 100%; }
.endpoint code { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
a { -webkit-tap-highlight-color: transparent; }
button:focus { outline: none; }
button:focus-visible, a:focus-visible { outline: 2.5px solid var(--a); outline-offset: 2px; }
.copy { border: 0; background: var(--ink); color: var(--paper); border-radius: 9px; padding: 7px 14px; font-weight: 600; font-size: 14px; white-space: nowrap; }
.copy:active { transform: translateY(1px); }

.placards { position: relative; height: 340px; }
.placard { position: absolute; width: 190px; height: 240px; border-radius: 18px; background: #fff; border: 3px solid currentColor; box-shadow: var(--shadow);
  display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 14px 10px 12px; transition: transform .35s cubic-bezier(.3,1.6,.5,1); }
.placard .lbl { font: 600 11px/1.2 "JetBrains Mono", monospace; letter-spacing: .14em; text-transform: uppercase; color: #333; text-align: center; }
.placard .g { font: 800 150px/1 "Bricolage Grotesque", sans-serif; letter-spacing: -.05em; margin-top: -6px; }
.placard.pa { color: var(--a); left: 50%; top: 10px; transform: translateX(-50%) rotate(2deg); z-index: 3; }
.placard.pb { color: var(--b); left: 4%; top: 70px; transform: rotate(-12deg); z-index: 2; }
.placard.pc { color: var(--c); right: 4%; top: 80px; transform: rotate(11deg); z-index: 1; }
.placards:hover .pa { transform: translateX(-50%) rotate(-3deg) translateY(-14px) scale(1.04); }
.placards:hover .pb { transform: rotate(-20deg) translateX(-20px); }
.placards:hover .pc { transform: rotate(19deg) translateX(20px); }
.placard .g { color: inherit; }
.sticker { position: absolute; right: 0; top: 0; z-index: 4; background: var(--c); color: #fff; font-weight: 800; font-size: 14px; line-height: 1.1; text-align: center; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; transform: rotate(14deg); box-shadow: var(--shadow); }

section { padding: 44px 0; }
h2 { font-size: clamp(30px, 4.5vw, 44px); letter-spacing: -.035em; line-height: 1.05; margin: 0 0 8px; }
.sub { color: var(--muted); margin: 0 0 26px; }

.panel { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 22px; box-shadow: var(--shadow); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.pick { position: relative; flex: none; display: flex; }
.pick select { appearance: none; -webkit-appearance: none; font: inherit; font-weight: 700; font-size: 17px; color: var(--ink); background: var(--paper);
  border: 2px solid var(--line); border-radius: 14px; padding: 0 40px 0 16px; min-width: 200px; cursor: pointer; outline: none; }
.pick select:focus { border-color: var(--a); }
.pick::after { content: ""; position: absolute; right: 16px; top: 50%; width: 8px; height: 8px; margin-top: -6px; border: solid var(--muted); border-width: 0 2.5px 2.5px 0; transform: rotate(45deg); pointer-events: none; }
.chip { border: 1.5px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 7px 15px; font-weight: 600; font-size: 15px; }
.chip[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.searchrow { display: flex; gap: 10px; }
.searchrow input { flex: 1; min-width: 0; font: inherit; font-size: 18px; padding: 13px 16px; border-radius: 14px; border: 2px solid var(--line); background: var(--paper); color: var(--ink); outline: none; }
.searchrow input:focus { border-color: var(--a); }
.go { border: 0; border-radius: 14px; background: var(--a); color: #fff; font-weight: 800; padding: 0 22px; font-size: 17px; }
.hint { font-size: 14px; color: var(--muted); margin-top: 10px; }
.hint button { border: 0; background: none; color: var(--a); padding: 0; text-decoration: underline; text-underline-offset: 3px; font-size: 14px; }
.results { margin-top: 18px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.item { border-radius: 14px; border: 1px solid var(--line); background: var(--paper); animation: pop .35s cubic-bezier(.3,1.5,.5,1) both; overflow: hidden; }
.res { display: flex; gap: 16px; align-items: center; justify-content: space-between; width: 100%; padding: 12px; border: 0; background: none; color: inherit; text-align: left; font: inherit; }
.res:hover .nm { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
.chev { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); border: 1.5px solid var(--line); font-size: 13px; transition: transform .2s; }
.res[aria-expanded="true"] .chev { transform: rotate(180deg); }
.res .more { display: block; font-size: 13px; color: var(--a); font-weight: 600; margin-top: 2px; }
.hist { border-top: 1px dashed var(--line); padding: 14px 14px 16px; font-size: 15px; }
.hist .note { margin: 0 0 10px; color: var(--muted); font-size: 14px; }
.tl { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--line); display: grid; gap: 16px; }
.tl > li { position: relative; }
.tl > li::before { content: ""; position: absolute; left: -25px; top: 5px; width: 12px; height: 12px; border-radius: 50%; background: var(--card); border: 2.5px solid var(--ink); }
.ih { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.idate { font-weight: 800; }
.itype { color: var(--muted); font-size: 13px; text-transform: lowercase; }
.facts { margin: 3px 0 2px; font-size: 14px; }
.fact b { font-weight: 600; color: var(--muted); margin-right: 4px; }
.fact + .fact::before { content: " · "; color: var(--muted); }
.vl { list-style: none; margin: 8px 0 0; padding: 0; border-top: 1px solid var(--line); }
.vl li { padding: 8px 0; border-bottom: 1px solid var(--line); }
.vt { font-weight: 600; font-size: 14px; line-height: 1.35; }
.vtags { margin-top: 2px; font-size: 13px; color: var(--muted); }
.vtags > * + *::before { content: " · "; color: var(--muted); font-weight: 400; }
.code { font-family: "JetBrains Mono", monospace; font-size: 12px; }
.tag.crit { color: var(--x); font-weight: 700; }
.tag.pts { color: var(--ink); font-weight: 700; }
.vc, .icom { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; cursor: pointer; }
.vc.open, .icom.open { -webkit-line-clamp: unset; display: block; cursor: auto; }
.vc { margin-top: 6px; font-size: 13px; color: var(--muted); line-height: 1.45; }
.older { margin-top: 12px; border: 1.5px solid var(--line); background: none; color: var(--ink); border-radius: 10px; padding: 7px 12px; font-weight: 600; font-size: 14px; }
.icom { margin: 6px 0 0; font-size: 13px; color: var(--muted); line-height: 1.45; }
.nov { font-size: 13px; color: var(--b); font-weight: 600; margin-top: 4px; }
.rep { display: inline-block; margin-top: 6px; font-size: 13px; font-weight: 600; color: var(--a); }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } }
.badges { flex: none; display: flex; align-items: stretch; gap: 8px; }
.badge { display: flex; align-items: center; justify-content: center; min-width: 48px; min-height: 48px; padding: 0 11px; border-radius: 11px;
  border: 2.5px solid currentColor; background: #fff; font-weight: 800; font-size: 28px; line-height: 1; letter-spacing: -.02em; }
.badge.word { font-size: 16px; letter-spacing: 0; white-space: nowrap; }
.num { display: flex; align-items: center; padding: 0 14px; border-radius: 999px; background: currentColor; }
.num span { color: #fff; font-weight: 800; font-size: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.res .meta { display: block; min-width: 0; flex: 1; }
.res .nm { display: block; font-weight: 700; line-height: 1.2; }
.res .ad { display: block; color: var(--muted); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.res .dt { display: block; font-size: 13px; color: var(--muted); }
.res .dt span { white-space: nowrap; }
.empty { color: var(--muted); padding: 12px 4px; }
.item.stale { opacity: .55; }
.item.stale:hover, .item.stale:focus-within { opacity: 1; }
.stalebtn { justify-self: start; }
.spin { display: inline-block; animation: wob .6s ease-in-out infinite alternate; }
@keyframes wob { from { transform: rotate(-12deg); } to { transform: rotate(12deg); } }

.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
pre { margin: 0; background: #1d1a14; color: #f3ecdf; padding: 16px 76px 16px 18px; border-radius: 14px; overflow-x: auto; line-height: 1.6; position: relative; }
@media (prefers-color-scheme: dark) { pre { background: #0d0c0a; border: 1px solid var(--line); } }
pre .copy { position: absolute; top: 10px; right: 10px; background: #f3ecdf; color: #1d1a14; padding: 4px 10px; font-size: 12px; }
.steps { margin: 0 0 14px; padding-left: 22px; color: var(--muted); }
.steps b { color: var(--ink); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.city { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: var(--shadow); }
.city h3 { margin: 0; font-size: 21px; letter-spacing: -.02em; line-height: 1.2; }
.city .region { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
.city .scale { display: flex; gap: 5px; margin: 12px 0; }
.city .scale span { flex: 1; min-width: 0; text-align: center; font-weight: 800; color: #fff; border-radius: 6px; padding: 3px 0; font-size: 14px; }
.city p { margin: 0; font-size: 14px; color: var(--muted); }
.city .dir { font: 600 11px/1 "JetBrains Mono", monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

.tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.tool { border-top: 3px solid var(--ink); padding-top: 12px; }
.tool code { font-weight: 600; font-size: 15px; }
.tool p { margin: 6px 0 0; color: var(--muted); font-size: 15px; }

footer { padding: 40px 0 60px; color: var(--muted); font-size: 14px; border-top: 1px dashed var(--line); margin-top: 30px; }
footer a { color: var(--muted); }

@media (max-width: 860px) {
  .hero { grid-template-columns: 1fr; padding-top: 10px; gap: 10px; }
  .placards { height: 290px; max-width: 420px; width: 100%; margin: 0 auto; }
  .placard { width: 150px; height: 190px; } .placard .g { font-size: 118px; }
  .tools { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  body { font-size: 16px; }
  .wrap { padding: 0 16px; }
  .top nav { display: none; }
  .searchrow { flex-wrap: wrap; }
  .pick { flex-basis: 100%; }
  .pick select { width: 100%; min-height: 50px; }
  .placard { width: 128px; height: 166px; } .placard .g { font-size: 100px; } .placard .lbl { font-size: 9px; }
  .placards { height: 250px; }
  .endpoint { width: 100%; justify-content: space-between; box-shadow: 3px 3px 0 var(--ink); }
  h1 em { white-space: normal; }
  .endpoint code { font-size: 14px; }
  .go { padding: 0 16px; }
  pre { font-size: 12.5px; padding: 46px 14px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
  pre .copy { top: 8px; right: 8px; }
  .res { gap: 12px; padding: 10px; }
  .res { flex-wrap: wrap; gap: 8px; }
  .res .meta { flex-basis: calc(100% - 40px); order: 0; }
  .chev { order: 1; }
  .badges { order: 2; }
  .hist { padding: 12px 12px 14px; }
  .badge { min-height: 40px; min-width: 40px; font-size: 24px; padding: 0 9px; } .badge.word { font-size: 14px; } .num { padding: 0 12px; } .num span { font-size: 14px; }
  .res .ad { white-space: normal; }
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="logo" href="/"><span class="mini">A</span> food.ian.sh</a>
    <nav><a href="#try">Try it</a><a href="#install">Install</a><a href="#cities">Cities</a></nav>
  </header>

  <div class="hero">
    <div>
      <h1>Should you <em>eat there?</em></h1>
      <p class="lede">An MCP server that gives your AI the <b>health inspection grades</b> for restaurants in ${cityList(cities)}. It's free and you don't need to sign up.</p>
      <div class="endpoint">
        <code id="ep">https://food.ian.sh/mcp</code>
        <button class="copy" data-copy="https://food.ian.sh/mcp">Copy</button>
      </div>
    </div>
    <div class="placards" aria-hidden="true">
      <div class="placard pb"><div class="lbl">Sanitary<br>Inspection Grade</div><div class="g">B</div><div class="lbl">Health Dept.</div></div>
      <div class="placard pc"><div class="lbl">Sanitary<br>Inspection Grade</div><div class="g">C</div><div class="lbl">Health Dept.</div></div>
      <div class="placard pa"><div class="lbl">Sanitary<br>Inspection Grade</div><div class="g">A</div><div class="lbl">Health Dept.</div></div>
      <div class="sticker">ask<br>your AI</div>
    </div>
  </div>

  <section id="try">
    <h2>Look up a place</h2>
    <p class="sub">Search right here, or ask your AI. Both use the same data.</p>
    <div class="panel">
      <form class="searchrow" id="f">
        <label class="pick"><span class="sr">City</span><select id="city">${options}</select></label>
        <input id="q" placeholder="Restaurant name…" autocomplete="off" aria-label="Restaurant name">
        <button class="go" type="submit">Check</button>
      </form>
      <div class="hint" id="hint"></div>
      <div class="results" id="out" aria-live="polite"></div>
    </div>
  </section>

  <section id="install">
    <h2>Plug it in</h2>
    <p class="sub">It's a remote MCP server over Streamable HTTP, with no auth or API keys.</p>
    <div class="panel">
      <div class="tabs" role="tablist">
        <button class="chip" data-tab="cc" aria-pressed="true">Claude Code</button>
        <button class="chip" data-tab="web" aria-pressed="false">Claude.ai / Desktop</button>
        <button class="chip" data-tab="gpt" aria-pressed="false">ChatGPT</button>
        <button class="chip" data-tab="json" aria-pressed="false">Cursor &amp; others</button>
      </div>
      <div data-pane="cc"><pre><button class="copy" data-copy="claude mcp add --transport http restaurant-health https://food.ian.sh/mcp">Copy</button>claude mcp add --transport http restaurant-health https://food.ian.sh/mcp</pre></div>
      <div data-pane="web" hidden>
        <ol class="steps">
          <li>Open <b>Settings → Connectors</b></li>
          <li>Click <b>Add custom connector</b></li>
          <li>Name it <b>Restaurant Health</b> and paste the URL below</li>
        </ol>
        <pre><button class="copy" data-copy="https://food.ian.sh/mcp">Copy</button>https://food.ian.sh/mcp</pre>
      </div>
      <div data-pane="gpt" hidden>
        <ol class="steps">
          <li>Visit <a href="https://chatgpt.com/plugins" target="_blank" rel="noopener"><b>chatgpt.com/plugins</b></a></li>
          <li>Click <b>Add → Add custom MCP server</b></li>
          <li>Paste the URL below</li>
        </ol>
        <pre><button class="copy" data-copy="https://food.ian.sh/mcp">Copy</button>https://food.ian.sh/mcp</pre>
      </div>
      <div data-pane="json" hidden><pre><button class="copy" data-copy='{"mcpServers":{"restaurant-health":{"url":"https://food.ian.sh/mcp"}}}'>Copy</button>{
  "mcpServers": {
    "restaurant-health": {
      "url": "https://food.ian.sh/mcp"
    }
  }
}</pre></div>
    </div>
    <p class="sub" style="margin-top:22px">Then ask something like <i>"Is Katz's Deli still an A?"</i> or <i>"What violations did the In-N-Out on Sunset get last time?"</i></p>
    <div class="tools">
      <div class="tool"><code>search_restaurants</code><p>Searches by name, with optional address words or ZIP, and returns the current grade or result.</p></div>
      <div class="tool"><code>get_inspection_history</code><p>Lists past inspections with scores and violations, newest first.</p></div>
      <div class="tool"><code>rating_systems</code><p>Explains each city's grading scale, since a 12 means something different in every one.</p></div>
    </div>
  </section>

  <section id="cities">
    <h2>${cities.length} cities, no two grade alike</h2>
    <p class="sub">The cities don't use the same scale, so the server explains each result. Data is refreshed daily.</p>
    <div class="grid">
      ${grid}
    </div>
  </section>

  <footer>
    Data comes from public sources: ${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}.
    This site isn't affiliated with any health department. Check the placard in the window before you trust it. Made by <a href="https://ian.sh">ian.sh</a>.
  </footer>
</div>

<script>
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); } catch {}
  const t = b.textContent; b.textContent = "Copied!"; setTimeout(() => (b.textContent = t), 1200);
});

$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  $$("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
}));

const EXAMPLES = ${examples};
const V = "${esc(apiVersion)}"; // in API URLs so browser caches turn over on deploys
let city = $("#city").value;
function renderHint() {
  $("#hint").innerHTML = "Try: " + EXAMPLES[city].map((x) => '<button type="button" data-ex="' + esc(x) + '">' + esc(x) + "</button>").join(" · ");
}
$("#hint").addEventListener("click", (e) => { const b = e.target.closest("[data-ex]"); if (b) { $("#q").value = b.dataset.ex; run(); } });
$("#city").addEventListener("change", (e) => {
  city = e.target.value;
  renderHint();
  if ($("#q").value.trim()) run();
});
renderHint();

function badge(r) {
  const b = r.badge || { text: "?", tone: "gray" };
  const word = b.text.length > 3;
  const col = TONES[b.tone] || TONES.gray;
  return '<span class="badges" style="color:' + col + '"><span class="badge' + (word ? " word" : "") + '">' + esc(b.text) + "</span>" +
    (b.sub ? '<span class="num"><span>' + esc(b.sub) + "</span></span>" : "") + "</span>";
}
const TONES = { blue: "var(--a)", green: "var(--b)", orange: "var(--c)", red: "var(--x)", yellow: "var(--cond)", gray: "var(--muted)" };
function detail(r) {
  const bits = [];
  if (r.latest_inspection_date) bits.push("inspected " + r.latest_inspection_date);
  const sub = (r.badge && r.badge.sub) || "";
  if (r.latest_violation_count != null && !/viol|critical/.test(sub)) bits.push(r.latest_violation_count + " violations");
  return bits.map((b) => "<span>" + esc(b) + "</span>").join(" · ");
}
const STALE_YEARS = 2;
const STALE_CUTOFF = new Date(Date.now() - STALE_YEARS * 365.25 * 864e5).toISOString().slice(0, 10);
let seq = 0;
async function run() {
  const q = $("#q").value.trim();
  if (q.length < 2) return;
  const my = ++seq;
  $("#out").innerHTML = '<div class="empty"><span class="spin">🍴</span> Checking…</div>';
  try {
    const res = await fetch("/api/search?city=" + city + "&name=" + encodeURIComponent(q) + "&v=" + V);
    const d = await res.json();
    if (my !== seq) return;
    if (d.error) throw new Error(d.error);
    if (!d.results.length) { $("#out").innerHTML = '<div class="empty">No matches. Try fewer words, or check the city.</div>'; return; }
    // Places not inspected in STALE_YEARS are probably closed: gray them out, and tuck them behind a button
    // when the search also found recently inspected places.
    const stale = (r) => r.latest_inspection_date && r.latest_inspection_date < STALE_CUTOFF;
    const item = (r, i) =>
      '<div class="item' + (stale(r) ? " stale" : "") + '" style="animation-delay:' + i * 40 + 'ms">' +
      '<button type="button" class="res" aria-expanded="false" data-city="' + esc(d.city) + '" data-id="' + esc(r.id) + '">' +
      '<span class="meta"><span class="nm">' + esc(r.name) + '</span><span class="ad">' + esc(r.address || r.location || "") + '</span><span class="dt">' + detail(r) + "</span></span>" +
      badge(r) + '<span class="chev" aria-hidden="true">▾</span></button><div class="hist" hidden></div></div>';
    const fresh = d.results.filter((r) => !stale(r)), old = d.results.filter(stale);
    if (!fresh.length || !old.length) { $("#out").innerHTML = d.results.map(item).join(""); return; }
    $("#out").innerHTML = fresh.map(item).join("") +
      '<button type="button" class="older stalebtn">Show ' + old.length + " place" + (old.length === 1 ? "" : "s") + " not inspected since " + STALE_CUTOFF.slice(0, 4) + "</button>" +
      '<div class="results" hidden style="margin-top:0">' + old.map(item).join("") + "</div>";
  } catch (err) {
    if (my === seq) $("#out").innerHTML = '<div class="empty">Something went wrong: ' + esc(err.message) + "</div>";
  }
}
$("#f").addEventListener("submit", (e) => { e.preventDefault(); run(); });

// ---- Inspection history (expand a result)
$("#out").addEventListener("click", (e) => {
  const c = e.target.closest(".vc, .icom");
  if (c) c.classList.add("open");
  const o = e.target.closest(".older");
  if (o) { o.nextElementSibling.hidden = false; o.remove(); }
});
$("#out").addEventListener("click", async (e) => {
  const btn = e.target.closest(".res");
  if (!btn) return;
  const panel = btn.nextElementSibling;
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  panel.hidden = open;
  if (open || panel.dataset.loaded) return;
  panel.innerHTML = '<div class="empty"><span class="spin">🍴</span> Loading inspections…</div>';
  try {
    const res = await fetch("/api/history?city=" + encodeURIComponent(btn.dataset.city) + "&id=" + encodeURIComponent(btn.dataset.id) + "&v=" + V);
    const d = await res.json();
    panel.innerHTML = renderHist(d);
    panel.dataset.loaded = d.error ? "" : "1";
  } catch (err) {
    panel.innerHTML = '<div class="empty">Could not load inspections: ' + esc(err.message) + "</div>";
  }
});

const FACTS = [
  ["grade", "Grade"], ["score", "Score"], ["demerits", "Demerits"], ["rating", "Rating"], ["placard", "Placard"],
  ["status", "Result"], ["result", "Result"], ["outcome", "Outcome"],
  ["critical_violations", "Critical"], ["critical_not_corrected", "Critical uncorrected"], ["noncritical_violations", "Non-critical"],
  ["violation_count", "Violations"],
];
const num = (v) => (v !== "" && v != null && !isNaN(v) ? String(Number(v)) : String(v));
const tag = (t, cls) => '<span class="tag' + (cls ? " " + cls : "") + '">' + esc(t) + "</span>";

function renderHist(d) {
  if (d.error) return '<div class="empty">' + esc(d.error) + "</div>";
  const ins = d.inspections || [];
  let h = d.note ? '<p class="note">' + esc(d.note) + "</p>" : "";
  if (!ins.length) return h + '<div class="empty">No inspections on record.</div>';
  const first = ins.slice(0, 3).map(inspection).join("");
  const rest = ins.slice(3).map(inspection).join("");
  return h + '<ol class="tl">' + first + "</ol>" +
    (rest ? '<button type="button" class="older">Show ' + (ins.length - 3) + " older inspection" + (ins.length - 3 === 1 ? "" : "s") + '</button><ol class="tl" hidden style="margin-top:16px">' + rest + "</ol>" : "");
}

function inspection(i) {
  const facts = FACTS.filter(([k]) => i[k] != null && i[k] !== "" && !(k === "result" && i.status))
    .map(([k, label]) => '<span class="fact"><b>' + label + "</b>" + esc(num(i[k])) + "</span>");
  if (i.rating_fr && i.rating_fr !== i.rating) facts.push('<span class="fact">' + esc(i.rating_fr) + "</span>");
  if (i.scores) for (const [k, v] of Object.entries(i.scores)) if (v != null) facts.push('<span class="fact"><b>' + esc(k.replace(/([a-z])([A-Z])/g, "$1 $2")) + "</b>" + esc(v) + " penalty pts</span>");
  const vs = Array.isArray(i.violations) ? i.violations : Array.isArray(i.infractions) ? i.infractions : null;
  let body = "";
  if (vs && vs.length) body = '<ul class="vl">' + vs.map(violation).join("") + "</ul>";
  else if (vs) body = '<div class="nov">No violations recorded</div>';
  else if (typeof i.violations === "string" && i.violations) body = '<p class="icom">Violation codes: ' + esc(i.violations) + "</p>";
  const note = i.comment || i.comments || i.action;
  const links = [i.report_url, i.report_pdf].filter(Boolean).map((u) => '<a class="rep" href="' + esc(u) + '" target="_blank" rel="noopener">View inspection report ↗</a>').join(" ");
  return '<li><div class="ih"><span class="idate">' + esc(i.date || "Undated") + "</span>" + (i.type ? '<span class="itype">' + esc(i.type) + "</span>" : "") + (i.context ? '<span class="itype">' + esc(i.context) + "</span>" : "") + "</div>" +
    (facts.length ? '<div class="facts">' + facts.join("") + "</div>" : "") + body + (note ? '<p class="icom">' + esc(note) + "</p>" : "") + links + "</li>";
}

function violation(v) {
  const tags = [];
  if (v.critical === true) tags.push(tag("critical", "crit"));
  if (v.level) tags.push(tag(v.level, v.level === "critical" ? "crit" : ""));
  if (v.severity) tags.push(tag(v.severity.replace(/^[A-Z] - /, ""), /crucial/i.test(v.severity) ? "crit" : ""));
  if (v.type) tags.push(tag(v.type, /^priority$/i.test(v.type) ? "crit" : ""));
  if (v.points != null && v.points !== "" && Number(v.points) > 0) tags.push(tag(num(v.points) + " pts", "pts"));
  if (v.weight != null && Number(v.weight) > 0) tags.push(tag(num(v.weight) + " pts", "pts"));
  if (v.status && v.status !== "OUT OF COMPLIANCE") tags.push(tag(v.status));
  if (v.corrected === true || v.corrected === "True" || v.corrected_on_site === true) tags.push(tag("corrected on site"));
  if (v.outcome) tags.push(tag(v.outcome, /convict/i.test(v.outcome) ? "crit" : ""));
  if (v.fine) tags.push(tag("$" + v.fine + " fine", "crit"));
  const title = v.description || v.problem || v.code || "Violation";
  const extra = v.comments || (v.description && v.problem) ? v.comments || v.problem : "";
  return '<li><div class="vt">' + esc(title) + "</div>" +
    ((v.code && title !== v.code) || tags.length ? '<div class="vtags">' + (v.code && title !== v.code ? '<span class="code">' + esc(v.code) + "</span>" : "") + tags.join("") + "</div>" : "") +
    (extra ? '<div class="vc">' + esc(extra) + "</div>" : "") + "</li>";
}
</script>
</body>
</html>`;
}
