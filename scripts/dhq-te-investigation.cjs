#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// dhq-te-investigation.cjs — WHY are elite TEs ~40% under the FantasyCalc
// market in the real Psycho League (Year VI), and which TE lever closes it?
// Runs the REAL engine vs the real league; levers applied as in-memory
// source patches only (NOTHING written to shared/*). Diagnosis only.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const LEAGUE_ID = '1312100327931019264';

function makeStorage() { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => {}, get length() { return Object.keys(s).length; }, key: i => Object.keys(s)[i] ?? null }; }
function makeDocument() { const el = () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }); return { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: el, body: el(), head: el() }; }
function buildCtx() {
  const ctx = { localStorage: makeStorage(), sessionStorage: makeStorage(), document: makeDocument(), console,
    location: { hostname: 'localhost', pathname: '/', search: '', href: 'http://localhost/' }, navigator: { userAgent: 'node' },
    performance: { now: () => Date.now() }, fetch: (u, o) => globalThis.fetch(u, o), setTimeout: fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, queueMicrotask: fn => Promise.resolve().then(fn), structuredClone: o => JSON.parse(JSON.stringify(o)),
    Date, Math, Object, Array, Number, String, Boolean, JSON, RegExp, Error, Function, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, URLSearchParams, URL, Set, Map, WeakMap, WeakSet, Symbol, Promise, Reflect, Proxy, ArrayBuffer, Float64Array, Float32Array, Int32Array, Uint8Array, Intl };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.DEV_MODE = false; vm.createContext(ctx); return ctx;
}
const MODULES = ['shared/app-config.js', 'shared/data-cache.js', 'shared/constants.js', 'shared/utils.js', 'shared/storage.js', 'shared/event-bus.js', 'shared/tier.js', 'shared/pick-value-model.js', 'shared/sleeper-api.js', 'shared/dhq-core.js', 'shared/intelligence-context.js', 'shared/dhq-engine.js'];
function loadPatched(ctx, rel, patches) { let code = fs.readFileSync(path.join(ROOT, rel), 'utf8'); (patches[rel] || []).forEach(({ find, replace, label }) => { if (!code.includes(find)) throw new Error(`patch miss ${rel}: ${label}`); code = code.replace(find, replace); }); vm.runInContext(code, ctx, { filename: rel }); }
async function getJSON(u) { const r = await globalThis.fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

(async () => {
  const players = await getJSON('https://api.sleeper.app/v1/players/nfl');
  const nflState = await getJSON('https://api.sleeper.app/v1/state/nfl').catch(() => ({ season: '2026', season_type: 'off' }));
  const season = parseInt(nflState.season) || 2026;
  const years = Array.from({ length: 5 }, (_, i) => season - 4 + i);
  const seasonStats = {}; for (const yr of years) { try { seasonStats[yr] = await getJSON('https://api.sleeper.app/v1/stats/nfl/regular/' + yr); } catch (e) { seasonStats[yr] = {}; } }
  function cachedSf(p) { const m = String(p).match(/\/stats\/nfl\/regular\/(\d+)/); if (m) return Promise.resolve(seasonStats[m[1]] || {}); if (String(p).includes('/players/nfl')) return Promise.resolve(players); if (String(p).includes('/state/nfl')) return Promise.resolve(nflState); return Promise.resolve([]); }
  const league = await getJSON('https://api.sleeper.app/v1/league/' + LEAGUE_ID);
  const realRosters = await getJSON('https://api.sleeper.app/v1/league/' + LEAGUE_ID + '/rosters');
  const NTEAMS = league.total_rosters || realRosters.length || 16;
  const rosters = realRosters.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id, players: r.players || [] }));
  const leagueSeason = String(league.season || season);
  const leagues = [{ league_id: LEAGUE_ID, season: leagueSeason, total_rosters: NTEAMS, roster_positions: league.roster_positions, scoring_settings: league.scoring_settings }];
  console.log(`League: ${league.name} | TE slots: ${(league.roster_positions||[]).filter(s=>s==='TE').length} + flex`);

  async function runEngine(patches) {
    const ctx = buildCtx(); for (const m of MODULES) { try { loadPatched(ctx, m, patches); } catch (e) { console.warn('[load]', m, e.message); } }
    ctx.window.App.sf = cachedSf; ctx.window.sf = cachedSf; if (ctx.window.Sleeper) ctx.window.Sleeper.sleeperFetch = cachedSf;
    const S = { currentLeagueId: LEAGUE_ID, season: leagueSeason, platform: 'sleeper', players, leagues, rosters: JSON.parse(JSON.stringify(rosters)), nflState, myRosterId: rosters[0]?.roster_id || 1 };
    ctx.window.S = S; ctx.window.App.S = S; ctx.window.App.LI_LOADED = false;
    await ctx.window.App.loadLeagueIntel(); const LI = ctx.window.App.LI || {};
    return { scores: LI.playerScores || {}, meta: LI.playerMeta || {} };
  }
  const nameOf = pid => { const p = players[pid]; return p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid) : pid; };
  function devByPos(scores, meta) {
    const rows = Object.keys(scores).map(pid => ({ pid, pos: meta[pid]?.pos, dhq: scores[pid], fc: Math.round(meta[pid]?.fcValue || 0) })).filter(r => r.fc > 0 && r.dhq > 0);
    const top = rows.slice().sort((a, b) => b.fc - a.fc).slice(0, 60);
    const dhqTop = Math.max(...rows.map(r => r.dhq)), fcTop = Math.max(...rows.map(r => r.fc)), scale = dhqTop / fcTop;
    const byPos = {}; top.forEach(r => { const d = (r.dhq - r.fc * scale) / (r.fc * scale); (byPos[r.pos] = byPos[r.pos] || []).push(d); });
    const out = {}; ['QB', 'RB', 'WR', 'TE'].forEach(p => { const a = byPos[p] || []; out[p] = a.length ? Math.round(100 * a.reduce((s, x) => s + x, 0) / a.length) : null; }); return out;
  }

  const TE_WEIGHT = { 'shared/dhq-engine.js': [{ label: 'TE dynasty weight 0.95→1.15', find: 'TE:0.95,K:0.30', replace: 'TE:1.15,K:0.30' }] };
  const TE_AGE = { 'shared/constants.js': [{ label: 'TE peak earlier (build22, peak23-29)', find: 'TE:{build:[23,25],peak:[26,29],decline:[30,32]}', replace: 'TE:{build:[22,22],peak:[23,29],decline:[30,32]}' }] };
  const merge = (...ps) => { const o = {}; ps.forEach(p => Object.entries(p).forEach(([k, v]) => { o[k] = (o[k] || []).concat(v); })); return o; };
  const SCEN = [['baseline', {}], ['TE weight 1.15', TE_WEIGHT], ['TE age (peak@23)', TE_AGE], ['TE weight + age', merge(TE_WEIGHT, TE_AGE)]];

  console.log('\n── FC deviation by position (top-60 FC), per scenario ──');
  let baseRun = null;
  for (const [label, patches] of SCEN) {
    const r = await runEngine(patches); if (!baseRun) baseRun = r;
    const d = devByPos(r.scores, r.meta);
    console.log(`  ${label.padEnd(18)} QB ${String(d.QB).padStart(4)}%  RB ${String(d.RB).padStart(4)}%  WR ${String(d.WR).padStart(4)}%  TE ${String(d.TE).padStart(4)}%`);
  }

  // Cause: decompose top TEs vs top WRs (baseline)
  const { scores, meta } = baseRun;
  const fcRows = Object.keys(meta).filter(pid => (meta[pid]?.fcValue || 0) > 0 && scores[pid] > 0).map(pid => ({ pid, name: nameOf(pid), m: meta[pid], dhq: scores[pid], fc: Math.round(meta[pid].fcValue) }));
  const dhqTop = Math.max(...fcRows.map(r => r.dhq)), fcTop = Math.max(...fcRows.map(r => r.fc)), scale = dhqTop / fcTop;
  const fmt = r => { const m = r.m; const comp = +(m.lineupValuePPG * m.ageFactor * m.sitMult * m.posDynastyWeight).toFixed(1); const dev = Math.round(100 * (r.dhq - r.fc * scale) / (r.fc * scale)); return `  ${r.name.padEnd(20)} ${String(m.pos).padEnd(3)} wPPG ${String(m.ppg).padStart(5)}  ageF ${String(m.ageFactor).padStart(5)}  sit ${String(m.sitMult).padStart(5)}  posWt ${String(m.posDynastyWeight).padStart(5)}  comp ${String(comp).padStart(6)}  DHQ ${String(r.dhq).padStart(5)}  FC ${String(r.fc).padStart(5)}  dev ${String(dev).padStart(4)}%`; };
  const topTE = fcRows.filter(r => r.m.pos === 'TE').sort((a, b) => b.fc - a.fc).slice(0, 8);
  const topWR = fcRows.filter(r => r.m.pos === 'WR').sort((a, b) => b.fc - a.fc).slice(0, 6);
  console.log('\n── Elite TEs (baseline decomposition) ──'); topTE.forEach(r => console.log(fmt(r)));
  console.log('\n── Elite WRs (for contrast) ──'); topWR.forEach(r => console.log(fmt(r)));

  // Isolate each factor's drag on TEs vs the WR cohort
  const avg = (arr, f) => arr.reduce((s, r) => s + f(r), 0) / arr.length;
  console.log('\n── Factor comparison: elite TE cohort vs elite WR cohort ──');
  console.log(`  wPPG:     TE ${avg(topTE, r => r.m.ppg).toFixed(1)}  vs WR ${avg(topWR, r => r.m.ppg).toFixed(1)}`);
  console.log(`  ageFactor:TE ${avg(topTE, r => r.m.ageFactor).toFixed(3)} vs WR ${avg(topWR, r => r.m.ageFactor).toFixed(3)}`);
  console.log(`  sitMult:  TE ${avg(topTE, r => r.m.sitMult).toFixed(3)} vs WR ${avg(topWR, r => r.m.sitMult).toFixed(3)}`);
  console.log(`  posWt:    TE ${avg(topTE, r => r.m.posDynastyWeight).toFixed(3)} vs WR ${avg(topWR, r => r.m.posDynastyWeight).toFixed(3)}`);
  const out = { league: league.name };
  fs.writeFileSync(path.join(ROOT, 'reports', 'dhq-te-investigation.json'), JSON.stringify({ topTE: topTE.map(r => ({ name: r.name, ...r.m, dhq: r.dhq, fc: r.fc })), topWR: topWR.map(r => ({ name: r.name, pos: r.m.pos, ppg: r.m.ppg, ageFactor: r.m.ageFactor, sitMult: r.m.sitMult, posDynastyWeight: r.m.posDynastyWeight, dhq: r.dhq, fc: r.fc })) }, null, 2));
  console.log('\nJSON → reports/dhq-te-investigation.json');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
