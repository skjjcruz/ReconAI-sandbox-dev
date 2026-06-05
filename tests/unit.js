#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// reconai/tests/unit.js  — Core unit tests for Scout shared modules
// Usage: node tests/unit.js
// No npm dependencies — uses only Node.js built-ins.
//
// Loads shared/*.js modules into a sandboxed vm context.
// Extracts addFieldLogEntry from js/scout-ui.js via string parsing
// (avoids loading the full DOM-heavy UI file).
// ════════════════════════════════════════════════════════════════
'use strict';

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ── Mini test runner ──────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (e) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${e.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

// Assertion helpers
function eq(a, b, label) {
  if (a !== b) throw new Error(`${label || ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function near(a, b, tol, label) {
  if (Math.abs(a - b) > tol) throw new Error(`${label || ''}: expected ≈${b} (±${tol}), got ${a}`);
}
function ok(v, label) {
  if (!v) throw new Error(label || `expected truthy, got ${JSON.stringify(v)}`);
}
function notNull(v, label) {
  if (v == null) throw new Error(label || `expected non-null, got ${v}`);
}

// ── Mock localStorage ─────────────────────────────────────────────
// Must be iterable via Object.keys() for DhqStorage.removeByPrefix.
function makeStorage() {
  const s = {};
  const ls = {
    getItem:    k => Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null,
    setItem:    (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; },
    clear:      () => { for (const k of Object.keys(s)) delete s[k]; },
    get length() { return Object.keys(s).length; },
    key:        i => Object.keys(s)[i] ?? null,
    _store:     s,
  };
  // Object.keys(localStorage) must return stored keys — achieved by proxying
  return new Proxy(ls, {
    ownKeys:          () => [...Object.keys(s), ...Object.getOwnPropertyNames(ls)],
    getOwnPropertyDescriptor: (t, k) =>
      Object.prototype.hasOwnProperty.call(s, k)
        ? { value: s[k], writable: true, enumerable: true, configurable: true }
        : Object.getOwnPropertyDescriptor(t, k),
  });
}

// ── Mock document ─────────────────────────────────────────────────
// tier.js calls document.getElementById / document.createElement at load time.
function makeDocument() {
  return {
    readyState: 'complete',
    getElementById:  () => null,
    addEventListener: () => {},
    createElement:   () => ({
      id: '', style: {}, innerHTML: '',
      setAttribute: () => {},
      appendChild: () => {},
    }),
    body: { appendChild: () => {} },
  };
}

// ── vm context ────────────────────────────────────────────────────
function buildCtx() {
  const ls = makeStorage();
  const ss = makeStorage();
  const ctx = {
    window:        null,   // set below
    localStorage:  ls,
    sessionStorage: ss,
    document:      makeDocument(),
    console,
    // JS builtins
    Date, Math, Object, Array, Number, String, Boolean, JSON,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    URLSearchParams,
    Set, Map, Promise, Error,
    // Stubs
    setTimeout:   fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
    fetch:        async () => ({ ok: true, json: async () => ({}) }),
    // Stub out DOM methods that tier.js may call during init
    // (renderTrialBanner etc. call getElementById → already returns null above)
  };
  ctx.window   = ctx;
  ctx.self     = ctx;
  ctx.DEV_MODE = false;
  return vm.createContext(ctx);
}

function loadScript(ctx, relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(code, ctx);
}

// ── Brace-counting function extractor ────────────────────────────
function extractFunction(source, sig) {
  const idx = source.indexOf(sig);
  if (idx === -1) throw new Error(`extractFunction: "${sig}" not found`);
  let depth = 0, i = idx, opened = false;
  while (i < source.length) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(idx, i + 1); }
    i++;
  }
  throw new Error(`extractFunction: no matching close for "${sig}"`);
}

// ── YYYY-MM-DD key matching tier.js._todayDateKey() ──────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════════════════════
// Bootstrap: load shared modules in dependency order
// ══════════════════════════════════════════════════════════════════
const ctx = buildCtx();
const ls  = ctx.localStorage;

process.stdout.write('  Loading shared/utils.js … ');
loadScript(ctx, 'shared/utils.js');
process.stdout.write('OK\n');

process.stdout.write('  Loading shared/storage.js … ');
loadScript(ctx, 'shared/storage.js');
process.stdout.write('OK\n');

process.stdout.write('  Loading shared/event-bus.js … ');
loadScript(ctx, 'shared/event-bus.js');
process.stdout.write('OK\n');

// tier.js calls initTrial() (sets TRIAL_START) and initTrialSystem() on load.
// document.getElementById returns null for all banner/modal elements → safe.
process.stdout.write('  Loading shared/tier.js … ');
loadScript(ctx, 'shared/tier.js');
process.stdout.write('OK\n');

process.stdout.write('  Loading shared/sleeper-api.js … ');
loadScript(ctx, 'shared/sleeper-api.js');
process.stdout.write('OK\n');

process.stdout.write('  Loading shared/dhq-core.js … ');
loadScript(ctx, 'shared/dhq-core.js');
process.stdout.write('OK\n');

process.stdout.write('  Loading shared/dhq-engine.js … ');
loadScript(ctx, 'shared/dhq-engine.js');
process.stdout.write('OK\n');

// Extract addFieldLogEntry from js/scout-ui.js (avoids full DOM-heavy file)
process.stdout.write('  Extracting addFieldLogEntry … ');
const scoutUiSrc = fs.readFileSync(path.join(ROOT, 'js/scout-ui.js'), 'utf8');
// Stub renderFieldLogCard before the extracted code runs
vm.runInContext('function renderFieldLogCard() {}', ctx);
const flKeyMatch = scoutUiSrc.match(/const FL_KEY\s*=\s*'([^']+)'/);
if (!flKeyMatch) throw new Error('FL_KEY constant not found in scout-ui.js');
const FL_KEY_VAL = flKeyMatch[1];
const getFieldLogFn       = extractFunction(scoutUiSrc, 'function getFieldLog()');
const addFieldLogEntryFn  = extractFunction(scoutUiSrc, 'function addFieldLogEntry(icon');
vm.runInContext(
  `const FL_KEY = '${FL_KEY_VAL}'; ${getFieldLogFn} ${addFieldLogEntryFn}`,
  ctx
);
process.stdout.write('OK\n\n');

// ── Grab references ───────────────────────────────────────────────
const normPos           = ctx.normPos;
const posLabel          = ctx.posLabel;
const formatNFLDraftSlot = ctx.formatNFLDraftSlot;
const getLeaguePositions = ctx.getLeaguePositions;
const calcRawPts        = ctx.calcRawPts;
const calcFantasyPts    = ctx.Sleeper.calcFantasyPts;
const DhqStorage        = ctx.DhqStorage;
const DhqEvents         = ctx.DhqEvents;
const STORAGE_KEYS      = ctx.STORAGE_KEYS;
const getTier           = ctx.getTier;
const isTrialActive     = ctx.isTrialActive;
const getDailyChatRemaining = ctx.getDailyChatRemaining;
const incrementDailyChat    = ctx.incrementDailyChat;
const canAccess         = ctx.canAccess;
const FEATURES          = ctx.FEATURES;
const addFieldLogEntry  = ctx.addFieldLogEntry;
const DhqCore           = ctx.App.DhqCore;
const DhqValueTuning    = ctx.App.DhqValueTuning;

// ══════════════════════════════════════════════════════════════════
// 1. normPos
// ══════════════════════════════════════════════════════════════════
group('normPos');
test('null → null',        () => eq(normPos(null),      null));
test('undefined → null',   () => eq(normPos(undefined), null));
test('CB → DB',            () => eq(normPos('CB'),  'DB'));
test('S  → DB',            () => eq(normPos('S'),   'DB'));
test('SS → DB',            () => eq(normPos('SS'),  'DB'));
test('FS → DB',            () => eq(normPos('FS'),  'DB'));
test('DB → DB',            () => eq(normPos('DB'),  'DB'));
test('DE → DL',            () => eq(normPos('DE'),  'DL'));
test('DT → DL',            () => eq(normPos('DT'),  'DL'));
test('NT → DL',            () => eq(normPos('NT'),  'DL'));
test('IDL → DL',           () => eq(normPos('IDL'), 'DL'));
test('EDGE → DL',          () => eq(normPos('EDGE'),'DL'));
test('DL → DL',            () => eq(normPos('DL'),  'DL'));
test('OLB → LB',           () => eq(normPos('OLB'), 'LB'));
test('ILB → LB',           () => eq(normPos('ILB'), 'LB'));
test('MLB → LB',           () => eq(normPos('MLB'), 'LB'));
test('LB → LB',            () => eq(normPos('LB'),  'LB'));
test('QB passthrough',      () => eq(normPos('QB'), 'QB'));
test('RB passthrough',      () => eq(normPos('RB'), 'RB'));
test('WR passthrough',      () => eq(normPos('WR'), 'WR'));
test('TE passthrough',      () => eq(normPos('TE'), 'TE'));
test('K  passthrough',      () => eq(normPos('K'),  'K'));
test('DEF passthrough',     () => eq(normPos('DEF'), 'DEF'));
test('DST → DEF',           () => eq(normPos('DST'), 'DEF'));
test('D/ST → DEF',          () => eq(normPos('D/ST'), 'DEF'));
test('unknown passthrough', () => eq(normPos('UNKNOWN'), 'UNKNOWN'));

group('posLabel');
test('DEF displays as D/ST', () => eq(posLabel('DEF'), 'D/ST'));
test('DST displays as D/ST', () => eq(posLabel('DST'), 'D/ST'));
test('Picks label keeps casing', () => eq(posLabel('Picks'), 'Picks'));

group('formatNFLDraftSlot');
// NFL draft-capital label: overall pick → R{round}.{pickInRound}, divisor 32.
// The bug this guards: a round-2+ pick showed the OVERALL pick (e.g. "R2.33")
// instead of the in-round slot ("R2.01").
test('R1 first pick → R1.01',  () => eq(formatNFLDraftSlot(1, 1),   'R1.01'));
test('R1 last pick → R1.32',   () => eq(formatNFLDraftSlot(1, 32),  'R1.32'));
test('R2 first pick → R2.01',  () => eq(formatNFLDraftSlot(2, 33),  'R2.01'));
test('R2 mid pick → R2.18',    () => eq(formatNFLDraftSlot(2, 50),  'R2.18'));
test('R3 first pick → R3.01',  () => eq(formatNFLDraftSlot(3, 65),  'R3.01'));
test('R4 pick → R4.04',        () => eq(formatNFLDraftSlot(4, 100), 'R4.04'));
test('round, no pick → R{n}',  () => eq(formatNFLDraftSlot(5, 0),   'R5'));
test('no round, has pick → #', () => eq(formatNFLDraftSlot(0, 150), '#150'));
test('no data → empty',        () => eq(formatNFLDraftSlot(0, 0),   ''));
test('in-round floor never < 1', () => eq(formatNFLDraftSlot(2, 1), 'R2.01'));

group('getLeaguePositions');
test('adds D/ST when league has a defense slot', () => {
  const positions = getLeaguePositions({ league: { roster_positions: ['QB', 'RB', 'WR', 'TE', 'DEF', 'BN'] } });
  ok(positions.includes('DEF'), 'DEF should be available');
});
test('normalizes DST aliases in roster positions', () => {
  const positions = getLeaguePositions({ league: { roster_positions: ['QB', 'RB', 'WR', 'TE', 'D/ST', 'BN'] } });
  ok(positions.includes('DEF'), 'D/ST slot should normalize to DEF');
});

// ══════════════════════════════════════════════════════════════════
// 2. calcRawPts (shared/utils.js version)
// ══════════════════════════════════════════════════════════════════
group('calcRawPts (utils.js)');
test('null stats → null',
  () => eq(calcRawPts(null, null), null));
test('custom: rush TD',
  () => eq(calcRawPts({ rush_td: 2 }, { rush_td: 6 }), 12));
test('custom: multi-stat',
  () => eq(calcRawPts({ pass_yd: 400, pass_td: 3 }, { pass_yd: 0.04, pass_td: 4 }), 28));
test('fallback: pts_half_ppr',
  () => eq(calcRawPts({ pts_half_ppr: 18 }, null), 18));
test('fallback: pts_ppr',
  () => eq(calcRawPts({ pts_ppr: 20 }, null), 20));
test('fallback: pts_std',
  () => eq(calcRawPts({ pts_std: 15 }, null), 15));
test('all fallbacks absent → null',
  () => eq(calcRawPts({ rush_yd: 100 }, null), null));

// ══════════════════════════════════════════════════════════════════
// 3. calcFantasyPts (shared/sleeper-api.js)
// ══════════════════════════════════════════════════════════════════
group('calcFantasyPts');

// Standard half-PPR scoring settings
const HALF_PPR = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1,
  rush_yd: 0.1,  rush_td: 6,
  rec: 0.5,      rec_yd: 0.1, rec_td: 6,
  fum_lost: -1,
};

test('null stats → 0',
  () => eq(calcFantasyPts(null, {}), 0));

test('zero stats → 0',
  () => eq(calcFantasyPts({}, HALF_PPR), 0));

test('300 pass yds @ 0.04 = 12 pts',
  () => eq(calcFantasyPts({ pass_yd: 300 }, { pass_yd: 0.04 }), 12));

test('1 pass TD @ 4 = 4 pts',
  () => eq(calcFantasyPts({ pass_td: 1 }, { pass_td: 4 }), 4));

test('1 INT @ -1 = -1 pts',
  () => eq(calcFantasyPts({ pass_int: 1 }, { pass_int: -1 }), -1));

test('100 rush yds @ 0.1 = 10 pts',
  () => eq(calcFantasyPts({ rush_yd: 100 }, { rush_yd: 0.1 }), 10));

test('1 rush TD @ 6 = 6 pts',
  () => eq(calcFantasyPts({ rush_td: 1 }, { rush_td: 6 }), 6));

test('1 reception @ 0.5 = 0.5 pts',
  () => eq(calcFantasyPts({ rec: 1 }, { rec: 0.5 }), 0.5));

test('typical QB line (half-PPR): 300 yds / 3 TD / 1 INT',
  () => {
    // 300*0.04=12, 3*4=12, 1*-1=-1 → 23
    eq(calcFantasyPts({ pass_yd: 300, pass_td: 3, pass_int: 1 }, HALF_PPR), 23);
  });

test('typical RB line (half-PPR): 100 rush yds / 1 TD / 3 rec / 30 rec yds',
  () => {
    // 100*0.1=10, 1*6=6, 3*0.5=1.5, 30*0.1=3 → 20.5
    eq(calcFantasyPts({ rush_yd: 100, rush_td: 1, rec: 3, rec_yd: 30 }, HALF_PPR), 20.5);
  });

test('IDP: solo tackle counted via idp_tkl_solo key',
  () => {
    // 3 solo tackles @ 1 pt each
    eq(calcFantasyPts({ idp_tkl_solo: 3 }, { idp_tkl_solo: 1 }), 3);
  });

test('IDP: non-prefixed tkl_solo fallback key',
  () => {
    // idp_tkl_solo weight but stats use non-prefixed key
    eq(calcFantasyPts({ tkl_solo: 3 }, { idp_tkl_solo: 1 }), 3);
  });

test('IDP: sack @ 3 pts',
  () => eq(calcFantasyPts({ idp_sack: 1 }, { idp_sack: 3 }), 3));

test('result is rounded to 1 decimal place',
  () => {
    // 1.33 would round to 1.3
    const raw = calcFantasyPts({ rec: 1 }, { rec: 1.33 });
    eq(raw, 1.3);
  });

test('missing scoring key uses ?? default for pass_td (default 4)',
  () => {
    // No pass_td in scoring → defaults to 4 via ??
    eq(calcFantasyPts({ pass_td: 1 }, {}), 4);
  });

test('scoring value of 0 overrides default (explicit zero)',
  () => {
    // Explicitly set pass_td: 0 → no TD points
    eq(calcFantasyPts({ pass_td: 1 }, { pass_td: 0 }), 0);
  });

test('fumble lost @ -1',
  () => eq(calcFantasyPts({ fum_lost: 1 }, { fum_lost: -1 }), -1));

test('kicker made field goal scoring can dominate custom formats',
  () => eq(calcFantasyPts({ fgm: 2, xpm: 1 }, { fgm: 100, xpm: 1 }), 201));

// ══════════════════════════════════════════════════════════════════
// 4. DHQ value tuning helpers
// ══════════════════════════════════════════════════════════════════
group('DHQ value tuning');

test('standalone DHQ core is loaded before the app wrapper',
  () => {
    ok(!!DhqCore, 'DhqCore should be exposed on App');
    eq(DhqCore.scoreStats({ fgm: 2 }, { fgm: 100 }), 200);
  });

test('age curves match current position bands',
  () => {
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.QB), JSON.stringify({ build: [23, 27], peak: [28, 34], decline: [35, 38] }), 'QB curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.RB), JSON.stringify({ build: [21, 22], peak: [23, 25], decline: [26, 28] }), 'RB curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.WR), JSON.stringify({ build: [22, 24], peak: [25, 28], decline: [29, 31] }), 'WR curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.TE), JSON.stringify({ build: [23, 25], peak: [26, 29], decline: [30, 32] }), 'TE curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.DL), JSON.stringify({ build: [22, 24], peak: [25, 29], decline: [30, 32] }), 'DL curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.LB), JSON.stringify({ build: [22, 23], peak: [24, 28], decline: [29, 31] }), 'LB curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.DB), JSON.stringify({ build: [21, 23], peak: [24, 27], decline: [28, 30] }), 'DB curve');
    eq(JSON.stringify(DhqValueTuning.ageCurveWindows.K), JSON.stringify({ build: [23, 27], peak: [28, 35], decline: [36, 40] }), 'K curve');
  });

test('age curve factor keeps decline band valuable before post-window cliff',
  () => {
    near(DhqValueTuning.ageCurveFactor(25, 'RB', DhqValueTuning.ageCurveWindows, { RB: 0.22 }), 1, 0.001, 'RB peak');
    near(DhqValueTuning.ageCurveFactor(28, 'RB', DhqValueTuning.ageCurveWindows, { RB: 0.22 }), 0.62, 0.001, 'RB decline end');
    ok(DhqValueTuning.ageCurveFactor(30, 'RB', DhqValueTuning.ageCurveWindows, { RB: 0.22 }) < 0.3, 'post-decline RB should cliff');
  });

test('PPG reliability keeps half-season production meaningful',
  () => {
    eq(DhqValueTuning.ppgReliability(17), 1);
    near(DhqValueTuning.ppgReliability(8), 0.88, 0.001);
    near(DhqValueTuning.ppgReliability(3), 0.55, 0.001);
  });

test('Superflex counts as a full startable QB slot for league demand',
  () => {
    const counts = DhqValueTuning.starterCountsFromRoster(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'SUPER_FLEX']);
    eq(counts.QB, 2);
  });

test('Flex slots count toward each eligible startable position pool',
  () => {
    const counts = DhqValueTuning.starterCountsFromRoster(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']);
    eq(counts.QB, 2);
    eq(counts.RB, 3);
    eq(counts.WR, 3);
    eq(counts.TE, 2);
  });

test('position scoring weights respond to extreme kicker scoring',
  () => {
    const weights = DhqValueTuning.positionScoringWeights(
      { QB: { avgStarter: 320 }, RB: { avgStarter: 230 }, WR: { avgStarter: 220 }, TE: { avgStarter: 160 }, K: { avgStarter: 2200 } },
      { QB: 2, RB: 2, WR: 3, TE: 1, K: 1 },
      ['QB', 'RB', 'WR', 'TE', 'K']
    );
    ok(weights.K > weights.RB, 'kicker weight should rise when kicker starter scoring is extreme');
  });

test('FantasyCalc blend policy uses 70/30 as the normal veteran anchor',
  () => {
    eq(DhqCore.marketBlendWeight(0.10, { rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'], scoring: { rec: 0.5 }, ppr: 0.5 }), 0.30);
    eq(DhqCore.marketBlendWeight(0.40, { rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'], scoring: { rec: 0.5 }, ppr: 0.5 }), 0.35);
    eq(DhqCore.marketBlendWeight(0.60, { rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'], scoring: { rec: 0.5 }, ppr: 0.5 }), 0.40);
  });

test('FantasyCalc blend is capped when scoring is outside the market model',
  () => {
    const cfg = { rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'], scoring: { rec: 0.5, fgm: 1000, xpm: 1 }, ppr: 0.5 };
    const compatibility = DhqCore.fantasyCalcCompatibility(cfg);
    ok(compatibility.extremeCustom, '1000-point kicker scoring should be treated as extreme custom scoring');
    eq(DhqCore.marketBlendWeight(0.60, cfg), 0.15);
  });

test('lineup context maps extreme scoring to total lineup share',
  () => {
    const context = DhqCore.buildLineupContext({
      totalTeams: 2,
      rosterPositions: ['QB', 'RB', 'WR', 'K'],
      positions: ['QB', 'RB', 'WR', 'K'],
      rows: [
        { position: 'QB', ppg: 25 }, { position: 'QB', ppg: 24 },
        { position: 'RB', ppg: 18 }, { position: 'RB', ppg: 17 },
        { position: 'WR', ppg: 17 }, { position: 'WR', ppg: 16 },
        { position: 'K', ppg: 1000 }, { position: 'K', ppg: 950 },
      ],
    });
    ok(context.position.K.pointShare > 0.90, 'kickers should own most lineup points in extreme K scoring');
    ok(context.position.QB.pointShare > 0 && context.position.QB.pointShare < 0.04, 'QBs still matter, but only at their lineup share');
    ok(context.position.K.importance > context.position.QB.importance, 'lineup importance should follow scoring dominance');
  });

test('lineup context assigns superflex to QBs when QB scoring earns it',
  () => {
    const context = DhqCore.buildLineupContext({
      totalTeams: 2,
      rosterPositions: ['QB', 'SUPER_FLEX'],
      positions: ['QB', 'RB', 'WR', 'TE'],
      rows: [
        { position: 'QB', ppg: 25 }, { position: 'QB', ppg: 24 },
        { position: 'QB', ppg: 23 }, { position: 'QB', ppg: 22 },
        { position: 'RB', ppg: 18 }, { position: 'WR', ppg: 17 },
      ],
    });
    eq(context.position.QB.lineupSlots, 4);
  });

test('standalone DHQ core calculates player values without app state',
  () => {
    const result = DhqCore.calculateValues({
      config: {
        mode: 'dynasty',
        teams: 16,
        ppr: 0.5,
        rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K'],
        scoring: { fgm: 100, xpm: 1 },
        includePicks: false,
      },
      players: {
        qb: { full_name: 'Starter QB', position: 'QB', age: 27, team: 'BUF' },
        k: { full_name: 'Stress Kicker', position: 'K', age: 28, team: 'DAL' },
      },
      stats: {
        qb: { gp: 17, pass_yd: 4200, pass_td: 34, pass_int: 10, rush_yd: 350, rush_td: 5 },
        k: { gp: 17, fgm: 35, xpm: 40 },
      },
      marketRows: [{ sleeper_id: 'qb', position: 'QB', value: 8000 }],
    });
    const top = result.playerRows[0];
    eq(top.position, 'K');
    ok(top.dhq_now > 9000, 'extreme kicker scoring should push kicker to top of standalone core');
    ok(result.topByPosition.K.lineupPointShare > result.topByPosition.QB.lineupPointShare, 'K share should beat QB share in the lineup model');
  });

test('production model blends 75% last year with 25% career',
  () => {
    const prod = DhqValueTuning.computeProductionPPG({
      2023: { avg: 10, gp: 17, total: 170 },
      2024: { avg: 20, gp: 8, total: 160 },
    });
    near(prod.ppg, 15.7, 0.01, '75/25 blended PPG');
    eq(prod.lastYear, 2024);
    near(prod.lastYearAdj, 17.6, 0.01, 'half-season adjusted PPG');
  });

// NOTE: Sleeper's depth_chart_order is 1-INDEXED (starter=1, backup=2, QB3=3).
// The depth LABEL reflects that real chart position (starter -> QB1). The role
// MULTIPLIER reads the raw 1-indexed order against the (0-indexed) mult table —
// a deliberate dampening that keeps QBs near the FantasyCalc market; un-dampening
// it (the "true" index fix) inflates QBs and crushes skill players vs market.
test('QB3 depth chart role receives a severe role discount',
  () => {
    const role = DhqValueTuning.depthRole('qb3', {
      position: 'QB', team: 'LV', depth_chart_order: 3, depth_chart_position: 'QB',
    }, { depthCharts: {} }, p => p);
    eq(role.label, 'QB3');
    near(role.mult, 0.35, 0.001);
  });

test("Aidan O'Connell profile: QB2 depth role receives backup penalty",
  () => {
    const aidanRole = DhqValueTuning.depthRole('aidan_oconnell', {
      full_name: "Aidan O'Connell",
      position: 'QB',
      team: 'LV',
      depth_chart_order: 2,
      depth_chart_position: 'QB',
    }, { depthCharts: {} }, p => p);
    const camRole = DhqValueTuning.depthRole('cam_ward', {
      full_name: 'Cam Ward',
      position: 'QB',
      team: 'TEN',
      depth_chart_order: 1,
      depth_chart_position: 'QB',
    }, { depthCharts: {} }, p => p);
    eq(aidanRole.label, 'QB2');
    near(aidanRole.mult, 0.52, 0.001);
    ok(aidanRole.mult < camRole.mult, 'QB2 should be valued below the QB1 role');
  });

test('Cam Ward profile: young QB1 keeps starter protection',
  () => {
    const role = DhqValueTuning.depthRole('cam_ward', {
      full_name: 'Cam Ward',
      position: 'QB',
      team: 'TEN',
      depth_chart_order: 1,
      depth_chart_position: 'QB',
      age: 24,
    }, { depthCharts: {} }, p => p);
    const status = DhqValueTuning.statusAdjustment({
      p: { full_name: 'Cam Ward', status: 'Active', team: 'TEN' },
      pos: 'QB',
      age: 24,
      peakEnd: 34,
      declineEnd: 38,
      seasons: { 2025: { avg: 12, gp: 17, total: 204 } },
      curSeason: 2026,
      lastCompletedSeason: 2025,
      isRostered: true,
      hasRealTeam: true,
      isOffseasonTeams: false,
    });
    eq(role.label, 'QB1'); // real Sleeper QB1 (order 1) is now labeled QB1, not QB2
    near(role.mult, 0.78, 0.001); // calibrated rank-1 mult (dampened; see note above)
    eq(status.code, 'active');
    eq(status.cap, null);
    eq(status.mult, 1);
  });

test('Derek Carr profile: long-term FA quarterback is capped like a near-retired profile',
  () => {
    const adj = DhqValueTuning.statusAdjustment({
      p: { full_name: 'Derek Carr', status: 'Active', team: 'FA' },
      pos: 'QB',
      age: 35,
      peakEnd: 34,
      declineEnd: 38,
      seasons: { 2024: { avg: 16, gp: 10, total: 160 } },
      curSeason: 2026,
      lastCompletedSeason: 2025,
      isRostered: true,
      hasRealTeam: false,
      isOffseasonTeams: false,
    });
    eq(adj.code, 'long_fa');
    ok(adj.cap <= 300, 'aging FA QB should be capped near zero');
    ok(adj.mult < 0.1, 'aging FA QB should receive severe multiplier');
  });

test('young RB blocked by an elite teammate gets opportunity discount',
  () => {
    const S0 = {
      depthCharts: {},
      players: {
        rb1: { position: 'RB', team: 'ARI', age: 25, depth_chart_order: 0 },
        rb2: { position: 'RB', team: 'ARI', age: 22, depth_chart_order: 1 },
      },
    };
    const ps = {
      rb1: { pos: 'RB', seasons: { 2025: { avg: 16, gp: 15, total: 240 } } },
      rb2: { pos: 'RB', seasons: { 2025: { avg: 8, gp: 12, total: 96 } } },
    };
    const oppMap = DhqValueTuning.buildOpportunityMap(S0, ps, p => p);
    const adj = DhqValueTuning.opportunityAdjustment({
      pid: 'rb2', pos: 'RB', age: 22, starterSeasons: 0, team: 'ARI', opportunityMap: oppMap, roleRank: 1,
    });
    ok(adj.mult < 1, 'blocked young RB should be discounted');
    eq(adj.blockers[0], 'rb1');
  });

// ══════════════════════════════════════════════════════════════════
// 5. DhqStorage
// ══════════════════════════════════════════════════════════════════
group('DhqStorage');

// Use a dedicated storage namespace so tests don't bleed into each other
const SK = 'dhq_test_';

test('set / get round-trip (object)',
  () => {
    DhqStorage.set(SK + 'obj', { x: 1, y: 'hello' });
    const v = DhqStorage.get(SK + 'obj');
    eq(v.x, 1);
    eq(v.y, 'hello');
  });

test('get: missing key returns fallback',
  () => eq(DhqStorage.get(SK + 'missing', 42), 42));

test('get: missing key returns null by default',
  () => eq(DhqStorage.get(SK + 'missing2'), null));

test('set / getStr round-trip (string)',
  () => {
    DhqStorage.setStr(SK + 'str', 'hello world');
    eq(DhqStorage.getStr(SK + 'str'), 'hello world');
  });

test('getStr: missing key returns empty string by default',
  () => eq(DhqStorage.getStr(SK + 'missing3'), ''));

test('getStr: missing key returns custom fallback',
  () => eq(DhqStorage.getStr(SK + 'missing4', 'fallback'), 'fallback'));

test('remove: key is deleted',
  () => {
    DhqStorage.set(SK + 'del', 123);
    DhqStorage.remove(SK + 'del');
    eq(DhqStorage.get(SK + 'del'), null);
  });

test('removeByPrefix: deletes all matching keys',
  () => {
    DhqStorage.set('pfx_a', 1);
    DhqStorage.set('pfx_b', 2);
    DhqStorage.set('other_c', 3);
    DhqStorage.removeByPrefix('pfx_');
    eq(DhqStorage.get('pfx_a'), null);
    eq(DhqStorage.get('pfx_b'), null);
    notNull(DhqStorage.get('other_c'), 'other_c should not be removed');
    DhqStorage.remove('other_c');
  });

test('set returns true on success',
  () => ok(DhqStorage.set(SK + 'ret', 1) === true));

test('get: returns fallback for malformed JSON',
  () => {
    ls.setItem(SK + 'bad', '{bad json');
    eq(DhqStorage.get(SK + 'bad', 'safe'), 'safe');
  });

test('setTtl / getTtl: value returned within TTL',
  () => {
    DhqStorage.setTtl(SK + 'ttl', { data: 'fresh' });
    const v = DhqStorage.getTtl(SK + 'ttl', 60000);  // 60s TTL
    notNull(v, 'should return value within TTL');
    eq(v.data, 'fresh');
  });

test('getTtl: expired entry returns fallback and removes key',
  () => {
    // Write entry with timestamp 1 hour ago
    ls.setItem(SK + 'expired', JSON.stringify({ _ts: Date.now() - 3700000, _data: 'old' }));
    const v = DhqStorage.getTtl(SK + 'expired', 3600000, 'EXPIRED');  // 1h TTL
    eq(v, 'EXPIRED', 'expired entry should return fallback');
    eq(ls.getItem(SK + 'expired'), null, 'expired entry should be cleaned up');
  });

test('getTtl: entry without _ts is returned as-is',
  () => {
    ls.setItem(SK + 'no_ts', JSON.stringify({ value: 42 }));
    const v = DhqStorage.getTtl(SK + 'no_ts', 60000);
    eq(v.value, 42);
  });

// ══════════════════════════════════════════════════════════════════
// 5. DhqEvents
// ══════════════════════════════════════════════════════════════════
group('DhqEvents');

test('on / emit: handler is called with data',
  () => {
    let received = null;
    const unsub = DhqEvents.on('test:basic', d => { received = d; });
    DhqEvents.emit('test:basic', { value: 99 });
    eq(received?.value, 99);
    unsub();
  });

test('off: unsubscribed handler is not called',
  () => {
    let count = 0;
    const fn = () => count++;
    DhqEvents.on('test:off', fn);
    DhqEvents.off('test:off', fn);
    DhqEvents.emit('test:off', {});
    eq(count, 0);
  });

test('on: returns unsubscribe function that works',
  () => {
    let count = 0;
    const unsub = DhqEvents.on('test:unsub', () => count++);
    DhqEvents.emit('test:unsub');  // count → 1
    unsub();
    DhqEvents.emit('test:unsub');  // should not fire
    eq(count, 1);
  });

test('once: fires exactly once then auto-unsubscribes',
  () => {
    let count = 0;
    DhqEvents.once('test:once', () => count++);
    DhqEvents.emit('test:once');
    DhqEvents.emit('test:once');
    DhqEvents.emit('test:once');
    eq(count, 1);
  });

test('once: returns unsubscribe function',
  () => {
    let count = 0;
    const unsub = DhqEvents.once('test:once2', () => count++);
    unsub();  // unsubscribe before first emit
    DhqEvents.emit('test:once2');
    eq(count, 0);
  });

test('multiple listeners on same event: all are called',
  () => {
    let a = 0, b = 0;
    const ua = DhqEvents.on('test:multi', () => a++);
    const ub = DhqEvents.on('test:multi', () => b++);
    DhqEvents.emit('test:multi');
    eq(a, 1);
    eq(b, 1);
    ua(); ub();
  });

test('error in one handler does not prevent others from firing',
  () => {
    let good = 0;
    DhqEvents.on('test:error', () => { throw new Error('handler error'); });
    DhqEvents.on('test:error', () => { good++; });
    DhqEvents.emit('test:error');
    eq(good, 1, 'second handler should still fire after first throws');
    DhqEvents.off('test:error', () => {});  // cleanup attempt (harmless)
  });

test('emit with no listeners: does not throw',
  () => { DhqEvents.emit('test:no_listeners', { x: 1 }); ok(true); });

test('emit payload is passed through unchanged',
  () => {
    const payload = { a: 1, b: [2, 3], c: { nested: true } };
    let received = null;
    const unsub = DhqEvents.on('test:payload', d => { received = d; });
    DhqEvents.emit('test:payload', payload);
    eq(received, payload);
    unsub();
  });

// ══════════════════════════════════════════════════════════════════
// 6. STORAGE_KEYS uniqueness
// ══════════════════════════════════════════════════════════════════
group('STORAGE_KEYS');

test('STORAGE_KEYS is defined',
  () => ok(STORAGE_KEYS && typeof STORAGE_KEYS === 'object'));

test('all static string values are unique (no key collisions)',
  () => {
    const staticValues = Object.values(STORAGE_KEYS).filter(v => typeof v === 'string');
    const set = new Set(staticValues);
    eq(set.size, staticValues.length,
      `Found duplicate static keys: ${staticValues.filter((v, i) => staticValues.indexOf(v) !== i).join(', ')}`);
  });

test('all static keys are non-empty strings',
  () => {
    const staticValues = Object.values(STORAGE_KEYS).filter(v => typeof v === 'string');
    for (const v of staticValues) {
      ok(v.length > 0, `Empty key string found in STORAGE_KEYS`);
    }
  });

test('function keys produce unique values for different league IDs',
  () => {
    const fnKeys = Object.entries(STORAGE_KEYS).filter(([, v]) => typeof v === 'function');
    for (const [name, fn] of fnKeys) {
      const v1 = fn('league_001');
      const v2 = fn('league_002');
      ok(v1 !== v2, `STORAGE_KEYS.${name}('league_001') === STORAGE_KEYS.${name}('league_002') — not unique per league`);
    }
  });

test('CHAT_DAILY key contains the date string',
  () => {
    const today = todayKey();
    const key = STORAGE_KEYS.CHAT_DAILY(today);
    ok(key.includes(today), `CHAT_DAILY key should embed date: ${key}`);
  });

test('HIST_KEY produces dhq_hist_<leagueId> format',
  () => {
    const key = STORAGE_KEYS.HIST_KEY('abc123');
    ok(key === `${STORAGE_KEYS.HIST_PREFIX}abc123`,
      `expected prefix+id, got ${key}`);
  });

// ══════════════════════════════════════════════════════════════════
// 7. Tier system: getTier / isTrialActive / getDailyChatRemaining / canAccess
// ══════════════════════════════════════════════════════════════════
group('isTrialActive');

// tier.js sets TRIAL_START on load via initTrial(), so it's active by default.
test('fresh install: trial is active',
  () => ok(isTrialActive(), 'trial should be active after initTrial()'));

test('trial started today: isTrialActive → true',
  () => {
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
    ok(isTrialActive());
  });

test('trial started 31 days ago: isTrialActive → false',
  () => {
    const expired = Date.now() - 31 * 24 * 60 * 60 * 1000;
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(expired));
    eq(isTrialActive(), false);
    // Restore active trial for subsequent tests
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('no TRIAL_START: isTrialActive → false',
  () => {
    ls.removeItem(STORAGE_KEYS.TRIAL_START);
    eq(isTrialActive(), false);
    // Restore
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('non-numeric TRIAL_START: isTrialActive → false',
  () => {
    ls.setItem(STORAGE_KEYS.TRIAL_START, 'not-a-number');
    eq(isTrialActive(), false);
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

group('getTier');

// Helper: clear the in-memory tier cache between tests
function clearTierCache() {
  ctx.App._userTier = null;
  ctx.App._productTier = null;
  ls.removeItem(STORAGE_KEYS.OD_PROFILE);
  ls.removeItem(STORAGE_KEYS.FW_SESSION);
  ls.removeItem(STORAGE_KEYS.TIER);
}

test('active trial + no profile → trial',
  () => {
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
    eq(getTier(), 'trial');
  });

test('OD profile tier=scout in localStorage does not grant paid access',
  () => {
    clearTierCache();
    ls.removeItem(STORAGE_KEYS.TRIAL_START);
    ls.setItem(STORAGE_KEYS.OD_PROFILE, JSON.stringify({ tier: 'scout' }));
    eq(getTier(), 'free');
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('OD profile tier=war_room in localStorage does not grant paid access',
  () => {
    clearTierCache();
    ls.removeItem(STORAGE_KEYS.TRIAL_START);
    ls.setItem(STORAGE_KEYS.OD_PROFILE, JSON.stringify({ tier: 'war_room' }));
    eq(getTier(), 'free');
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('OD profile tier=commissioner in localStorage does not grant paid access',
  () => {
    clearTierCache();
    ls.removeItem(STORAGE_KEYS.TRIAL_START);
    ls.setItem(STORAGE_KEYS.OD_PROFILE, JSON.stringify({ tier: 'commissioner' }));
    eq(getTier(), 'free');
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('FW session with access_token in localStorage does not grant paid access',
  () => {
    clearTierCache();
    ls.removeItem(STORAGE_KEYS.TRIAL_START);
    ls.setItem(STORAGE_KEYS.FW_SESSION, JSON.stringify({ access_token: 'tok_abc' }));
    eq(getTier(), 'free');
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('DEV_MODE → paid regardless of profile',
  () => {
    clearTierCache();
    ctx.DEV_MODE = true;
    ctx.App._userTier = null;
    eq(getTier(), 'paid');
    ctx.DEV_MODE = false;
    ctx.App._userTier = null;
  });

test('expired trial + no profile → free',
  () => {
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now() - 31 * 24 * 60 * 60 * 1000));
    eq(getTier(), 'free');
    // Restore active trial
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

test('cached _userTier is respected',
  () => {
    clearTierCache();
    ctx.App._userTier = 'paid';
    eq(getTier(), 'paid');
    ctx.App._userTier = null;
  });

test('product entitlement keeps War Room separate from bundle/pro',
  () => {
    eq(ctx.normalizeProductTier({ tier: 'pro', products: ['war_room'] }), 'warroom');
    eq(ctx.normalizeProductTier({ tier: 'pro', products: ['dynast_hq'] }), 'scout');
    eq(ctx.normalizeProductTier({ tier: 'pro', products: ['war_room', 'dynast_hq'] }), 'pro');
  });

group('getDailyChatRemaining');

test('no chats used → 3 remaining',
  () => {
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
    eq(getDailyChatRemaining(), 3);
  });

test('1 chat used → 2 remaining',
  () => {
    ls.setItem(STORAGE_KEYS.CHAT_DAILY(todayKey()), JSON.stringify(1));
    eq(getDailyChatRemaining(), 2);
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
  });

test('2 chats used → 1 remaining',
  () => {
    ls.setItem(STORAGE_KEYS.CHAT_DAILY(todayKey()), JSON.stringify(2));
    eq(getDailyChatRemaining(), 1);
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
  });

test('3 chats used → 0 remaining (floor at 0)',
  () => {
    ls.setItem(STORAGE_KEYS.CHAT_DAILY(todayKey()), JSON.stringify(3));
    eq(getDailyChatRemaining(), 0);
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
  });

test('over-limit → still 0 (never negative)',
  () => {
    ls.setItem(STORAGE_KEYS.CHAT_DAILY(todayKey()), JSON.stringify(99));
    ok(getDailyChatRemaining() === 0);
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
  });

test('incrementDailyChat increments counter',
  () => {
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
    const before = getDailyChatRemaining();
    incrementDailyChat();
    const after = getDailyChatRemaining();
    eq(after, before - 1, 'remaining should decrease by 1 after increment');
    ls.removeItem(STORAGE_KEYS.CHAT_DAILY(todayKey()));
  });

group('canAccess');

test('paid tier → all features accessible',
  () => {
    clearTierCache();
    ctx.App._userTier = 'paid';
    ok(canAccess(FEATURES.OWNER_DNA));
    ok(canAccess(FEATURES.TRADE_CALC));
    ok(canAccess(FEATURES.BEHAVIORAL_MODEL));
    ok(canAccess(FEATURES.FIELD_LOG_SYNC));
    ok(canAccess(FEATURES.WAR_ROOM_CORE));
    ctx.App._userTier = null;
  });

test('trial tier → trial features accessible',
  () => {
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
    // Active trial, no paid profile → tier = 'trial'
    ok(canAccess(FEATURES.OWNER_DNA),         'OWNER_DNA in trial');
    ok(canAccess(FEATURES.TRADE_CALC),        'TRADE_CALC in trial');
    ok(canAccess(FEATURES.UNLIMITED_CHAT),    'UNLIMITED_CHAT in trial');
    ok(canAccess(FEATURES.NOTIFICATIONS),     'NOTIFICATIONS in trial');
  });

test('trial tier → paid-only features blocked',
  () => {
    clearTierCache();
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
    ok(!canAccess(FEATURES.BEHAVIORAL_MODEL), 'BEHAVIORAL_MODEL blocked in trial');
    ok(!canAccess(FEATURES.FIELD_LOG_SYNC),   'FIELD_LOG_SYNC blocked in trial');
    ok(!canAccess(FEATURES.WAR_ROOM_CORE),    'WAR_ROOM_CORE blocked in trial');
  });

test('free tier → all features blocked',
  () => {
    clearTierCache();
    ls.removeItem(STORAGE_KEYS.TRIAL_START);  // no trial
    eq(getTier(), 'free');
    ok(!canAccess(FEATURES.OWNER_DNA));
    ok(!canAccess(FEATURES.TRADE_CALC));
    ok(!canAccess(FEATURES.UNLIMITED_CHAT));
    ok(!canAccess(FEATURES.BEHAVIORAL_MODEL));
    // Restore trial
    ls.setItem(STORAGE_KEYS.TRIAL_START, String(Date.now()));
  });

// ══════════════════════════════════════════════════════════════════
// 8. addFieldLogEntry
// ══════════════════════════════════════════════════════════════════
group('addFieldLogEntry');
const FL_KEY = FL_KEY_VAL;

// Helper: clear field log
function clearFieldLog() { ls.removeItem(FL_KEY); }

test('creates entry with correct structure',
  () => {
    clearFieldLog();
    addFieldLogEntry('🎯', 'Trade target: CMC', 'trade', {});
    const log = JSON.parse(ls.getItem(FL_KEY));
    eq(log.length, 1, 'log should have 1 entry');
    const e = log[0];
    ok(e.id.startsWith('fl_'), `id should start with fl_: ${e.id}`);
    eq(e.icon, '🎯');
    eq(e.text, 'Trade target: CMC');
    eq(e.category, 'trade');
    eq(e.syncStatus, 'pending');
    ok(typeof e.ts === 'number' && e.ts > 0, 'ts should be a positive timestamp');
  });

test('default icon is 📋 when icon is omitted',
  () => {
    clearFieldLog();
    addFieldLogEntry(null, 'Quick note', 'note', {});
    const log = JSON.parse(ls.getItem(FL_KEY));
    eq(log[0].icon, '📋');
  });

test('default category is "note" when category is omitted',
  () => {
    clearFieldLog();
    addFieldLogEntry('📋', 'Note text', null, {});
    const log = JSON.parse(ls.getItem(FL_KEY));
    eq(log[0].category, 'note');
  });

test('meta fields are stored on entry',
  () => {
    clearFieldLog();
    addFieldLogEntry('📋', 'Tagged trade', 'trade', {
      actionType: 'proposed',
      players: [{ id: 'p1', name: 'Player One' }],
      context: 'week 12',
      leagueId: 'league_abc',
    });
    const e = JSON.parse(ls.getItem(FL_KEY))[0];
    eq(e.actionType, 'proposed');
    eq(e.players[0].name, 'Player One');
    eq(e.context, 'week 12');
    eq(e.leagueId, 'league_abc');
  });

test('new entries are prepended (most recent first)',
  () => {
    clearFieldLog();
    addFieldLogEntry('1️⃣', 'first',  'note', {});
    addFieldLogEntry('2️⃣', 'second', 'note', {});
    const log = JSON.parse(ls.getItem(FL_KEY));
    eq(log[0].text, 'second', 'newest should be first');
    eq(log[1].text, 'first');
  });

test('log is capped at 50 entries',
  () => {
    clearFieldLog();
    for (let i = 0; i < 55; i++) {
      addFieldLogEntry('📋', `entry ${i}`, 'note', {});
    }
    const log = JSON.parse(ls.getItem(FL_KEY));
    ok(log.length <= 50, `log length ${log.length} exceeds 50`);
  });

test('entry IDs are unique across calls',
  () => {
    clearFieldLog();
    for (let i = 0; i < 5; i++) {
      addFieldLogEntry('📋', `entry ${i}`, 'note', {});
    }
    const log = JSON.parse(ls.getItem(FL_KEY));
    const ids = log.map(e => e.id);
    const uniqueIds = new Set(ids);
    eq(uniqueIds.size, ids.length, 'all entry IDs should be unique');
  });

test('source integrity: addFieldLogEntry signature in scout-ui.js',
  () => ok(scoutUiSrc.includes('function addFieldLogEntry(icon'),
           'function signature not found — update this test if it was renamed'));

test('source integrity: Scout Today renders the shared recommendation contract',
  () => {
    ok(scoutUiSrc.includes('buildRecommendationContract'), 'Scout Today should use the shared recommendation contract');
    ok(scoutUiSrc.includes('function _scoutBuildNextMoveContract'), 'Scout next move contract builder missing');
    ok(scoutUiSrc.includes('scout-reco-proof'), 'Scout next move contract UI missing');
  });

// ══════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════
console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? '✗' : '✓';
console.log(`${status} ${passed + failed} tests — ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
