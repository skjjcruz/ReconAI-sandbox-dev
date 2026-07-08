// ══════════════════════════════════════════════════════════════════
// js/today-cards.js — Adaptive "Today" instrument panel.
// Holds the full KPI card catalog; a rules-based relevance selector reads
// the user's situation (ctx) and surfaces only the top 2-3 cards that
// matter right now. No user config. Each card = { key, title, tieClass,
// relevance(ctx)->score (0=hide), render(ctx)->html }. Built once per
// renderWarRoomBrief via window.TodayCards.{buildCtx,renderPanel}.
// Phase 1: rules-based selection + 6 cards. AI nudge + chat-summon = Phase 2.
// Loaded as a module (main.js) — communicates only via window.* globals.
// ══════════════════════════════════════════════════════════════════

function _tcSafe(fn) { try { return fn(); } catch { return null; } }
function _tcEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _tcHealthCol(h) { h = Number(h) || 0; return h >= 80 ? 'var(--green)' : h >= 65 ? 'var(--accent)' : h >= 50 ? 'var(--amber)' : 'var(--red)'; }
function _tcGradeRank(g) { return ({ A: 0, B: 1, C: 2, D: 3, F: 4 })[g] != null ? ({ A: 0, B: 1, C: 2, D: 3, F: 4 })[g] : 2; }
function _tcOwnerName(ctx, rid) {
  const S = ctx.S || {};
  const r = (S.rosters || []).find(x => x.roster_id === rid);
  const u = (S.leagueUsers || S.users || []).find(x => x.user_id === r?.owner_id);
  return u?.metadata?.team_name || u?.display_name || u?.username || ('Team ' + rid);
}
function _tcCard(opts) {
  const rows = (opts.rows || []).map(r => `<div class="sac-row"><span>${_tcEsc(r.label)}</span><strong${r.color ? ` style="color:${r.color}"` : ''}>${_tcEsc(r.value)}</strong></div>`).join('');
  return `<div class="scout-adaptive-card"><span class="scout-kicker">${_tcEsc(opts.kicker)}</span><h3${opts.titleColor ? ` style="color:${opts.titleColor}"` : ''}>${_tcEsc(opts.title)}</h3>${rows}</div>`;
}

