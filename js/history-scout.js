// ══════════════════════════════════════════════════════════════════
// js/history-scout.js — Scout League History (premium module)
// Ports warroom/js/shared/league-history.js (WrHistory: walks the Sleeper
// previous_league_id chain, aggregates per-owner records + champions) and
// renders a compact mobile history surface. Gated FEATURES.LEAGUE_HISTORY.
//
// Self-contained: nothing external in Scout calls window.buildOwnerHistory
// (analytics-engine uses its own module-local copy), and App.LI.championships
// is only read elsewhere — so this is additive. Lazy-loads on tab open.
// ══════════════════════════════════════════════════════════════════

// ─── WrHistory fetcher (ported verbatim from War Room) ───────────────
(function () {
  'use strict';
  const SLEEPER = 'https://api.sleeper.app/v1';
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const CHAIN_MAX = 15;
  const CACHE_KEY = (lid) => 'wr_history_' + lid;
  const memoryCache = {};

  function fetchJson(url) { return fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null); }

  async function walkChain(startId) {
    const out = []; let lid = startId; const seen = new Set();
    while (lid && lid !== '0' && out.length < CHAIN_MAX && !seen.has(lid)) {
      seen.add(lid);
      const info = await fetchJson(SLEEPER + '/league/' + lid);
      if (!info) break;
      out.push({ leagueId: lid, season: parseInt(info.season) || null, info });
      lid = info.previous_league_id;
    }
    return out;
  }

  async function fetchSeasonData(leagueId) {
    const [rosters, users, bracket] = await Promise.all([
      fetchJson(SLEEPER + '/league/' + leagueId + '/rosters'),
      fetchJson(SLEEPER + '/league/' + leagueId + '/users'),
      fetchJson(SLEEPER + '/league/' + leagueId + '/winners_bracket'),
    ]);
    return { rosters, users, bracket };
  }

  function placementsFromBracket(bracket) {
    const out = {};
    if (!Array.isArray(bracket) || !bracket.length) return out;
    bracket.forEach(b => {
      if (!b || b.w == null) return;
      if (b.p === 1) { out[b.w] = 1; if (b.l != null) out[b.l] = 2; }
      else if (b.p === 3) { out[b.w] = 3; if (b.l != null) out[b.l] = 4; }
      else if (b.p === 5) { out[b.w] = 5; if (b.l != null) out[b.l] = 6; }
      else if (b.p === 7) { out[b.w] = 7; if (b.l != null) out[b.l] = 8; }
    });
    if (!Object.keys(out).length) {
      const maxR = Math.max(...bracket.map(b => b.r || 0));
      const finals = bracket.filter(b => b.r === maxR);
      if (finals.length === 1 && finals[0].w != null) { out[finals[0].w] = 1; if (finals[0].l != null) out[finals[0].l] = 2; }
    }
    return out;
  }

  function rosterFinish(place, w, l, t) {
    if (place === 1) return 'Champion';
    if (place === 2) return 'Runner-Up';
    if (place === 3) return '3rd';
    if (place === 4) return '4th';
    if (place && place <= 8) return '#' + place;
    if ((w || 0) + (l || 0) + (t || 0) > 0) return w + '-' + l + (t ? '-' + t : '');
    return '—';
  }

  async function build(currentLeague) {
    const startId = currentLeague?.id || currentLeague?.league_id;
    if (!startId) return null;
    try {
      const raw = localStorage.getItem(CACHE_KEY(startId));
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) { populateGlobals(cached, startId); return cached; }
      }
    } catch { /* fall through */ }

    const chain = await walkChain(startId);
    if (!chain.length) return null;
    const seasons = await Promise.all(chain.map(c => fetchSeasonData(c.leagueId).then(d => ({ ...c, ...d }))));

    const currentRosterByOwner = {};
    (currentLeague?.rosters || []).forEach(r => { if (r.owner_id) currentRosterByOwner[r.owner_id] = r.roster_id; });

    const ownerHistory = {};
    const championships = {};
    const flatHist = [];

    seasons.forEach(s => {
      const season = s.season;
      const userById = {}; (s.users || []).forEach(u => { userById[u.user_id] = u; });
      const rosterByRid = {}; (s.rosters || []).forEach(r => { rosterByRid[r.roster_id] = r; });
      const placements = placementsFromBracket(s.bracket);
      const bracketTeams = new Set();
      (s.bracket || []).forEach(g => { if (g && g.w != null) bracketTeams.add(g.w); if (g && g.l != null) bracketTeams.add(g.l); });

      const champRid = Object.keys(placements).find(rid => placements[rid] === 1);
      const runRid = Object.keys(placements).find(rid => placements[rid] === 2);
      if (season && (champRid != null || runRid != null)) {
        const champRoster = champRid ? rosterByRid[champRid] : null;
        const runRoster = runRid ? rosterByRid[runRid] : null;
        const champUser = champRoster?.owner_id ? userById[champRoster.owner_id] : null;
        const runUser = runRoster?.owner_id ? userById[runRoster.owner_id] : null;
        const champCur = champRoster?.owner_id ? currentRosterByOwner[champRoster.owner_id] : null;
        const runCur = runRoster?.owner_id ? currentRosterByOwner[runRoster.owner_id] : null;
        championships[season] = {
          champion: champCur ?? null,
          runnerUp: runCur ?? null,
          championName: champUser?.metadata?.team_name || champUser?.display_name || (champRid ? 'Team ' + champRid : null),
          championAvatar: champUser?.avatar || null,
          championStillActive: champCur != null,
          runnerUpName: runUser?.metadata?.team_name || runUser?.display_name || (runRid ? 'Team ' + runRid : null),
          runnerUpStillActive: runCur != null,
        };
      }

      (s.rosters || []).forEach(r => {
        const userId = r.owner_id;
        if (!userId) return;
        const user = userById[userId];
        if (!ownerHistory[userId]) {
          ownerHistory[userId] = {
            ownerId: userId,
            ownerName: user?.metadata?.team_name || user?.display_name || ('Team ' + userId),
            avatar: user?.avatar,
            currentRosterId: currentRosterByOwner[userId] != null ? currentRosterByOwner[userId] : null,
            rosterId: currentRosterByOwner[userId] != null ? currentRosterByOwner[userId] : null,
            championships: 0, runnerUps: 0, playoffAppearances: 0,
            wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, tenure: 0, seasonHistory: [],
          };
        }
        const oh = ownerHistory[userId];
        const w = r.settings?.wins || 0, l = r.settings?.losses || 0, t = r.settings?.ties || 0;
        const fpts = (r.settings?.fpts || 0) + ((r.settings?.fpts_decimal || 0) / 100);
        const fptsAg = (r.settings?.fpts_against || 0) + ((r.settings?.fpts_against_decimal || 0) / 100);
        oh.wins += w; oh.losses += l; oh.ties += t; oh.pointsFor += fpts; oh.pointsAgainst += fptsAg; oh.tenure += 1;
        const place = placements[r.roster_id] || null;
        if (place === 1) oh.championships++;
        else if (place === 2) oh.runnerUps++;
        if (bracketTeams.has(r.roster_id)) oh.playoffAppearances++;
        oh.seasonHistory.push({ season: String(season), wins: w, losses: l, ties: t, fpts, place, finish: rosterFinish(place, w, l, t) });
        const curRid = currentRosterByOwner[userId];
        if (curRid != null && season) flatHist.push({ rosterId: curRid, season, wins: w, losses: l, ties: t, place });
      });
    });

    Object.values(ownerHistory).forEach(oh => {
      oh.seasonHistory.sort((a, b) => Number(a.season) - Number(b.season));
      oh.record = oh.wins + '-' + oh.losses + (oh.ties ? '-' + oh.ties : '');
      const totalGames = oh.wins + oh.losses + oh.ties;
      oh.winPct = totalGames ? (oh.wins / totalGames) : 0;
      oh.avgPointsFor = oh.tenure ? (oh.pointsFor / oh.tenure) : 0;
    });

    const cache = { fetchedAt: Date.now(), leagueId: startId, ownerHistory, championships, flatHist, seasonsLoaded: chain.length };
    try { localStorage.setItem(CACHE_KEY(startId), JSON.stringify(cache)); } catch { /* quota */ }
    populateGlobals(cache, startId);
    return cache;
  }

  function ownerHistoryByRoster(cache) {
    const byKey = {};
    Object.values(cache?.ownerHistory || {}).forEach(oh => {
      if (oh.currentRosterId != null) byKey[oh.currentRosterId] = { ...oh, isFormer: false };
      else byKey['former:' + oh.ownerId] = { ...oh, isFormer: true, rosterId: 'former:' + oh.ownerId };
    });
    return byKey;
  }

  function readCache(leagueId) {
    if (!leagueId) return null;
    const key = String(leagueId);
    if (memoryCache[key]) return memoryCache[key];
    try {
      const raw = localStorage.getItem(CACHE_KEY(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed) memoryCache[key] = parsed;
      return parsed;
    } catch { return null; }
  }

  function isFresh(cache) { return !!(cache && Date.now() - cache.fetchedAt < CACHE_TTL); }

  function populateGlobals(cache, leagueId) {
    if (!cache || !leagueId) return;
    const key = String(leagueId);
    memoryCache[key] = cache;
    // App.LI.championships is the active-league snapshot (additive — Scout only reads it).
    window.App = window.App || {};
    window.App.LI = window.App.LI || {};
    window.App.LI.championshipLeagueId = key;
    window.App.LI.championships = Object.assign({}, cache.championships || {});
    try { window.dispatchEvent(new CustomEvent('wr_history_loaded', { detail: { leagueId, seasons: cache.seasonsLoaded } })); } catch {}
  }

  function loadIfMissing(currentLeague) {
    const lid = currentLeague?.id || currentLeague?.league_id;
    if (!lid) return Promise.resolve(null);
    const cached = readCache(lid);
    if (isFresh(cached)) { populateGlobals(cached, lid); return Promise.resolve(cached); }
    return build(currentLeague);
  }

  window.WrHistory = {
    load: build,
    loadIfMissing,
    getCached: readCache,
    getOwnerHistory: (leagueId) => ownerHistoryByRoster(readCache(leagueId)),
    getChampionships: (leagueId) => (readCache(leagueId)?.championships || {}),
  };
})();

