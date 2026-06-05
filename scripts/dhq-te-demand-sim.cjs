#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// dhq-te-demand-sim.cjs — Does DHQ respond to TE starter DEMAND?
// Same real league (Psycho Year VI), but vary only the roster: require
// 1 / 2 / 3 starting TEs (converting FLEX→TE) and watch TE DHQ + FC dev.
// Tests whether DHQ correctly says "TEs are less valuable when the league
// only requires one." No source patches; only roster_positions change.
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
function load(ctx, rel) { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel }); }
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
  const baseRP = league.roster_positions.slice();
  // Build a roster requiring N starting TEs by converting FLEX→TE (keeps 23 starters).
  function rosterWithTEs(n) {
    const rp = baseRP.slice(); let have = rp.filter(s => s === 'TE').length;
    for (let i = 0; i < rp.length && have < n; i++) { if (rp[i] === 'FLEX') { rp[i] = 'TE'; have++; } }
    return rp;
  }
  console.log(`League: ${league.name} | base TE slots: ${baseRP.filter(s => s === 'TE').length}, FLEX: ${baseRP.filter(s => s === 'FLEX').length}`);

  async function runEngine(rosterPositions) {
    const ctx = buildCtx(); for (const m of MODULES) { try { load(ctx, m); } catch (e) { console.warn('[load]', m, e.message); } }
    ctx.window.App.sf = cachedSf; ctx.window.sf = cachedSf; if (ctx.window.Sleeper) ctx.window.Sleeper.sleeperFetch = cachedSf;
    const leagues = [{ league_id: LEAGUE_ID, season: leagueSeason, total_rosters: NTEAMS, roster_positions: rosterPositions, scoring_settings: league.scoring_settings }];
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

  const scen = [['1 TE (real)', 1], ['2 TE', 2], ['3 TE', 3]];
  const runs = {};
  console.log('\n── FC deviation by position, by TE-start requirement ──');
  for (const [label, n] of scen) {
    const r = await runEngine(rosterWithTEs(n)); runs[label] = r;
    const d = devByPos(r.scores, r.meta);
    console.log(`  ${label.padEnd(12)} QB ${String(d.QB).padStart(4)}%  RB ${String(d.RB).padStart(4)}%  WR ${String(d.WR).padStart(4)}%  TE ${String(d.TE).padStart(4)}%`);
  }

  // Per-TE DHQ across requirements
  const base = runs['1 TE (real)'];
  const topTE = Object.keys(base.meta).filter(pid => base.meta[pid]?.pos === 'TE' && (base.meta[pid]?.fcValue || 0) > 0)
    .sort((a, b) => (base.meta[b].fcValue || 0) - (base.meta[a].fcValue || 0)).slice(0, 10);
  console.log('\n── Elite TE DHQ vs TE-start requirement ──');
  console.log('  name                 1TE    2TE    3TE     FC     posWt(1→2→3)');
  topTE.forEach(pid => {
    const d1 = base.scores[pid] || 0, d2 = runs['2 TE'].scores[pid] || 0, d3 = runs['3 TE'].scores[pid] || 0;
    const w1 = base.meta[pid]?.posDynastyWeight, w2 = runs['2 TE'].meta[pid]?.posDynastyWeight, w3 = runs['3 TE'].meta[pid]?.posDynastyWeight;
    console.log(`  ${nameOf(pid).padEnd(20)} ${String(d1).padStart(5)}  ${String(d2).padStart(5)}  ${String(d3).padStart(5)}  ${String(Math.round(base.meta[pid].fcValue)).padStart(5)}   ${w1}→${w2}→${w3}`);
  });
  fs.writeFileSync(path.join(ROOT, 'reports', 'dhq-te-demand-sim.json'), JSON.stringify({ league: league.name,
    byPos: Object.fromEntries(scen.map(([l]) => [l, devByPos(runs[l].scores, runs[l].meta)])),
    teDHQ: topTE.map(pid => ({ name: nameOf(pid), te1: base.scores[pid], te2: runs['2 TE'].scores[pid], te3: runs['3 TE'].scores[pid], fc: Math.round(base.meta[pid].fcValue) })) }, null, 2));
  console.log('\nJSON → reports/dhq-te-demand-sim.json');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