// ── Shared situation context — built once, every engine call guarded ──
// Heavy engines (analytics / leverage / window / grades / picks) memoized by a
// cheap state signature — the brief re-renders on tab switch AND a 15s poll, so
// without this runLeagueAnalytics (O(rosters×players)) would recompute each time.
let _tcHeavyCache = null, _tcHeavySig = '';
function _tcHeavy(S, roster, league, myRid, assessment) {
  const sig = [league?.league_id, myRid, (roster?.players || []).length, (S.rosters || []).length, Math.round(assessment?.healthScore || 0), Array.isArray(S.transactions) ? S.transactions.length : Object.keys(S.transactions || {}).length].join('|');
  if (_tcHeavyCache && _tcHeavySig === sig) return _tcHeavyCache;
  const h = {
    analytics: _tcSafe(() => window.runLeagueAnalytics ? window.runLeagueAnalytics() : null),
    leverage: _tcSafe(() => window.computeLeverageBoard ? window.computeLeverageBoard(myRid) : null),
    windowForecast: _tcSafe(() => window.computeWindowForecast ? window.computeWindowForecast(myRid, S.rosters, S.players, league) : null),
    posGrades: _tcSafe(() => window._anCalcPosGrades ? window._anCalcPosGrades(myRid, S.rosters, S.players) : null),
    picksByOwner: _tcSafe(() => window.buildPicksByOwner ? window.buildPicksByOwner(S.rosters, league, S.tradedPicks) : null) || {},
  };
  _tcHeavyCache = h; _tcHeavySig = sig;
  return h;
}
function _tcBuildCtx(S, roster, league, phase, assessment) {
  const myRid = roster ? roster.roster_id : null;
  const _h = _tcHeavy(S, roster, league, myRid, assessment);
  const all = _tcSafe(() => window.assessAllTeamsFromGlobal()) || [];
  const ranked = [...all].sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
  const rank = (myRid != null) ? (ranked.findIndex(a => a.rosterId === myRid) + 1) : 0;
  const phaseStr = phase?.phase || '';
  // Tally all tag counts in one pass over window._playerTags (was 4 getPlayersByTag
  // calls, each of which rebuilt + mapped the whole tag pool just to read .length).
  const tagCounts = { trade: 0, cut: 0, watch: 0, untouchable: 0 };
  const _pt = window._playerTags || {};
  for (const pid in _pt) { const t = _pt[pid]; if (tagCounts[t] != null) tagCounts[t]++; }
  return {
    S, roster, league, myRid, me: assessment, all, ranked, rank,
    elite: (window.App?.countElitePlayers || window.countElitePlayers || (() => 0))(roster?.players || []),
    phase: phaseStr, phaseLabel: phase?.label || '',
    inSeason: phaseStr === 'regular_season' || phaseStr === 'playoffs',
    season: parseInt(S.season || league?.season, 10) || new Date().getFullYear(),
    panic: assessment?.panic || 0,
    window: assessment?.window || '',
    needs: (assessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean),
    windowForecast: _h.windowForecast,
    posGrades: _h.posGrades,
    picksByOwner: _h.picksByOwner,
    analytics: _h.analytics,
    leverage: _h.leverage,
    optimalLineup: (phaseStr === 'regular_season' || phaseStr === 'playoffs') ? _tcSafe(() => window._buildLineupState ? window._buildLineupState() : null) : null,
    tagCounts, tagTotal: tagCounts.trade + tagCounts.cut + tagCounts.watch + tagCounts.untouchable,
  };
}

