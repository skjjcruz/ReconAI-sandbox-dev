// ═══════════════════════════════════════════════════════════════
// trade-calc.js — Full Trade Calculator Module for War Room Scout
// Ported from War Room's trade-calculator.html into vanilla JS
// Uses window.App global namespace (Plan B)
// ═══════════════════════════════════════════════════════════════
// Globals expected: S, LI, LI_LOADED, $, pName, pNameShort, pPos,
//   pAge, pTeam, pM, myR, getUser, dynastyValue, pickValue,
//   tradeValueTier, posClass, fullTeam, showToast, copyText,
//   openPlayerModal, switchTab
// ═══════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Co-owner-safe "is this my roster?" helper ──────────────────
function _isMyRoster(rosterId) {
  if (rosterId === S.myRosterId) return true;
  const uid = S.user?.user_id;
  if (!uid) return false;
  const r = S.rosters?.find(r => r.roster_id === rosterId);
  return r ? (r.owner_id === uid || (r.co_owners || []).includes(uid)) : false;
}

function _tcLI() {
  return window.App?.LI || window.LI || {};
}

function _tcLILoaded() {
  return Boolean(window.App?.LI_LOADED || window.LI_LOADED);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 1: Constants & DNA System
// ═══════════════════════════════════════════════════════════════

const DNA_TYPES = {
  NONE:      { label: '-- Not Set --', color: 'var(--text3)', mult: 1.0,  desc: '' },
  FLEECER:   { label: 'Fleecer',      color: '#E74C3C',      mult: 0.85, desc: 'Hunts asymmetric value, lowballs, will counter' },
  DOMINATOR: { label: 'Dominator',     color: '#D4AF37',      mult: 0.75, desc: 'High ego, needs +30% perceived margin' },
  STALWART:  { label: 'Stalwart',      color: '#2ECC71',      mult: 1.0,  desc: 'Prefers 1-for-1 fair laterals' },
  ACCEPTOR:  { label: 'Acceptor',      color: '#45B7D1',      mult: 1.15, desc: 'Low attachment, sells for futures' },
  DESPERATE: { label: 'Desperate',     color: '#F0A500',      mult: 1.3,  desc: 'Overpays for immediate help' },
};

// Pick value resolution: DHQ engine → getIndustryPickValue → hardcoded fallback
function getPickDHQ(round, totalTeams) {
  // Use DHQ engine pick values if available
  if (window.App?.LI?.dhqPickValues) {
    const pick = (round - 1) * (totalTeams || 16) + Math.ceil((totalTeams || 16) / 2); // mid-round estimate
    return window.App.LI.dhqPickValues[pick]?.value || 0;
  }
  // Fallback to universal model (pick-value-model.js, always loaded)
  const teams = totalTeams || 16;
  return getIndustryPickValue((round - 1) * teams + Math.ceil(teams / 2), teams, 7);
}
// Legacy constant — now dynamically resolved via getPickDHQ at call sites.
// Kept as static object for backward compat with Object.assign exports.
const TRADE_PICK_VALUES = { 1: 7500, 2: 3000, 3: 1000, 4: 300, 5: 80, 6: 30, 7: 10 };

// DEPTH_POSITIONS — defined in shared/utils.js (window.DEPTH_POSITIONS)

// ── Dynamic builders — derive from league roster_positions ──

function buildIdealRoster(rosterPositions) {
  const rp = rosterPositions || [];
  const ideal = {};
  const posCount = {};
  rp.forEach(slot => {
    const norm = normPos(slot);
    if (['BN','IR','TAXI'].includes(slot)) return;
    if (!posCount[norm]) posCount[norm] = 0;
    posCount[norm]++;
  });
  Object.entries(posCount).forEach(([pos, count]) => {
    ideal[pos] = Math.max(count, Math.ceil(count * 1.5));
  });
  return ideal;
}

function buildMinStarterQuality(rosterPositions) {
  const rp = rosterPositions || [];
  const msq = {};
  const slots = {};
  rp.forEach(slot => {
    if (['BN','IR','TAXI'].includes(slot)) return;
    const n = normPos(slot);
    if (['QB','RB','WR','TE','K','DEF','DL','LB','DB'].includes(n)) {
      slots[n] = (slots[n] || 0) + 1;
    } else if (slot === 'FLEX') { slots.RB = (slots.RB||0)+0.4; slots.WR = (slots.WR||0)+0.4; slots.TE = (slots.TE||0)+0.2; }
    else if (slot === 'SUPER_FLEX') { slots.QB = (slots.QB||0)+0.5; slots.RB = (slots.RB||0)+0.25; slots.WR = (slots.WR||0)+0.25; }
    else if (slot === 'IDP_FLEX') { slots.DL = (slots.DL||0)+0.35; slots.LB = (slots.LB||0)+0.35; slots.DB = (slots.DB||0)+0.3; }
    else if (slot === 'REC_FLEX') { slots.WR = (slots.WR||0)+0.5; slots.TE = (slots.TE||0)+0.5; }
  });
  Object.entries(slots).forEach(([pos, count]) => {
    const rounded = Math.max(1, Math.round(count));
    msq[pos] = Math.max(rounded, Math.ceil(rounded * 1.3));
  });
  return msq;
}

function buildPosWeights(rosterPositions) {
  const base = { QB: 14, RB: 14, WR: 14, TE: 8, K: 3, DL: 13, LB: 10, DB: 12 };
  const rp = rosterPositions || [];
  const hasPos = new Set();
  rp.forEach(slot => {
    const n = normPos(slot);
    if (['QB','RB','WR','TE','K','DEF','DL','LB','DB'].includes(n)) hasPos.add(n);
    if (slot === 'FLEX') { hasPos.add('RB'); hasPos.add('WR'); hasPos.add('TE'); }
    if (slot === 'SUPER_FLEX') { hasPos.add('QB'); hasPos.add('RB'); hasPos.add('WR'); hasPos.add('TE'); }
    if (slot === 'IDP_FLEX') { hasPos.add('DL'); hasPos.add('LB'); hasPos.add('DB'); }
  });
  const weights = {};
  hasPos.forEach(pos => { if (base[pos]) weights[pos] = base[pos]; });
  return weights;
}

function buildNflStarterPool(totalTeams) {
  const t = totalTeams || 12;
  return { QB: t, RB: Math.round(t*2.5), WR: Math.round(t*4), TE: t, K: t, DL: Math.round(t*4), LB: Math.round(t*4), DB: Math.round(t*4) };
}

// Draft pick horizon and rounds
const PICK_HORIZON  = 3;
const DRAFT_ROUNDS  = 5;
const PICK_IDEAL    = PICK_HORIZON * DRAFT_ROUNDS;  // 15 picks across 3 years

// FAAB conversion rate ($ to value)
const FAAB_RATE = 0.5;

// Posture definitions
const POSTURES = {
  DESPERATE: { key: 'DESPERATE', label: 'Desperate',     color: '#BB8FCE', desc: 'Panic-mode -- will overpay for immediate help.' },
  BUYER:     { key: 'BUYER',     label: 'Active Buyer',  color: '#F0A500', desc: 'Contender upgrading -- open to deals, fair value required.' },
  NEUTRAL:   { key: 'NEUTRAL',   label: 'Neutral',       color: '#95A5A6', desc: 'No strong directional push. Fair offers only.' },
  SELLER:    { key: 'SELLER',    label: 'Active Seller', color: '#5DADE2', desc: 'Moving assets for futures. Buy at a discount.' },
  LOCKED:    { key: 'LOCKED',    label: 'Locked In',     color: '#7F8C8D', desc: 'Satisfied roster, high attachment. Very hard to move.' },
};

// normPos — defined in shared/utils.js (window.normPos), returns null for unknown positions

// ═══════════════════════════════════════════════════════════════
// SECTION 2: Team Assessment
// ═══════════════════════════════════════════════════════════════

/**
 * Build the NFL starter set — rank all players by dynasty value (or season pts),
 * take top N per position. Returns { pos: Set<pid> }
 */
function buildNflStarterSet(nflStarterPool) {
  const pool = nflStarterPool || buildNflStarterPool((S.rosters || []).length);
  const nflStarterSet = {};
  const li = _tcLI();
  const scoreMap = (_tcLILoaded() && li.playerScores) ? li.playerScores : (window.App?.LI?.playerScores || null);
  const sourceIds = scoreMap ? Object.keys(scoreMap) : Object.keys(S.players || {});
  DEPTH_POSITIONS.forEach(pos => {
    const poolSize = pool[pos] || 32;
    const allAtPos = [];
    sourceIds.forEach(pid => {
      const p = S.players[pid]; if (!p) return;
      if (normPos(p.position) !== pos) return;
      if (!p.team) return;
      // Prefer dynasty value; fall back to season stats
      const val = scoreMap?.[pid] || dynastyValue(pid);
      const pts = val > 0 ? val : (S.playerStats?.[pid]?.seasonTotal || S.playerStats?.[pid]?.prevTotal || 0);
      if (pts > 0) allAtPos.push({ pid, pts });
    });
    allAtPos.sort((a, b) => b.pts - a.pts);
    nflStarterSet[pos] = new Set(allAtPos.slice(0, poolSize).map(p => p.pid));
  });
  return nflStarterSet;
}

/**
 * True once every draft for the given season has completed — the signal that
 * "the draft is over", so that season's picks are spent and must drop off the
 * trade calculator. Requires at least one draft so "no drafts yet" is never read
 * as complete, and every() so a rookie+supplemental pair doesn't drop the year
 * while one is still pending.
 */
function currentSeasonDraftComplete(curYear) {
  const drafts = (S.drafts || []).filter(d => parseInt(d.season) === curYear);
  return drafts.length > 0 && drafts.every(d => String(d.status || '').toLowerCase() === 'complete');
}

/**
 * The tradeable pick window — the next PICK_HORIZON draft seasons, rolled
 * forward past any season whose draft has already finished (e.g. after the 2026
 * draft completes: 2027/2028/2029 instead of 2026/2027/2028).
 */
function tradeablePickYears(curYear) {
  const start = curYear + (currentSeasonDraftComplete(curYear) ? 1 : 0);
  return Array.from({ length: PICK_HORIZON }, (_, i) => start + i);
}

/**
 * Build picks owned by each roster — returns { rosterId: [{year, round, originalOwnerRid}] }
 */
function buildPicksByOwner() {
  const league = S.leagues.find(l => l.league_id === S.currentLeagueId);
  const draftRounds = league?.settings?.draft_rounds || DRAFT_ROUNDS;
  const curYear = parseInt(S.season) || new Date().getFullYear();
  const years = tradeablePickYears(curYear);
  const allTP = S.tradedPicks || [];
  const result = {};

  (S.rosters || []).forEach(r => {
    const rid = r.roster_id;
    result[rid] = [];
    years.forEach(yr => {
      for (let rd = 1; rd <= draftRounds; rd++) {
        // Check if this pick was traded away
        const tradedAway = allTP.find(p =>
          parseInt(p.season) === yr && p.round === rd &&
          p.roster_id === rid && p.owner_id !== rid
        );
        if (!tradedAway) {
          // Own original pick
          result[rid].push({ year: yr, round: rd, originalOwnerRid: rid });
        }
        // Check for acquired picks
        const acquired = allTP.filter(p =>
          parseInt(p.season) === yr && p.round === rd &&
          p.owner_id === rid && p.roster_id !== rid
        );
        acquired.forEach(p => {
          result[rid].push({ year: yr, round: rd, originalOwnerRid: p.roster_id });
        });
      }
    });
  });
  return result;
}

/**
 * Calculate optimal lineup PPG for a roster
 */
function calcOptimalPPG(rosterPids) {
  const league = S.leagues.find(l => l.league_id === S.currentLeagueId);
  const rp = league?.roster_positions || [];
  const slotCounts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0, DL: 0, LB: 0, DB: 0, IDP_FLEX: 0 };
  rp.forEach(s => {
    if (s === 'DE' || s === 'DT') slotCounts.DL++;
    else if (s === 'CB' || s === 'S') slotCounts.DB++;
    else if (s in slotCounts) slotCounts[s]++;
    else if (s === 'REC_FLEX') slotCounts.FLEX++;
    else if (s === 'BN' || s === 'IR' || s === 'TAXI') { /* skip */ }
    else slotCounts.FLEX++;
  });

  const byPos = {};
  (rosterPids || []).forEach(pid => {
    const rawPos = pPos(pid); const pos = normPos(rawPos);
    const ppg = S.playerStats?.[pid]?.seasonAvg || S.playerStats?.[pid]?.prevAvg || 0;
    if (ppg <= 0) return;
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push({ pid, ppg, pos });
  });
  Object.values(byPos).forEach(arr => arr.sort((a, b) => b.ppg - a.ppg));

  const used = new Set();
  let total = 0;

  ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K', 'DEF'].forEach(pos => {
    const need = slotCounts[pos] || 0;
    const avail = byPos[pos] || [];
    for (let i = 0; i < need && i < avail.length; i++) {
      total += avail[i].ppg; used.add(avail[i].pid);
    }
  });

  const flexPool = ['RB', 'WR', 'TE'].flatMap(pos => (byPos[pos] || []).filter(p => !used.has(p.pid))).sort((a, b) => b.ppg - a.ppg);
  for (let i = 0; i < (slotCounts.FLEX || 0) && i < flexPool.length; i++) {
    total += flexPool[i].ppg; used.add(flexPool[i].pid);
  }

  const sfPool = ['QB', 'RB', 'WR', 'TE'].flatMap(pos => (byPos[pos] || []).filter(p => !used.has(p.pid))).sort((a, b) => b.ppg - a.ppg);
  for (let i = 0; i < (slotCounts.SUPER_FLEX || 0) && i < sfPool.length; i++) {
    total += sfPool[i].ppg; used.add(sfPool[i].pid);
  }

  const idpPool = ['DL', 'LB', 'DB'].flatMap(pos => (byPos[pos] || []).filter(p => !used.has(p.pid))).sort((a, b) => b.ppg - a.ppg);
  for (let i = 0; i < (slotCounts.IDP_FLEX || 0) && i < idpPool.length; i++) {
    total += idpPool[i].ppg; used.add(idpPool[i].pid);
  }

  return +total.toFixed(1);
}

/**
 * Assess a single team. Returns a full assessment object.
 */
