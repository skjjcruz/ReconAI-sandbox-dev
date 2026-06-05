#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// dhq-nfl-fit-diff.cjs — Before/After DHQ comparison for the sandbox-gated
// NFL-Fit SitMult layer (_dhqNflFitAdjustment), using a Psycho-League-style
// 16-team Superflex 0.5 PPR config and REAL Sleeper player/stat data.
//
// Runs the actual dhq-engine.js loadLeagueIntel() TWICE in isolated vm
// contexts — once with window.isSandbox()=false (BEFORE / current production)
// and once =true (AFTER / the new layer active) — then diffs every player.
//
// Output: reports/dhq-nfl-fit-diff.csv  (+ .xlsx via openpyxl if available)
// ════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_CSV = path.join(ROOT, 'reports', 'dhq-nfl-fit-diff.csv');
const OUT_XLSX = path.join(ROOT, 'reports', 'DHQ_NFL_Fit_BeforeAfter.xlsx');

// ── shims ──────────────────────────────────────────────────────────
function makeStorage() {
  const s = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; },
    clear: () => { for (const k of Object.keys(s)) delete s[k]; },
    get length() { return Object.keys(s).length; },
    key: i => Object.keys(s)[i] ?? null,
  };
}
function makeDocument() {
  const el = () => ({ id: '', style: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  return {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: el, body: el(), head: el(),
  };
}

function buildCtx(sf) {
  const ctx = {
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    document: makeDocument(),
    console,
    location: { hostname: 'localhost', pathname: '/', search: '', href: 'http://localhost/' },
    navigator: { userAgent: 'node' },
    performance: { now: () => Date.now() },
    fetch: (url, opts) => globalThis.fetch(url, opts),     // FC blend uses real fetch
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    structuredClone: (o) => JSON.parse(JSON.stringify(o)),
    // builtins
    Date, Math, Object, Array, Number, String, Boolean, JSON, RegExp, Error, Function,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    URLSearchParams, URL, Set, Map, WeakMap, WeakSet, Symbol, Promise, Reflect, Proxy,
    ArrayBuffer, Float64Array, Float32Array, Int32Array, Uint8Array, Intl,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.DEV_MODE = false;
  vm.createContext(ctx);
  return ctx;
}

function load(ctx, rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, ctx, { filename: rel });
}

const MODULES = [
  'shared/app-config.js', 'shared/data-cache.js', 'shared/constants.js', 'shared/utils.js',
  'shared/storage.js', 'shared/event-bus.js', 'shared/tier.js', 'shared/pick-value-model.js',
  'shared/sleeper-api.js', 'shared/dhq-core.js', 'shared/intelligence-context.js',
  'shared/dhq-engine.js', 'shared/nfl-fit.js',
];

async function getJSON(url) {
  const r = await globalThis.fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return r.json();
}

(async () => {
  // ── 1. Prefetch real data ONCE (identical inputs to both passes) ──
  console.log('Fetching Sleeper players DB (~5MB)…');
  const players = await getJSON('https://api.sleeper.app/v1/players/nfl');
  console.log('  players:', Object.keys(players).length);
  const nflState = await getJSON('https://api.sleeper.app/v1/state/nfl').catch(() => ({ season: '2026', season_type: 'off' }));
  const season = parseInt(nflState.season) || 2026;
  const years = Array.from({ length: 5 }, (_, i) => season - 4 + i);
  const seasonStats = {};
  for (const yr of years) {
    try { seasonStats[yr] = await getJSON('https://api.sleeper.app/v1/stats/nfl/regular/' + yr); }
    catch (e) { seasonStats[yr] = {}; }
    console.log('  stats', yr + ':', Object.keys(seasonStats[yr] || {}).length);
  }

  // cached Sleeper fetch — serves prefetched data, empties everything else
  // (no provider → engine cold-path uses empty league history, real stats).
  function cachedSf(p) {
    const m = String(p).match(/\/stats\/nfl\/regular\/(\d+)/);
    if (m) return Promise.resolve(seasonStats[m[1]] || {});
    if (String(p).includes('/players/nfl')) return Promise.resolve(players);
    if (String(p).includes('/state/nfl')) return Promise.resolve(nflState);
    return Promise.resolve([]);
  }

  // ── 2. Build a Psycho-style 16-team SF roster set ──
  // Roster the ~480 highest-scoring teamed players (deep dynasty), rest are FA.
  const lastYr = years.filter(y => Object.keys(seasonStats[y] || {}).length > 0).pop() || (season - 1);
  const ptsOf = pid => { const s = seasonStats[lastYr]?.[pid]; return s ? (s.pts_half_ppr ?? s.pts_ppr ?? s.pts_std ?? 0) : 0; };
  const OFF_DEF = ['QB', 'RB', 'WR', 'TE', 'K', 'DE', 'DT', 'NT', 'LB', 'OLB', 'ILB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB', 'DL'];
  const teamed = Object.keys(players).filter(pid => {
    const p = players[pid]; return p && p.team && p.team !== 'null' && OFF_DEF.includes(p.position);
  });
  const topRostered = teamed.slice().sort((a, b) => ptsOf(b) - ptsOf(a)).slice(0, 480);
  const NTEAMS = 16;
  const rosters = Array.from({ length: NTEAMS }, (_, i) => ({ roster_id: i + 1, owner_id: 'owner_' + (i + 1), players: [] }));
  topRostered.forEach((pid, idx) => rosters[idx % NTEAMS].players.push(pid));

  const leagues = [{
    league_id: 'psycho-16sf', season: String(season), name: 'Psycho League (16-SF 0.5PPR model)',
    total_rosters: NTEAMS,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    scoring_settings: { pass_yd: 0.04, pass_td: 6, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  }];

  // ── 3. Run one engine pass ──
  async function runPass(sandboxOn) {
    const ctx = buildCtx(cachedSf);
    for (const m of MODULES) {
      try { load(ctx, m); } catch (e) { console.warn('  [load warn]', m, '—', e.message); }
    }
    // Force the gate + cached Sleeper fetch
    ctx.window.isSandbox = () => sandboxOn;
    ctx.window.App.isSandbox = ctx.window.isSandbox;
    ctx.window.App.sf = cachedSf; ctx.window.sf = cachedSf;
    if (ctx.window.Sleeper) ctx.window.Sleeper.sleeperFetch = cachedSf;
    // State
    const S = {
      currentLeagueId: 'psycho-16sf', season: String(season), platform: 'sleeper',
      players, leagues, rosters: JSON.parse(JSON.stringify(rosters)), nflState, myRosterId: 1,
    };
    ctx.window.S = S; ctx.window.App.S = S;
    ctx.window.App.LI_LOADED = false;
    await ctx.window.App.loadLeagueIntel();
    const LI = ctx.window.App.LI || {};
    return { scores: LI.playerScores || {}, meta: LI.playerMeta || {} };
  }

  console.log('\nRunning BEFORE pass (window.isSandbox()=false — current production)…');
  const before = await runPass(false);
  console.log('  scored players:', Object.keys(before.scores).length);
  console.log('Running AFTER pass (window.isSandbox()=true — NFL-Fit layer active)…');
  const after = await runPass(true);
  console.log('  scored players:', Object.keys(after.scores).length);

  // ── 4. Diff ──
  // Optional legacy baseline = production TODAY (depth-chart bug present, gate off).
  // Lets the report separate the depth-fix impact from the NFL-Fit layer impact.
  let legacyToday = {};
  try {
    const lg = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', '_legacy_depth_rows.json'), 'utf8'));
    lg.forEach(r => { legacyToday[r.pid] = r.dhq_before; }); // dhq_before there = legacy gate-off
  } catch (e) { /* no legacy baseline — columns will mirror depth-fixed */ }

  const nameOf = pid => { const p = players[pid]; return p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid) : pid; };
  const pids = Array.from(new Set([...Object.keys(before.scores), ...Object.keys(after.scores)]));
  const rows = pids.map(pid => {
    const b = before.scores[pid] || 0;          // depth-FIXED, gate off
    const a = after.scores[pid] || 0;           // depth-FIXED, gate on (NFL-Fit active)
    const today = legacyToday[pid] != null ? legacyToday[pid] : b; // production today
    const m = after.meta[pid] || before.meta[pid] || {};
    return {
      pid, name: nameOf(pid), pos: m.pos || players[pid]?.position || '', team: players[pid]?.team || '',
      age: m.age || players[pid]?.age || '',
      fc_value: Math.round(m.fcValue || before.meta[pid]?.fcValue || 0),
      dhq_today: today, dhq_depthfix: b, dhq_depthfix_nflfit: a,
      depthfix_delta: b - today, nflfit_delta: a - b, delta: a - b,
      pct: b ? +(((a - b) / b) * 100).toFixed(1) : 0,
      nfl_fit_mult: m.nflFitMult ?? 1, nfl_fit_label: m.nflFitLabel || '',
      role: m.roleLabel || '', opportunity: m.opportunityLabel || '', sitMult_after: m.sitMult ?? '',
    };
  }).sort((x, y) => (y.dhq_depthfix_nflfit - x.dhq_depthfix_nflfit));

  // ── FantasyCalc market alignment ──
  // FC is the external market reference (same across all scenarios). Scale FC to
  // each scenario's own top so the comparison is on a common 0-top basis, then
  // measure how far each scenario's DHQ sits from market — especially for the
  // highest-FC ("great") players. Lower mean |dev| & higher rank-correlation = closer to market.
  const fcRows = rows.filter(r => r.fc_value > 0);
  const fcByVal = fcRows.slice().sort((a, b) => b.fc_value - a.fc_value);
  const fcRank = new Map(fcByVal.map((r, i) => [r.pid, i + 1]));
  function alignment(scenarioKey) {
    const scored = fcRows.filter(r => r[scenarioKey] > 0);
    const dhqTop = Math.max(...scored.map(r => r[scenarioKey]));
    const fcTop = Math.max(...scored.map(r => r.fc_value));
    const scale = dhqTop / fcTop;
    const withDev = scored.map(r => {
      const fcScaled = Math.round(r.fc_value * scale);
      return { ...r, fcScaled, dev: (r[scenarioKey] - fcScaled) / Math.max(1, fcScaled) };
    });
    // Spearman rank correlation vs FC
    const byDhq = withDev.slice().sort((a, b) => b[scenarioKey] - a[scenarioKey]);
    const dhqRank = new Map(byDhq.map((r, i) => [r.pid, i + 1]));
    const n = withDev.length;
    let d2 = 0; withDev.forEach(r => { const d = (fcRank.get(r.pid) || 0) - (dhqRank.get(r.pid) || 0); d2 += d * d; });
    const rho = n > 2 ? 1 - (6 * d2) / (n * (n * n - 1)) : 0;
    const meanAbsDev = withDev.reduce((s, r) => s + Math.abs(r.dev), 0) / Math.max(1, n);
    const top30 = fcByVal.slice(0, 30).map(r => withDev.find(w => w.pid === r.pid)).filter(Boolean);
    const top30MeanDev = top30.reduce((s, r) => s + r.dev, 0) / Math.max(1, top30.length);   // signed: negative = great players UNDER market
    const top30MeanAbsDev = top30.reduce((s, r) => s + Math.abs(r.dev), 0) / Math.max(1, top30.length);
    return { withDev, dhqRank, rho: +rho.toFixed(3), meanAbsDevPct: +(meanAbsDev * 100).toFixed(1),
      top30SignedDevPct: +(top30MeanDev * 100).toFixed(1), top30AbsDevPct: +(top30MeanAbsDev * 100).toFixed(1) };
  }
  const align = { today: alignment('dhq_today'), depthfix: alignment('dhq_depthfix'), combined: alignment('dhq_depthfix_nflfit') };
  // attach per-player FC fields + dev for the workbook
  rows.forEach(r => {
    r.fc_rank = fcRank.get(r.pid) || '';
    const dev = (key, al) => { const w = al.withDev.find(x => x.pid === r.pid); return w ? +(w.dev * 100).toFixed(0) : ''; };
    r.fc_scaled_today = (() => { const w = align.today.withDev.find(x => x.pid === r.pid); return w ? w.fcScaled : ''; })();
    r.dev_today_pct = dev('today', align.today);
    r.dev_depthfix_pct = dev('depthfix', align.depthfix);
    r.dev_combined_pct = dev('combined', align.combined);
  });

  const changed = rows.filter(r => r.nflfit_delta !== 0);
  const HEADERS = ['pid', 'name', 'pos', 'team', 'age', 'fc_value', 'fc_rank', 'fc_scaled_today',
    'dhq_today', 'dhq_depthfix', 'dhq_depthfix_nflfit', 'dev_today_pct', 'dev_depthfix_pct', 'dev_combined_pct',
    'depthfix_delta', 'nflfit_delta', 'nfl_fit_label', 'role', 'opportunity', 'sitMult_after'];
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [HEADERS.join(',')].concat(rows.map(r => HEADERS.map(h => csvCell(r[h])).join(','))).join('\n');
  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  fs.writeFileSync(OUT_CSV, csv);

  // ── 5. Summary ──
  const totalScored = rows.filter(r => r.dhq_depthfix_nflfit > 0).length;
  const ups = changed.filter(r => r.nflfit_delta > 0);
  const downs = changed.filter(r => r.nflfit_delta < 0);
  const maxUp = ups.slice().sort((a, b) => b.nflfit_delta - a.nflfit_delta).slice(0, 15);
  const maxDown = downs.slice().sort((a, b) => a.nflfit_delta - b.nflfit_delta).slice(0, 15);
  const haveLegacy = Object.keys(legacyToday).length > 0;
  const depthChanged = rows.filter(r => r.depthfix_delta !== 0);
  const depthUp = rows.slice().sort((a, b) => b.depthfix_delta - a.depthfix_delta).slice(0, 15);
  const summary = {
    leagueModel: '16-team Superflex, 0.5 PPR (Psycho-style); real Sleeper player + stat data; season ' + season,
    totalScored,
    depthChartFix: haveLegacy ? {
      note: 'Sleeper depth_chart_order is 1-indexed; engine read it 0-indexed → every starter mis-scored as a backup. Fixed in _dhqDepthRole.',
      playersChanged: depthChanged.length,
      avgAbsDelta: depthChanged.length ? Math.round(depthChanged.reduce((s, r) => s + Math.abs(r.depthfix_delta), 0) / depthChanged.length) : 0,
      biggestGains: depthUp.slice(0, 6).map(r => `${r.name} ${r.dhq_today}→${r.dhq_depthfix} (+${r.depthfix_delta})`),
    } : 'no legacy baseline captured',
    nflFitLayer: {
      changedCount: changed.length,
      pctOfPlayersChanged: +((changed.length / Math.max(1, totalScored)) * 100).toFixed(1),
      boosted: ups.length, dinged: downs.length, unchanged: totalScored - changed.length,
      avgAbsDeltaAmongChanged: changed.length ? Math.round(changed.reduce((s, r) => s + Math.abs(r.nflfit_delta), 0) / changed.length) : 0,
      maxBoost: maxUp[0] ? `${maxUp[0].name} +${maxUp[0].nflfit_delta} (${maxUp[0].pct}%)` : '—',
      maxDing: maxDown[0] ? `${maxDown[0].name} ${maxDown[0].nflfit_delta}` : '—',
    },
    fantasyCalcAlignment: {
      legend: 'rho = Spearman rank-correlation vs FC market (higher = closer). top30SignedDev% = avg deviation of the 30 highest-FC players (NEGATIVE = great players scored BELOW market = "punished").',
      today: { rho: align.today.rho, meanAbsDev_pct: align.today.meanAbsDevPct, top30_signedDev_pct: align.today.top30SignedDevPct, top30_absDev_pct: align.today.top30AbsDevPct },
      depthfix: { rho: align.depthfix.rho, meanAbsDev_pct: align.depthfix.meanAbsDevPct, top30_signedDev_pct: align.depthfix.top30SignedDevPct, top30_absDev_pct: align.depthfix.top30AbsDevPct },
      combined: { rho: align.combined.rho, meanAbsDev_pct: align.combined.meanAbsDevPct, top30_signedDev_pct: align.combined.top30SignedDevPct, top30_absDev_pct: align.combined.top30AbsDevPct },
    },
  };
  // Worst "great-player" cases under the combined scenario (top-FC players DHQ sits furthest below market)
  const greatPunished = fcByVal.slice(0, 40)
    .map(r => ({ name: r.name, pos: r.pos, fc_rank: r.fc_rank, fc_value: r.fc_value,
      dhq_today: r.dhq_today, dhq_combined: r.dhq_depthfix_nflfit,
      dev_today: r.dev_today_pct, dev_combined: r.dev_combined_pct }))
    .sort((a, b) => a.dev_combined - b.dev_combined).slice(0, 15);
  fs.writeFileSync(path.join(ROOT, 'reports', 'dhq-nfl-fit-diff-summary.json'),
    JSON.stringify({ summary, topBoosts: maxUp, topDings: maxDown, topDepthGains: depthUp, greatPunished }, null, 2));

  console.log('\n════ SUMMARY ════');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nTop-FC players where DHQ sits furthest BELOW market (combined scenario):');
  greatPunished.forEach(r => console.log(`  FC#${String(r.fc_rank).padStart(2)} ${r.name.padEnd(20)} today dev ${String(r.dev_today).padStart(4)}%  →  combined dev ${String(r.dev_combined).padStart(4)}%   (DHQ ${r.dhq_today}→${r.dhq_combined})`));
  console.log('\nNFL-Fit top boosts:'); maxUp.slice(0, 10).forEach(r => console.log(`  +${String(r.nflfit_delta).padStart(4)}  ${r.name} (${r.pos}, age ${r.age}) ${r.dhq_depthfix}→${r.dhq_depthfix_nflfit}  [${r.nfl_fit_label}]`));
  console.log('NFL-Fit top dings:'); maxDown.slice(0, 10).forEach(r => console.log(`  ${String(r.nflfit_delta).padStart(5)}  ${r.name} (${r.pos}, age ${r.age}) ${r.dhq_depthfix}→${r.dhq_depthfix_nflfit}  [${r.nfl_fit_label}]`));
  if (haveLegacy) { console.log('\nDepth-fix biggest gains (starters no longer scored as backups):'); depthUp.slice(0, 10).forEach(r => console.log(`  +${String(r.depthfix_delta).padStart(4)}  ${r.name} (${r.pos}) ${r.dhq_today}→${r.dhq_depthfix}  role=${r.role}`)); }
  console.log('\nCSV →', OUT_CSV);

  // ── 6. Build .xlsx via openpyxl ──
  try {
    const py = `
import openpyxl, json
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
rows = json.load(open(${JSON.stringify(path.join(ROOT, 'reports', 'dhq-nfl-fit-rows.json'))}))
summ = json.load(open(${JSON.stringify(path.join(ROOT, 'reports', 'dhq-nfl-fit-diff-summary.json'))}))
wb = openpyxl.Workbook()
hdr_fill = PatternFill('solid', fgColor='1F2937'); hdr_font = Font(color='FFFFFF', bold=True)
up_fill = PatternFill('solid', fgColor='E8F5E9'); down_fill = PatternFill('solid', fgColor='FDECEA')
HEADERS = ${JSON.stringify(HEADERS)}
def sheet(ws, data, title):
    ws.title = title
    ws.append(HEADERS)
    for c in range(1, len(HEADERS)+1):
        cell = ws.cell(1, c); cell.fill = hdr_fill; cell.font = hdr_font
    for r in data:
        ws.append([r.get(h, '') for h in HEADERS])
        d = r.get('delta', 0)
        if d:
            fill = up_fill if d > 0 else down_fill
            for c in range(1, len(HEADERS)+1): ws.cell(ws.max_row, c).fill = fill
    ws.freeze_panes = 'A2'
    widths = {'name':26,'nfl_fit_label':22,'role':10,'opportunity':24}
    for i,h in enumerate(HEADERS,1): ws.column_dimensions[get_column_letter(i)].width = widths.get(h, 11)
# Summary sheet
s = wb.active; s.title = 'Summary'
s.append(['DHQ — NFL-Fit SitMult layer: Before vs After']); s['A1'].font = Font(bold=True, size=14)
s.append([])
for k,v in summ['summary'].items(): s.append([k, v])
s.column_dimensions['A'].width = 26; s.column_dimensions['B'].width = 60
# All players
sheet(wb.create_sheet(), rows, 'All players')
# Changed only
sheet(wb.create_sheet(), [r for r in rows if r.get('delta')], 'Changed only')
wb.save(${JSON.stringify(OUT_XLSX)})
print('xlsx saved')
`;
    fs.writeFileSync(path.join(ROOT, 'reports', 'dhq-nfl-fit-rows.json'), JSON.stringify(rows));
    execFileSync('python3', ['-c', py], { stdio: 'inherit' });
    console.log('XLSX →', OUT_XLSX);
  } catch (e) {
    console.warn('xlsx build skipped:', e.message, '(CSV is available)');
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