// ── Card catalog ────────────────────────────────────────────────────
const _TC_CATALOG = [
  {
    key: 'roster-pulse', title: 'Roster Pulse', tieClass: 1,
    relevance(ctx) { return ctx.me ? 35 + (ctx.panic || 0) * 4 : 0; },
    render(ctx) {
      const m = ctx.me;
      return _tcCard({ kicker: 'Roster Pulse', title: (m.healthScore != null ? Math.round(m.healthScore) : '—') + ' Health', titleColor: _tcHealthCol(m.healthScore), rows: [
        { label: 'Tier', value: m.tier || '—', color: m.tierColor || 'var(--accent)' },
        { label: 'League rank', value: ctx.rank ? ('#' + ctx.rank + ' / ' + ctx.all.length) : '—' },
        { label: 'Elite assets', value: String(ctx.elite) },
      ] });
    },
  },
  {
    key: 'power-rankings', title: 'Power Rank', tieClass: 3,
    relevance(ctx) {
      if (!ctx.rank || !ctx.all.length) return 0;
      let s = 22 + (ctx.panic || 0) * 3;
      const above = ctx.ranked[ctx.rank - 2];
      if (above && ctx.me && (above.healthScore - ctx.me.healthScore) > 0 && (above.healthScore - ctx.me.healthScore) <= 8) s += 15;
      return s;
    },
    render(ctx) {
      const above = ctx.ranked[ctx.rank - 2], below = ctx.ranked[ctx.rank], rival = above || below;
      return _tcCard({ kicker: 'Power Rank', title: '#' + ctx.rank + ' of ' + ctx.all.length, rows: [
        { label: above ? 'Team to catch' : 'Closest below', value: rival ? (_tcOwnerName(ctx, rival.rosterId) + ' · ' + Math.round(rival.healthScore || 0)) : '—' },
        { label: 'Your health', value: ctx.me ? String(Math.round(ctx.me.healthScore || 0)) : '—', color: _tcHealthCol(ctx.me?.healthScore) },
      ] });
    },
  },
  {
    key: 'coverage-grades', title: 'Coverage', tieClass: 2,
    relevance(ctx) {
      const g = ctx.posGrades;
      if (!g || !g.some(x => x.mySum > 0)) return 0;
      const weak = g.filter(x => x.mySum > 0 && (x.grade === 'D' || x.grade === 'F'));
      const pa = ctx.me?.posAssessment || {};
      const deficits = Object.values(pa).filter(v => v && (v.status === 'deficit' || v.status === 'thin')).length;
      if (!weak.length && deficits < 2) return 0;
      return 20 + (ctx.panic || 0) * 8 + (deficits >= 2 ? 15 : 0) + ((ctx.phase === 'pre_draft' || ctx.phase === 'draft_week') ? 20 : 0);
    },
    render(ctx) {
      const g = ctx.posGrades || [];
      const weak = g.filter(x => x.mySum > 0 && (x.grade === 'D' || x.grade === 'F')).sort((a, b) => b.rank - a.rank);
      const worst = [...g].filter(x => x.mySum > 0).sort((a, b) => _tcGradeRank(b.grade) - _tcGradeRank(a.grade))[0];
      const rows = weak.slice(0, 2).map(x => ({ label: x.pos + ' room', value: 'Grade ' + x.grade + ' · #' + x.rank + '/' + x.totalTeams, color: x.col }));
      return _tcCard({ kicker: 'Coverage', title: worst ? ('Weakest: ' + worst.pos + ' (' + worst.grade + ')') : 'Coverage', titleColor: worst?.col, rows: rows.length ? rows : [{ label: 'Status', value: 'Rooms graded league-relative' }] });
    },
  },
  {
    key: 'window-cliff', title: 'Age Window', tieClass: 2,
    relevance(ctx) {
      const wf = ctx.windowForecast;
      if (!wf || !wf.groups || !wf.groups.length) return 0;
      const nearest = wf.groups.find(g => g.cliffT >= 0);
      if (!nearest || nearest.cliffT > 3) return 0;
      let s = 25;
      if (nearest.cliffT === 0) s += 30; else if (nearest.cliffT === 1) s += 20;
      if (ctx.phase === 'pre_draft' || ctx.phase === 'early_offseason' || ctx.phase === 'post_draft') s += 20;
      return s;
    },
    render(ctx) {
      const wf = ctx.windowForecast;
      const nearest = wf.groups.find(g => g.cliffT >= 0) || wf.groups[0];
      const cliffLabel = nearest.cliffT === 0 ? 'NOW' : String(wf.season + nearest.cliffT);
      const col = nearest.cliffT === 0 ? 'var(--red)' : nearest.cliffT === 1 ? 'var(--amber)' : 'var(--accent)';
      const sellBy = wf.groups.reduce((n, g) => n + ((g.sellBy && g.sellBy.length) || 0), 0);
      return _tcCard({ kicker: 'Age Window', title: nearest.pos + ' cliff · ' + cliffLabel, titleColor: col, rows: [
        { label: 'Prime value now', value: Math.round((nearest.primeShares?.[0] || 0) * 100) + '%' },
        { label: 'Sell-by candidates', value: String(sellBy), color: sellBy ? 'var(--amber)' : 'var(--text2)' },
      ] });
    },
  },
  {
    key: 'draft-capital', title: 'Draft Capital', tieClass: 4,
    relevance(ctx) {
      const pbo = ctx.picksByOwner;
      if (!pbo || !pbo[ctx.myRid]) return 0;
      let s = 15;
      if (ctx.phase === 'pre_draft' || ctx.phase === 'draft_week') s += 40;
      const counts = (ctx.S.rosters || []).map(r => (pbo[r.roster_id] || []).length).sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)] || 0;
      if ((pbo[ctx.myRid] || []).length < median) s += 15;
      return s;
    },
    render(ctx) {
      const pbo = ctx.picksByOwner, teams = (ctx.S.rosters || []).length || 12, PV = window.App?.PlayerValue;
      const pv = (y, r) => (PV && PV.getPickValue) ? (PV.getPickValue(y, r, teams) || 0) : 0;
      const mine = pbo[ctx.myRid] || [];
      const myVal = mine.reduce((s, p) => s + pv(p.year || p.season, p.round), 0);
      const rank = (ctx.S.rosters || []).filter(r => (pbo[r.roster_id] || []).reduce((s, p) => s + pv(p.year || p.season, p.round), 0) > myVal).length + 1;
      return _tcCard({ kicker: 'Draft Capital', title: Math.round(myVal).toLocaleString() + ' DHQ', rows: [
        { label: 'Future picks', value: String(mine.length) },
        { label: 'Capital rank', value: '#' + rank + ' / ' + teams },
      ] });
    },
  },
  {
    key: 'tagged-players', title: 'Your Tags', tieClass: 4,
    relevance(ctx) {
      if (!ctx.tagTotal) return 0;
      let s = 12 + Math.min(18, ctx.tagTotal * 3);
      if (ctx.tagCounts.trade && ctx.window === 'CONTENDING') s += 10;
      return s;
    },
    render(ctx) {
      const t = ctx.tagCounts, rows = [];
      if (t.trade) rows.push({ label: 'Trade Block', value: String(t.trade), color: 'var(--amber)' });
      if (t.cut) rows.push({ label: 'Cut Candidates', value: String(t.cut), color: 'var(--red)' });
      if (t.watch) rows.push({ label: 'Watch', value: String(t.watch), color: 'var(--blue)' });
      if (t.untouchable) rows.push({ label: 'Untouchables', value: String(t.untouchable), color: 'var(--green)' });
      return _tcCard({ kicker: 'Your Tags', title: ctx.tagTotal + ' tagged', rows: rows.slice(0, 3) });
    },
  },
  {
    key: 'gap-plan', title: 'Gap Plan', tieClass: 2,
    relevance(ctx) {
      const gaps = ctx.analytics?.roster?.gaps || ctx.analytics?.gaps;
      if (!gaps || !gaps.length) return 0;
      const sev = String(gaps[0].priority || gaps[0].severity || '').toLowerCase();
      let s = 18 + (ctx.panic || 0) * 6;
      if (sev === 'critical') s += 25;
      if (ctx.window === 'REBUILDING') s += 12;
      if (ctx.phase === 'pre_draft' || ctx.phase === 'draft_week') s += 10;
      return Math.min(100, s);
    },
    render(ctx) {
      const gaps = ctx.analytics?.roster?.gaps || ctx.analytics?.gaps || [];
      const top = gaps[0]; if (!top) return '';
      const sev = String(top.priority || top.severity || 'medium');
      const sevCol = /crit/i.test(sev) ? 'var(--red)' : /high/i.test(sev) ? 'var(--amber)' : 'var(--text2)';
      const gapN = Math.abs(Number(top.dhqGap ?? top.delta ?? 0));
      // Position gaps carry .pos ("Close the WR gap"); roster-construction gaps
      // (elite/starter/age/bench) carry a full .action sentence instead.
      const title = top.pos ? ('Close the ' + top.pos + ' gap')
        : top.action ? top.action
          : top.area ? ('Close the ' + top.area + ' gap')
            : (top.label || 'Close the biggest gap');
      return _tcCard({ kicker: 'Gap Plan', title, rows: [
        { label: 'Behind champions', value: gapN ? Math.round(gapN).toLocaleString() + ' ' + (top.unit || 'DHQ') : '—' },
        { label: 'Priority', value: sev.toUpperCase(), color: sevCol },
      ] });
    },
  },
  {
    key: 'rebuild-timeline', title: 'Rebuild Timeline', tieClass: 3,
    relevance(ctx) {
      if (ctx.window !== 'REBUILDING') return 0;
      const proj = ctx.analytics?.projection; if (!proj || !proj.length) return 0;
      const yrs = (ctx.analytics?.window?.years != null) ? ctx.analytics.window.years : 5;
      return 20 + (5 - Math.min(5, yrs)) * 8 + (yrs < 2 ? 20 : 0);
    },
    render(ctx) {
      const proj = ctx.analytics?.projection || [], win = ctx.analytics?.window || {};
      // FIRST projected contending year (not reversed → not the last).
      const contend = proj.find(p => /CONTEND|ELITE|PLAYOFF/i.test(p.tier || ''));
      const title = contend ? ('Contends by ' + contend.year) : 'Multi-year rebuild';
      const peak = contend ? contend.tier : (proj[proj.length - 1]?.tier || '—');
      return _tcCard({ kicker: 'Rebuild Timeline', title, rows: [
        { label: 'Window', value: win.label || ((win.years || 0) + ' yr left') },
        { label: 'Projected peak', value: peak },
      ] });
    },
  },
  {
    key: 'trade-performance', title: 'Trade Edge', tieClass: 4,
    relevance(ctx) {
      const tp = ctx.analytics?.trades?.myTradeProfile;
      if (!tp || (tp.totalTrades || 0) < 3) return 0;
      return Math.max(0, 15 + ((tp.tradeWinRate || 0.5) - 0.5) * 50 + ((tp.avgValueGained || 0) > 0 ? 15 : 0));
    },
    render(ctx) {
      const tp = ctx.analytics?.trades?.myTradeProfile || {};
      const wr = tp.tradeWinRate || 0, avg = tp.avgValueGained || 0;
      return _tcCard({ kicker: 'Trade Edge', title: (tp.tradesWon || 0) + '-' + (tp.tradesFair || 0) + '-' + (tp.tradesLost || 0) + ' record', rows: [
        { label: 'Win rate', value: Math.round(wr * 100) + '%', color: wr >= 0.55 ? 'var(--green)' : wr >= 0.4 ? 'var(--amber)' : 'var(--red)' },
        { label: 'Avg value / deal', value: (avg > 0 ? '+' : '') + Math.round(avg).toLocaleString() + ' DHQ', color: avg >= 0 ? 'var(--green)' : 'var(--red)' },
      ] });
    },
  },
  {
    key: 'leverage-board', title: 'Leverage Board', tieClass: 3,
    relevance(ctx) {
      const lev = ctx.leverage;
      if (!lev || !lev.hasValue || (!lev.buyers.length && !lev.sellers.length)) return 0;
      let s = 12;
      if (ctx.window === 'CONTENDING' && lev.buyers.length) s += 20;
      if (ctx.window === 'REBUILDING' && lev.sellers.length) s += 15;
      if (/offseason|post_draft|pre_draft/.test(ctx.phase)) s += 10;
      return s;
    },
    render(ctx) {
      const lev = ctx.leverage || { buyers: [], sellers: [] }, rows = [];
      lev.buyers.slice(0, 2).forEach(b => rows.push({ label: 'Buyer · ' + b.name, value: 'core age ' + b.wAge.toFixed(1), color: 'var(--amber)' }));
      lev.sellers.slice(0, 2).forEach(s => rows.push({ label: 'Seller · ' + s.name, value: Number.isFinite(s.picks) ? s.picks + ' picks' : 'sells vets', color: 'var(--accent)' }));
      return _tcCard({ kicker: 'Leverage Board', title: 'Who is desperate', rows: rows.slice(0, 3) });
    },
  },
];