function assessTeam(roster, nflStarterSet, ownerPicks, dynamicConfig) {
  const _cfg = dynamicConfig || {};
  const league = S.leagues.find(l => l.league_id === S.currentLeagueId);
  const IDEAL_ROSTER = _cfg.idealRoster || buildIdealRoster(league?.roster_positions);
  const MIN_STARTER_QUALITY = _cfg.minStarterQuality || buildMinStarterQuality(league?.roster_positions);
  const POS_WEIGHTS = _cfg.posWeights || buildPosWeights(league?.roster_positions);
  const TOTAL_WEIGHT = Object.values(POS_WEIGHTS).reduce((a, b) => a + b, 0);
  const WEEKLY_TARGET = _cfg.weeklyTarget || 150;
  const leaguePositions = new Set(Object.keys(POS_WEIGHTS));
  const users = S.leagueUsers || [];
  const user = users.find(u => u.user_id === roster.owner_id);
  const teamName  = user?.metadata?.team_name || `Team ${roster.roster_id}`;
  const ownerName = user?.display_name || `Owner ${roster.roster_id}`;
  const avatar    = user?.avatar || null;

  const wins   = roster.settings?.wins   || 0;
  const losses = roster.settings?.losses || 0;
  const ties   = roster.settings?.ties   || 0;
  const pf     = Number(roster.settings?.fpts || 0) + Number(roster.settings?.fpts_decimal || 0) / 100;

  const waiverBudget  = Number(league?.settings?.waiver_budget || 100);
  const waiverUsed    = Number(roster.settings?.waiver_budget_used || 0);
  const faabRemaining = Math.max(0, waiverBudget - waiverUsed);

  // Group players by normalized position
  const posGroups = {};
  for (const id of (roster.players || [])) {
    const np = normPos(S.players[id]?.position);
    if (!np) continue;
    if (!posGroups[np]) posGroups[np] = [];
    posGroups[np].push(id);
  }

  // Assess each position — only positions that exist in the league
  const posAssessment = {};
  for (const [pos, ideal] of Object.entries(IDEAL_ROSTER)) {
    if (!leaguePositions.has(pos)) continue; // skip positions not in this league
    const playerIds   = posGroups[pos] || [];
    const startingReq = MIN_STARTER_QUALITY[pos] || 1;
    const actual      = playerIds.length;
    const diff        = actual - ideal;

    // NFL-starter count
    const posStarters   = nflStarterSet[pos] || new Set();
    const nflStarterIds = playerIds.filter(id => posStarters.has(id));
    const nflStarters   = nflStarterIds.length;
    const minQuality    = MIN_STARTER_QUALITY[pos] || startingReq;

    // Projected PPG from starters
    const withPPG = playerIds
      .map(id => ({ id, ppg: S.playerStats?.[id]?.seasonAvg || S.playerStats?.[id]?.prevAvg || 0 }))
      .sort((a, b) => b.ppg - a.ppg);
    const projectedPts = withPPG.slice(0, startingReq).reduce((s, p) => s + p.ppg, 0);

    // Status determination — dynamic based on minQuality from league config
    let status;
    if (nflStarters === 0) {
      status = 'deficit';
    } else if (nflStarters < minQuality) {
      status = 'thin';
    } else if (nflStarters >= minQuality && actual >= ideal) {
      status = 'surplus';
    } else {
      status = 'ok';
    }

    // Depth override
    if ((status === 'ok' || status === 'surplus') && actual < ideal) {
      status = 'thin';
    }

    // Sort display order by dynasty value
    const sortedIds = [...playerIds]
      .map(id => ({ id, score: dynastyValue(id) }))
      .sort((a, b) => b.score - a.score)
      .map(p => p.id);

    posAssessment[pos] = { actual, ideal, diff, nflStarters, nflStarterIds, sortedIds, startingReq, minQuality, projectedPts, status };
  }

  // Draft picks assessment
  const leagueSeason = parseInt(league?.season || new Date().getFullYear());
  const draftRounds  = league?.settings?.draft_rounds || DRAFT_ROUNDS;
  const pickYears    = tradeablePickYears(leagueSeason).map(String);

  const pickCountByRound     = {};
  const pickCountByYear      = {};
  const pickCountByYearRound = {};
  for (let r = 1; r <= draftRounds; r++) pickCountByRound[r] = 0;
  for (const year of pickYears) {
    pickCountByYear[year] = 0;
    pickCountByYearRound[year] = {};
    for (let r = 1; r <= draftRounds; r++) pickCountByYearRound[year][r] = 0;
  }
  const myPicks = ownerPicks || [];
  for (const { year, round } of myPicks) {
    const y = String(year);
    if (!pickYears.includes(y)) continue;
    if (round < 1 || round > draftRounds) continue;
    pickCountByRound[round] = (pickCountByRound[round] || 0) + 1;
    pickCountByYear[y] = (pickCountByYear[y] || 0) + 1;
    if (pickCountByYearRound[y]) pickCountByYearRound[y][round] = (pickCountByYearRound[y][round] || 0) + 1;
  }
  const totalPicks    = Object.values(pickCountByRound).reduce((a, b) => a + b, 0);
  const roundsMissing = Object.values(pickCountByRound).filter(c => c === 0).length;
  const pickIdeal     = PICK_HORIZON * draftRounds;
  let picksStatus;
  if      (totalPicks === 0)       picksStatus = 'deficit';
  else if (totalPicks < pickIdeal) picksStatus = 'thin';
  else if (totalPicks === pickIdeal) picksStatus = 'ok';
  else                              picksStatus = 'surplus';
  const picksAssessment = { pickCountByRound, pickCountByYear, pickCountByYearRound, totalPicks, draftRounds, idealTotal: pickIdeal, pickYears, roundsMissing, status: picksStatus };

  // Optimal weekly scoring
  const weeklyPts = calcOptimalPPG(roster.players || []);

  // Health score: 60% scoring + 40% coverage
  const scoringScore = Math.min(60, (weeklyPts / WEEKLY_TARGET) * 60);
  let coverageScore  = 0;
  const hasValueData = Object.keys(nflStarterSet).length > 0;
  for (const [pos, data] of Object.entries(posAssessment)) {
    const ratio = hasValueData
      ? Math.min(1, data.nflStarters / (data.minQuality || data.startingReq || 1))
      : Math.min(1, data.actual / data.ideal);
    coverageScore += ratio * ((POS_WEIGHTS[pos] || 0) / TOTAL_WEIGHT) * 40;
  }
  const projBonus   = weeklyPts > WEEKLY_TARGET + 10 ? 3 : weeklyPts >= WEEKLY_TARGET ? 1 : 0;
  const healthScore = Math.min(100, Math.round(scoringScore + coverageScore + projBonus));

  // Tier classification. Do not call assessTeamFromGlobal inside the all-team pass:
  // that helper rebuilds league-wide indexes and can lock the mobile Studio on load.
  let tier, tierColor, tierBg;
  const _sharedAssess = _cfg.sharedAssessmentsByRosterId?.[roster.roster_id] || null;
  if (_sharedAssess?.tier) {
    tier = _sharedAssess.tier;
    tierColor = _sharedAssess.tierColor || '#95A5A6';
    tierBg = _sharedAssess.tierBg || 'transparent';
  } else if (weeklyPts > 0) {
    if      (weeklyPts > WEEKLY_TARGET + 10)   { tier = 'ELITE';      tierColor = '#D4AF37'; tierBg = 'rgba(212,175,55,0.15)'; }
    else if (weeklyPts >= WEEKLY_TARGET - 15)   { tier = 'CONTENDER';  tierColor = '#2ECC71'; tierBg = 'rgba(46,204,113,0.12)'; }
    else if (weeklyPts >= WEEKLY_TARGET * 0.85) { tier = 'CROSSROADS'; tierColor = '#F0A500'; tierBg = 'rgba(240,165,0,0.12)'; }
    else                                         { tier = 'REBUILDING'; tierColor = '#E74C3C'; tierBg = 'rgba(231,76,60,0.12)'; }
  } else {
    if      (coverageScore >= 36) { tier = 'CONTENDER';  tierColor = '#2ECC71'; tierBg = 'rgba(46,204,113,0.12)'; }
    else if (coverageScore >= 26) { tier = 'CROSSROADS'; tierColor = '#F0A500'; tierBg = 'rgba(240,165,0,0.12)'; }
    else                           { tier = 'REBUILDING'; tierColor = '#E74C3C'; tierBg = 'rgba(231,76,60,0.12)'; }
  }

  // Panic meter (0-5)
  let panic = 0;
  if      (weeklyPts > 0 && weeklyPts < WEEKLY_TARGET * 0.85) panic += 2;
  else if (weeklyPts > 0 && weeklyPts < WEEKLY_TARGET)        panic += 1;
  const criticals = Object.values(posAssessment).filter(p => p.status === 'deficit').length;
  if      (criticals >= 3) panic += 2;
  else if (criticals >= 1) panic += 1;
  const played = wins + losses + ties;
  if (played > 0 && losses / played > 0.6) panic += 1;
  panic = Math.min(5, panic);

  // Trade window
  let tradeWindow;
  if      (tier === 'ELITE' || (tier === 'CONTENDER' && panic <= 1)) tradeWindow = 'CONTENDING';
  else if (tier === 'REBUILDING')                                     tradeWindow = 'REBUILDING';
  else                                                                tradeWindow = 'TRANSITIONING';

  const needs = Object.entries(posAssessment)
    .filter(([, v]) => v.status === 'deficit' || v.status === 'thin')
    .sort((a, b) => {
      const aGap = a[1].nflStarters - a[1].startingReq;
      const bGap = b[1].nflStarters - b[1].startingReq;
      return aGap !== bGap ? aGap - bGap : a[1].diff - b[1].diff;
    })
    .map(([pos, v]) => ({ pos, urgency: v.status }));

  const strengths = Object.entries(posAssessment)
    .filter(([, v]) => v.status === 'surplus')
    .map(([pos]) => pos);

  return {
    rosterId: roster.roster_id, ownerId: roster.owner_id,
    teamName, ownerName, avatar,
    wins, losses, ties, pf,
    posGroups, posAssessment, picksAssessment,
    weeklyPts, healthScore,
    tier, tierColor, tierBg,
    panic, window: tradeWindow,
    needs, strengths,
    faabRemaining, waiverBudget,
  };
}

/**
 * Assess ALL teams in the league. Returns array of assessments.
 */
