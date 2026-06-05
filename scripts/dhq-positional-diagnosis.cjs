#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// dhq-positional-diagnosis.cjs — WHY does DHQ score elite RB/WR/TE far
// below FantasyCalc while QBs sit at market, and which lever fixes it?
//
// Runs the REAL engine against real Sleeper data (16-team SF 0.5PPR), once
// as baseline and once per candidate lever — applied as IN-MEMORY source
// patches only (NOTHING is written to shared/*). Reports FC deviation by
// position for each scenario + a per-player composite decomposition.
//
// Output: reports/dhq-positional-diagnosis.json (+ console table)
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function makeStorage() { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => { for (const k of Object.keys(s)) delete s[k]; }, get length() { return Object.keys(s).length; }, key: i => Object.keys(s)[i] ?? null }; }
function makeDocument() { const el = () => ({ id: '', style: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }); return { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: el, body: el(), head: el() }; }
function buildCtx() {
  const ctx = {
    localStorage: makeStorage(), sessionStorage: makeStorage(), document: makeDocument(), console,
    location: { hostname: 'localhost', pathname: '/', search: '', href: 'http://localhost/' },
    navigator: { userAgent: 'node' }, performance: { now: () => Date.now() },
    fetch: (u, o) => globalThis.fetch(u, o), setTimeout: fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, queueMicrotask: fn => Promise.resolve().then(fn),
    structuredClone: o => JSON.parse(JSON.stringify(o)),
    Date, Math, Object, Array, Number, String, Boolean, JSON, RegExp, Error, Function,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    URLSearchParams, URL, Set, Map, WeakMap, WeakSet, Symbol, Promise, Reflect, Proxy,
    ArrayBuffer, Float64Array, Float32Array, Int32Array, Uint8Array, Intl,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.DEV_MODE = false;
  vm.createContext(ctx); return ctx;
}
const MODULES = ['shared/app-config.js', 'shared/data-cache.js', 'shared/constants.js', 'shared/utils.js',
  'shared/storage.js', 'shared/event-bus.js', 'shared/tier.js', 'shared/pick-value-model.js',
  'shared/sleeper-api.js', 'shared/dhq-core.js', 'shared/intelligence-context.js', 'shared/dhq-engine.js'];
// Apply {find,replace} patches to a module's source before running it.
function loadPatched(ctx, rel, patches) {
  let code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  (patches[rel] || []).forEach(({ find, replace, label }) => {
    if (!code.includes(find)) throw new Error(`patch miss in ${rel}: ${label || find.slice(0, 40)}`);
    code = code.replace(find, replace);
  });
  vm.runInContext(code, ctx, { filename: rel });
}
async function getJSON(u) { const r = await globalThis.fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

(async () => {
  console.log('Fetching Sleeper players + stats…');
  const players = await getJSON('https://api.sleeper.app/v1/players/nfl');
  const nflState = await getJSON('https://api.sleeper.app/v1/state/nfl').catch(() => ({ season: '2026', season_type: 'off' }));
  const season = parseInt(nflState.season) || 2026;
  const years = Array.from({ length: 5 }, (_, i) => season - 4 + i);
  const seasonStats = {};
  for (const yr of years) { try { seasonStats[yr] = await getJSON('https://api.sleeper.app/v1/stats/nfl/regular/' + yr); } catch (e) { seasonStats[yr] = {}; } }
  function cachedSf(p) { const m = String(p).match(/\/stats\/nfl\/regular\/(\d+)/); if (m) return Promise.resolve(seasonStats[m[1]] || {}); if (String(p).includes('/players/nfl')) return Promise.resolve(players); if (String(p).includes('/state/nfl')) return Promise.resolve(nflState); return Promise.resolve([]); }
  // Real league: The Psycho League: Year VI (Sleeper) — 16-team SF, 0.5 PPR,
  // 12 offense + 11 IDP starters, with the league's actual IDP scoring.
  const LEAGUE_ID = '1312100327931019264';
  const league = await getJSON('https://api.sleeper.app/v1/league/' + LEAGUE_ID);
  const realRosters = await getJSON('https://api.sleeper.app/v1/league/' + LEAGUE_ID + '/rosters');
  const NTEAMS = league.total_rosters || realRosters.length || 16;
  const rosters = realRosters.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id, players: r.players || [] }));
  const leagueSeason = String(league.season || season);
  const leagues = [{ league_id: LEAGUE_ID, season: leagueSeason, total_rosters: NTEAMS,
    roster_positions: league.roster_positions, scoring_settings: league.scoring_settings }];
  console.log(`League: ${league.name} | teams ${NTEAMS} | starters ${(league.roster_positions||[]).filter(s=>s!=='BN'&&s!=='IR'&&s!=='TAXI').length} | rostered players ${rosters.reduce((s,r)=>s+r.players.length,0)}`);

  async function runEngine(patches) {
    const ctx = buildCtx();
    for (const m of MODULES) { try { loadPatched(ctx, m, patches); } catch (e) { console.warn('  [load]', m, e.message); } }
    ctx.window.App.sf = cachedSf; ctx.window.sf = cachedSf; if (ctx.window.Sleeper) ctx.window.Sleeper.sleeperFetch = cachedSf;
    const S = { currentLeagueId: LEAGUE_ID, season: leagueSeason, platform: 'sleeper', players, leagues, rosters: JSON.parse(JSON.stringify(rosters)), nflState, myRosterId: rosters[0]?.roster_id || 1 };
    ctx.window.S = S; ctx.window.App.S = S; ctx.window.App.LI_LOADED = false;
    await ctx.window.App.loadLeagueIntel();
    const LI = ctx.window.App.LI || {};
    return { scores: LI.playerScores || {}, meta: LI.playerMeta || {} };
  }

  // ── candidate levers (in-memory patches only) ──
  const P = {
    qbWeight: { 'shared/dhq-engine.js': [{ label: 'QB dynasty weight 1.0→0.65', find: 'const baseDynastyWeight={QB:1.0,RB:1.0,WR:1.0,TE:0.95,', replace: 'const baseDynastyWeight={QB:0.65,RB:1.05,WR:1.05,TE:1.0,' }] },
    vor: { 'shared/dhq-engine.js': [{ label: 'lineupValue VOR mix 0.35/0.65→0.15/0.85', find: 'return (p.wPPG*0.35)+(edge*0.65);', replace: 'return (p.wPPG*0.15)+(edge*0.85);' }] },
    fcBlend: { 'shared/dhq-core.js': [{ label: 'FC blend weight floor→0.55', find: 'return +Math.min(weight,cap).toFixed(2);', replace: 'return 0.55;' }] },
  };
  const merge = (...ps) => { const out = {}; ps.forEach(p => Object.entries(p).forEach(([k, v]) => { out[k] = (out[k] || []).concat(v); })); return out; };
  const SCENARIOS = [
    ['baseline (today)', {}],
    ['A: QB weight 0.65', P.qbWeight],
    ['B: VOR-heavy lineup', P.vor],
    ['C: FC blend 55%', P.fcBlend],
    ['A+B: QB weight + VOR', merge(P.qbWeight, P.vor)],
    ['A+B+C: all three', merge(P.qbWeight, P.vor, P.fcBlend)],
  ];

  const nameOf = pid => { const p = players[pid]; return p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid) : pid; };
  function fcDevByPos(scores, meta) {
    const rows = Object.keys(scores).map(pid => ({ pid, name: nameOf(pid), pos: meta[pid]?.pos, dhq: scores[pid], fc: Math.round(meta[pid]?.fcValue || 0) })).filter(r => r.fc > 0 && r.dhq > 0);
    const top = rows.slice().sort((a, b) => b.fc - a.fc).slice(0, 60);
    const dhqTop = Math.max(...rows.map(r => r.dhq)); const fcTop = Math.max(...rows.map(r => r.fc)); const scale = dhqTop / fcTop;
    const byPos = {}; top.forEach(r => { const d = (r.dhq - r.fc * scale) / (r.fc * scale); (byPos[r.pos] = byPos[r.pos] || []).push(d); });
    const out = {}; ['QB', 'RB', 'WR', 'TE'].forEach(p => { const a = byPos[p] || []; out[p] = a.length ? Math.round(100 * a.reduce((s, x) => s + x, 0) / a.length) : null; });
    // spearman vs FC over all FC-matched
    const byDhq = rows.slice().sort((a, b) => b.dhq - a.dhq); const dr = new Map(byDhq.map((r, i) => [r.pid, i + 1]));
    const byFc = rows.slice().sort((a, b) => b.fc - a.fc); const fr = new Map(byFc.map((r, i) => [r.pid, i + 1]));
    const n = rows.length; let d2 = 0; rows.forEach(r => { const d = dr.get(r.pid) - fr.get(r.pid); d2 += d * d; });
    const rho = n > 2 ? +(1 - 6 * d2 / (n * (n * n - 1))).toFixed(3) : 0;
    return { byPos: out, rho, n: rows.length };
  }

  const results = [];
  for (const [label, patches] of SCENARIOS) {
    process.stdout.write(`Running ${label}… `);
    const { scores, meta } = await runEngine(patches);
    const a = fcDevByPos(scores, meta);
    results.push({ label, ...a, _scores: scores, _meta: meta });
    console.log(`QB ${a.byPos.QB}%  RB ${a.byPos.RB}%  WR ${a.byPos.WR}%  TE ${a.byPos.TE}%  | rho ${a.rho}`);
  }

  // decomposition of representative players in baseline
  const base = results[0];
  const sample = ['Josh Allen', "Ja'Marr Chase", 'Puka Nacua', 'Bijan Robinson', 'Brock Bowers'];
  const decomp = sample.map(nm => {
    const pid = Object.keys(base._meta).find(id => nameOf(id) === nm); if (!pid) return null;
    const m = base._meta[pid];
    return { name: nm, pos: m.pos, wPPG: m.ppg, ageFactor: m.ageFactor, sitMult: m.sitMult,
      posDynastyWeight: m.posDynastyWeight, lineupValuePPG: m.lineupValuePPG,
      composite: +(m.lineupValuePPG * m.ageFactor * m.sitMult * m.posDynastyWeight).toFixed(1),
      dhq: base._scores[pid], fcValue: Math.round(m.fcValue || 0) };
  }).filter(Boolean);

  console.log('\n── Baseline composite decomposition ──');
  console.log('  name                pos  wPPG  ageF  sitMlt  posWt  lineupVPPG  composite   DHQ    FC');
  decomp.forEach(d => console.log(`  ${d.name.padEnd(18)} ${String(d.pos).padEnd(3)}  ${String(d.wPPG).padStart(4)}  ${String(d.ageFactor).padStart(4)}  ${String(d.sitMult).padStart(5)}  ${String(d.posDynastyWeight).padStart(5)}  ${String(d.lineupValuePPG).padStart(9)}  ${String(d.composite).padStart(8)}  ${String(d.dhq).padStart(5)} ${String(d.fcValue).padStart(5)}`));

  const out = { leagueModel: '16-team SF 0.5PPR, real Sleeper data, season ' + season,
    legend: 'FC deviation by position among the 60 highest-FC players; negative = DHQ below market. Goal: bring RB/WR/TE near 0 without breaking QB.',
    scenarios: results.map(r => ({ label: r.label, byPos: r.byPos, rho: r.rho })), decomposition: decomp };
  fs.writeFileSync(path.join(ROOT, 'reports', 'dhq-positional-diagnosis.json'), JSON.stringify(out, null, 2));
  console.log('\nJSON → reports/dhq-positional-diagnosis.json');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