// ── Selector ────────────────────────────────────────────────────────
// Brief-nudge: the AI/brief can boost specific card keys (additive over the
// rules baseline — never gates). seasonOnly cards are hard-filtered out of
// season so a nudge can't lift them past the floor.
let _tcNudge = new Set();
function _tcSelect(ctx, n) {
  return _TC_CATALOG
    .filter(c => !(c.seasonOnly && !ctx.inSeason))
    .map((c, i) => {
      const base = _tcSafe(() => c.relevance(ctx)) || 0;
      // Nudge AMPLIFIES a relevant card (base > 0); it never resurrects a card
      // the rules hid (base 0 — e.g. tagged-players with no tags).
      return { c, i, score: base > 0 ? base + (_tcNudge.has(c.key) ? 25 : 0) : 0 };
    })
    .filter(x => x.score >= 20)
    .sort((a, b) => (b.score - a.score) || ((a.c.tieClass || 5) - (b.c.tieClass || 5)) || (a.i - b.i))
    .slice(0, n)
    .map(x => x.c);
}

function _tcRenderPanel(ctx) {
  if (!ctx || !ctx.me) return '';
  // The adaptive analysis panel is the app doing the analysis for you → Scout Pro.
  if (typeof window.isScoutPro === 'function' && !window.isScoutPro()) return '';
  const n = (window.innerWidth >= 900) ? 3 : 2;
  const cards = _tcSafe(() => _tcSelect(ctx, n)) || [];
  if (!cards.length) return '';
  const body = cards.map(c => _tcSafe(() => c.render(ctx)) || '').filter(Boolean).join('');
  return body ? `<section class="scout-adaptive-rail">${body}</section>` : '';
}