function assessAllTeams() {
  const league = S.leagues.find(l => l.league_id === S.currentLeagueId);
  const rosterPositions = league?.roster_positions || [];
  const totalTeams = (S.rosters || []).length;
  const nflStarterPool = buildNflStarterPool(totalTeams);
  const nflStarterSet = buildNflStarterSet(nflStarterPool);
  const picksByOwner  = buildPicksByOwner();

  // Compute WEEKLY_TARGET from league data — median of all teams' optimal PPG
  const allPPGs = (S.rosters || []).map(r => calcOptimalPPG(r.players || [])).filter(v => v > 0);
  const WEEKLY_TARGET_DYN = allPPGs.length ? allPPGs.sort((a,b) => a-b)[Math.floor(allPPGs.length/2)] * 1.05 : 150;

  // Build dynamic config from league settings
  const dynamicConfig = {
    idealRoster: buildIdealRoster(rosterPositions),
    minStarterQuality: buildMinStarterQuality(rosterPositions),
    posWeights: buildPosWeights(rosterPositions),
    weeklyTarget: WEEKLY_TARGET_DYN,
  };

  return (S.rosters || []).map(r => {
    const ownerPicks = picksByOwner[r.roster_id] || [];
    return assessTeam(r, nflStarterSet, ownerPicks, dynamicConfig);
  });
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: Trade Partner Matching
// ═══════════════════════════════════════════════════════════════

/**
 * Score 0-100 compatibility between two team assessments
 */
function calcComplementarity(mine, theirs) {
  if (!mine || !theirs) return 0;
  let score = 0;
  for (const n of mine.needs) {
    const t = theirs.posAssessment[n.pos];
    if (t?.status === 'surplus') score += n.urgency === 'deficit' ? 25 : 12;
    else if (t?.status === 'ok' && n.urgency === 'deficit') score += 6;
  }
  for (const n of theirs.needs) {
    const m = mine.posAssessment[n.pos];
    if (m?.status === 'surplus') score += n.urgency === 'deficit' ? 25 : 12;
    else if (m?.status === 'ok' && n.urgency === 'deficit') score += 6;
  }
  if (mine.window !== theirs.window) score += 15;
  return Math.min(100, score);
}

/**
 * Find best trade partners, sorted by compatibility descending
 */
function findBestPartners(myAssessment, allAssessments) {
  if (!myAssessment) return [];
  return allAssessments
    .filter(a => a.rosterId !== myAssessment.rosterId)
    .map(a => ({
      assessment: a,
      compatibility: calcComplementarity(myAssessment, a),
      theyProvide: myAssessment.needs
        .filter(n => {
          const t = a.posAssessment[n.pos];
          return t?.status === 'surplus' || t?.status === 'ok';
        })
        .map(n => n.pos),
      iProvide: a.needs
        .filter(n => {
          const m = myAssessment.posAssessment[n.pos];
          return m?.status === 'surplus' || m?.status === 'ok';
        })
        .map(n => n.pos),
    }))
    .sort((a, b) => b.compatibility - a.compatibility);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: Owner DNA & Psychology
// ═══════════════════════════════════════════════════════════════

/**
 * Determine owner posture based on assessment and DNA
 */
function calcOwnerPosture(assessment, dnaKey) {
  if (!assessment) return POSTURES.NEUTRAL;
  const { tier, panic } = assessment;
  if (panic >= 4)                                                      return POSTURES.DESPERATE;
  if (tier === 'REBUILDING' || dnaKey === 'ACCEPTOR')                  return POSTURES.SELLER;
  if (tier === 'ELITE' && panic <= 1)                                  return POSTURES.LOCKED;
  if ((tier === 'CONTENDER' || tier === 'CROSSROADS') && panic >= 2)   return POSTURES.BUYER;
  return POSTURES.NEUTRAL;
}

/**
 * Calculate psychological tax modifiers (8 factors)
 * Returns array of { name, impact, type:'TAX'|'BONUS', desc }
 */
function calcPsychTaxes(myAssessment, theirAssessment, theirDnaKey, theirPosture) {
  const taxes = [];

  // 1 - Endowment Effect
  const ePct = { FLEECER: 10, DOMINATOR: 28, STALWART: 20, ACCEPTOR: 5, DESPERATE: 15, NONE: 12 }[theirDnaKey] || 12;
  taxes.push({
    name: 'Endowment Effect', impact: -Math.round(ePct / 2), type: 'TAX',
    desc: `~${ePct}% mental inflation on their own players. Their side feels worth more than market.`
  });

  // 2 - Panic Premium
  if (theirAssessment?.panic >= 3) {
    taxes.push({
      name: 'Panic Premium', impact: 8 + (theirAssessment.panic - 2) * 6, type: 'BONUS',
      desc: `Panic ${theirAssessment.panic}/5 -- urgency overrides normal caution.`
    });
  }

  // 3 - Status Tax (Dominator)
  if (theirDnaKey === 'DOMINATOR') {
    taxes.push({
      name: 'Status Tax', impact: -18, type: 'TAX',
      desc: 'Must visibly win the trade for ego/status. Frame it so they feel like the winner.'
    });
  }

  // 4 - Loss Aversion (Stalwart, Dominator)
  if (['STALWART', 'DOMINATOR'].includes(theirDnaKey)) {
    taxes.push({
      name: 'Loss Aversion', impact: -8, type: 'TAX',
      desc: 'Losing a familiar player hurts more than gaining a new one. Expect resistance.'
    });
  }

  // 5 - Rebuilding Discount (Acceptor)
  if (theirDnaKey === 'ACCEPTOR') {
    taxes.push({
      name: 'Rebuilding Discount', impact: +10, type: 'BONUS',
      desc: 'They mentally discount current starters. Buy at a discount in their mind.'
    });
  }

  // 6 - Need Fulfillment
  const myStrengths  = myAssessment?.strengths || [];
  const theirNeedPos = theirAssessment?.needs?.slice(0, 3).map(n => n.pos) || [];
  if (theirNeedPos.some(p => myStrengths.includes(p))) {
    taxes.push({
      name: 'Need Fulfillment', impact: +12, type: 'BONUS',
      desc: 'Your surplus fills their critical positional gap -- strong deal motivation.'
    });
  }

  // 7 - Trade Window alignment
  if (myAssessment && theirAssessment) {
    if (myAssessment.window !== theirAssessment.window) {
      taxes.push({
        name: 'Window Alignment', impact: +8, type: 'BONUS',
        desc: 'Opposite windows (contender vs rebuilder) = natural asset exchange.'
      });
    } else {
      taxes.push({
        name: 'Window Friction', impact: -5, type: 'TAX',
        desc: 'Same trade window reduces natural motivation to exchange assets.'
      });
    }
  }

  // 8 - Posture
  if (theirPosture?.key === 'LOCKED') {
    taxes.push({
      name: 'Locked Roster Tax', impact: -12, type: 'TAX',
      desc: 'High satisfaction + attachment. Roster moves feel threatening to them.'
    });
  } else if (theirPosture?.key === 'SELLER') {
    taxes.push({
      name: 'Seller Momentum', impact: +10, type: 'BONUS',
      desc: 'Actively shopping. Trade conversations are welcomed.'
    });
  }

  return taxes;
}

/**
 * Derive DNA from trade history (LI.ownerProfiles enriched data)
 * Returns { key: string, confidence: number (0-1) } or null if insufficient data (<3 trades)
 */
function deriveDNAFromHistory(rosterId) {
  const li = _tcLI();
  const profile = _tcLILoaded() && li.ownerProfiles?.[rosterId];
  if (!profile || profile.trades < 3) return null;

  const { trades, tradesWon, tradesLost, tradesFair, picksAcquired, picksSold, weekTiming } = profile;
  const pickBuyer  = picksAcquired > picksSold * 1.5;
  const pickSeller = picksSold > picksAcquired * 1.5;
  const totalTeams = S.rosters?.length || 12;
  const avgTrades  = (li.leagueTradeTendencies?.totalTrades || 0) / totalTeams;
  // Top 25% by trade count = above 75th percentile
  const allCounts  = Object.values(li.ownerProfiles || {}).map(p => p.trades).sort((a, b) => a - b);
  const p75        = allCounts[Math.floor(allCounts.length * 0.75)] || avgTrades;
  const highVolume = trades >= p75 && trades >= 3;
  const lowVolume  = trades <= Math.max(1, avgTrades * 0.4);

  // Assessment for panic / tier check
  const assessment = _tcAssessments?.find(a => a.rosterId === rosterId);
  const isRebuilding = assessment?.tier === 'REBUILDING';
  const highPanic    = (assessment?.panic || 0) >= 3;
  const lateSeason   = (weekTiming?.late || 0) > (weekTiming?.early || 0);

  // Score each archetype (0-1 range per factor, then averaged)
  const scores = {};

  // FLEECER: tradesWon > tradesLost*2 AND trades >= 3
  if (tradesWon > tradesLost * 2 && trades >= 3) {
    let c = 0.6;
    c += Math.min(0.2, (tradesWon - tradesLost * 2) / trades * 0.4); // margin above threshold
    if (pickSeller) c += 0.1;  // pick sellers lean dominator/win-now
    if (trades >= 5) c += 0.1; // more data = more confidence
    scores.FLEECER = Math.min(1, c);
  }

  // DOMINATOR: tradesWon > tradesLost AND highVolume
  if (tradesWon > tradesLost && highVolume) {
    let c = 0.55;
    c += Math.min(0.15, (tradesWon - tradesLost) / trades * 0.3);
    if (pickSeller) c += 0.15; // selling picks = win-now posture
    if (trades >= p75 * 1.3) c += 0.1; // well above volume threshold
    scores.DOMINATOR = Math.min(1, c);
  }

  // STALWART: tradesFair >= trades*0.5 AND trades >= 3
  if (tradesFair >= trades * 0.5 && trades >= 3) {
    let c = 0.5;
    c += Math.min(0.25, (tradesFair / trades - 0.5) * 1.0); // how far above 50% fair
    if (!pickBuyer && !pickSeller) c += 0.1; // balanced pick activity
    if (trades >= 5) c += 0.1;
    scores.STALWART = Math.min(1, c);
  }

  // ACCEPTOR: tradesLost > tradesWon AND pickBuyer
  if (tradesLost > tradesWon && pickBuyer) {
    let c = 0.55;
    c += Math.min(0.2, (tradesLost - tradesWon) / trades * 0.4);
    c += Math.min(0.15, (picksAcquired - picksSold * 1.5) / (picksAcquired || 1) * 0.3);
    if (isRebuilding) c += 0.1;
    scores.ACCEPTOR = Math.min(1, c);
  }

  // DESPERATE: lowVolume AND (rebuilding or high panic)
  if (lowVolume && (isRebuilding || highPanic)) {
    let c = 0.45;
    if (isRebuilding && highPanic) c += 0.2;
    else if (isRebuilding || highPanic) c += 0.1;
    if (lateSeason) c += 0.15; // late-season trades = panic
    if (tradesLost > tradesWon) c += 0.1;
    scores.DESPERATE = Math.min(1, c);
  }

  // Timing & pick modifiers — nudge existing scores
  if (lateSeason && scores.DESPERATE != null) scores.DESPERATE = Math.min(1, scores.DESPERATE + 0.1);
  if (pickBuyer) {
    if (scores.ACCEPTOR != null) scores.ACCEPTOR = Math.min(1, scores.ACCEPTOR + 0.05);
  }
  if (pickSeller) {
    if (scores.DOMINATOR != null) scores.DOMINATOR = Math.min(1, scores.DOMINATOR + 0.05);
  }

  // Pick the highest-scoring archetype
  const entries = Object.entries(scores);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { key: entries[0][0], confidence: +entries[0][1].toFixed(2) };
}


// ── DNA Persistence ──────────────────────────────────────────

const DNA_LOCAL_KEY = lid => STORAGE_KEYS.OWNER_DNA(lid);
const TC_DNA_LOAD_TIMEOUT_MS = 1200;

async function _tcAwaitWithTimeout(promise, timeoutMs, fallback, label) {
  let timerId;
  const guarded = Promise.resolve(promise).catch(e => {
    console.warn(`[TradeCalc] ${label || 'async task'} failed; using fallback`, e);
    return fallback;
  });
  const timeout = new Promise(resolve => {
    timerId = setTimeout(() => resolve({ __tcTimedOut: true }), timeoutMs);
  });
  const result = await Promise.race([guarded, timeout]);
  clearTimeout(timerId);
  if (result?.__tcTimedOut) {
    console.warn(`[TradeCalc] ${label || 'async task'} timed out; using fallback`);
    return fallback;
  }
  return result;
}

/**
 * Load DNA profiles for a league. Returns { rosterId: dnaKey }
 */
async function loadDNAProfiles(leagueId) {
  const local = DhqStorage.get(DNA_LOCAL_KEY(leagueId), {});
  // Try Supabase first
  if (window.OD?.loadDNA) {
    return await _tcAwaitWithTimeout(
      window.OD.loadDNA(leagueId),
      TC_DNA_LOAD_TIMEOUT_MS,
      local,
      'OD.loadDNA'
    );
  }
  // localStorage fallback
  return local;
}

/**
 * Save a single DNA profile for a roster in a league
 */
function saveDNAProfile(leagueId, rosterId, dnaKey) {
  // Load existing, merge, save
  const map = DhqStorage.get(DNA_LOCAL_KEY(leagueId), {});
  map[rosterId] = dnaKey;
  DhqStorage.set(DNA_LOCAL_KEY(leagueId), map);
  if (window.OD?.saveDNA) {
    try { window.OD.saveDNA(leagueId, map); } catch (e) { dhqLog('trade-calc.saveDNA',e); }
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: Trade Value & Acceptance
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate total trade value for a set of player IDs, pick objects, and FAAB
 * @param {string[]} playerIds
 * @param {Array<{year:number,round:number}>} picks
 * @param {number} faab
 */
function calcTradeValue(playerIds, picks, faab) {
  const teams = S.rosters?.length || 12;
  const playerSum = (playerIds || []).reduce((sum, pid) => sum + (dynastyValue(pid) || 0), 0);
  const pickSum = (picks || []).reduce((sum, pk) => {
    return sum + pickValue(pk.year || S.season, pk.round, teams, pk.pickInRound);
  }, 0);
  return playerSum + pickSum + Math.round((faab || 0) * FAAB_RATE);
}

/**
 * Calculate acceptance likelihood (5-95%) based on value diff, DNA, and psych taxes
 * diff > 0 means I'm overpaying (good for acceptance)
 * diff < 0 means they're overpaying (bad for acceptance)
 *
 * CALIBRATION NOTES (March 2026):
 * - DNA affects the tax/posture layer, not a separate curve
 * - Overpaying always raises likelihood; underpaying always lowers it
 */
function calcAcceptanceLikelihood(myValue, theirValue, theirDnaKey, psychTaxes, myAssessment, theirAssessment, opts) {
  // Delegate to shared trade engine (canonical implementation)
  if (window.App?.TradeEngine?.calcAcceptanceLikelihood) {
    return window.App.TradeEngine.calcAcceptanceLikelihood(myValue, theirValue, theirDnaKey, psychTaxes, myAssessment, theirAssessment, opts);
  }
  // Emergency fallback — shared module should always be loaded.
  const totalA = Number(myValue) || 0;
  const totalB = Number(theirValue) || 0;
  if (totalA <= 0 && totalB <= 0) return 50;
  const maxSide = Math.max(totalA, totalB, 1);
  const diff = totalA - totalB;
  const rawTax = (psychTaxes || []).reduce((sum, t) => sum + (Number(t.impact) || 0), 0);
  const complexityTax = Math.max(0, ((opts?.totalPieces) || 0) - 4) * 5;
  const taxValueAdjust = ((rawTax - complexityTax) / 200) * maxSide;
  const normalizedSurplus = (diff + taxValueAdjust) / maxSide;
  return Math.round(Math.max(5, Math.min(95, 50 + Math.round(normalizedSurplus * 200))));
}

/**
 * Grade a trade's fairness
 */
function fairnessGrade(myValue, theirValue) {
  // Delegate to shared trade engine (canonical ratio-based grading)
  if (window.App?.TradeEngine?.fairnessGrade) {
    return window.App.TradeEngine.fairnessGrade(myValue, theirValue);
  }
  // Emergency fallback
  if (myValue === 0 && theirValue === 0) return { grade: '--', color: '#95A5A6' };
  const ratio = theirValue / Math.max(myValue, 1);
  if (ratio >= 1.15) return { grade: 'A', color: '#2ECC71' };
  if (ratio >= 0.95) return { grade: 'B', color: '#D4AF37' };
  if (ratio >= 0.85) return { grade: 'C', color: '#F0A500' };
  return { grade: 'F', color: '#E74C3C' };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: Rendering
// ═══════════════════════════════════════════════════════════════

// Module-level state for the trade calculator UI
let _tcAssessments = [];
let _tcMyAssessment = null;
let _tcDnaMap = {};
let _tcSelectedScout = null;
let _tcBuilderMy = null;
let _tcBuilderTheir = null;
let _tcBuilderMyAssets = { players: [], picks: [], faab: 0 };
let _tcBuilderTheirAssets = { players: [], picks: [], faab: 0 };
let _tcActiveView = 'finder'; // 'finder' | 'builder' | 'partners' | 'history' | 'dna' | 'valuechart' | 'overview' | 'scout'
let _vcShowCount = 50; // Value Chart: how many rows to render

function _tcEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── renderTradeCalc — main entry point ───────────────────────

async function renderTradeCalc() {
  const el = $('trade-calc-container');
  if (!el) return;

  // Paywall gate for trade calculator
  if (typeof canAccess === 'function' && !canAccess('trade-calc')) {
    el.innerHTML = '';
    showUpgradePrompt('trade-calc', el);
    return;
  }

  if (!S.rosters?.length || !S.players || !Object.keys(S.players).length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px;color:var(--text3)">
      <div style="font-size:14px">Connect to a league to use the Trade Calculator</div>
    </div>`;
    return;
  }

  // Show loading
  el.innerHTML = `<div style="text-align:center;padding:24px">
    <div class="ld"><span>.</span><span>.</span><span>.</span></div>
    <div style="font-size:13px;color:var(--text3);margin-top:8px">Building partner map...</div>
  </div>`;

  // Compute assessments
  try {
    _tcAssessments = assessAllTeams();
    _tcMyAssessment = _tcAssessments.find(a => a.rosterId === S.myRosterId) || _tcAssessments[0] || null;
  } catch (e) {
    console.error('[TradeCalc] Failed to assess teams', e);
    el.innerHTML = `<div class="scout-empty-card">
      <div class="scout-empty-title">Trade Studio could not analyze this league</div>
      <div class="scout-empty-body">Scout has your league loaded, but the team assessment pass failed. Refresh data and try again.</div>
      <button class="scout-primary-btn" onclick="window.refreshData?.()">Refresh Data</button>
    </div>`;
    return;
  }

  // Load DNA profiles
  if (S.currentLeagueId) {
    _tcDnaMap = await loadDNAProfiles(S.currentLeagueId);
  }

  // Auto-derive missing DNA (deriveDNAFromHistory returns {key,confidence} or null)
  _tcAssessments.forEach(a => {
    if (!_tcDnaMap[a.rosterId]) {
      const derived = deriveDNAFromHistory(a.rosterId);
      if (derived) _tcDnaMap[a.rosterId] = derived.key;
    }
  });

  _renderTradeCalcShell(el);
}

async function renderTradeStudio() {
  const hero = $('trades-hero');
  const calc = $('trade-calc-container');
  if (!S.rosters?.length || !S.players || !Object.keys(S.players || {}).length) {
    if (hero) hero.innerHTML = '';
    if (calc) {
      calc.innerHTML = `<div class="scout-empty-card">
        <div class="scout-empty-title">Connect a league to open Trade Studio</div>
        <div class="scout-empty-body">Scout needs your roster, league owners, picks, and player values before it can build real packages.</div>
        <button class="scout-primary-btn" onclick="mobileTab('digest')">Connect League</button>
      </div>`;
    }
    return;
  }

  if (!_tcAssessments.length) {
    if (calc) {
      calc.innerHTML = `<div style="text-align:center;padding:24px">
        <div class="ld"><span>.</span><span>.</span><span>.</span></div>
        <div style="font-size:13px;color:var(--text3);margin-top:8px">Opening Trade Studio...</div>
      </div>`;
    }
    await renderTradeCalc();
  }

  if (!_tcAssessments.length) return;
  if (_tcActiveView === 'overview') _tcActiveView = 'finder';
  try {
    _renderTradeStudioHero(hero);
  } catch (e) {
    console.error('[TradeStudio] Hero render failed', e);
    if (hero) {
      hero.innerHTML = `<div class="scout-empty-card" style="margin-bottom:12px">
        <div class="scout-empty-title">Trade Studio loaded without the market read</div>
        <div class="scout-empty-body">The deal tools are ready. Refresh data if the market summary does not return.</div>
      </div>`;
    }
  }
  if (calc) _renderTradeCalcShell(calc);
  if (typeof renderTradeIntel === 'function') renderTradeIntel();
  _tcRenderRecentTrades();
}

function _tcTradeableAssets(rosterId) {
  const roster = S.rosters?.find(r => r.roster_id === rosterId);
  if (!roster) return [];
  const assets = (roster.players || [])
    .map(pid => ({ pid, val: dynastyValue(pid), pos: normPos(pPos(pid)), name: pNameShort(pid) }))
    .filter(p => p.val > 0)
    .sort((a, b) => b.val - a.val);
  const topByPos = {};
  assets.forEach(p => { if (!topByPos[p.pos]) topByPos[p.pos] = p.pid; });
  return assets.filter(p => p.pid !== topByPos[p.pos]);
}

function _tcOwnedPickSummary(rosterId) {
  const teams = S.rosters?.length || 12;
  const picksByOwner = typeof buildPicksByOwner === 'function' ? buildPicksByOwner() : {};
  const picks = picksByOwner?.[rosterId] || [];
  const value = picks.reduce((sum, pk) => sum + pickValue(pk.year, pk.round, teams), 0);
  return { count: picks.length, value };
}

function _tcSavedTradeCount() {
  const log = typeof window.getFieldLog === 'function' ? window.getFieldLog() : [];
  return log.filter(e => e.category === 'trade' || e.actionType === 'trade_option_saved' || e.actionType === 'trade_scenario').length;
}

function _renderTradeStudioHero(hero) {
  if (!hero) return;
  const my = _tcMyAssessment;
  if (!my) {
    hero.innerHTML = '';
    return;
  }
  const partners = findBestPartners(my, _tcAssessments);
  const best = partners[0] || null;
  const bestAssessment = best?.assessment || null;
  const dnaKey = bestAssessment ? (_tcDnaMap[bestAssessment.rosterId] || 'NONE') : 'NONE';
  const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
  const needs = (my.needs || []).map(n => n.pos).filter(Boolean);
  const surplus = (my.strengths || []).filter(Boolean);
  const chips = _tcTradeableAssets(S.myRosterId);
  const pickBank = _tcOwnedPickSummary(S.myRosterId);
  const savedDeals = _tcSavedTradeCount();
  const topChip = chips[0];
  const fitScore = best ? Math.round(best.compatibility) : 0;
  const partnerProvides = best?.theyProvide || [];
  const partnerWants = best?.iProvide || [];
  const partnerProvidesText = partnerProvides.slice(0, 2).join(', ');
  const partnerWantsText = partnerWants.slice(0, 2).join(', ');
  const bestRead = bestAssessment
    ? `${bestAssessment.ownerName} can help with ${partnerProvidesText || needs[0] || 'your next need'}${partnerWantsText ? ` and wants ${partnerWantsText}` : ''}.`
    : 'No obvious partner is standing out yet. Start with your trade chips or ask Scout for a market scan.';
  const scoutPrompt = bestAssessment
    ? `Build three realistic trades with ${bestAssessment.ownerName}. My needs are ${needs.slice(0, 3).join(', ') || 'best player available'} and my surplus is ${surplus.slice(0, 3).join(', ') || 'unclear'}. Include picks, FAAB if useful, acceptance odds, and why they accept.`
    : 'Scan my league for the best trade partners and build three realistic trade packages with acceptance odds.';

  hero.innerHTML = `<section class="tc-studio-hero">
    <div class="tc-studio-top">
      <div>
        <div class="scout-kicker">Trade Studio</div>
        <h1>Build the deal, prove why it works, save it for War Room.</h1>
        <p>${_tcEsc(bestRead)}</p>
      </div>
      <div class="tc-studio-fit">
        <strong>${fitScore || '--'}</strong>
        <span>Partner fit</span>
      </div>
    </div>
    <div class="tc-studio-kpis">
      <button onclick="${bestAssessment ? `_tcStartTrade(${bestAssessment.rosterId})` : `_tcSwitchView('partners')`}">
        <span>Best Partner</span>
        <strong>${_tcEsc(bestAssessment?.ownerName || 'Scan Market')}</strong>
        <small>${bestAssessment ? _tcEsc(dna.label || 'Owner DNA') : 'Find a match'}</small>
      </button>
      <button onclick="_tcSwitchView('finder')">
        <span>Trade Chips</span>
        <strong>${chips.length}</strong>
        <small>${topChip ? `${_tcEsc(topChip.name)} · ${Math.round(topChip.val).toLocaleString()}` : 'Pick a player to shop'}</small>
      </button>
      <button onclick="_tcSwitchView('builder')">
        <span>Draft Bank</span>
        <strong>${Math.round(pickBank.value).toLocaleString()}</strong>
        <small>${pickBank.count} movable picks</small>
      </button>
      <button onclick="mobileTab('fieldlog')">
        <span>Saved Deals</span>
        <strong>${savedDeals}</strong>
        <small>Field Log artifacts</small>
      </button>
    </div>
    <div class="tc-studio-actions">
      <button class="scout-primary-btn" onclick="_tcSwitchView('finder')">Generate Deals</button>
      <button class="scout-secondary-btn" onclick="${bestAssessment ? `_tcStartTrade(${bestAssessment.rosterId})` : `_tcSwitchView('builder')`}">Build Manually</button>
      <button class="scout-secondary-btn" onclick="fillGlobalChat(${JSON.stringify(scoutPrompt)})">Ask Scout</button>
    </div>
  </section>`;
}

function _tcRenderRecentTrades() {
  const el = $('trades-recent');
  if (!el) return;
  const li = _tcLI();
  const week = S.currentWeek;
  let trades = (S.transactions?.['w' + week] || []).filter(t => t.type === 'trade');
  if (!trades.length && _tcLILoaded() && li.tradeHistory?.length) {
    trades = li.tradeHistory.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 3);
  }
  if (!trades.length) {
    el.innerHTML = '<div class="empty">No recent trade history found.</div>';
    return;
  }
  el.innerHTML = trades.slice(0, 3).map(t => {
    const rids = t.roster_ids || [];
    const names = rids.map(id => {
      const roster = S.rosters.find(r => r.roster_id === id);
      return roster ? (getUser(roster.owner_id) || `Team ${id}`) : `Team ${id}`;
    });
    const sideText = t.sides
      ? Object.values(t.sides).map(side => (side.players || []).slice(0, 3).map(p => pNameShort(p)).join(', ')).filter(Boolean).join(' / ')
      : 'Open history for details';
    return `<div class="tc-recent-row">
      <span><strong>${_tcEsc(names.join(' vs ') || 'League trade')}</strong><small>${_tcEsc(sideText || 'Trade recorded')}</small></span>
      <button onclick="_tcSwitchView('history')">History</button>
    </div>`;
  }).join('');
}

function _renderTradeCalcShell(el) {
  const views = [
    ['finder', 'Find Deals'],
    ['builder', 'Build'],
    ['partners', 'Partners'],
    ['history', 'History'],
    ['dna', 'DNA'],
    ['valuechart', 'Values']
  ];
  el.innerHTML = `
    <div class="tc-view-tabs">
      ${views.map(([view, label]) => `<button class="${_tcActiveView === view ? 'active' : ''}" onclick="_tcSwitchView('${view}')">${label}</button>`).join('')}
    </div>
    <div id="tc-view-content"></div>
  `;

  const content = $('tc-view-content');
  if (_tcActiveView === 'overview') renderLeagueOverview(_tcAssessments, content);
  else if (_tcActiveView === 'scout' && _tcSelectedScout) renderTeamScout(_tcSelectedScout, content);
  else if (_tcActiveView === 'finder') renderTradeFinder(content);
  else if (_tcActiveView === 'partners') renderPartnerFinder(_tcMyAssessment, _tcAssessments, content);
  else if (_tcActiveView === 'builder') renderTradeBuilder(_tcBuilderMy?.rosterId || S.myRosterId, _tcBuilderTheir?.rosterId, content);
  else if (_tcActiveView === 'dna') renderDNAPanel(_tcAssessments, content);
  else if (_tcActiveView === 'valuechart') renderValueChart(content);
  else if (_tcActiveView === 'history') renderTradeHistory(content);
  else renderLeagueOverview(_tcAssessments, content);
}

function _tcToggleTools() {
  const menu = document.getElementById('tc-tools-menu');
  if (!menu) return;
  const show = menu.style.display !== 'block';
  menu.style.display = show ? 'block' : 'none';
  if (show) {
    const close = (e) => { if (!menu.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}
window._tcToggleTools = _tcToggleTools;

function _tcSwitchView(view) {
  _tcActiveView = view;
  const el = $('trade-calc-container');
  if (el) _renderTradeCalcShell(el);
}
window._tcSwitchView = _tcSwitchView;

function _tcScoutTeam(rosterId) {
  _tcSelectedScout = _tcAssessments.find(a => a.rosterId === rosterId) || null;
  _tcActiveView = 'scout';
  const el = $('trade-calc-container');
  if (el) _renderTradeCalcShell(el);
}
window._tcScoutTeam = _tcScoutTeam;

function _tcStartTrade(theirRosterId) {
  _tcBuilderMy = _tcMyAssessment;
  _tcBuilderTheir = _tcAssessments.find(a => a.rosterId === theirRosterId) || null;
  _tcBuilderMyAssets = { players: [], picks: [], faab: 0 };
  _tcBuilderTheirAssets = { players: [], picks: [], faab: 0 };
  _tcActiveView = 'builder';
  if (typeof trackUsage === 'function') trackUsage('trade_scenarios_explored');
  const el = $('trade-calc-container');
  if (el) _renderTradeCalcShell(el);
}
window._tcStartTrade = _tcStartTrade;


// ── renderLeagueOverview ─────────────────────────────────────

function renderLeagueOverview(assessments, container) {
  if (!container) container = $('tc-view-content');
  if (!container) return;
  if (!assessments?.length) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--text3);padding:20px">No teams found</div>';
    return;
  }

  // Sort by health score descending
  const sorted = [...assessments].sort((a, b) => b.healthScore - a.healthScore);

  let html = `<div class="sec">League Overview <span class="sec-line"></span></div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">`;

  sorted.forEach((a, idx) => {
    const dnaKey = _tcDnaMap[a.rosterId] || 'NONE';
    const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
    const isMe = _isMyRoster(a.rosterId);
    const topNeed = a.needs[0]?.pos || '--';
    const topStrength = a.strengths[0] || '--';
    const posture = calcOwnerPosture(a, dnaKey);
    const _ini = (a.ownerName || '?')[0].toUpperCase();
    const avatarHtml = a.avatar
      ? `<div style="position:relative;width:32px;height:32px;flex-shrink:0"><img src="https://sleepercdn.com/avatars/thumbs/${a.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div style="display:none;width:32px;height:32px;border-radius:50%;background:var(--bg3);align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--text3)">${_ini}</div></div>`
      : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--text3);flex-shrink:0">${_ini}</div>`;

    html += `
      <div class="card" style="cursor:pointer;${isMe ? 'border-color:rgba(212,175,55,.35);box-shadow:0 0 12px rgba(212,175,55,.1)' : ''}" onclick="_tcScoutTeam(${a.rosterId})">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          ${avatarHtml}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.ownerName}${isMe ? ' <span style="font-size:13px;color:var(--accent)">(You)</span>' : ''}</div>
            <div style="font-size:13px;color:var(--text3)">${a.teamName}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;color:${a.tierColor};text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:5px;background:${a.tierBg}">${a.tier}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <div style="font-size:13px;color:var(--text2)"><span style="font-weight:600">${a.wins}-${a.losses}${a.ties ? '-' + a.ties : ''}</span></div>
          <div style="font-size:13px;color:var(--text3)">${a.weeklyPts > 0 ? a.weeklyPts.toFixed(1) + ' ppg' : '--'}</div>
          ${dnaKey !== 'NONE' ? `<span style="font-size:13px;padding:1px 7px;border-radius:10px;background:${dna.color}22;color:${dna.color};font-weight:600">${dna.label}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <div style="font-size:13px;color:var(--text3);min-width:52px">Health</div>
          <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${a.healthScore}%;background:${a.healthScore >= 70 ? 'var(--green)' : a.healthScore >= 45 ? 'var(--amber)' : 'var(--red)'};border-radius:3px;transition:width .4s"></div>
          </div>
          <div style="font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;min-width:28px;text-align:right;color:${a.healthScore >= 70 ? 'var(--green)' : a.healthScore >= 45 ? 'var(--amber)' : 'var(--red)'}">${a.healthScore}</div>
        </div>
        <div style="display:flex;gap:12px;font-size:13px">
          <div><span style="color:var(--text3)">Need:</span> <span style="color:var(--red);font-weight:600">${topNeed}</span></div>
          <div><span style="color:var(--text3)">Surplus:</span> <span style="color:var(--green);font-weight:600">${topStrength}</span></div>
          <div><span style="color:var(--text3)">Panic:</span> <span style="color:${a.panic >= 3 ? 'var(--red)' : a.panic >= 2 ? 'var(--amber)' : 'var(--green)'};font-weight:600">${a.panic}/5</span></div>
        </div>
      </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}


// ── renderTeamScout ──────────────────────────────────────────

function renderTeamScout(assessment, container) {
  if (!container) container = $('tc-view-content');
  if (!container || !assessment) return;
  const a = assessment;
  const dnaKey = _tcDnaMap[a.rosterId] || 'NONE';
  const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
  const posture = calcOwnerPosture(a, dnaKey);
  const isMe = _isMyRoster(a.rosterId);
  const compat = _tcMyAssessment && !isMe ? calcComplementarity(_tcMyAssessment, a) : null;

  const _ini2 = (a.ownerName || '?')[0].toUpperCase();
  const avatarHtml = a.avatar
    ? `<div style="position:relative;width:44px;height:44px;flex-shrink:0"><img src="https://sleepercdn.com/avatars/thumbs/${a.avatar}" style="width:44px;height:44px;border-radius:50%;object-fit:cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div style="display:none;width:44px;height:44px;border-radius:50%;background:var(--bg3);align-items:center;justify-content:center;font-size:16px;font-weight:700;color:var(--text3)">${_ini2}</div></div>`
    : `<div style="width:44px;height:44px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:var(--text3);flex-shrink:0">${_ini2}</div>`;

  let html = `
    <button class="btn btn-sm btn-ghost" onclick="_tcSwitchView('overview')" style="margin-bottom:12px">&larr; Back to Overview</button>
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        ${avatarHtml}
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:800;letter-spacing:-.02em">${a.ownerName}${isMe ? ' <span style="color:var(--accent);font-size:13px">(You)</span>' : ''}</div>
          <div style="font-size:13px;color:var(--text3)">${a.teamName} &middot; ${a.wins}-${a.losses}${a.ties ? '-' + a.ties : ''} &middot; ${a.weeklyPts > 0 ? a.weeklyPts.toFixed(1) + ' ppg' : '--'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700;color:${a.tierColor};text-transform:uppercase;padding:3px 10px;border-radius:6px;background:${a.tierBg}">${a.tier}</div>
        </div>
      </div>

      <!-- Health + Panic meters -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="background:var(--bg3);border-radius:var(--r);padding:10px 12px">
          <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;font-weight:600">Health Score</div>
          <div style="font-size:28px;font-weight:800;color:${a.healthScore >= 70 ? 'var(--green)' : a.healthScore >= 45 ? 'var(--amber)' : 'var(--red)'};font-family:'JetBrains Mono',monospace;letter-spacing:-.03em">${a.healthScore}</div>
          <div style="height:5px;background:var(--bg);border-radius:3px;margin-top:6px;overflow:hidden">
            <div style="height:100%;width:${a.healthScore}%;background:${a.healthScore >= 70 ? 'var(--green)' : a.healthScore >= 45 ? 'var(--amber)' : 'var(--red)'};border-radius:3px"></div>
          </div>
        </div>
        <div style="background:var(--bg3);border-radius:var(--r);padding:10px 12px">
          <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;font-weight:600">Panic Meter</div>
          <div style="font-size:28px;font-weight:800;color:${a.panic >= 4 ? 'var(--red)' : a.panic >= 2 ? 'var(--amber)' : 'var(--green)'};font-family:'JetBrains Mono',monospace;letter-spacing:-.03em">${a.panic}<span style="font-size:14px;color:var(--text3)">/5</span></div>
          <div style="display:flex;gap:3px;margin-top:6px">
            ${[1, 2, 3, 4, 5].map(i => `<div style="flex:1;height:5px;border-radius:3px;background:${i <= a.panic ? (a.panic >= 4 ? 'var(--red)' : a.panic >= 2 ? 'var(--amber)' : 'var(--green)') : 'var(--bg)'}"></div>`).join('')}
          </div>
        </div>
      </div>

      <!-- DNA + Posture + Window -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${dnaKey !== 'NONE' ? `<span class="pill" style="background:${dna.color}18;color:${dna.color};border-color:${dna.color}40;font-size:13px">DNA: ${dna.label}</span>` : '<span class="pill pd" style="font-size:13px">DNA: Not Set</span>'}
        <span class="pill" style="background:${posture.color}18;color:${posture.color};border-color:${posture.color}40;font-size:13px">${posture.label}</span>
        <span class="pill pd" style="font-size:13px">Window: ${a.window}</span>
      </div>
    </div>`;

  // Position Assessment Grid
  html += `<div class="sec">Position Assessment <span class="sec-line"></span></div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px">`;

  DEPTH_POSITIONS.forEach(pos => {
    const pa = a.posAssessment[pos];
    if (!pa) return;
    const statusColor = pa.status === 'surplus' ? 'var(--green)' : pa.status === 'ok' ? 'var(--accent)' : pa.status === 'thin' ? 'var(--amber)' : 'var(--red)';
    const statusBg = pa.status === 'surplus' ? 'var(--greenL)' : pa.status === 'ok' ? 'var(--accentL)' : pa.status === 'thin' ? 'var(--amberL)' : 'var(--redL)';
    const statusLabel = pa.status === 'surplus' ? 'Surplus' : pa.status === 'ok' ? 'Covered' : pa.status === 'thin' ? 'Thin' : 'Deficit';

    // Top players at this position (show top 3)
    const topPlayers = (pa.sortedIds || []).slice(0, 3).map(pid => {
      const val = dynastyValue(pid);
      const isStarter = pa.nflStarterIds?.includes(pid);
      return `<div style="display:flex;align-items:center;gap:4px;font-size:13px;padding:1px 0">
        <span style="color:${isStarter ? 'var(--green)' : 'var(--text3)'};font-size:13px">${isStarter ? '●' : '○'}</span>
        <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;color:var(--text2)" onclick="openPlayerModal('${pid}')">${pNameShort(pid)}</span>
        ${val > 0 ? `<span style="font-size:13px;color:var(--text3);font-family:'JetBrains Mono',monospace">${val.toLocaleString()}</span>` : ''}
      </div>`;
    }).join('');

    html += `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;border-top:3px solid ${statusColor}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:13px;font-weight:700">${pos}</span>
          <span style="font-size:13px;font-weight:700;color:${statusColor};text-transform:uppercase;padding:1px 6px;border-radius:4px;background:${statusBg}">${statusLabel}</span>
        </div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:6px">
          ${pa.nflStarters}/${pa.minQuality} starters &middot; ${pa.actual} total
        </div>
        ${topPlayers}
      </div>`;
  });
  html += `</div>`;

  // Needs and Strengths
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">`;
  html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px">
    <div style="font-size:13px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Needs</div>
    ${a.needs.length ? a.needs.map(n => `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:13px">
      <span style="font-weight:600">${n.pos}</span>
      <span style="font-size:13px;padding:1px 5px;border-radius:3px;background:${n.urgency === 'deficit' ? 'var(--redL)' : 'var(--amberL)'};color:${n.urgency === 'deficit' ? 'var(--red)' : 'var(--amber)'};font-weight:600;text-transform:uppercase">${n.urgency}</span>
    </div>`).join('') : '<div style="font-size:13px;color:var(--text3)">None</div>'}
  </div>`;
  html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px">
    <div style="font-size:13px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Strengths</div>
    ${a.strengths.length ? a.strengths.map(pos => `<div style="font-size:13px;font-weight:600;padding:2px 0">${pos} <span style="font-size:13px;color:var(--green)">surplus</span></div>`).join('') : '<div style="font-size:13px;color:var(--text3)">None</div>'}
  </div>`;
  html += `</div>`;

  // Draft Capital Summary
  const pa = a.picksAssessment;
  html += `<div class="sec">Draft Capital <span class="sec-line"></span></div>`;
  html += `<div class="card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:13px;font-weight:700">Picks</span>
      <span style="font-size:13px;padding:2px 7px;border-radius:4px;font-weight:600;background:${pa.status === 'surplus' ? 'var(--greenL)' : pa.status === 'ok' ? 'var(--accentL)' : pa.status === 'thin' ? 'var(--amberL)' : 'var(--redL)'};color:${pa.status === 'surplus' ? 'var(--green)' : pa.status === 'ok' ? 'var(--accent)' : pa.status === 'thin' ? 'var(--amber)' : 'var(--red)'};text-transform:uppercase">${pa.status}</span>
      <span style="font-size:13px;color:var(--text3)">${pa.totalPicks}/${pa.idealTotal} total</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px">
      ${(pa.pickYears || []).map(yr => {
        const count = pa.pickCountByYear[yr] || 0;
        return `<div style="background:var(--bg3);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:13px;color:var(--text3);font-weight:600">${yr}</div>
          <div style="font-size:18px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${count >= pa.draftRounds ? 'var(--green)' : count > 0 ? 'var(--text)' : 'var(--red)'}">${count}</div>
          <div style="font-size:13px;color:var(--text3)">picks</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // Compatibility with MY team
  if (compat !== null) {
    html += `<div class="card" style="margin-bottom:14px;border-color:rgba(212,175,55,.2)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;font-weight:700">Trade Compatibility with You</span>
        <span style="font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${compat >= 60 ? 'var(--green)' : compat >= 30 ? 'var(--amber)' : 'var(--text3)'}">${compat}</span>
      </div>
      <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-bottom:10px">
        <div style="height:100%;width:${compat}%;background:${compat >= 60 ? 'var(--green)' : compat >= 30 ? 'var(--amber)' : 'var(--text3)'};border-radius:3px"></div>
      </div>
      <button class="btn btn-sm" onclick="_tcStartTrade(${a.rosterId})">Open Trade Builder</button>
    </div>`;
  }

  container.innerHTML = html;
}


// ── renderPartnerFinder ──────────────────────────────────────

function renderPartnerFinder(myAssessment, allAssessments, container) {
  if (!container) container = $('tc-view-content');
  if (!container) return;

  if (!myAssessment) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--text3);padding:20px">Could not find your team assessment</div>';
    return;
  }

  const partners = findBestPartners(myAssessment, allAssessments);

  let html = `<div class="sec">Partner Finder <span class="sec-line"></span></div>
  <div style="font-size:13px;color:var(--text3);margin-bottom:8px">by dynasty value</div>`;

  // My summary
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">`;

  // My needs
  html += `<div class="card">
    <div style="font-size:13px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">My Needs</div>
    ${myAssessment.needs.length ? myAssessment.needs.map(n => `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0">
        <span style="font-size:13px;font-weight:700">${n.pos}</span>
        <span style="font-size:13px;padding:1px 5px;border-radius:3px;background:${n.urgency === 'deficit' ? 'var(--redL)' : 'var(--amberL)'};color:${n.urgency === 'deficit' ? 'var(--red)' : 'var(--amber)'};font-weight:600;text-transform:uppercase">${n.urgency}</span>
      </div>
    `).join('') : '<div style="font-size:13px;color:var(--text3)">No critical needs</div>'}
  </div>`;

  // My strengths
  html += `<div class="card">
    <div style="font-size:13px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">My Strengths</div>
    ${myAssessment.strengths.length ? myAssessment.strengths.map(pos => `
      <div style="font-size:13px;font-weight:600;padding:3px 0">${pos} <span style="font-size:13px;color:var(--green);text-transform:uppercase">surplus</span></div>
    `).join('') : '<div style="font-size:13px;color:var(--text3)">No surplus positions</div>'}
  </div>`;
  html += `</div>`;

  // Partner rankings
  html += `<div class="sec">Ranked Partners <span class="sec-line"></span></div>`;

  if (!partners.length) {
    html += '<div class="card" style="text-align:center;color:var(--text3);padding:16px;font-size:13px">No trade partners found</div>';
  } else {
    partners.forEach((p, idx) => {
      const a = p.assessment;
      const dnaKey = _tcDnaMap[a.rosterId] || 'NONE';
      const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
      const compatColor = p.compatibility >= 60 ? 'var(--green)' : p.compatibility >= 30 ? 'var(--amber)' : 'var(--text3)';

      html += `
        <div class="card" style="cursor:pointer" onclick="_tcStartTrade(${a.rosterId})">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:16px;font-weight:800;color:var(--text3);min-width:24px;font-family:'JetBrains Mono',monospace">#${idx + 1}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <span style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.ownerName}</span>
                <span style="font-size:13px;color:${a.tierColor};font-weight:600">${a.tier}</span>
                ${dnaKey !== 'NONE' ? `<span style="font-size:13px;padding:1px 5px;border-radius:8px;background:${dna.color}22;color:${dna.color};font-weight:600">${dna.label}</span>` : ''}
              </div>
              <div style="display:flex;gap:8px;font-size:13px;color:var(--text3);flex-wrap:wrap">
                ${p.theyProvide.length ? `<span>They give: <span style="color:var(--green);font-weight:600">${p.theyProvide.join(', ')}</span></span>` : ''}
                ${p.iProvide.length ? `<span>I give: <span style="color:var(--blue);font-weight:600">${p.iProvide.join(', ')}</span></span>` : ''}
              </div>
            </div>
            <div style="text-align:right;min-width:50px">
              <div style="font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${compatColor}">${p.compatibility}</div>
              <div style="font-size:13px;color:var(--text3)">compat</div>
            </div>
          </div>
          <div style="height:4px;background:var(--bg3);border-radius:2px;margin-top:8px;overflow:hidden">
            <div style="height:100%;width:${p.compatibility}%;background:${compatColor};border-radius:2px"></div>
          </div>
        </div>`;
    });
  }

  container.innerHTML = html;
}


// ── renderTradeBuilder ───────────────────────────────────────

function renderTradeBuilder(myRosterId, theirRosterId, container) {
  if (!container) container = $('tc-view-content');
  if (!container) return;

  // Tier gate — Trade Scenarios require trial or paid
  if (typeof canAccess === 'function' && !canAccess(FEATURES?.TRADE_SCENARIOS || 'trade_scenarios')) {
    container.innerHTML = typeof _tierGatePlaceholder === 'function'
      ? _tierGatePlaceholder('Trade Scenario Builder', FEATURES?.TRADE_SCENARIOS || 'trade_scenarios')
      : '<div style="padding:24px;text-align:center;color:var(--text3)">Upgrade to unlock the Trade Scenario Builder.</div>';
    return;
  }

  const myAssessment = _tcAssessments.find(a => a.rosterId === myRosterId);
  const theirAssessment = theirRosterId ? _tcAssessments.find(a => a.rosterId === theirRosterId) : null;

  if (!myAssessment) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--text3);padding:20px">Could not find your team</div>';
    return;
  }

  let html = `
    <button class="btn btn-sm btn-ghost" onclick="_tcSwitchView('finder')" style="margin-bottom:12px">&larr; Back to generated deals</button>
    <div class="sec">Trade Builder <span class="sec-line"></span></div>`;

  // Team selector if no opponent yet
  if (!theirAssessment) {
    html += `<div class="card" style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Select trade partner</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
        ${_tcAssessments.filter(a => !_isMyRoster(a.rosterId)).map(a => `
          <button class="btn btn-sm btn-ghost" onclick="_tcStartTrade(${a.rosterId})" style="text-align:left;padding:8px 10px">
            <div style="font-size:13px;font-weight:600">${a.ownerName}</div>
            <div style="font-size:13px;color:var(--text3)">${a.tier} &middot; ${a.wins}-${a.losses}</div>
          </button>
        `).join('')}
      </div>
    </div>`;
    container.innerHTML = html;
    return;
  }

  const teams = S.rosters?.length || 12;
  const theirDnaKey = _tcDnaMap[theirAssessment.rosterId] || 'NONE';
  const theirDna = DNA_TYPES[theirDnaKey] || DNA_TYPES.NONE;
  const posture = calcOwnerPosture(theirAssessment, theirDnaKey);

  // Enhanced partner context header
  const theirNeeds = theirAssessment.needs?.slice(0, 2).map(n => n.pos).join(', ') || '';
  const theirSurplus = theirAssessment.strengths?.slice(0, 2).join(', ') || '';
  const tradeAngle = theirNeeds && theirSurplus ? `Needs ${theirNeeds} · Surplus ${theirSurplus}` : theirNeeds ? `Needs ${theirNeeds}` : '';

  html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:12px 14px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:700">${theirAssessment.ownerName}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
          <span style="font-size:13px;color:${theirAssessment.tierColor};font-weight:600">${theirAssessment.tier}</span>
          ${theirDnaKey !== 'NONE' ? `<span style="font-size:13px;padding:1px 5px;border-radius:8px;background:${theirDna.color}22;color:${theirDna.color};font-weight:600">${theirDna.label}</span>` : ''}
          <span style="font-size:13px;padding:1px 5px;border-radius:8px;background:${posture.color}22;color:${posture.color};font-weight:600">${posture.label}</span>
        </div>
        ${tradeAngle ? `<div style="font-size:13px;color:var(--green);margin-top:4px;font-weight:600">${tradeAngle}</div>` : ''}
      </div>
      <button class="btn btn-sm btn-ghost" onclick="_tcScoutTeam(${theirAssessment.rosterId})">Scout</button>
    </div>
  </div>`;

  // Two-column trade layout
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:10px;margin-bottom:12px">`;

  // MY SIDE
  html += _renderTradeSide(myAssessment, _tcBuilderMyAssets, 'my', true);

  // THEIR SIDE
  html += _renderTradeSide(theirAssessment, _tcBuilderTheirAssets, 'their', false);

  html += `</div>`;

  // Trade summary
  const myVal = calcTradeValue(
    _tcBuilderMyAssets.players,
    _tcBuilderMyAssets.picks,
    _tcBuilderMyAssets.faab
  );
  const theirVal = calcTradeValue(
    _tcBuilderTheirAssets.players,
    _tcBuilderTheirAssets.picks,
    _tcBuilderTheirAssets.faab
  );
  const diff = myVal - theirVal;
  const hasTrade = myVal > 0 || theirVal > 0;
  const psychTaxes = hasTrade ? calcPsychTaxes(myAssessment, theirAssessment, theirDnaKey, posture) : [];
  const acceptance = hasTrade ? calcAcceptanceLikelihood(myVal, theirVal, theirDnaKey, psychTaxes, myAssessment, theirAssessment) : 50;
  const grade = fairnessGrade(myVal, theirVal);

  // ── RECON VERDICT ──────────────────────────────────────
  if (hasTrade) {
    const absDiff = Math.abs(diff);
    const youWin = diff < 0;
    const close = absDiff < 500;
    const bigWin = absDiff > 1500;
    let verdictLabel, verdictColor, verdictBg, verdictAction;

    if (close) {
      verdictLabel = 'CLOSE TRADE';
      verdictColor = 'var(--amber)';
      verdictBg = 'var(--amberL)';
      verdictAction = youWin ? 'Slightly in your favor. Send with confidence.' : 'Nearly fair. Consider sending — they may accept.';
    } else if (youWin) {
      verdictLabel = bigWin ? 'STRONG WIN' : 'GOOD TRADE';
      verdictColor = 'var(--green)';
      verdictBg = 'var(--greenL)';
      verdictAction = acceptance >= 50 ? 'Send now before they reconsider.' : 'Great value for you but low acceptance — consider sweetening slightly.';
    } else {
      verdictLabel = bigWin ? 'NOT FAVORABLE' : 'SLIGHT OVERPAY';
      verdictColor = 'var(--red)';
      verdictBg = 'var(--redL)';
      verdictAction = 'You are overpaying by ~' + absDiff.toLocaleString() + ' DHQ. Add a pick or remove a player to rebalance.';
    }

    html += `<div style="background:${verdictBg};border:1px solid ${verdictColor}30;border-radius:var(--rl);padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:6px;color:${verdictColor};border:1px solid ${verdictColor}">${verdictLabel}</span>
        <span style="font-size:13px;font-weight:700;color:${verdictColor}">${youWin ? 'You win' : close ? 'Nearly fair' : 'You lose'} by ${close ? '<500' : absDiff.toLocaleString()} DHQ</span>
      </div>
      <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:6px">${verdictAction}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:13px;color:var(--text3)">Acceptance</div>
        <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${acceptance}%;background:${acceptance >= 65 ? 'var(--green)' : acceptance >= 40 ? 'var(--amber)' : 'var(--red)'};border-radius:3px"></div>
        </div>
        <div style="font-size:14px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${acceptance >= 65 ? 'var(--green)' : acceptance >= 40 ? 'var(--amber)' : 'var(--red)'}">${acceptance}%</div>
      </div>
    </div>`;
  }

  // ── TRADE IMPACT SIMULATOR ─────────────────────────────
  if (hasTrade) {
    // Get current assessments
    const myAssessNow = assessTeamFromGlobal(myRosterId);
    const theirAssessNow = theirRosterId ? assessTeamFromGlobal(theirRosterId) : null;

    if (myAssessNow) {
      // Simulate swap: remove my given players, add their given players
      const myGivePids = _tcBuilderMyAssets.players.map(String);
      const myGetPids = _tcBuilderTheirAssets.players.map(String);
      const myRosterObj = S.rosters?.find(r => r.roster_id === myRosterId);
      if (myRosterObj) {
        const simPlayers = (myRosterObj.players || []).filter(pid => !myGivePids.includes(String(pid))).concat(myGetPids);
        const simRoster = { ...myRosterObj, players: simPlayers };
        const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
        const nflStarterSet = buildNflStarterSetFromGlobal();
        const picksByOwner = window.App.buildPicksByOwner(S.rosters, league, S.tradedPicks);
        const simAssess = assessTeam(simRoster, S.players, S.playerStats, league, S.leagueUsers, nflStarterSet, picksByOwner[myRosterId] || []);

        if (simAssess) {
          const hsDelta = simAssess.healthScore - myAssessNow.healthScore;
          const nowElite = window.App.countElitePlayers(myRosterObj.players || []);
          const simElite = window.App.countElitePlayers(simPlayers);
          const eDelta = simElite - nowElite;
          const nowTier = myAssessNow.tier;
          const simTier = simAssess.tier;
          const tierChanged = nowTier !== simTier;

          // Position changes
          const posChanges = [];
          Object.keys(simAssess.posAssessment || {}).forEach(pos => {
            const before = myAssessNow.posAssessment?.[pos]?.status;
            const after = simAssess.posAssessment?.[pos]?.status;
            if (before !== after) posChanges.push({ pos, before, after });
          });

          html += `<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rl);padding:14px 16px;margin-bottom:12px">
            <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">Trade Impact Preview</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
              <div style="background:var(--bg3);border-radius:var(--r);padding:8px;text-align:center">
                <div style="font-size:13px;color:var(--text3)">Health Score</div>
                <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${hsDelta > 0 ? 'var(--green)' : hsDelta < 0 ? 'var(--red)' : 'var(--text3)'}">${myAssessNow.healthScore} → ${simAssess.healthScore}</div>
                <div style="font-size:13px;font-weight:700;color:${hsDelta > 0 ? 'var(--green)' : hsDelta < 0 ? 'var(--red)' : 'var(--text3)'}">${hsDelta > 0 ? '+' : ''}${hsDelta}</div>
              </div>
              <div style="background:var(--bg3);border-radius:var(--r);padding:8px;text-align:center">
                <div style="font-size:13px;color:var(--text3)">Elite Players</div>
                <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${eDelta > 0 ? 'var(--green)' : eDelta < 0 ? 'var(--red)' : 'var(--text3)'}">${nowElite} → ${simElite}</div>
                <div style="font-size:13px;font-weight:700;color:${eDelta > 0 ? 'var(--green)' : eDelta < 0 ? 'var(--red)' : 'var(--text3)'}">${eDelta > 0 ? '+' : ''}${eDelta}</div>
              </div>
              <div style="background:var(--bg3);border-radius:var(--r);padding:8px;text-align:center">
                <div style="font-size:13px;color:var(--text3)">Tier</div>
                <div style="font-size:16px;font-weight:800;color:${tierChanged ? (simTier === 'ELITE' || simTier === 'CONTENDER' ? 'var(--green)' : 'var(--red)') : 'var(--text3)'}">${nowTier} ${tierChanged ? '→ ' + simTier : ''}</div>
                <div style="font-size:13px;color:${tierChanged ? 'var(--accent)' : 'var(--text3)'}">${tierChanged ? 'TIER CHANGE' : 'No change'}</div>
              </div>
            </div>
            ${posChanges.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' + posChanges.map(pc => {
              const improved = (pc.after === 'surplus' || pc.after === 'ok') && (pc.before === 'thin' || pc.before === 'deficit');
              const worsened = (pc.before === 'surplus' || pc.before === 'ok') && (pc.after === 'thin' || pc.after === 'deficit');
              return '<span style="font-size:13px;padding:2px 8px;border-radius:4px;background:' + (improved ? 'var(--greenL)' : worsened ? 'var(--redL)' : 'var(--bg3)') + ';color:' + (improved ? 'var(--green)' : worsened ? 'var(--red)' : 'var(--text3)') + '">' + pc.pos + ' ' + pc.before + ' → ' + pc.after + '</span>';
            }).join('') + '</div>' : ''}
          </div>`;
        }
      }
    }
  }

  // ── PSYCHOLOGICAL FACTORS (elevated) ─────────────────
  if (psychTaxes.length && hasTrade) {
    const topInsights = psychTaxes.slice(0, 3);
    html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">`;
    topInsights.forEach(t => {
      const isBonus = t.type === 'BONUS';
      const col = isBonus ? 'var(--green)' : 'var(--red)';
      const bg = isBonus ? 'var(--greenL)' : 'var(--redL)';
      html += `<div style="flex:1;min-width:140px;background:${bg};border:1px solid ${col}20;border-radius:var(--r);padding:8px 10px">
        <div style="font-size:13px;font-weight:700;color:${col}">${t.impact > 0 ? '+' : ''}${t.impact}% ${t.name}</div>
        <div style="font-size:13px;color:var(--text3);margin-top:2px;line-height:1.4">${t.desc}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── TRADE SUMMARY ────────────────────────────────────
  const acceptColor = acceptance >= 65 ? 'var(--green)' : acceptance >= 40 ? 'var(--amber)' : 'var(--red)';
  html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:12px 14px;margin-bottom:12px">
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center">
      <div style="text-align:center">
        <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">You Give</div>
        <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--accent)">${myVal.toLocaleString()}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Net</div>
        <div style="font-size:18px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${diff > 0 ? 'var(--red)' : diff < 0 ? 'var(--green)' : 'var(--text3)'}">${diff > 0 ? '+' : ''}${diff.toLocaleString()}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">They Give</div>
        <div style="font-size:22px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--accent)">${theirVal.toLocaleString()}</div>
      </div>
    </div>
  </div>`;

  // ── COUNTEROFFER SUGGESTIONS ────────────────────────
  if (hasTrade && (Math.abs(diff) > 300 || acceptance < 50)) {
    const suggestions = [];
    const myRoster = S.rosters?.find(r => r.roster_id === myRosterId);
    const theirRoster = S.rosters?.find(r => r.roster_id === theirRosterId);
    const myPids = new Set(_tcBuilderMyAssets.players.map(String));
    const theirPids = new Set(_tcBuilderTheirAssets.players.map(String));

    if (diff > 300) {
      // ── YOU'RE OVERPAYING — suggest ways to rebalance ──
      // 1. Remove your smallest asset if it closes the gap
      const mySmallest = _tcBuilderMyAssets.players
        .map(pid => ({ pid, val: dynastyValue(pid), name: pNameShort(pid) }))
        .filter(p => p.val > 0)
        .sort((a, b) => a.val - b.val)[0];
      if (mySmallest && mySmallest.val <= diff * 1.3) {
        suggestions.push({ text: 'Remove ' + mySmallest.name + ' (' + mySmallest.val.toLocaleString() + ' DHQ) — closes the gap', action: "_tcRemoveAsset('my','player','" + mySmallest.pid + "')", type: 'remove' });
      }
      // 2. Find a specific player on their roster that closes the gap
      if (theirRoster) {
        const gapTarget = (theirRoster.players || [])
          .filter(pid => !theirPids.has(String(pid)))
          .map(pid => ({ pid, val: dynastyValue(pid), name: pNameShort(pid), pos: pPos(pid) }))
          .filter(p => p.val > 0 && p.val >= diff * 0.5 && p.val <= diff * 1.5)
          .sort((a, b) => Math.abs(a.val - diff) - Math.abs(b.val - diff))[0];
        if (gapTarget) {
          suggestions.push({ text: 'Ask for ' + gapTarget.name + ' (' + gapTarget.pos + ', ' + gapTarget.val.toLocaleString() + ' DHQ) to close the ~' + diff.toLocaleString() + ' gap', action: null, type: 'add_their' });
        }
      }
    } else if (diff < -300) {
      // ── YOU'RE WINNING — suggest sweeteners to boost acceptance ──
      // 1. Find a depth player on your roster that fills their need
      if (myAssessment && theirAssessment && myRoster) {
        const theirNeeds = (theirAssessment.needs || []).map(n => n.pos);
        const sweetener = (myRoster.players || [])
          .filter(pid => !myPids.has(String(pid)))
          .map(pid => ({ pid, val: dynastyValue(pid), name: pNameShort(pid), pos: pPos(pid) }))
          .filter(p => p.val >= 500 && p.val <= 3000 && theirNeeds.includes(p.pos))
          .sort((a, b) => a.val - b.val)[0];
        if (sweetener) {
          suggestions.push({ text: 'Add ' + sweetener.name + ' (' + sweetener.pos + ', ' + sweetener.val.toLocaleString() + ' DHQ) — fills their ' + sweetener.pos + ' need', action: "_tcAddAsset('my','player','" + sweetener.pid + "')", type: 'add_my' });
        }
      }
      // 2. Suggest a specific pick
      const absDiff = Math.abs(diff);
      const roundNeeded = absDiff > 4000 ? '1st' : absDiff > 2000 ? '2nd' : '3rd';
      suggestions.push({ text: 'Add a ' + roundNeeded + ' round pick (~' + absDiff.toLocaleString() + ' value gap)', action: null, type: 'pick' });
    }

    // 3. If acceptance is low regardless of value, explain why
    if (acceptance < 40 && suggestions.length < 3) {
      const dnaKey = _tcDnaMap[theirRosterId] || 'NONE';
      if (dnaKey === 'STALWART') suggestions.push({ text: 'This owner is attachment-heavy — make the surplus clear and avoid messy packages', action: null, type: 'tip' });
      else if (dnaKey === 'FLEECER') suggestions.push({ text: 'This owner hunts surplus value — lead with a clean edge or expect a counter', action: null, type: 'tip' });
      else if (dnaKey === 'DOMINATOR') suggestions.push({ text: 'This owner wants to feel like they won — add a "name" player even if value is lower', action: null, type: 'tip' });
    }

    if (suggestions.length) {
      html += `<div style="margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${diff > 300 ? 'Rebalance Options' : 'Sweeten the Deal'}</div>
        ${suggestions.map(s => {
          const icon = s.type === 'remove' ? '✂' : s.type === 'add_my' ? '+' : s.type === 'add_their' ? '←' : s.type === 'tip' ? '💡' : '→';
          const bg = s.type === 'tip' ? 'var(--accentL)' : 'var(--bg2)';
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${bg};border:1px solid var(--border);border-radius:var(--r);margin-bottom:4px;cursor:${s.action ? 'pointer' : 'default'};transition:background .12s" ${s.action ? 'onclick="' + s.action + '"' : ''}>
            <span style="color:var(--accent);font-weight:700;font-size:14px;flex-shrink:0">${icon}</span>
            <span style="font-size:13px;color:var(--text2)">${s.text}</span>
            ${s.action ? '<span style="font-size:13px;color:var(--accent);margin-left:auto;flex-shrink:0">Apply →</span>' : ''}
          </div>`;
        }).join('')}
      </div>`;
    }
  }

  // ── SEND TRADE CTA ──────────────────────────────────
  if (hasTrade) {
    html += `<div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn" style="flex:1;padding:14px;font-size:15px;font-weight:700" onclick="goAsk('Draft a Sleeper trade message for this trade: I give ${_tcBuilderMyAssets.players.map(p=>pNameShort(p)).join(', ')||'nothing'} and receive ${_tcBuilderTheirAssets.players.map(p=>pNameShort(p)).join(', ')||'nothing'} from ${theirAssessment.ownerName}. Make it persuasive.')">
        Send Trade Message
      </button>
      <button class="btn btn-ghost" style="padding:14px;font-size:13px" onclick="goAsk('Analyze this trade: I give ${_tcBuilderMyAssets.players.map(p=>pNameShort(p)+' ('+dynastyValue(p)+')').join(', ')} for ${_tcBuilderTheirAssets.players.map(p=>pNameShort(p)+' ('+dynastyValue(p)+')').join(', ')} from ${theirAssessment.ownerName}')">
        Ask AI
      </button>
    </div>`;
  }

  container.innerHTML = html;
}

/**
 * Render one side of the trade builder (my side or their side)
 */
function _renderTradeSide(assessment, assets, side, isMySide) {
  const roster = S.rosters?.find(r => r.roster_id === assessment.rosterId);
  const playerIds = roster?.players || [];
  const league = S.leagues.find(l => l.league_id === S.currentLeagueId);
  const teams = S.rosters?.length || 12;
  const draftRounds = league?.settings?.draft_rounds || DRAFT_ROUNDS;
  const curYear = parseInt(S.season) || new Date().getFullYear();

  // Group players by position, sorted by value
  const grouped = {};
  playerIds.forEach(pid => {
    const pos = normPos(pPos(pid));
    if (!grouped[pos]) grouped[pos] = [];
    grouped[pos].push({ pid, val: dynastyValue(pid), name: pName(pid) });
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => b.val - a.val));

  // Build available picks
  const allTP = S.tradedPicks || [];
  const availPicks = [];
  for (let yr = curYear; yr < curYear + PICK_HORIZON; yr++) {
    for (let rd = 1; rd <= draftRounds; rd++) {
      const tradedAway = allTP.find(p =>
        parseInt(p.season) === yr && p.round === rd &&
        p.roster_id === assessment.rosterId && p.owner_id !== assessment.rosterId
      );
      if (!tradedAway) {
        availPicks.push({ year: yr, round: rd, originalOwnerRid: assessment.rosterId });
      }
      const acquired = allTP.filter(p =>
        parseInt(p.season) === yr && p.round === rd &&
        p.owner_id === assessment.rosterId && p.roster_id !== assessment.rosterId
      );
      acquired.forEach(p => {
        availPicks.push({ year: yr, round: rd, originalOwnerRid: p.roster_id });
      });
    }
  }

  // Selected assets — card-style chips
  const selectedPlayerHtml = assets.players.map(pid => {
    const val = dynastyValue(pid);
    const { col } = tradeValueTier(val);
    const pos = pPos(pid);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;cursor:pointer;-webkit-tap-highlight-color:transparent" onclick="openPlayerModal('${pid}')">
      <span class="rr-pos" style="${getPosBadgeStyle(pos)};font-size:13px;padding:1px 4px">${pos}</span>
      <span style="font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pNameShort(pid)}</span>
      <span style="font-size:13px;font-weight:700;color:${col};font-family:'JetBrains Mono',monospace">${val.toLocaleString()}</span>
      <button style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0 4px;line-height:1" onclick="event.stopPropagation();_tcRemoveAsset('${side}','player','${pid}')">&times;</button>
    </div>`;
  }).join('');

  const selectedPickHtml = assets.picks.map((pk, idx) => {
    const val = pickValue(pk.year, pk.round, teams);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:var(--bg3);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:13px;font-weight:800;padding:1px 4px;border-radius:4px;background:var(--amberL);color:var(--amber)">PICK</span>
      <span style="font-size:13px;font-weight:600;flex:1">${pk.year} Rd ${pk.round}</span>
      <span style="font-size:13px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${val.toLocaleString()}</span>
      <button style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:0 4px;line-height:1" onclick="_tcRemoveAsset('${side}','pick',${idx})">&times;</button>
    </div>`;
  }).join('');

  // Player dropdown grouped by position
  let playerOptions = '<option value="">+ Add player...</option>';
  DEPTH_POSITIONS.forEach(pos => {
    const players = grouped[pos] || [];
    if (!players.length) return;
    playerOptions += `<optgroup label="${pos}">`;
    players.forEach(p => {
      if (assets.players.includes(p.pid)) return; // already selected
      playerOptions += `<option value="${p.pid}">${pNameShort(p.pid)} (${p.val > 0 ? p.val.toLocaleString() : '--'})</option>`;
    });
    playerOptions += `</optgroup>`;
  });

  // Pick dropdown
  let pickOptions = '<option value="">+ Add pick...</option>';
  availPicks.forEach((pk, idx) => {
    const alreadySelected = assets.picks.some(ap => ap.year === pk.year && ap.round === pk.round && ap.originalOwnerRid === pk.originalOwnerRid);
    if (alreadySelected) return;
    const val = pickValue(pk.year, pk.round, teams);
    const origLabel = pk.originalOwnerRid !== assessment.rosterId ? ` (via ${getUser(S.rosters?.find(r => r.roster_id === pk.originalOwnerRid)?.owner_id) || 'R' + pk.originalOwnerRid})` : '';
    pickOptions += `<option value="${pk.year}-${pk.round}-${pk.originalOwnerRid}">${pk.year} Rd ${pk.round}${origLabel} (${val.toLocaleString()})</option>`;
  });

  return `<div style="background:var(--bg2);border:1px solid ${isMySide ? 'rgba(212,175,55,.2)' : 'var(--border)'};border-radius:var(--rl);padding:12px">
    <div style="font-size:13px;font-weight:700;color:${isMySide ? 'var(--accent)' : 'var(--text2)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${isMySide ? 'You Give' : assessment.ownerName + ' Gives'}</div>

    <!-- Selected assets -->
    <div style="min-height:24px;margin-bottom:8px">
      ${selectedPlayerHtml}
      ${selectedPickHtml}
      ${assets.faab > 0 ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;flex:1">$${assets.faab} FAAB</span>
        <span style="font-size:13px;font-weight:600;color:var(--amber);font-family:'JetBrains Mono',monospace">${Math.round(assets.faab * FAAB_RATE).toLocaleString()}</span>
        <button style="background:none;border:1px solid var(--border2);border-radius:4px;padding:1px 5px;cursor:pointer;color:var(--text3);font-size:13px;font-family:inherit" onclick="_tcRemoveAsset('${side}','faab',0)">&times;</button>
      </div>` : ''}
      ${!selectedPlayerHtml && !selectedPickHtml && assets.faab <= 0 ? `<div style="font-size:13px;color:var(--text3);padding:10px 0;text-align:center;line-height:1.5">${isMySide ? 'Add players or picks you want to trade away' : 'Add what you want from ' + assessment.ownerName}</div>` : ''}
    </div>

    <!-- Add player -->
    <select style="font-size:13px;padding:6px 8px;margin-bottom:6px" onchange="_tcAddPlayer('${side}',this.value);this.value=''">
      ${playerOptions}
    </select>

    <!-- Add pick -->
    <select style="font-size:13px;padding:6px 8px;margin-bottom:6px" onchange="_tcAddPick('${side}',this.value);this.value=''">
      ${pickOptions}
    </select>

    <!-- FAAB input -->
    <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
      <span style="font-size:13px;color:var(--text3)">FAAB $</span>
      <input type="number" min="0" max="${assessment.faabRemaining || 0}" value="${assets.faab || ''}" style="width:70px;font-size:13px;padding:4px 6px" placeholder="0" onchange="_tcSetFaab('${side}',parseInt(this.value)||0)">
      <span style="font-size:13px;color:var(--text3)">/${assessment.faabRemaining || 0}</span>
    </div>
  </div>`;
}

// Trade builder asset manipulation
function _tcAddPlayer(side, pid) {
  if (!pid) return;
  const assets = side === 'my' ? _tcBuilderMyAssets : _tcBuilderTheirAssets;
  if (assets.players.includes(pid)) return;
  if (assets.players.length >= 8) { showToast('Max 8 players per side'); return; }
  assets.players.push(pid);
  _tcRefreshBuilder();
}
window._tcAddPlayer = _tcAddPlayer;

function _tcAddPick(side, val) {
  if (!val) return;
  const [year, round, origRid] = val.split('-').map(Number);
  const assets = side === 'my' ? _tcBuilderMyAssets : _tcBuilderTheirAssets;
  if (assets.picks.length >= 6) { showToast('Max 6 picks per side'); return; }
  assets.picks.push({ year, round, originalOwnerRid: origRid });
  _tcRefreshBuilder();
}
window._tcAddPick = _tcAddPick;

function _tcSetFaab(side, val) {
  const assets = side === 'my' ? _tcBuilderMyAssets : _tcBuilderTheirAssets;
  assets.faab = Math.max(0, val || 0);
  _tcRefreshBuilder();
}
window._tcSetFaab = _tcSetFaab;

function _tcAddAsset(side, type, pid) {
  const assets = side === 'my' ? _tcBuilderMyAssets : _tcBuilderTheirAssets;
  if (type === 'player' && !assets.players.includes(pid)) {
    assets.players.push(pid);
  }
  _tcRefreshBuilder();
}
window._tcAddAsset = _tcAddAsset;

function _tcRemoveAsset(side, type, idxOrPid) {
  const assets = side === 'my' ? _tcBuilderMyAssets : _tcBuilderTheirAssets;
  if (type === 'player') {
    assets.players = assets.players.filter(p => p !== idxOrPid);
  } else if (type === 'pick') {
    assets.picks.splice(Number(idxOrPid), 1);
  } else if (type === 'faab') {
    assets.faab = 0;
  }
  _tcRefreshBuilder();
}
window._tcRemoveAsset = _tcRemoveAsset;

function _tcRefreshBuilder() {
  const myRid = _tcBuilderMy?.rosterId || S.myRosterId;
  const theirRid = _tcBuilderTheir?.rosterId;
  const container = $('tc-view-content');
  if (container) renderTradeBuilder(myRid, theirRid, container);
}


// ── renderDNAPanel ───────────────────────────────────────────

function renderDNAPanel(assessments, container) {
  if (!container) container = $('tc-view-content');
  if (!container) return;

  // Tier gate — Owner DNA requires trial or paid
  if (typeof canAccess === 'function' && !canAccess(FEATURES?.OWNER_DNA || 'owner_dna')) {
    container.innerHTML = typeof _tierGatePlaceholder === 'function'
      ? _tierGatePlaceholder('Owner DNA Profiles', FEATURES?.OWNER_DNA || 'owner_dna')
      : '<div style="padding:24px;text-align:center;color:var(--text3)">Upgrade to unlock Owner DNA Profiles.</div>';
    return;
  }
  if (typeof trackUsage === 'function') trackUsage('owner_dna_views');

  let html = `<div class="sec">Owner DNA Profiles <span class="sec-line"></span></div>
    <div style="font-size:13px;color:var(--text3);margin-bottom:12px;line-height:1.5">
      DNA profiles model each owner's trade psychology. Auto-derived from league trade history, or set manually via Override.
    </div>`;

  const sorted = [...assessments].sort((a, b) => b.healthScore - a.healthScore);

  sorted.forEach(a => {
    const dnaKey = _tcDnaMap[a.rosterId] || 'NONE';
    const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
    const derived = deriveDNAFromHistory(a.rosterId);
    const derivedKey = derived ? derived.key : null;
    const derivedDna = derivedKey ? DNA_TYPES[derivedKey] : null;
    const derivedConf = derived ? derived.confidence : 0;
    const posture = calcOwnerPosture(a, dnaKey);
    const isMe = _isMyRoster(a.rosterId);

    // Trade history stats from LeagueIntel owner profiles
    const li = _tcLI();
    const profile = _tcLILoaded() && li.ownerProfiles?.[a.rosterId];

    // Resolve most-traded-with partner name
    let topPartnerStr = '';
    if (profile?.partners) {
      const partnerEntries = Object.entries(profile.partners).sort((x, y) => y[1] - x[1]);
      if (partnerEntries.length) {
        const [pRid, pCount] = partnerEntries[0];
        const pAssessment = assessments.find(x => String(x.rosterId) === String(pRid));
        topPartnerStr = `${pAssessment?.ownerName || 'Owner ' + pRid} (${pCount}x)`;
      }
    }

    // Confidence display
    const confPct = Math.round(derivedConf * 100);
    const confColor = confPct >= 75 ? 'var(--green)' : confPct >= 50 ? 'var(--amber)' : 'var(--text3)';

    html += `
      <div class="card" style="margin-bottom:8px;${isMe ? 'border-color:rgba(212,175,55,.3)' : ''}">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <span style="font-size:14px;font-weight:700">${a.ownerName}${isMe ? ' <span style="font-size:13px;color:var(--accent)">(You)</span>' : ''}</span>
              <span style="font-size:13px;color:${a.tierColor};font-weight:600">${a.tier}</span>
            </div>

            <!-- Current DNA badge + posture -->
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
              <span style="font-size:13px;padding:3px 10px;border-radius:12px;font-weight:700;background:${dna.color}22;color:${dna.color};border:1px solid ${dna.color}40">${dna.label || 'Not Set'}</span>
              <span style="font-size:13px;padding:2px 6px;border-radius:8px;background:${posture.color}22;color:${posture.color};font-weight:600">${posture.label}</span>
            </div>
            ${dna.desc ? `<div style="font-size:13px;color:var(--text3);margin-bottom:6px">${dna.desc}</div>` : ''}

            <!-- Auto-derived DNA with confidence -->
            ${derivedKey ? `<div style="font-size:13px;margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="color:var(--text3)">Auto:</span>
              <span style="font-weight:700;color:${derivedDna.color}">${derivedDna.label}</span>
              <span style="color:${confColor};font-weight:600">(${confPct}% confidence)</span>
              <span style="width:40px;height:4px;border-radius:2px;background:var(--bg3);display:inline-block;vertical-align:middle;overflow:hidden"><span style="display:block;width:${confPct}%;height:100%;background:${confColor};border-radius:2px"></span></span>
              ${derivedKey !== dnaKey ? `<button class="btn btn-sm" style="font-size:13px;padding:2px 8px" onclick="_tcSetDNA(${a.rosterId},'${derivedKey}')">Apply</button>` : ''}
            </div>` : profile && profile.trades < 3 ? `<div style="font-size:13px;color:var(--text3);margin-bottom:6px">Auto: Insufficient data (${profile.trades} trade${profile.trades !== 1 ? 's' : ''}, need 3+)</div>` : ''}

            <!-- Trade history stats: wins/losses/fair, avg value diff, most traded with -->
            ${profile ? `<div style="display:flex;gap:10px;font-size:13px;color:var(--text3);flex-wrap:wrap;margin-bottom:4px">
              <span><span style="font-weight:600;color:var(--green)">${profile.tradesWon || 0}W</span> / <span style="font-weight:600;color:var(--red)">${profile.tradesLost || 0}L</span> / <span style="font-weight:600;color:var(--text2)">${profile.tradesFair || 0}F</span></span>
              <span>Avg diff: <span style="font-weight:600;color:${(profile.avgValueDiff || 0) >= 0 ? 'var(--green)' : 'var(--red)'}">${(profile.avgValueDiff || 0) >= 0 ? '+' : ''}${profile.avgValueDiff || 0}</span></span>
              ${topPartnerStr ? `<span>Most traded with: <span style="font-weight:600;color:var(--accent)">${topPartnerStr}</span></span>` : ''}
            </div>
            <div style="display:flex;gap:10px;font-size:13px;color:var(--text3);flex-wrap:wrap">
              <span>Trades: <span style="font-weight:600;color:var(--text2)">${profile.trades}</span></span>
              <span>Picks In: <span style="font-weight:600;color:var(--green)">${profile.picksAcquired || 0}</span></span>
              <span>Picks Out: <span style="font-weight:600;color:var(--red)">${profile.picksSold || 0}</span></span>
              ${profile.targetPos ? `<span>Targets: <span style="font-weight:600;color:var(--accent)">${profile.targetPos}</span></span>` : ''}
            </div>` : '<div style="font-size:13px;color:var(--text3)">No trade history data</div>'}
          </div>

          <!-- Override dropdown -->
          <div style="flex-shrink:0;text-align:right">
            <div style="font-size:13px;color:var(--text3);margin-bottom:2px">Override</div>
            <select style="font-size:13px;padding:4px 6px;width:110px" onchange="_tcSetDNA(${a.rosterId},this.value)">
              ${Object.entries(DNA_TYPES).map(([key, d]) => `<option value="${key}" ${key === dnaKey ? 'selected' : ''}>${d.label}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function _tcSetDNA(rosterId, dnaKey) {
  _tcDnaMap[rosterId] = dnaKey;
  if (S.currentLeagueId) {
    saveDNAProfile(S.currentLeagueId, rosterId, dnaKey);
  }
  showToast(`DNA set to ${DNA_TYPES[dnaKey]?.label || dnaKey}`);
  // Re-render DNA panel
  if (_tcActiveView === 'dna') {
    const container = $('tc-view-content');
    if (container) renderDNAPanel(_tcAssessments, container);
  }
}
window._tcSetDNA = _tcSetDNA;


// ═══════════════════════════════════════════════════════════════
// SECTION 7: Window Exports
// ═══════════════════════════════════════════════════════════════

Object.assign(window.App, {
  // Constants & builders
  DNA_TYPES,
  TRADE_PICK_VALUES,
  getPickDHQ,
  POSTURES,
  FAAB_RATE,
  buildIdealRoster,
  buildMinStarterQuality,
  buildPosWeights,
  buildNflStarterPool,

  // Assessment
  buildNflStarterSet,
  buildPicksByOwner,
  calcOptimalPPG,
  assessTeam,
  assessAllTeams,

  // Partner matching
  calcComplementarity,
  findBestPartners,

  // DNA & Psychology
  calcOwnerPosture,
  calcPsychTaxes,
  deriveDNAFromHistory,
  loadDNAProfiles,
  saveDNAProfile,

  // Trade value
  calcTradeValue,
  calcAcceptanceLikelihood,
  fairnessGrade,
});

// ── renderValueChart — browseable trade value chart ──────────

let _vcFilter = 'All';
let _vcSearch = '';

function renderValueChart(container) {
  if (!container) container = $('tc-view-content');
  if (!container) return;

  const li = _tcLI();
  const scores = (_tcLILoaded() && li.playerScores) ? li.playerScores : {};
  const positions = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'Picks'];

  // Build player list: id, name, team, pos, age, value, peak info
  let players = [];
  Object.keys(scores).forEach(pid => {
    const val = scores[pid] || 0;
    if (val <= 0) return;
    const p = S.players?.[pid];
    if (!p) return;
    const pos = normPos(p.position);
    const name = (p.first_name || '') + ' ' + (p.last_name || '');
    players.push({ pid, name, team: p.team || 'FA', pos, age: p.age || 0, val });
  });

  // Add draft picks as entries
  if (_vcFilter === 'All' || _vcFilter === 'Picks') {
    const teams = S.rosters?.length || 12;
    const curSeason = parseInt(S.season) || new Date().getFullYear();
    for (let yr = curSeason; yr <= curSeason + 2; yr++) {
      for (let rd = 1; rd <= (S.leagues?.find(l=>l.league_id===S.currentLeagueId)?.settings?.draft_rounds || 5); rd++) {
        const val = pickValue(yr, rd, teams, Math.ceil(teams/2));
        if (val > 0) {
          const ordinal = ['','1st','2nd','3rd','4th','5th','6th','7th'][rd] || rd+'th';
          players.push({ pid: `PICK-${yr}-${rd}`, name: `${yr} ${ordinal} Round Pick`, team: 'Mid', pos: 'PICK', age: 0, val, isPick: true });
        }
      }
    }
  }

  // Apply position filter
  if (_vcFilter !== 'All' && _vcFilter !== 'Picks') players = players.filter(p => p.pos === _vcFilter);
  if (_vcFilter === 'Picks') players = players.filter(p => p.isPick);

  // Apply search filter
  if (_vcSearch) {
    const q = _vcSearch.toLowerCase();
    players = players.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
  }

  // Sort by value descending
  players.sort((a, b) => b.val - a.val);

  const total = players.length;
  const visible = players.slice(0, _vcShowCount);

  // Position filter buttons
  let html = `<div class="sec">Trade Value Chart <span class="sec-line"></span></div>`;
  html += `<div class="card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:14px">`;
  html += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">`;
  positions.forEach(pos => {
    const active = _vcFilter === pos;
    const label = window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    html += `<button class="btn btn-sm ${active ? '' : 'btn-ghost'}" onclick="_vcSetFilter('${pos}')">${label}</button>`;
  });
  html += `<div style="flex:1"></div>`;
  html += `<input type="text" id="vc-search" placeholder="Search player or team…" value="${_vcSearch.replace(/"/g, '&quot;')}" oninput="_vcSetSearch(this.value)" style="font-size:13px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text1);width:180px;outline:none">`;
  html += `</div>`;

  // Count
  html += `<div style="font-size:13px;color:var(--text3);margin-bottom:8px">${total} player${total !== 1 ? 's' : ''} valued</div>`;

  // Header row
  html += `<div style="display:grid;grid-template-columns:36px 28px 1fr 42px 32px 72px 64px 32px;gap:4px;padding:4px 8px;font-size:13px;font-weight:700;color:var(--text3);border-bottom:2px solid var(--border);text-transform:uppercase;letter-spacing:.03em">`;
  html += `<span>#</span><span></span><span>Player</span><span>Pos</span><span>Age</span><span>Value</span><span>Phase</span><span></span>`;
  html += `</div>`;

  // Player rows
  html += `<div style="max-height:520px;overflow-y:auto">`;
  visible.forEach((p, i) => {
    const rank = i + 1;
    const { tier, col } = tradeValueTier(p.val);
    const pk = peakYears(p.pid);
    const initials = p.name.split(' ').map(n => (n[0] || '')).join('');
    // Trend arrow: Rising/Seedling = up, Peak = steady, Veteran/Declining = down
    const arrow = pk.cls === 'rising' || pk.cls === 'seedling' ? '<span style="color:var(--green)">&#9650;</span>'
      : pk.cls === 'peak' ? '<span style="color:var(--text3)">&#9654;</span>'
      : pk.cls === 'veteran' || pk.cls === 'declining' ? '<span style="color:var(--red)">&#9660;</span>' : '';

    const clickAction = p.isPick ? '' : `onclick="openPlayerModal('${p.pid}')"`;
    html += `<div style="display:grid;grid-template-columns:36px 28px 1fr 42px 32px 72px 64px 32px;gap:4px;padding:5px 8px;align-items:center;border-bottom:1px solid var(--border);cursor:${p.isPick?'default':'pointer'};transition:background .12s" ${clickAction} onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background=''">`;
    // Rank
    html += `<span style="font-size:13px;font-weight:700;color:var(--text3);font-family:'JetBrains Mono',monospace">${rank}</span>`;
    if (p.isPick) {
      // Pick icon
      const rdNum = parseInt(p.pid.split('-')[2]) || 1;
      const pickCol = {1:'#D4AF37',2:'#5DADE2',3:'#2ECC71',4:'#BB8FCE',5:'#95A5A6',6:'#7F8C8D',7:'#6C7A7D'}[rdNum] || 'var(--text3)';
      html += `<div style="width:24px;height:24px;border-radius:50%;background:${pickCol}22;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:${pickCol};flex-shrink:0">R${rdNum}</div>`;
      html += `<div style="overflow:hidden"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div><div style="font-size:13px;color:var(--text3)">Mid-round estimate</div></div>`;
      html += `<span style="font-size:13px;padding:1px 5px;background:${pickCol}18;color:${pickCol};border-radius:4px;font-weight:700">PICK</span>`;
      html += `<span style="font-size:13px;color:var(--text3)">—</span>`;
      html += `<span style="font-size:13px;font-weight:700;color:${col};font-family:'JetBrains Mono',monospace">${p.val.toLocaleString()}</span>`;
      html += `<span style="font-size:13px;color:var(--text3)">—</span>`;
      html += `<span></span>`;
    } else {
      // Photo
      html += `<div style="width:24px;height:24px;border-radius:50%;overflow:hidden;background:var(--bg4);display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="https://sleepercdn.com/content/nfl/players/${p.pid}.jpg" style="width:24px;height:24px;border-radius:50%" onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,var(--bg4),var(--bg3))';this.parentElement.style.border='1px solid var(--border2)';this.parentElement.innerHTML='<span style=\\'font-size:13px;font-weight:800;color:var(--text2);letter-spacing:.02em\\'>${initials}</span>'" loading="lazy"/></div>`;
      // Name + Team
      html += `<div style="overflow:hidden"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div><div style="font-size:13px;color:var(--text3)">${p.team}</div></div>`;
      // Pos badge
      html += `<span class="pos ${posClass(p.pos)}" style="font-size:13px;padding:1px 5px">${p.pos}</span>`;
      // Age
      html += `<span style="font-size:13px;color:var(--text2);font-family:'JetBrains Mono',monospace">${p.age || '—'}</span>`;
      // Value
      html += `<span style="font-size:13px;font-weight:700;color:${col};font-family:'JetBrains Mono',monospace">${p.val.toLocaleString()}</span>`;
      // Peak phase
      html += `<span style="font-size:13px;color:${pk.color};font-weight:600">${pk.label}</span>`;
      // Trend arrow
      html += `<span style="font-size:13px;text-align:center">${arrow}</span>`;
    }
    html += `</div>`;
  });
  html += `</div>`;

  // Show more button
  if (_vcShowCount < total) {
    const remaining = total - _vcShowCount;
    html += `<div style="text-align:center;padding:10px"><button class="btn btn-sm btn-ghost" onclick="_vcShowMore()">Show ${Math.min(50, remaining)} more (${remaining} remaining)</button></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function _vcSetFilter(pos) {
  _vcFilter = pos;
  _vcShowCount = 50;
  const el = $('tc-view-content');
  if (el) renderValueChart(el);
}
window._vcSetFilter = _vcSetFilter;

function _vcSetSearch(val) {
  _vcSearch = val;
  _vcShowCount = 50;
  const el = $('tc-view-content');
  if (el) renderValueChart(el);
}
window._vcSetSearch = _vcSetSearch;

function _vcShowMore() {
  _vcShowCount += 50;
  const el = $('tc-view-content');
  if (el) renderValueChart(el);
}
window._vcShowMore = _vcShowMore;


// ── renderTradeHistory — Trade History Visualization ──────────

let _thSeasonFilter = null;
let _thOwnerFilter = null;

function _thOwner(rid) {
  const a = _tcAssessments.find(x => x.rosterId === rid);
  return a ? a.ownerName : `Team ${rid}`;
}
function _thAvatar(rid) {
  const a = _tcAssessments.find(x => x.rosterId === rid);
  const _i = (_thOwner(rid)[0] || '?').toUpperCase();
  if (a?.avatar) return `<div style="position:relative;width:22px;height:22px;flex-shrink:0"><img src="https://sleepercdn.com/avatars/thumbs/${a.avatar}" style="width:22px;height:22px;border-radius:50%;object-fit:cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div style="display:none;width:22px;height:22px;border-radius:50%;background:var(--bg3);align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--text3)">${_i}</div></div>`;
  return `<div style="width:22px;height:22px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--text3)">${_i}</div>`;
}

function renderTradeHistory(container) {
  if (!container) container = $('tc-view-content');
  if (!container) return;
  const li = _tcLI();
  const trades = (_tcLILoaded() && li.tradeHistory) || [];
  const profiles = (_tcLILoaded() && li.ownerProfiles) || {};
  const myRid = S.myRosterId;
  if (!trades.length) { container.innerHTML = '<div class="card" style="text-align:center;color:var(--text3);padding:20px">No trade history available</div>'; return; }

  // Collect all seasons and owner rids
  const seasons = [...new Set(trades.map(t => t.season))].sort();
  const allRids = [...new Set(trades.flatMap(t => t.roster_ids))].sort((a, b) => a - b);
  let html = '';

  // ── 1. Trade Activity Heatmap ──
  html += `<div class="sec">Trade Activity Heatmap <span class="sec-line"></span></div>`;
  html += `<div class="card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:14px;overflow-x:auto;margin-bottom:16px">`;
  html += `<div style="display:grid;grid-template-columns:140px repeat(${seasons.length},1fr);gap:2px;font-size:13px">`;
  html += `<div style="font-weight:700;color:var(--text3)"></div>`;
  seasons.forEach(s => { html += `<div style="text-align:center;font-weight:700;color:var(--text3)">${s}</div>`; });
  allRids.forEach(rid => {
    const isMe = rid === myRid;
    html += `<div style="font-weight:${isMe ? '700' : '500'};color:${isMe ? 'var(--accent)' : 'var(--text2)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_thOwner(rid)}</div>`;
    seasons.forEach(s => {
      const ct = trades.filter(t => t.season === s && t.roster_ids.includes(rid)).length;
      const maxCt = Math.max(...allRids.map(r => trades.filter(t => t.season === s && t.roster_ids.includes(r)).length), 1);
      const intensity = ct > 0 ? 0.2 + 0.8 * (ct / maxCt) : 0;
      const bg = ct > 0 ? `rgba(69,183,209,${intensity.toFixed(2)})` : 'var(--bg3)';
      const active = _thSeasonFilter === s && _thOwnerFilter === rid;
      html += `<div onclick="_thFilterCell(${s},${rid})" style="text-align:center;padding:4px;border-radius:4px;background:${bg};cursor:pointer;font-weight:600;color:${ct > 0 ? 'var(--text1)' : 'var(--text3)'};${active ? 'outline:2px solid var(--accent)' : ''}">${ct || '·'}</div>`;
    });
  });
  html += `</div></div>`;

  // ── 2. Trade Network ──
  html += `<div class="sec">Trade Network <span class="sec-line"></span></div>`;
  html += `<div class="card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:14px;margin-bottom:16px">`;
  const pairMap = {};
  trades.forEach(t => {
    if (t.roster_ids.length !== 2) return;
    const [a, b] = t.roster_ids.slice().sort((x, y) => x - y);
    const key = `${a}-${b}`;
    if (!pairMap[key]) pairMap[key] = { a, b, total: 0, aWon: 0, bWon: 0 };
    pairMap[key].total++;
    if (t.winner === a) pairMap[key].aWon++;
    else if (t.winner === b) pairMap[key].bWon++;
  });
  const pairs = Object.values(pairMap).sort((x, y) => y.total - x.total);
  if (!pairs.length) html += `<div style="color:var(--text3);text-align:center;padding:8px">No 2-team trades found</div>`;
  pairs.slice(0, 20).forEach(p => {
    const myInvolved = p.a === myRid || p.b === myRid;
    const myWins = p.a === myRid ? p.aWon : p.b === myRid ? p.bWon : 0;
    const myLoss = p.a === myRid ? p.bWon : p.b === myRid ? p.aWon : 0;
    const col = myInvolved ? (myWins > myLoss ? 'var(--green)' : myLoss > myWins ? 'var(--red)' : 'var(--text2)') : 'var(--text2)';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;color:${col}">`;
    html += `${_thAvatar(p.a)} <span style="font-weight:600">${_thOwner(p.a)}</span>`;
    html += `<span style="color:var(--text3);font-size:13px">\u21C4</span>`;
    html += `${_thAvatar(p.b)} <span style="font-weight:600">${_thOwner(p.b)}</span>`;
    html += `<span style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:13px">${p.total} trade${p.total > 1 ? 's' : ''}</span>`;
    html += `<span style="font-size:13px;color:var(--text3)">(${_thOwner(p.a).split(' ')[0]} ${p.aWon}W, ${_thOwner(p.b).split(' ')[0]} ${p.bWon}W)</span>`;
    html += `</div>`;
  });
  html += `</div>`;

  // ── 3. Trade Leaderboard ──
  html += `<div class="sec">Trade Leaderboard <span class="sec-line"></span></div>`;
  html += `<div class="card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:14px;margin-bottom:16px">`;
  html += `<div style="display:grid;grid-template-columns:32px 22px 1fr 80px 60px 60px 60px 80px 90px;gap:4px;padding:4px 6px;font-size:13px;font-weight:700;color:var(--text3);border-bottom:2px solid var(--border);text-transform:uppercase;letter-spacing:.03em">`;
  html += `<span>#</span><span></span><span>Owner</span><span>Record</span><span>Won</span><span>Lost</span><span>Fair</span><span>Avg Val</span><span>Badge</span></div>`;
  const ranked = allRids.map(rid => {
    const p = profiles[rid] || {};
    const total = (p.tradesWon || 0) + (p.tradesLost || 0) + (p.tradesFair || 0);
    const score = total > 0 ? ((p.tradesWon || 0) - (p.tradesLost || 0)) / total : 0;
    return { rid, ...p, total, score };
  }).filter(r => r.total > 0).sort((a, b) => b.score - a.score);

  const bestRid = ranked[0]?.rid;
  const worstRid = ranked[ranked.length - 1]?.rid;
  ranked.forEach((r, i) => {
    const isMe = r.rid === myRid;
    const badge = r.rid === bestRid ? '<span style="color:#D4AF37;font-weight:700" title="Best Trader">Best Trader</span>'
      : r.rid === worstRid && ranked.length > 1 ? '<span style="color:var(--red);font-weight:700" title="Most Fleeced">Most Fleeced</span>' : '';
    const avgCol = (r.avgValueDiff || 0) >= 0 ? 'var(--green)' : 'var(--red)';
    html += `<div style="display:grid;grid-template-columns:32px 22px 1fr 80px 60px 60px 60px 80px 90px;gap:4px;padding:5px 6px;align-items:center;border-bottom:1px solid var(--border);${isMe ? 'background:rgba(69,183,209,0.08);border-radius:6px' : ''}">`;
    html += `<span style="font-size:13px;font-weight:700;color:var(--text3);font-family:'JetBrains Mono',monospace">${i + 1}</span>`;
    html += _thAvatar(r.rid);
    html += `<span style="font-weight:${isMe ? '700' : '500'};color:${isMe ? 'var(--accent)' : 'var(--text1)'};font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_thOwner(r.rid)}</span>`;
    html += `<span style="font-size:13px;font-family:'JetBrains Mono',monospace;color:var(--text2)">${r.tradesWon || 0}-${r.tradesLost || 0}-${r.tradesFair || 0}</span>`;
    html += `<span style="font-size:13px;color:var(--green);font-weight:600">${r.tradesWon || 0}</span>`;
    html += `<span style="font-size:13px;color:var(--red);font-weight:600">${r.tradesLost || 0}</span>`;
    html += `<span style="font-size:13px;color:var(--text3)">${r.tradesFair || 0}</span>`;
    html += `<span style="font-size:13px;font-family:'JetBrains Mono',monospace;color:${avgCol}">${(r.avgValueDiff || 0) >= 0 ? '+' : ''}${(r.avgValueDiff || 0).toLocaleString()}</span>`;
    html += `<span style="font-size:13px">${badge}</span>`;
    html += `</div>`;
  });
  html += `</div>`;

  // ── 4. Recent Trades Feed ──
  const filteredTrades = (_thSeasonFilter && _thOwnerFilter)
    ? trades.filter(t => t.season === _thSeasonFilter && t.roster_ids.includes(_thOwnerFilter))
    : null;
  const feedTrades = (filteredTrades || trades.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))).slice(0, 10);
  const feedTitle = filteredTrades ? `Trades: ${_thOwner(_thOwnerFilter)} in ${_thSeasonFilter}` : 'Recent Trades';
  html += `<div class="sec">${feedTitle} ${filteredTrades ? `<span style="font-size:13px;cursor:pointer;color:var(--accent);margin-left:8px" onclick="_thClearFilter()">[clear filter]</span>` : ''}<span class="sec-line"></span></div>`;
  html += `<div class="card" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:14px">`;
  if (!feedTrades.length) html += `<div style="color:var(--text3);text-align:center;padding:8px">No trades found</div>`;
  feedTrades.forEach(t => {
    const rids = t.roster_ids || [];
    const date = t.ts ? new Date(t.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `S${t.season} W${t.week}`;
    const fg = (() => {
      const maxVal = Math.max(...rids.map(r => t.sides[r]?.totalValue || 0), 1);
      const diff = t.valueDiff || 0;
      const pct = diff / maxVal;
      if (pct <= 0.05) return { grade: 'A+', color: 'var(--green)' };
      if (pct <= 0.10) return { grade: 'A', color: 'var(--green)' };
      if (pct <= 0.15) return { grade: 'B+', color: '#2ECC71' };
      if (pct <= 0.22) return { grade: 'B', color: 'var(--accent)' };
      if (pct <= 0.30) return { grade: 'C', color: 'var(--amber)' };
      if (pct <= 0.40) return { grade: 'D', color: '#F0A500' };
      return { grade: 'F', color: 'var(--red)' };
    })();
    html += `<div style="border-bottom:1px solid var(--border);padding:10px 0">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">`;
    html += `<span style="font-size:13px;color:var(--text3)">${date}</span>`;
    html += `<span style="font-size:13px;font-weight:700;color:${fg.color}">${fg.grade}</span>`;
    html += `</div>`;
    rids.forEach(rid => {
      const side = t.sides[rid] || {};
      const isWinner = t.winner === rid;
      const players = (side.players || []).map(pid => pNameShort(pid)).join(', ') || 'none';
      const picks = (side.picks || []).map(pk => `${pk.season} Rd${pk.round}`).join(', ');
      const assets = [players, picks].filter(Boolean).join(' + ');
      html += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">`;
      html += `${_thAvatar(rid)} <span style="font-weight:600;color:${isWinner ? 'var(--green)' : 'var(--text2)'}${rid === myRid ? ';text-decoration:underline' : ''}">${_thOwner(rid)}${isWinner ? ' ✓' : ''}</span>`;
      html += `<span style="color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${assets}">${assets}</span>`;
      html += `<span style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text2)">${(side.totalValue || 0).toLocaleString()}</span>`;
      html += `</div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;

  container.innerHTML = html;
}

function _thFilterCell(season, rid) {
  if (_thSeasonFilter === season && _thOwnerFilter === rid) { _thSeasonFilter = null; _thOwnerFilter = null; }
  else { _thSeasonFilter = season; _thOwnerFilter = rid; }
  const el = $('tc-view-content');
  if (el) renderTradeHistory(el);
}
window._thFilterCell = _thFilterCell;

function _thClearFilter() {
  _thSeasonFilter = null; _thOwnerFilter = null;
  const el = $('tc-view-content');
  if (el) renderTradeHistory(el);
}
window._thClearFilter = _thClearFilter;


// initTradeCalc — called when Trades tab is shown
async function initTradeCalc() {
  if (!S.rosters?.length || !S.players || !Object.keys(S.players).length) return;
  if (_tcAssessments.length) {
    await renderTradeStudio();
    return;
  }
  await renderTradeStudio();
}

// ═══════════════════════════════════════════════════════════════
// TRADE FINDER — auto-generate trade proposals
// Select a player, get 3 best trade offers from 3 best teams
// ═══════════════════════════════════════════════════════════════

let _finderMode = 'my'; // 'my' or 'acquire'
let _finderSelectedPid = null;
let _finderResults = null;
let _finderContainer = null; // track last render target
let _finderShowMoonshots = false;
const FINDER_DEFAULT_ACTIONABLE_ACCEPTANCE_FLOOR = 75;

function _finderAcceptanceFloorFromAggression(value) {
  const raw = Number(value);
  const aggression = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 50;
  if (aggression <= 50) return Math.round(75 + ((50 - aggression) / 50) * 10);
  return Math.round(75 - ((aggression - 50) / 50) * 20);
}

function _finderActionableAcceptanceFloor() {
  try {
    const settings = window.WR?.AlexSettings?.get?.();
    const sharedFloor = window.WR?.AlexSettings?.actionableTradeAcceptanceFloor?.(settings || {});
    if (Number.isFinite(Number(sharedFloor))) return Math.max(55, Math.min(90, Math.round(Number(sharedFloor))));
  } catch (_) {}
  try {
    const strategy = window.GMStrategy?.getStrategy?.() || {};
    if (strategy.tradeAggression != null) return _finderAcceptanceFloorFromAggression(strategy.tradeAggression);
    if (strategy.aggression === 'aggressive' || strategy.aggression === 'high') return 55;
    if (strategy.aggression === 'conservative' || strategy.aggression === 'low') return 85;
  } catch (_) {}
  return FINDER_DEFAULT_ACTIONABLE_ACCEPTANCE_FLOOR;
}

function _finderSetMode(mode) {
  _finderMode = mode;
  _finderSelectedPid = null;
  _finderResults = null;
  _finderShowMoonshots = false;
  const el = _finderContainer || $('tc-view-content') || $('league-trade-finder-host');
  if (el) renderTradeFinder(el);
}
window._finderSetMode = _finderSetMode;

function _finderSelect(pid) {
  _finderSelectedPid = pid;
  _finderResults = null;
  _finderShowMoonshots = false;
  _finderGenerate(pid);
}
window._finderSelect = _finderSelect;

function _finderToggleMoonshots() {
  _finderShowMoonshots = !_finderShowMoonshots;
  _finderRefresh();
}
window._finderToggleMoonshots = _finderToggleMoonshots;

function _finderGenerate(pid) {
  const val = dynastyValue(pid);
  if (!val) { _finderResults = []; _finderRefresh(); return; }

  const tolerance = 0.20;
  const minVal = val * (1 - tolerance);
  const maxVal = val * (1 + tolerance);
  const myRosterId = S.myRosterId;
  const myAssess = _tcAssessments.find(a => a.rosterId === myRosterId);
  const teams = S.rosters?.length || 12;
  const allPBO = buildPicksByOwner();
  const results = [];

  if (_finderMode === 'my') {
    // Shopping my player — find offers from other teams
    _tcAssessments.forEach(a => {
      if (_isMyRoster(a.rosterId)) return;
      const roster = S.rosters.find(r => r.roster_id === a.rosterId);
      if (!roster) return;
      const dnaKey = _tcDnaMap[a.rosterId] || 'NONE';
      const theirPosture = calcOwnerPosture(a, dnaKey);
      const theirPlayers = (roster.players || [])
        .map(p => ({ pid: p, val: dynastyValue(p) }))
        .filter(p => p.val > 0)
        .sort((b,c) => c.val - b.val);
      const theirPicks = allPBO[a.rosterId] || [];

      const trades = [];

      // 1-for-1
      theirPlayers.forEach(tp => {
        if (tp.val >= minVal && tp.val <= maxVal) {
          const taxes = calcPsychTaxes(myAssess, a, dnaKey, theirPosture);
          const likelihood = calcAcceptanceLikelihood(val, tp.val, dnaKey, taxes, myAssess, a);
          trades.push({ give: [{ pid, val }], receive: [{ pid: tp.pid, val: tp.val }], givePicks: [], receivePicks: [], diff: tp.val - val, likelihood, type: '1-for-1' });
        }
      });

      // 2-for-1
      for (let i = 0; i < Math.min(theirPlayers.length, 12); i++) {
        for (let j = i+1; j < Math.min(theirPlayers.length, 12); j++) {
          const combo = theirPlayers[i].val + theirPlayers[j].val;
          if (combo >= minVal && combo <= maxVal) {
            const taxes = calcPsychTaxes(myAssess, a, dnaKey, theirPosture);
            const likelihood = calcAcceptanceLikelihood(val, combo, dnaKey, taxes, myAssess, a);
            trades.push({ give: [{ pid, val }], receive: [{ pid: theirPlayers[i].pid, val: theirPlayers[i].val }, { pid: theirPlayers[j].pid, val: theirPlayers[j].val }], givePicks: [], receivePicks: [], diff: combo - val, likelihood, type: '2-for-1' });
            break;
          }
        }
      }

      // Player + pick
      theirPlayers.slice(0, 8).forEach(tp => {
        if (tp.val >= val) return;
        const gap = val - tp.val;
        const bestPick = theirPicks.find(pk => {
          const pv = pickValue(pk.year, pk.round, teams);
          return Math.abs(pv - gap) <= val * tolerance;
        });
        if (bestPick) {
          const pv = pickValue(bestPick.year, bestPick.round, teams);
          const total = tp.val + pv;
          const taxes = calcPsychTaxes(myAssess, a, dnaKey, theirPosture);
          const likelihood = calcAcceptanceLikelihood(val, total, dnaKey, taxes, myAssess, a);
          trades.push({ give: [{ pid, val }], receive: [{ pid: tp.pid, val: tp.val }], givePicks: [], receivePicks: [{ year: bestPick.year, round: bestPick.round, val: pv }], diff: total - val, likelihood, type: 'Player + Pick' });
        }
      });

      trades.sort((b,c) => c.likelihood - b.likelihood);
      if (trades.length) results.push({ assessment: a, dnaKey, trades }); // all viable trades per team, sorted by likelihood
    });
  } else {
    // Acquiring a player — find what I can offer
    const ownerRoster = S.rosters.find(r => (r.players || []).includes(pid));
    if (!ownerRoster) { _finderResults = []; _finderRefresh(); return; }
    const theirAssess = _tcAssessments.find(a => a.rosterId === ownerRoster.roster_id);
    if (!theirAssess) { _finderResults = []; _finderRefresh(); return; }
    const dnaKey = _tcDnaMap[ownerRoster.roster_id] || 'NONE';
    const theirPosture = calcOwnerPosture(theirAssess, dnaKey);
    const myRoster = S.rosters.find(r => r.roster_id === myRosterId);
    const myPlayers = (myRoster?.players || [])
      .filter(p => p !== pid)
      .map(p => ({ pid: p, val: dynastyValue(p) }))
      .filter(p => p.val > 0)
      .sort((b,c) => c.val - b.val);
    const myPicks = allPBO[myRosterId] || [];

    const trades = [];

    // 1-for-1
    myPlayers.forEach(mp => {
      if (mp.val >= minVal && mp.val <= maxVal) {
        const taxes = calcPsychTaxes(myAssess, theirAssess, dnaKey, theirPosture);
        const likelihood = calcAcceptanceLikelihood(mp.val, val, dnaKey, taxes, myAssess, theirAssess);
        trades.push({ give: [{ pid: mp.pid, val: mp.val }], receive: [{ pid, val }], givePicks: [], receivePicks: [], diff: val - mp.val, likelihood, type: '1-for-1' });
      }
    });

    // 2-for-1
    for (let i = 0; i < Math.min(myPlayers.length, 12); i++) {
      for (let j = i+1; j < Math.min(myPlayers.length, 12); j++) {
        const combo = myPlayers[i].val + myPlayers[j].val;
        if (combo >= minVal && combo <= maxVal) {
          const taxes = calcPsychTaxes(myAssess, theirAssess, dnaKey, theirPosture);
          const likelihood = calcAcceptanceLikelihood(combo, val, dnaKey, taxes, myAssess, theirAssess);
          trades.push({ give: [{ pid: myPlayers[i].pid, val: myPlayers[i].val }, { pid: myPlayers[j].pid, val: myPlayers[j].val }], receive: [{ pid, val }], givePicks: [], receivePicks: [], diff: val - combo, likelihood, type: '2-for-1' });
          break;
        }
      }
    }

    // Player + my pick
    myPlayers.slice(0, 8).forEach(mp => {
      if (mp.val >= val) return;
      const gap = val - mp.val;
      const bestPick = myPicks.find(pk => {
        const pv = pickValue(pk.year, pk.round, teams);
        return Math.abs(pv - gap) <= val * tolerance;
      });
      if (bestPick) {
        const pv = pickValue(bestPick.year, bestPick.round, teams);
        const total = mp.val + pv;
        if (total >= minVal && total <= maxVal) {
          const taxes = calcPsychTaxes(myAssess, theirAssess, dnaKey, theirPosture);
          const likelihood = calcAcceptanceLikelihood(total, val, dnaKey, taxes, myAssess, theirAssess);
          trades.push({ give: [{ pid: mp.pid, val: mp.val }], receive: [{ pid, val }], givePicks: [{ year: bestPick.year, round: bestPick.round, val: pv }], receivePicks: [], diff: val - total, likelihood, type: 'Player + Pick' });
        }
      }
    });

    trades.sort((b,c) => c.likelihood - b.likelihood);
    if (trades.length) results.push({ assessment: theirAssess, dnaKey, trades }); // all viable offers, sorted by likelihood
  }

  // Sort teams by best likelihood — return every team with at least one viable trade
  results.sort((a,b) => {
    const aMax = Math.max(...a.trades.map(t => t.likelihood));
    const bMax = Math.max(...b.trades.map(t => t.likelihood));
    return bMax - aMax;
  });
  _finderResults = results;
  _finderRefresh();
}

function _finderRefresh() {
  const el = _finderContainer || $('tc-view-content') || $('league-trade-finder-host');
  if (el) renderTradeFinder(el);
}

function _tcGetFinderDeal(rosterId, tradeIndex) {
  const result = (_finderResults || []).find(r => Number(r.assessment.rosterId) === Number(rosterId));
  if (!result) return null;
  const trade = result.trades?.[Number(tradeIndex)];
  if (!trade) return null;
  return { result, trade };
}

function _tcLoadFinderDeal(rosterId, tradeIndex) {
  const deal = _tcGetFinderDeal(rosterId, tradeIndex);
  if (!deal) return;
  _tcBuilderMy = _tcMyAssessment;
  _tcBuilderTheir = deal.result.assessment;
  _tcBuilderMyAssets = {
    players: deal.trade.give.map(p => String(p.pid)),
    picks: (deal.trade.givePicks || []).map(pk => ({ year: pk.year, round: pk.round, originalOwnerRid: pk.originalOwnerRid || S.myRosterId })),
    faab: deal.trade.giveFaab || 0
  };
  _tcBuilderTheirAssets = {
    players: deal.trade.receive.map(p => String(p.pid)),
    picks: (deal.trade.receivePicks || []).map(pk => ({ year: pk.year, round: pk.round, originalOwnerRid: pk.originalOwnerRid || deal.result.assessment.rosterId })),
    faab: deal.trade.receiveFaab || 0
  };
  _tcActiveView = 'builder';
  const el = $('trade-calc-container');
  if (el) _renderTradeCalcShell(el);
}
window._tcLoadFinderDeal = _tcLoadFinderDeal;

function _tcDealSideLabel(players, picks) {
  const playerNames = (players || []).map(p => pNameShort(p.pid));
  const pickNames = (picks || []).map(pk => `${pk.year} R${pk.round}`);
  return playerNames.concat(pickNames).join(' + ') || 'nothing';
}

function _tcSaveFinderDeal(rosterId, tradeIndex) {
  const deal = _tcGetFinderDeal(rosterId, tradeIndex);
  if (!deal || typeof window.addFieldLogEntry !== 'function') return;
  const give = _tcDealSideLabel(deal.trade.give, deal.trade.givePicks);
  const receive = _tcDealSideLabel(deal.trade.receive, deal.trade.receivePicks);
  const text = `Trade option saved: ${give} for ${receive} with ${deal.result.assessment.ownerName} - ${Math.round(deal.trade.likelihood)}% acceptance`;
  const players = deal.trade.give.concat(deal.trade.receive).map(p => ({ id: p.pid, name: pName(p.pid) }));
  window.addFieldLogEntry('🔄', text, 'trade', {
    actionType: 'trade_option_saved',
    players,
    context: {
      partnerRosterId: deal.result.assessment.rosterId,
      likelihood: Math.round(deal.trade.likelihood),
      type: deal.trade.type,
      give,
      receive
    }
  });
  if (typeof showToast === 'function') showToast('Trade option saved');
}
window._tcSaveFinderDeal = _tcSaveFinderDeal;

function renderTradeFinder(container) {
  if (!container) container = _finderContainer || $('tc-view-content');
  if (!container) return;
  _finderContainer = container;

  const myRosterId = S.myRosterId;
  const myPlayers = (S.rosters?.find(r => r.roster_id === myRosterId)?.players || [])
    .map(pid => ({ pid, name: pName(pid), pos: pPos(pid), val: dynastyValue(pid) }))
    .filter(p => p.val > 0)
    .sort((a,b) => b.val - a.val);

  const allOtherPlayers = [];
  (S.rosters || []).forEach(r => {
    if (_isMyRoster(r.roster_id)) return;
    (r.players || []).forEach(pid => {
      const v = dynastyValue(pid);
      if (v > 0) allOtherPlayers.push({ pid, name: pName(pid), pos: pPos(pid), val: v });
    });
  });
  allOtherPlayers.sort((a,b) => b.val - a.val);

  const playerList = _finderMode === 'my' ? myPlayers : allOtherPlayers.slice(0, 50);

  let html = `<div class="sec">Deal Generator <span class="sec-line"></span></div>`;
  html += `<div style="font-size:13px;color:var(--text3);margin-bottom:12px;line-height:1.5">Start with a player you want to shop or acquire. Scout ranks packages by partner, value fit, picks, and acceptance likelihood, then lets you save or inspect the deal.</div>`;

  // Mode toggle
  html += `<div style="display:flex;gap:6px;margin-bottom:14px">`;
  html += `<button class="btn btn-sm ${_finderMode==='my'?'':'btn-ghost'}" onclick="_finderSetMode('my')">Trade My Player</button>`;
  html += `<button class="btn btn-sm ${_finderMode==='acquire'?'':'btn-ghost'}" onclick="_finderSetMode('acquire')">Acquire a Player</button>`;
  html += `</div>`;

  // Player selector
  html += `<div style="font-size:13px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600">${_finderMode==='my'?'Select your player to shop':'Select a player to acquire'}</div>`;
  html += `<div class="tc-player-chip-grid">`;
  playerList.forEach(p => {
    const sel = _finderSelectedPid === p.pid;
    html += `<button class="btn btn-sm ${sel?'':'btn-ghost'}" onclick="_finderSelect('${p.pid}')" style="font-size:13px;padding:3px 8px;${sel?'':'opacity:0.7'}">${p.name} <span style="opacity:0.5">${p.val.toLocaleString()}</span></button>`;
  });
  html += `</div>`;

  // Results
  if (_finderSelectedPid && !_finderResults) {
    html += `<div style="text-align:center;padding:20px;color:var(--accent)">Generating trades...</div>`;
  } else if (_finderResults && !_finderResults.length) {
    html += `<div style="text-align:center;padding:20px;color:var(--text3)">No viable trades found within 20% value variance.</div>`;
  } else if (_finderResults) {
    const acceptanceFloor = _finderActionableAcceptanceFloor();
    const hiddenMoonshotCount = _finderResults.reduce((sum, r) => sum + (r.trades || []).filter(t => t.likelihood < acceptanceFloor).length, 0);
    const visibleResults = _finderResults
      .map(r => ({ ...r, trades: _finderShowMoonshots ? (r.trades || []) : (r.trades || []).filter(t => t.likelihood >= acceptanceFloor) }))
      .filter(r => r.trades.length);
    if (!visibleResults.length) {
      html += `<div style="text-align:center;padding:20px;color:var(--text3)">No actionable trades clear ${acceptanceFloor}% acceptance.</div>`;
    }
    if (hiddenMoonshotCount) {
      html += `<button class="btn btn-sm btn-ghost" onclick="_finderToggleMoonshots()" style="margin-bottom:12px">${_finderShowMoonshots ? 'Hide moonshots' : `Show ${hiddenMoonshotCount} moonshot${hiddenMoonshotCount === 1 ? '' : 's'}`}</button>`;
    }
    visibleResults.forEach(r => {
      const dna = DNA_TYPES[r.dnaKey] || DNA_TYPES.NONE;
      html += `<div style="margin-bottom:16px;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl)">`;
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">`;
      html += `<span style="font-size:14px;font-weight:700;color:var(--text)">${r.assessment.ownerName}</span>`;
      html += `<span style="font-size:13px;color:var(--text3)">${r.assessment.teamName}</span>`;
      html += `<span style="font-size:13px;font-weight:700;color:${r.assessment.tierColor};background:${r.assessment.tierBg};padding:1px 6px;border-radius:3px">${r.assessment.tier}</span>`;
      if (r.dnaKey !== 'NONE') html += `<span style="font-size:13px;color:${dna.color};font-weight:700">${dna.label}</span>`;
      html += `</div>`;

      r.trades.forEach((t, tradeIndex) => {
        const giveTotal = t.give.reduce((s,p) => s + p.val, 0) + t.givePicks.reduce((s,p) => s + (p.val||0), 0);
        const getTotal = t.receive.reduce((s,p) => s + p.val, 0) + t.receivePicks.reduce((s,p) => s + (p.val||0), 0);
        const diffLabel = t.diff >= 0 ? `+${Math.round(t.diff).toLocaleString()}` : Math.round(t.diff).toLocaleString();
        const diffCol = t.diff >= 0 ? 'var(--green)' : 'var(--red)';
        const lklCol = t.likelihood >= 60 ? 'var(--green)' : t.likelihood >= 40 ? 'var(--amber,#fbbf24)' : 'var(--red)';

        html += `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:10px;margin-bottom:6px">`;
        html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">`;
        html += `<span style="font-size:13px;color:var(--accent);font-weight:700;text-transform:uppercase">${t.type}</span>`;
        html += `<div style="display:flex;gap:8px;align-items:center">`;
        html += `<span style="font-size:13px;color:${diffCol}">${diffLabel} DHQ</span>`;
        html += `<span style="font-size:13px;font-weight:800;color:${lklCol};background:${lklCol}15;padding:2px 8px;border-radius:4px">${Math.round(t.likelihood)}%</span>`;
        html += `</div></div>`;

        html += `<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:start">`;
        // Give side
        html += `<div><div style="font-size:13px;color:var(--red);text-transform:uppercase;font-weight:700;margin-bottom:3px">SEND (${giveTotal.toLocaleString()})</div>`;
        t.give.forEach(p => html += `<div style="font-size:13px;font-weight:600">${pName(p.pid)} <span style="color:var(--text3);font-size:13px">${pPos(p.pid)} ${p.val.toLocaleString()}</span></div>`);
        t.givePicks.forEach(pk => html += `<div style="font-size:13px;color:var(--accent);font-weight:600">${pk.year} R${pk.round} <span style="color:var(--text3);font-size:13px">${(pk.val||0).toLocaleString()}</span></div>`);
        html += `</div>`;
        // Arrow
        html += `<div style="font-size:16px;color:var(--accent);align-self:center;font-weight:700">&#8644;</div>`;
        // Receive side
        html += `<div><div style="font-size:13px;color:var(--green);text-transform:uppercase;font-weight:700;margin-bottom:3px">GET (${getTotal.toLocaleString()})</div>`;
        t.receive.forEach(p => html += `<div style="font-size:13px;font-weight:600">${pName(p.pid)} <span style="color:var(--text3);font-size:13px">${pPos(p.pid)} ${p.val.toLocaleString()}</span></div>`);
        t.receivePicks.forEach(pk => html += `<div style="font-size:13px;color:var(--accent);font-weight:600">${pk.year} R${pk.round} <span style="color:var(--text3);font-size:13px">${(pk.val||0).toLocaleString()}</span></div>`);
        html += `</div></div>
          <div class="tc-deal-actions">
            <button onclick="_tcLoadFinderDeal(${r.assessment.rosterId},${tradeIndex})">Load Builder</button>
            <button onclick="_tcSaveFinderDeal(${r.assessment.rosterId},${tradeIndex})">Save</button>
            <button onclick="fillGlobalChat(${JSON.stringify(`Analyze this trade idea with ${r.assessment.ownerName}: I give ${_tcDealSideLabel(t.give, t.givePicks)} and I get ${_tcDealSideLabel(t.receive, t.receivePicks)}. Explain why they accept, why I should or should not do it, and what counter I should expect.`)})">Ask Scout</button>
          </div>
        </div>`;
      });

      html += `</div>`;
    });
  }

  container.innerHTML = html;
}

// Rendering functions on window (called from onclick handlers)
Object.assign(window, {
  renderTradeCalc,
  renderTradeStudio,
  initTradeCalc,
  renderLeagueOverview,
  renderTeamScout,
  renderPartnerFinder,
  renderTradeBuilder,
  renderDNAPanel,
  renderValueChart,
  renderTradeHistory,
  renderTradeFinder,
});

// ── Module global exports (Vite migration) ───────────────────────────────────
window.DNA_TYPES = DNA_TYPES;
window.TRADE_PICK_VALUES = TRADE_PICK_VALUES;
window.getPickDHQ = getPickDHQ;
window.calcTradeValue = calcTradeValue;
window.fairnessGrade = fairnessGrade;
window.calcAcceptanceLikelihood = calcAcceptanceLikelihood;
window.deriveDNAFromHistory = deriveDNAFromHistory;
window.loadDNAProfiles = loadDNAProfiles;
window.saveDNAProfile = saveDNAProfile;
window.findBestPartners = findBestPartners;
window.calcOwnerPosture = calcOwnerPosture;
window.assessAllTeams = assessAllTeams;
window.assessTeam = assessTeam;
