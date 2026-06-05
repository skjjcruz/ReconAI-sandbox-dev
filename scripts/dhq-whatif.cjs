#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// dhq-whatif.cjs — DHQ "what-if" lab: run the REAL engine (loadLeagueIntel)
// against ALL active players for an arbitrary league size + scoring + roster,
// and report values + FantasyCalc market alignment. Built to validate every
// scoring change against the FC anchor across league configs.
//
// Usage:
//   node scripts/dhq-whatif.cjs --teams 16 --ppr 0.5 \
//     --roster "QB,RB,RB,WR,WR,WR,TE,FLEX,FLEX,FLEX,SUPER_FLEX,K,DL,DL,DL,LB,LB,DB,DB,DB,IDP_FLEX,IDP_FLEX,IDP_FLEX"
//   node scripts/dhq-whatif.cjs --league 1312100327931019264        # pull a real Sleeper league
//   node scripts/dhq-whatif.cjs --preset 12-1qb-ppr --out reports/x.csv
//
// Flags:
//   --league <id>      Pull roster_positions + scoring_settings + rosters from a real Sleeper league
//   --teams <n>        League size (default 12)
//   --roster "<csv>"   Starter slots (QB,RB,WR,TE,FLEX,SUPER_FLEX,K,DL,LB,DB,IDP_FLEX,REC_FLEX,BN...)
//   --ppr <x>          Reception points (default 0.5)        --pass-td <x> (default 4)
//   --pass-yd <x>      Points per pass yard (default 0.04)   --scoring-file <path> (full override, wins)
//   --idp              Add a default tackle-based IDP scoring block if roster has IDP slots
//   --season <yyyy>    Season (default: current Sleeper state)
//   --top <n>          Console table rows (default 30)       --out <path> (CSV; default reports/dhq-whatif.csv)
//   --refresh          Re-fetch Sleeper data (otherwise uses local cache)
//   --patch-core "<find>=>><replace>"  /  --patch-engine "..."   In-memory source patch to A/B a scoring change
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(require('os').tmpdir(), 'dhq-whatif-cache');

// ── args ──
function parseArgs(argv) {
  const a = { teams: 12, ppr: 0.5, passTd: 4, passYd: 0.04, top: 30, out: path.join(ROOT, 'reports', 'dhq-whatif.csv'),
    roster: 'QB,RB,RB,WR,WR,WR,TE,FLEX,FLEX,SUPER_FLEX,K', idp: false, refresh: false, patchCore: [], patchEngine: [] };
  for (let i = 2; i < argv.length; i++) { const k = argv[i], n = argv[i + 1];
    if (k === '--league') (a.league = n, i++);
    else if (k === '--teams') (a.teams = +n, i++);
    else if (k === '--roster') (a.roster = n, i++);
    else if (k === '--ppr') (a.ppr = +n, i++);
    else if (k === '--pass-td') (a.passTd = +n, i++);
    else if (k === '--pass-yd') (a.passYd = +n, i++);
    else if (k === '--scoring-file') (a.scoringFile = path.resolve(n), i++);
    else if (k === '--idp') a.idp = true;
    else if (k === '--season') (a.season = +n, i++);
    else if (k === '--top') (a.top = +n, i++);
    else if (k === '--out') (a.out = path.resolve(n), i++);
    else if (k === '--refresh') a.refresh = true;
    else if (k === '--sandbox') a.sandbox = true;
    else if (k === '--preset') (a.preset = n, i++);
    else if (k === '--patch-core') (a.patchCore.push(n), i++);
    else if (k === '--patch-engine') (a.patchEngine.push(n), i++);
  }
  const PRESETS = {
    '12-1qb-ppr': { teams: 12, ppr: 1, roster: 'QB,RB,RB,WR,WR,WR,TE,FLEX,K' },
    '12-sf-ppr': { teams: 12, ppr: 1, roster: 'QB,RB,RB,WR,WR,WR,TE,FLEX,SUPER_FLEX,K' },
    '16-sf-idp': { teams: 16, ppr: 0.5, idp: true, roster: 'QB,RB,RB,WR,WR,WR,TE,FLEX,FLEX,FLEX,SUPER_FLEX,K,DL,DL,DL,LB,LB,DB,DB,DB,IDP_FLEX,IDP_FLEX,IDP_FLEX' },
  };
  if (a.preset && PRESETS[a.preset]) Object.assign(a, PRESETS[a.preset], { preset: a.preset, out: a.out, top: a.top, refresh: a.refresh });
  return a;
}
const args = parseArgs(process.argv);