// ── AI layer ────────────────────────────────────────────────────────
// Chat-summon: map a user phrase to a card key so the chat can render any
// catalog card inline ("show me my draft capital").
const _TC_ALIASES = [
  ['draft-capital', ['draft capital', 'my picks', 'pick capital', 'draft pick', 'draft board', 'draft target', 'rookie draft', 'map your rookie']],
  ['leverage-board', ['leverage', 'who is buying', 'who is selling', 'buyers and sellers', 'trade partner', 'win-now', 'teams are buying', 'aging asset', 'convert to pick']],
  ['gap-plan', ['gap plan', 'my gaps', 'close the gap', 'behind champ', 'champion gap', 'rebuild gap', 'biggest gap', 'secondary gap', 'below league']],
  ['power-rankings', ['power rank', 'my rank', 'league rank', 'standings']],
  ['coverage-grades', ['coverage', 'position grade', 'room grade', 'weakest room', 'group dhq is below']],
  ['window-cliff', ['window cliff', 'age window', 'my window', 'age cliff', 'contention window']],
  ['roster-pulse', ['roster pulse', 'team health', 'my health', 'roster health']],
  ['rebuild-timeline', ['rebuild timeline', 'when do i contend', 'rebuild window']],
  ['trade-performance', ['trade record', 'trade edge', 'my trade history', 'trade performance']],
  ['tagged-players', ['my tags', 'tagged player', 'trade block', 'cut candidate', 'watch list', 'untouchable']],
];
function _tcMatchCardKey(text) {
  const t = (text || '').toLowerCase();
  for (const [key, phrases] of _TC_ALIASES) { if (phrases.some(p => t.includes(p))) return key; }
  return null;
}
function _tcRenderCard(key, ctx) {
  // Same gate as _tcRenderPanel — the summon-from-chat path is Scout Pro too, so a
  // free user can't pull the adaptive analysis cards (incl. reads of other teams).
  if (typeof window.isScoutPro === 'function' && !window.isScoutPro()) return '';
  const c = _TC_CATALOG.find(x => x.key === key);
  return (c && ctx) ? (_tcSafe(() => c.render(ctx)) || '') : '';
}

window.TodayCards = {
  buildCtx: (S, roster, league, phase, assessment) => _tcSafe(() => _tcBuildCtx(S, roster, league, phase, assessment)),
  renderPanel: ctx => _tcSafe(() => _tcRenderPanel(ctx)) || '',
  matchCardKey: _tcMatchCardKey,
  renderCard: (key, ctx) => _tcSafe(() => _tcRenderCard(key, ctx)) || '',
  setNudge: keys => { _tcNudge = new Set(Array.isArray(keys) ? keys : []); },
  _catalog: _TC_CATALOG,
};