// ─── Scout mobile render ─────────────────────────────────────────────
function _histEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _histLeague() {
  const S = window.S || {};
  return (S.leagues || []).find(l => l.league_id === S.currentLeagueId) || (S.leagues || [])[0] || null;
}
const _histLoading = {}; // per-league in-flight guard
const _histFailed = {};   // per-league "fetch ran, no history" marker → degrade not spinner

function renderHistoryPanel() {
  const host = document.getElementById('panel-history-content');
  if (!host) return;

  if (typeof canAccess === 'function' && !canAccess(window.FEATURES?.LEAGUE_HISTORY || 'league_history')) {
    host.innerHTML = `<div class="scout-command-shell">
      <section class="scout-hero"><div class="scout-kicker">League History</div>
        <h1>Every banner, every record.</h1>
        <p>Champions timeline, all-time standings, and career records across every season your league has played.</p>
      </section>
      ${typeof _tierGatePlaceholder === 'function' ? _tierGatePlaceholder('League History', window.FEATURES?.LEAGUE_HISTORY || 'league_history') : ''}
    </div>`;
    return;
  }

  const league = _histLeague();
  if (!league || !(window.S && window.S.user)) {
    host.innerHTML = `<div class="scout-command-shell"><div class="scout-empty-card">
      <div class="scout-empty-title">Connect a league to see its history</div>
      <div class="scout-empty-body">Scout walks your league's past seasons to assemble champions and all-time records.</div>
      <button class="scout-primary-btn" onclick="mobileTab('digest')">Back to Today</button>
    </div></div>`;
    return;
  }

  const lid = league.id || league.league_id;
  const cache = window.WrHistory.getCached(lid);

  if (!cache) {
    // Fetch already ran and produced nothing (empty chain / network fail) →
    // show the degrade card, not an endless spinner.
    if (_histFailed[lid]) {
      host.innerHTML = `<div class="scout-command-shell">
        <section class="scout-hero"><div class="scout-kicker">League History</div><h1>No past seasons yet</h1>
          <p>Scout couldn't find a prior-season chain for this league (history is richest on Sleeper dynasty leagues with multiple seasons). Check back after a season completes.</p></section>
      </div>`;
      return;
    }
    host.innerHTML = `<div class="scout-command-shell">
      <section class="scout-hero"><div class="scout-kicker">League History</div><h1>Assembling the record book…</h1>
        <p>Walking past seasons for champions and all-time standings. This runs once, then caches.</p></section>
      <div class="scout-section-card"><div class="ld" style="text-align:center;padding:8px"><span>.</span><span>.</span><span>.</span></div></div>
    </div>`;
    if (!_histLoading[lid]) {
      _histLoading[lid] = true;
      Promise.resolve(window.WrHistory.loadIfMissing(league))
        .then(() => { if (!window.WrHistory.getCached(lid)) _histFailed[lid] = true; })
        .catch(() => { _histFailed[lid] = true; })
        .finally(() => {
          _histLoading[lid] = false;
          if (window._activeTab === 'history') renderHistoryPanel();
        });
    }
    return;
  }

  const ownersMap = window.WrHistory.getOwnerHistory(lid);
  const owners = Object.values(ownersMap || {});
  const champs = window.WrHistory.getChampionships(lid);
  const seasons = Object.keys(champs).sort((a, b) => Number(b) - Number(a));
  const seasonsLoaded = cache.seasonsLoaded || 1;

  // Non-Sleeper / single-season degrade: no multi-season chain to show.
  if (!owners.length && !seasons.length) {
    host.innerHTML = `<div class="scout-command-shell">
      <section class="scout-hero"><div class="scout-kicker">League History</div><h1>No past seasons yet</h1>
        <p>This league has no prior-season chain to walk yet (history is richest on Sleeper dynasty leagues with multiple seasons). Check back after a season completes.</p></section>
    </div>`;
    return;
  }

  // All-time standings: titles, then win%.
  const ranked = owners.slice().sort((a, b) =>
    (b.championships - a.championships) || (b.winPct - a.winPct) || (b.wins - a.wins));
  const mostTitles = ranked.slice().sort((a, b) => b.championships - a.championships)[0];
  const mostWins = owners.slice().sort((a, b) => b.wins - a.wins)[0];
  const bestPct = owners.filter(o => (o.wins + o.losses) >= 5).sort((a, b) => b.winPct - a.winPct)[0];

  const champTimeline = seasons.length ? seasons.map(season => {
    const c = champs[season];
    const name = c.championName || 'Unknown';
    return `<div class="scout-action-row" style="cursor:default">
      <span style="display:flex;align-items:center;gap:10px;min-width:0">
        <span style="font-size:18px;flex-shrink:0" aria-hidden="true">🏆</span>
        <span style="min-width:0"><strong>${_histEsc(name)}${c.championStillActive ? '' : ' <em style="color:var(--text3);font-style:normal">(former)</em>'}</strong>${c.runnerUpName ? `<small>def. ${_histEsc(c.runnerUpName)}${c.runnerUpStillActive === false ? ' (former)' : ''}</small>` : ''}</span>
      </span>
      <em class="mono" style="color:var(--accent)">${_histEsc(season)}</em>
    </div>`;
  }).join('') : '<div class="scout-empty-body" style="padding:12px">No completed champions recorded yet.</div>';

  const leaderCard = (label, who, val) => `<div style="padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg2)">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">${label}</div>
    <div style="font-weight:700;font-size:13px;color:var(--text);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${who ? _histEsc(who.ownerName) : '—'}</div>
    <div style="font-size:12px;color:var(--accent);margin-top:1px">${val}</div>
  </div>`;

  const standingsRows = ranked.map((o, i) => `<div class="scout-action-row" style="cursor:default">
    <span style="display:flex;align-items:center;gap:10px;min-width:0">
      <span class="mono" style="color:var(--text3);width:18px;flex-shrink:0">${i + 1}</span>
      <span style="min-width:0"><strong>${_histEsc(o.ownerName)}${o.isFormer ? ' <em style="color:var(--text3);font-style:normal">(former)</em>' : ''}</strong><small>${o.record} · ${(o.winPct * 100).toFixed(0)}%${o.playoffAppearances ? ' · ' + o.playoffAppearances + ' playoff' + (o.playoffAppearances === 1 ? '' : 's') : ''}</small></span>
    </span>
    <em class="mono" style="color:${o.championships ? 'var(--accent)' : 'var(--text3)'}">${o.championships ? '🏆×' + o.championships : '—'}</em>
  </div>`).join('');

  host.innerHTML = `<div class="scout-command-shell">
    <section class="scout-hero">
      <div class="scout-kicker">League History</div>
      <h1>${_histEsc(league.name || 'Your league')}</h1>
      <p>${seasonsLoaded} season${seasonsLoaded === 1 ? '' : 's'} on record · ${seasons.length} champion${seasons.length === 1 ? '' : 's'} crowned</p>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head"><div><span class="scout-kicker">All-time leaders</span><h2>The record holders</h2></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        ${leaderCard('Most titles', mostTitles, (mostTitles?.championships || 0) + ' title' + ((mostTitles?.championships || 0) === 1 ? '' : 's'))}
        ${leaderCard('Most wins', mostWins, (mostWins?.wins || 0) + ' wins')}
        ${leaderCard('Best win %', bestPct, bestPct ? (bestPct.winPct * 100).toFixed(0) + '%' : '—')}
      </div>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head"><div><span class="scout-kicker">Champions</span><h2>Title timeline</h2></div></div>
      <div class="scout-action-list">${champTimeline}</div>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head"><div><span class="scout-kicker">All-time standings</span><h2>Every owner, every season</h2></div></div>
      <div class="scout-action-list">${standingsRows}</div>
    </section>
  </div>`;
}
window.renderHistoryPanel = renderHistoryPanel;

// Re-render when the async chain-walk lands (if the user is on the history tab).
window.addEventListener('wr_history_loaded', () => {
  if (window._activeTab === 'history' && typeof renderHistoryPanel === 'function') renderHistoryPanel();
});