const DEFAULT_IDP = { idp_tkl_solo: 0.75, idp_tkl_ast: 0.5, idp_tkl_loss: 1, idp_sack: 2, idp_qb_hit: 1, idp_int: 3, idp_pass_def: 1, idp_ff: 1, idp_fum_rec: 1, idp_def_td: 6, idp_safe: 4, idp_blk_kick: 3 };
// Cache FantasyCalc (and any in-engine fetch) to disk so DHQ output is
// DETERMINISTIC across runs — otherwise live FC drift makes before/after
// score comparisons unreliable (FC is blended into DHQ). Sleeper data goes
// through cachedSf; this covers the engine's own FC fetch.
function cachedFetch(u, o) {
  const url = String(u);
  if (!/fantasycalc\.com/i.test(url)) return globalThis.fetch(u, o);
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
  const key = path.join(CACHE_DIR, 'fc-' + Buffer.from(url).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 48) + '.json');
  if (!args.refresh && fs.existsSync(key)) {
    const body = fs.readFileSync(key, 'utf8');
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body });
  }
  return globalThis.fetch(u, o).then(async r => { try { fs.writeFileSync(key, await r.clone().text()); } catch (e) {} return r; });
}

function buildScoring() {
  if (args.scoringFile) return JSON.parse(fs.readFileSync(args.scoringFile, 'utf8'));
  const sc = { pass_yd: args.passYd, pass_td: args.passTd, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: args.ppr, rec_yd: 0.1, rec_td: 6, fum_lost: -2 };
  if (args.idp) Object.assign(sc, DEFAULT_IDP);
  return sc;
}

// ── shims / module loading (runs the real engine headless) ──
function makeStorage() { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => {}, get length() { return Object.keys(s).length; }, key: i => Object.keys(s)[i] ?? null }; }
function makeDocument() { const el = () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }); return { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: el, body: el(), head: el() }; }
function buildCtx() {
  const ctx = { localStorage: makeStorage(), sessionStorage: makeStorage(), document: makeDocument(), console,
    location: { hostname: 'localhost', pathname: '/', search: '', href: 'http://localhost/' }, navigator: { userAgent: 'node' },
    performance: { now: () => Date.now() }, fetch: cachedFetch, setTimeout: fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, queueMicrotask: fn => Promise.resolve().then(fn), structuredClone: o => JSON.parse(JSON.stringify(o)),
    Date, Math, Object, Array, Number, String, Boolean, JSON, RegExp, Error, Function, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, URLSearchParams, URL, Set, Map, WeakMap, WeakSet, Symbol, Promise, Reflect, Proxy, ArrayBuffer, Float64Array, Float32Array, Int32Array, Uint8Array, Intl };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.DEV_MODE = false; vm.createContext(ctx); return ctx;
}
const MODULES = ['shared/app-config.js', 'shared/data-cache.js', 'shared/constants.js', 'shared/utils.js', 'shared/storage.js', 'shared/event-bus.js', 'shared/tier.js', 'shared/pick-value-model.js', 'shared/sleeper-api.js', 'shared/dhq-core.js', 'shared/intelligence-context.js', 'shared/dhq-engine.js'];
function parsePatches(list) { return (list || []).map(s => { const [find, replace] = String(s).split('=>>'); return { file: 'auto', find, replace: replace ?? '' }; }); }
function loadModule(ctx, rel, corePatches, enginePatches) {
  let code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const patches = rel.endsWith('dhq-core.js') ? corePatches : rel.endsWith('dhq-engine.js') ? enginePatches : [];
  patches.forEach(p => { if (p.find && code.includes(p.find)) code = code.replace(p.find, p.replace); });
  vm.runInContext(code, ctx, { filename: rel });
}

// ── Sleeper data (disk-cached, offline-capable after first warm) ──
async function getJSON(u) { const r = await globalThis.fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); }
async function cachedJSON(name, url, fallback) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const f = path.join(CACHE_DIR, name + '.json');
  if (!args.refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  try { const d = await getJSON(url); fs.writeFileSync(f, JSON.stringify(d)); return d; }
  catch (e) { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); if (fallback !== undefined) return fallback; throw e; }
}
async function loadSleeper(season) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `nfl-${season}.json`);
  if (!args.refresh && fs.existsSync(cacheFile)) {
    const age = (Date.now() - fs.statSync(cacheFile).mtimeMs) / 36e5;
    if (age < 24) { console.log(`(cache ${age.toFixed(1)}h old; --refresh to update)`); return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); }
  }
  console.log('Fetching Sleeper players + 5yr stats…');
  const players = await getJSON('https://api.sleeper.app/v1/players/nfl');
  const years = Array.from({ length: 5 }, (_, i) => season - 4 + i);
  const seasonStats = {};
  for (const yr of years) { try { seasonStats[yr] = await getJSON('https://api.sleeper.app/v1/stats/nfl/regular/' + yr); } catch (e) { seasonStats[yr] = {}; } }
  const data = { players, seasonStats, years };
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

(async () => {
  const nflState = await cachedJSON('state-nfl', 'https://api.sleeper.app/v1/state/nfl', { season: '2026', season_type: 'off' });
  const season = args.season || parseInt(nflState.season) || 2026;
  const { players, seasonStats } = await loadSleeper(season);
  const corePatches = parsePatches(args.patchCore), enginePatches = parsePatches(args.patchEngine);

  function cachedSf(p) { const m = String(p).match(/\/stats\/nfl\/regular\/(\d+)/); if (m) return Promise.resolve(seasonStats[m[1]] || {}); if (String(p).includes('/players/nfl')) return Promise.resolve(players); if (String(p).includes('/state/nfl')) return Promise.resolve(nflState); return Promise.resolve([]); }

  // ── league config: from a real Sleeper league, or synthesized from flags ──
  let rosterPositions, scoring, NTEAMS, rosters, label;
  if (args.league) {
    const lg = await cachedJSON('league-' + args.league, 'https://api.sleeper.app/v1/league/' + args.league);
    const rr = await cachedJSON('rosters-' + args.league, 'https://api.sleeper.app/v1/league/' + args.league + '/rosters');
    rosterPositions = lg.roster_positions; scoring = lg.scoring_settings; NTEAMS = lg.total_rosters || rr.length;
    rosters = rr.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id, players: r.players || [] }));
    label = `${lg.name} (real)`;
  } else {
    rosterPositions = args.roster.split(',').map(s => s.trim()).filter(Boolean);
    scoring = buildScoring(); NTEAMS = args.teams;
    // synthetic rostering: top players by last completed season points across NTEAMS teams
    const lastYr = Object.keys(seasonStats).map(Number).filter(y => Object.keys(seasonStats[y] || {}).length).sort().pop();
    const ptsOf = pid => { const s = seasonStats[lastYr]?.[pid]; return s ? (s.pts_half_ppr ?? s.pts_ppr ?? s.pts_std ?? 0) : 0; };
    const OFF_DEF = ['QB', 'RB', 'WR', 'TE', 'K', 'DE', 'DT', 'NT', 'LB', 'OLB', 'ILB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB', 'DL'];
    const teamed = Object.keys(players).filter(pid => { const p = players[pid]; return p && p.team && p.team !== 'null' && OFF_DEF.includes(p.position); });
    const starters = rosterPositions.filter(s => !['BN', 'IR', 'TAXI'].includes(s)).length;
    const pool = teamed.slice().sort((a, b) => ptsOf(b) - ptsOf(a)).slice(0, NTEAMS * Math.max(starters, 14) * 2);
    rosters = Array.from({ length: NTEAMS }, (_, i) => ({ roster_id: i + 1, owner_id: 'o' + (i + 1), players: [] }));
    pool.forEach((pid, i) => rosters[i % NTEAMS].players.push(pid));
    label = `synthetic ${NTEAMS}tm`;
  }
  const isSF = rosterPositions.some(s => s === 'SUPER_FLEX');
  console.log(`\nConfig: ${label} | teams ${NTEAMS} | ${isSF ? 'Superflex' : '1QB'} | rec ${scoring.rec} | passTD ${scoring.pass_td} | starters ${rosterPositions.filter(s => !['BN','IR','TAXI'].includes(s)).length}`);
  if (corePatches.length || enginePatches.length) console.log(`Patches: core[${corePatches.length}] engine[${enginePatches.length}]`);

  // ── run the engine ──
  const ctx = buildCtx();
  for (const m of MODULES) { try { loadModule(ctx, m, corePatches, enginePatches); } catch (e) { console.warn('[load]', m, e.message); } }
  ctx.window.App.sf = cachedSf; ctx.window.sf = cachedSf; if (ctx.window.Sleeper) ctx.window.Sleeper.sleeperFetch = cachedSf;
  // --sandbox forces window.isSandbox() true so sandbox-GATED scoring changes
  // fire in the lab (otherwise tier.js keys off 'sandbox' in hostname → off on localhost).
  if (args.sandbox) { ctx.window.isSandbox = () => true; ctx.window.App.isSandbox = ctx.window.isSandbox; }
  const leagues = [{ league_id: args.league || 'whatif', season: String(season), total_rosters: NTEAMS, roster_positions: rosterPositions, scoring_settings: scoring }];
  const S = { currentLeagueId: leagues[0].league_id, season: String(season), platform: 'sleeper', players, leagues, rosters, nflState, myRosterId: rosters[0]?.roster_id || 1 };
  ctx.window.S = S; ctx.window.App.S = S; ctx.window.App.LI_LOADED = false;
  await ctx.window.App.loadLeagueIntel();
  const LI = ctx.window.App.LI || {}; const scores = LI.playerScores || {}, meta = LI.playerMeta || {};

  // ── output ──
  const nameOf = pid => { const p = players[pid]; return p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid) : pid; };
  const rows = Object.keys(scores).map(pid => {
    const m = meta[pid] || {};
    return { pid, name: nameOf(pid), pos: m.pos || players[pid]?.position || '', team: players[pid]?.team || '', age: m.age || '', dhq: scores[pid], fc: Math.round(m.fcValue || 0) };
  }).filter(r => r.dhq > 0).sort((a, b) => b.dhq - a.dhq);

  // FC alignment (offense only — FC has no IDP)
  const fcRows = rows.filter(r => r.fc > 0);
  const dhqTop = Math.max(1, ...fcRows.map(r => r.dhq)), fcTop = Math.max(1, ...fcRows.map(r => r.fc)), scale = dhqTop / fcTop;
  fcRows.forEach(r => { r.fcScaled = Math.round(r.fc * scale); r.devPct = Math.round(100 * (r.dhq - r.fcScaled) / Math.max(1, r.fcScaled)); });
  const top60 = fcRows.slice().sort((a, b) => b.fc - a.fc).slice(0, 60);
  const byPos = {}; top60.forEach(r => { (byPos[r.pos] = byPos[r.pos] || []).push(r.devPct); });
  // spearman
  const byDhq = new Map(fcRows.slice().sort((a, b) => b.dhq - a.dhq).map((r, i) => [r.pid, i + 1]));
  const byFc = new Map(fcRows.slice().sort((a, b) => b.fc - a.fc).map((r, i) => [r.pid, i + 1]));
  let d2 = 0; const n = fcRows.length; fcRows.forEach(r => { const d = byDhq.get(r.pid) - byFc.get(r.pid); d2 += d * d; });
  const rho = n > 2 ? +(1 - 6 * d2 / (n * (n * n - 1))).toFixed(3) : 0;

  console.log(`\nScored ${rows.length} players (${fcRows.length} with FC). Top player: ${rows[0]?.name} ${rows[0]?.dhq}`);
  console.log(`FC rank-correlation (offense): ${rho}`);
  console.log('FC deviation by position (top-60 FC; neg = DHQ below market):');
  ['QB', 'RB', 'WR', 'TE'].forEach(p => { const a = byPos[p] || []; if (a.length) console.log(`   ${p}: ${Math.round(a.reduce((s, x) => s + x, 0) / a.length)}%  (n=${a.length})`); });
  console.log(`\nTop ${args.top} by DHQ:`);
  console.log('  #   DHQ   Pos Age  FC    vsFC   Name');
  rows.slice(0, args.top).forEach((r, i) => console.log(`  ${String(i + 1).padStart(3)} ${String(r.dhq).padStart(5)}  ${String(r.pos).padEnd(3)} ${String(r.age).padStart(3)}  ${String(r.fc || '—').padStart(5)}  ${(r.fc ? (r.devPct >= 0 ? '+' : '') + r.devPct + '%' : '—').padStart(5)}  ${r.name}`));

  // CSV
  const HEAD = ['pid', 'name', 'pos', 'team', 'age', 'dhq', 'fc_value', 'fc_scaled', 'dev_vs_fc_pct'];
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [HEAD.join(',')].concat(rows.map(r => [r.pid, r.name, r.pos, r.team, r.age, r.dhq, r.fc || '', r.fcScaled ?? '', r.devPct ?? ''].map(cell).join(','))).join('\n');
  fs.mkdirSync(path.dirname(args.out), { recursive: true }); fs.writeFileSync(args.out, csv);
  console.log(`\nCSV → ${args.out}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
