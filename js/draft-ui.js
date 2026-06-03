// ═══════════════════════════════════════════════════════════════
// js/draft-ui.js — Draft room, rookie scouting board, pick analysis
// Extracted from ui.js to keep draft-tab logic editable standalone.
//
// Globals expected (all set before this file loads):
//   S, $, LI, LI_LOADED                   — state
//   pName, pPos, pAge, getUser, fullTeam   — player/user helpers (app.js)
//   dynastyValue, getPickDHQ               — valuation (dhq-engine, trade-calc)
//   assessTeamFromGlobal                   — roster assessment (team-assess)
//   pickValue, normPos                     — value/position helpers (ui.js, utils)
//   dhqAI, dhqContext                      — AI layer (dhq-ai)
//   goAsk, hasAnyAI                        — navigation/AI (ai-chat, ai-dispatch)
// ═══════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Phase 8 v2: centralized IDP position helpers ─────────────
// Scout's old lists were narrower than War Room's, so Psycho league (and
// any league with NT/IDL/EDGE/MLB/SS/FS positions) lost IDP prospects.
// Align with War Room's js/draft-room.js:58-70 so both apps agree.
const IDP_RAW_POSITIONS = ['DL','DE','DT','NT','IDL','EDGE','LB','OLB','ILB','MLB','DB','CB','S','SS','FS'];
const IDP_SLOT_TYPES    = ['DL','DE','DT','LB','DB','CB','S','IDP_FLEX'];
const IDP_MAPPED = ['DL','LB','DB'];

function isIDPPosition(pos) { return IDP_RAW_POSITIONS.includes(pos); }
function leagueHasIDPSlots(league) {
  const rp = league?.roster_positions;
  // If roster_positions data is missing (Sleeper occasionally delays this
  // field on cold load), default to TRUE — better to over-include IDP and
  // let users filter visually than to hide prospects they can draft.
  if (!rp || !rp.length) {
    console.warn('[draft] league.roster_positions unavailable — defaulting to IDP-on');
    return true;
  }
  return rp.some(s => IDP_SLOT_TYPES.includes(s));
}
window.isIDPPosition = isIDPPosition;
window.leagueHasIDPSlots = leagueHasIDPSlots;

// ── Mock draft speed control ─────────────────────────────────
let _mockSpeed = 'medium';
const MOCK_SPEED_MS = { slow: 5000, medium: 2000, fast: 500 };

// ── Live dashboard state ─────────────────────────────────────
let _mockStartDHQ = 0;
let _mockStartHealth = 0;
let _mockDraftedByMe = [];
let _mockLastAlexMsg = '';

// ── Mock draft sort/filter state ─────────────────────────────
let _mockPosFilter = '';
let _mockSortKey = 'dhq';

function _setMockPosFilter(pos) { _mockPosFilter = pos; renderMockDraftUI(); }
window._setMockPosFilter = _setMockPosFilter;

function _setMockSort(key) { _mockSortKey = key; renderMockDraftUI(); }
window._setMockSort = _setMockSort;

function _setMockSpeed(speed) {
  _mockSpeed = speed;
  document.querySelectorAll('.mock-speed-btn').forEach(btn => {
    const isActive = btn.dataset.speed === speed;
    btn.classList.toggle('active', isActive);
    btn.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
    btn.style.background = isActive ? 'var(--accentL)' : 'var(--bg2)';
    const title = btn.querySelector('div');
    if (title) title.style.color = isActive ? 'var(--accent)' : 'var(--text)';
  });
}
window._setMockSpeed = _setMockSpeed;

function _setMockType(type) {
  _mockMode = type;
  ['rookie', 'startup'].forEach(t => {
    const btn = document.getElementById('mock-type-' + t);
    if (!btn) return;
    btn.classList.toggle('active', t === type);
    btn.style.borderColor = t === type ? 'var(--accent)' : 'var(--border)';
    btn.style.background = t === type ? 'var(--accentL)' : 'var(--bg2)';
    const title = btn.querySelector('div');
    if (title) title.style.color = t === type ? 'var(--accent)' : 'var(--text)';
  });
}
window._setMockType = _setMockType;

// ── Draft Sub-tabs — legacy stub ──────────────────────────────
// Replaced by enterDraftRoom(). Kept for backward compat (GM bar
// launcher, deep links, etc. may still call switchDraftView).
function switchDraftView(view) {
  if (typeof enterDraftRoom === 'function') enterDraftRoom(view === 'mock' ? 'mock' : 'board');
}
window.switchDraftView = switchDraftView;

// ── Draft Room navigation (entry cards ↔ full-screen rooms) ──
function enterDraftRoom(mode) {
  const entry = document.getElementById('draft-entry-view');
  const board = document.getElementById('draft-board-fullview');
  const mock  = document.getElementById('draft-mock-fullview');
  const live  = document.getElementById('draft-live-fullview');
  if (!entry || !board || !mock) return;

  entry.style.display = 'none';
  // Any time we leave the live screen, stop its polling loop.
  if (mode !== 'live' && typeof stopLiveDraft === 'function') stopLiveDraft();

  if (mode === 'live') {
    if (live) live.style.display = '';
    board.style.display = 'none';
    mock.style.display  = 'none';
    if (typeof startLiveDraft === 'function') startLiveDraft();
    return;
  }
  if (live) live.style.display = 'none';

  if (mode === 'board') {
    board.style.display = '';
    mock.style.display  = 'none';
    if (typeof renderDraftNeeds === 'function') renderDraftNeeds();
    if (typeof renderTopProspects === 'function') renderTopProspects();
  } else {
    mock.style.display  = '';
    board.style.display = 'none';
    try {
      if (_mockState && typeof renderMockDraftUI === 'function') renderMockDraftUI();
      else if (typeof renderDynamicMockSetup === 'function') renderDynamicMockSetup();
    } catch (e) {
      console.error('[draft] mock setup failed', e);
      const mount = document.getElementById('draft-mock');
      if (mount) {
        mount.innerHTML = `<div class="scout-empty-card"><div class="scout-empty-title">Dynamic Mock Draft could not load</div><div class="scout-empty-body">${(window.escHtml || (s => String(s)))(e?.message || 'Unknown draft setup error')}</div></div>`;
      }
    }
  }
}
window.enterDraftRoom = enterDraftRoom;

function openDynamicMockDraft() {
  window._draftDirectMode = 'mock';
  if (typeof mobileTab === 'function') mobileTab('draftroom');
  else if (typeof switchTab === 'function') switchTab('draftroom');
  else setTimeout(() => enterDraftRoom('mock'), 0);
}
window.openDynamicMockDraft = openDynamicMockDraft;

function openRookieBigBoard() {
  window._draftDirectMode = 'board';
  if (typeof mobileTab === 'function') mobileTab('draftroom');
  else if (typeof switchTab === 'function') switchTab('draftroom');
  else setTimeout(() => enterDraftRoom('board'), 0);
}
window.openRookieBigBoard = openRookieBigBoard;

function openDynamicMockRun() {
  try {
    startMockDraft();
  } catch (e) {
    console.error('[draft] mock start failed', e);
    const mount = document.getElementById('draft-mock');
    if (mount) {
      mount.innerHTML = `<div class="scout-empty-card"><div class="scout-empty-title">Dynamic Mock Draft could not start</div><div class="scout-empty-body">${(window.escHtml || (s => String(s)))(e?.message || 'Unknown mock draft error')}</div><button class="scout-secondary-btn" onclick="renderDynamicMockSetup()">Back to setup</button></div>`;
    }
  }
}
window.openDynamicMockRun = openDynamicMockRun;

function exitDraftRoom() {
  const entry = document.getElementById('draft-entry-view');
  const board = document.getElementById('draft-board-fullview');
  const mock  = document.getElementById('draft-mock-fullview');
  const live  = document.getElementById('draft-live-fullview');
  if (typeof stopLiveDraft === 'function') stopLiveDraft();
  if (entry) entry.style.display = '';
  if (board) board.style.display = 'none';
  if (mock)  mock.style.display  = 'none';
  if (live)  live.style.display  = 'none';
  _refreshDraftEntrySubtitles();
}
window.exitDraftRoom = exitDraftRoom;

function _refreshDraftEntrySubtitles() {
  if (typeof renderLiveDraftEntryCard === 'function') renderLiveDraftEntryCard();
  const boardSub = document.getElementById('draft-entry-board-sub');
  if (boardSub) {
    const S = window.S || {};
    const totalRookies = Object.values(S.players || {}).filter(p => p.years_exp === 0).length;
    boardSub.textContent = totalRookies > 0
      ? `${totalRookies} prospects ranked by DHQ`
      : 'DHQ-ranked prospects · tap to rank';
  }
  const mockSub = document.getElementById('draft-entry-mock-sub');
  if (mockSub) {
    const LI = window.LI || {};
    const ownerCount = Object.keys(LI.ownerProfiles || {}).length;
    const teams = (window.S?.rosters || []).length;
    mockSub.textContent = ownerCount > 0
      ? `${ownerCount} owner DNA profiles loaded · ${teams} teams`
      : `Simulate your draft with AI opponents`;
  }
}
window._refreshDraftEntrySubtitles = _refreshDraftEntrySubtitles;

// ── Entry picks summary card ─────────────────────────────────
function renderDraftEntryPicks() {
  const el = document.getElementById('draft-entry-picks');
  if (!el || !window.S?.myRosterId) return;

  const S = window.S;
  const year = S.season || new Date().getFullYear();
  const allTP = S.tradedPicks || [];
  const myId = S.myRosterId;
  const teams = S.rosters?.length || 16;
  const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const draftRounds = league?.settings?.draft_rounds || 7;
  const ownedPicks = [];
  for (let rd = 1; rd <= draftRounds; rd++) {
    const tradedAway = allTP.find(p => String(p.season) === String(year) && p.round === rd && p.roster_id === myId && p.owner_id !== myId);
    if (!tradedAway) ownedPicks.push({ round: rd, own: true });
    const acquired = allTP.filter(p => String(p.season) === String(year) && p.round === rd && p.owner_id === myId && p.roster_id !== myId);
    acquired.forEach(() => ownedPicks.push({ round: rd, own: false }));
  }

  if (!ownedPicks.length) { el.innerHTML = ''; return; }

  const totalVal = ownedPicks.reduce((s, p) => s + (typeof pickValue === 'function' ? pickValue(year, p.round, teams, Math.ceil(teams / 2)) : 0), 0);
  const roundBadges = ownedPicks.slice(0, 6).map(p =>
    `<span style="font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;background:${p.own ? 'var(--accentL)' : 'rgba(52,211,153,.08)'};color:${p.own ? 'var(--accent)' : 'var(--green)'};border:1px solid ${p.own ? 'rgba(212,175,55,.2)' : 'rgba(52,211,153,.2)'}">R${p.round}</span>`
  ).join('');
  const extra = ownedPicks.length > 6 ? `<span style="font-size:12px;color:var(--text3)">+${ownedPicks.length - 6} more</span>` : '';

  el.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:12px 14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">Your ${year} Picks</span>
        <span style="font-size:12px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">~${totalVal.toLocaleString()} DHQ</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${roundBadges}${extra}</div>
    </div>`;
}
window.renderDraftEntryPicks = renderDraftEntryPicks;

// ═══════════════════════════════════════════════════════════════
// LIVE DRAFT — follow the real draft as it happens on the phone.
// Polls Sleeper's /draft/<id>/picks while a draft has status
// 'drafting', shows who's on the clock, how far away the user's next
// pick is, the running pick feed, and the user's available board
// (DHQ-ranked, undrafted, with War-Room-synced target/lock tags).
// ═══════════════════════════════════════════════════════════════
let _liveDraftTimer = null;
let _liveDraftPicks = [];
let _liveDraftPosFilter = '';
let _liveDraftPool = null;        // memoized ranked candidate pool
let _liveDraftPoolLeague = null;  // league the pool was built for
let _liveDraftBoard = {};         // user's custom War Room board (pid -> {rank,tier,note,target})
let _liveDraftBoardMode = 'best'; // 'my' (War Room board) | 'best' (DHQ)
let _liveDraftBoardLoaded = false;
const LIVE_DRAFT_POLL_MS = 6000;

// Pull the user's custom draft board (built in War Room) once per live session.
async function _loadLiveDraftBoard() {
  const leagueId = window.S?.currentLeagueId || '';
  try {
    if (window.OD?.loadDraftBoard) {
      const board = await window.OD.loadDraftBoard(leagueId);
      _liveDraftBoard = board && typeof board === 'object' ? board : {};
    }
  } catch (e) { console.warn('[live-draft] board load failed', e); _liveDraftBoard = {}; }
  _liveDraftBoardLoaded = true;
  // If the user has a War Room board, default to showing it.
  if (Object.keys(_liveDraftBoard).length) _liveDraftBoardMode = 'my';
  renderLiveDraftUI();
}

function _setLiveDraftBoardMode(mode) {
  _liveDraftBoardMode = mode === 'my' ? 'my' : 'best';
  renderLiveDraftUI();
}
window._setLiveDraftBoardMode = _setLiveDraftBoardMode;

// Find the draft that is currently running (status 'drafting').
function _activeLiveDraft() {
  const drafts = (window.S?.drafts) || [];
  return drafts.find(d => d && d.status === 'drafting') || null;
}
window._activeLiveDraft = _activeLiveDraft;

// Entry-view card — only visible while a draft is live. Tapping enters
// the live screen directly.
function renderLiveDraftEntryCard() {
  const el = document.getElementById('draft-entry-live-card');
  if (!el) return;
  const draft = _activeLiveDraft();
  if (!draft) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = `
    <div class="draft-entry-card" onclick="enterDraftRoom('live')" style="border:1px solid rgba(231,76,60,.5);background:linear-gradient(135deg,rgba(231,76,60,.14),rgba(231,76,60,.03))">
      <div class="draft-entry-icon" style="background:rgba(231,76,60,.14)">
        <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#e74c3c;box-shadow:0 0 0 4px rgba(231,76,60,.22)"></span>
      </div>
      <div class="draft-entry-body">
        <div class="draft-entry-title">Live Draft <span style="font-size:11px;font-weight:800;color:#e74c3c;letter-spacing:.06em;margin-left:4px">● ON THE CLOCK</span></div>
        <div class="draft-entry-sub">Follow every pick · see who's left · your board</div>
      </div>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--text3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
}
window.renderLiveDraftEntryCard = renderLiveDraftEntryCard;

function _setLiveDraftPosFilter(pos) {
  _liveDraftPosFilter = pos || '';
  renderLiveDraftUI();
}
window._setLiveDraftPosFilter = _setLiveDraftPosFilter;

function startLiveDraft() {
  stopLiveDraft();
  const mount = document.getElementById('draft-live');
  if (mount && !_liveDraftPicks.length) {
    mount.innerHTML = `<div class="scout-empty-card"><div class="scout-empty-title">Connecting to your live draft…</div><div class="scout-empty-body">Pulling the latest picks from Sleeper.</div></div>`;
  }
  _liveDraftBoardLoaded = false;
  _loadLiveDraftBoard();
  _pollLiveDraft();
  _liveDraftTimer = setInterval(_pollLiveDraft, LIVE_DRAFT_POLL_MS);
}
window.startLiveDraft = startLiveDraft;

function stopLiveDraft() {
  if (_liveDraftTimer) { clearInterval(_liveDraftTimer); _liveDraftTimer = null; }
}
window.stopLiveDraft = stopLiveDraft;

async function _pollLiveDraft() {
  const draft = _activeLiveDraft();
  // Draft finished (or vanished) — render a final state and stop polling.
  if (!draft) {
    stopLiveDraft();
    renderLiveDraftUI(true);
    return;
  }
  try {
    const api = window.SleeperAPI || window.App?.SleeperAPI || window;
    const fn = api.fetchDraftPicks || window.fetchDraftPicks;
    if (typeof fn === 'function') {
      const picks = await fn(draft.draft_id || draft.draftId);
      if (Array.isArray(picks)) _liveDraftPicks = picks;
    }
  } catch (e) {
    console.warn('[live-draft] poll failed', e);
  }
  renderLiveDraftUI();
}

// Build (and memoize) the ranked pool of draftable players: everyone with a
// DHQ value who is not already on a roster, best first. Works for rookie
// drafts (pool ≈ rookies + FAs) and startups (pool ≈ everyone).
function _buildLiveDraftPool() {
  const S = window.S || {};
  const leagueId = S.currentLeagueId || '';
  if (_liveDraftPool && _liveDraftPoolLeague === leagueId) return _liveDraftPool;

  const dyn = window.dynastyValue || (() => 0);
  const scores = window.LI?.playerScores || window.App?.LI?.playerScores || {};
  const pName = window.pName || (id => String(id));
  const pPos = window.pPos || (() => '');
  const normPos = window.normPos || (p => p);

  const rostered = new Set();
  (S.rosters || []).forEach(r => (r.players || []).forEach(pid => rostered.add(String(pid))));

  const players = S.players || {};
  const pool = [];
  for (const pid in players) {
    if (rostered.has(String(pid))) continue;
    let val = 0;
    try { val = Number(dyn(pid)) || 0; } catch {}
    if (val <= 0) val = Number(scores[pid] || scores[String(pid)] || 0);
    if (val <= 0) continue;
    const p = players[pid] || {};
    pool.push({
      pid: String(pid),
      name: pName(pid),
      pos: normPos(p.position || pPos(pid)) || (p.position || ''),
      team: p.team || '',
      val,
    });
  }
  pool.sort((a, b) => b.val - a.val);
  _liveDraftPool = pool.slice(0, 250);
  _liveDraftPoolLeague = leagueId;
  return _liveDraftPool;
}

// Compute the slot on the clock + how many picks until the user is up.
function _liveDraftClock(draft, picksMade) {
  const S = window.S || {};
  const teams = draft.settings?.teams || (S.rosters || []).length || 12;
  const rounds = draft.settings?.rounds || 5;
  const snake = (draft.type || 'snake') === 'snake';
  const slotForOverall = (overall1) => {
    const round = Math.floor((overall1 - 1) / teams) + 1;
    const idx = (overall1 - 1) % teams;          // 0-based within round
    const slot = (snake && round % 2 === 0) ? teams - idx : idx + 1;
    return { round, slot };
  };

  const currentOverall = picksMade + 1;
  const cur = slotForOverall(currentOverall);
  const slotToRoster = draft.slot_to_roster_id || {};
  const onClockRosterId = slotToRoster[cur.slot] != null ? Number(slotToRoster[cur.slot]) : null;

  // My slot: prefer slot_to_roster_id reverse, fall back to draft_order by user id.
  const myRosterId = S.myRosterId != null ? Number(S.myRosterId) : null;
  let mySlot = null;
  for (const slot in slotToRoster) {
    if (Number(slotToRoster[slot]) === myRosterId) { mySlot = Number(slot); break; }
  }
  if (mySlot == null) {
    const myUserId = S.myUserId || (typeof myR === 'function' ? myR()?.owner_id : null);
    const order = draft.draft_order || {};
    if (myUserId != null && order[myUserId] != null) mySlot = Number(order[myUserId]);
  }

  let picksUntilMe = null, myNextOverall = null;
  if (mySlot != null) {
    const maxOverall = teams * rounds;
    for (let n = currentOverall; n <= maxOverall; n++) {
      if (slotForOverall(n).slot === mySlot) { myNextOverall = n; picksUntilMe = n - currentOverall; break; }
    }
  }

  return { teams, rounds, currentOverall, round: cur.round, onClockRosterId, mySlot, myNextOverall, picksUntilMe };
}

function _liveRosterName(rosterId) {
  const S = window.S || {};
  const roster = (S.rosters || []).find(r => Number(r.roster_id) === Number(rosterId));
  if (!roster) return `Team ${rosterId ?? '?'}`;
  const getUser = window.getUser;
  if (typeof getUser === 'function' && roster.owner_id) return getUser(roster.owner_id);
  return `Team ${roster.roster_id}`;
}

function renderLiveDraftUI(ended) {
  const mount = document.getElementById('draft-live');
  if (!mount) return;
  const esc = window.escHtml || (s => String(s));
  const posColor = window.posColor || (() => 'var(--silver)');
  const pName = window.pName || (id => String(id));

  const draft = _activeLiveDraft();
  const picks = _liveDraftPicks || [];

  if (ended || !draft) {
    mount.innerHTML = `<div class="scout-empty-card">
      <div class="scout-empty-title">Draft complete</div>
      <div class="scout-empty-body">${picks.length} picks are in. Head to the Big Board to review the results or run a mock for next year.</div>
      <button class="scout-secondary-btn" style="margin-top:12px" onclick="exitDraftRoom()">Back to Draft Room</button>
    </div>`;
    return;
  }

  const clock = _liveDraftClock(draft, picks.length);
  const onClockName = clock.onClockRosterId != null ? _liveRosterName(clock.onClockRosterId) : 'TBD';
  const myTurn = clock.mySlot != null && clock.picksUntilMe === 0;

  // ── On-the-clock header ──
  const untilLine = clock.picksUntilMe == null
    ? `<span style="color:var(--text3)">No pick of yours remaining</span>`
    : myTurn
      ? `<span style="color:#e74c3c;font-weight:800">You're on the clock</span>`
      : `Your pick in <strong style="color:var(--accent)">${clock.picksUntilMe}</strong> pick${clock.picksUntilMe === 1 ? '' : 's'}`;

  const header = `
    <div style="background:var(--bg2);border:1px solid ${myTurn ? 'rgba(231,76,60,.5)' : 'var(--border)'};border-radius:var(--rl);padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#e74c3c"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#e74c3c;margin-right:6px;vertical-align:middle;box-shadow:0 0 0 3px rgba(231,76,60,.22)"></span>Live · Round ${clock.round}</span>
        <span style="font-size:12px;color:var(--text3);font-family:'JetBrains Mono',monospace">Pick ${clock.currentOverall}</span>
      </div>
      <div style="font-size:20px;font-weight:800;color:var(--text);letter-spacing:-.02em;margin-bottom:2px">${esc(onClockName)}</div>
      <div style="font-size:13px;color:var(--text3)">on the clock · ${untilLine}</div>
    </div>`;

  // ── Recent picks feed (latest first) ──
  const recent = picks.slice().sort((a, b) => (b.pick_no || 0) - (a.pick_no || 0)).slice(0, 10);
  const feedRows = recent.map(pk => {
    const md = pk.metadata || {};
    const nm = (md.first_name || md.last_name) ? `${md.first_name || ''} ${md.last_name || ''}`.trim() : pName(pk.player_id);
    const pos = window.normPos ? (window.normPos(md.position) || md.position || '') : (md.position || '');
    const rd = pk.round || Math.floor(((pk.pick_no || 1) - 1) / clock.teams) + 1;
    const inRd = clock.teams ? (((pk.pick_no || 1) - 1) % clock.teams) + 1 : pk.pick_no;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;font-weight:700;color:var(--text3);font-family:'JetBrains Mono',monospace;min-width:34px">${rd}.${String(inRd).padStart(2,'0')}</span>
        <span style="width:6px;height:6px;border-radius:50%;background:${posColor(pos)};flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nm)}</div>
          <div style="font-size:12px;color:var(--text3)">${esc(pos)}${md.team ? ' · ' + esc(md.team) : ''} → ${esc(_liveRosterName(pk.roster_id))}</div>
        </div>
      </div>`;
  }).join('');
  const feed = `
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Latest picks</div>
      ${recent.length ? feedRows : '<div style="font-size:13px;color:var(--text3);padding:6px 0">No picks yet — draft is about to begin.</div>'}
    </div>`;

  // ── Available board (your board: undrafted, DHQ or your War Room board) ──
  const taken = new Set(picks.map(p => String(p.player_id)));
  const tags = (typeof _rookieTags === 'function' ? _rookieTags() : {}) || {};
  const customBoard = _liveDraftBoard || {};
  const hasCustom = Object.keys(customBoard).length > 0;
  const myMode = hasCustom && _liveDraftBoardMode === 'my';

  const pool = _buildLiveDraftPool().filter(p => !taken.has(p.pid));
  let filtered = _liveDraftPosFilter ? pool.filter(p => p.pos === _liveDraftPosFilter) : pool;

  // In My Board mode, order by the user's War Room rank; players not on the
  // custom board fall to the bottom (by DHQ). Otherwise pure DHQ order.
  if (myMode) {
    filtered = filtered.slice().sort((a, b) => {
      const ra = customBoard[a.pid]?.rank, rb = customBoard[b.pid]?.rank;
      const aHas = ra != null, bHas = rb != null;
      if (aHas && bHas) return ra - rb;
      if (aHas) return -1;
      if (bHas) return 1;
      return b.val - a.val;
    });
  }

  // Need positions for highlight
  let needSet = new Set();
  try {
    const assess = window.assessTeamFromGlobal ? window.assessTeamFromGlobal(window.S?.myRosterId) : null;
    (assess?.needs || []).forEach(n => needSet.add(typeof n === 'string' ? n : n.pos));
  } catch {}

  const posOptions = ['', 'QB', 'RB', 'WR', 'TE'];
  const filterChips = posOptions.map(p => {
    const active = _liveDraftPosFilter === p;
    return `<button onclick="_setLiveDraftPosFilter('${p}')" style="font-size:12px;font-weight:700;padding:5px 11px;border-radius:8px;cursor:pointer;font-family:inherit;border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'var(--accentL)' : 'var(--bg2)'};color:${active ? 'var(--accent)' : 'var(--text2)'}">${p || 'All'}</button>`;
  }).join('');

  // My Board / Best Available toggle — only when a War Room board exists.
  const modeToggle = hasCustom ? `
    <div style="display:flex;gap:0;background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:3px;margin-bottom:10px">
      <button onclick="_setLiveDraftBoardMode('my')" style="flex:1;padding:6px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;background:${myMode ? 'var(--accentL)' : 'transparent'};color:${myMode ? 'var(--accent)' : 'var(--text3)'}">My Board <span style="font-size:10px;opacity:.8">· War Room</span></button>
      <button onclick="_setLiveDraftBoardMode('best')" style="flex:1;padding:6px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;background:${!myMode ? 'var(--accentL)' : 'transparent'};color:${!myMode ? 'var(--accent)' : 'var(--text3)'}">Best Available</button>
    </div>` : '';

  const tagBadge = (pid) => {
    const t = tags[pid];
    if (customBoard[pid]?.target) return `<span title="Target (your War Room board)" style="font-size:11px;color:var(--accent)">★</span>`;
    if (t === 'watch') return `<span title="Target (synced from War Room)" style="font-size:11px;color:var(--accent)">★</span>`;
    if (t === 'untouchable') return `<span title="Must-draft (synced from War Room)" style="font-size:11px;color:var(--green)">●</span>`;
    return '';
  };

  const rows = filtered.slice(0, 60).map((p, i) => {
    const need = needSet.has(p.pos);
    const cb = customBoard[p.pid];
    const rankLabel = myMode && cb?.rank != null ? cb.rank : (i + 1);
    const tier = myMode && cb?.tier != null ? `<span style="font-size:11px;font-weight:700;color:var(--accent);background:var(--accentL);border-radius:5px;padding:1px 6px;margin-left:4px">T${esc(String(cb.tier))}</span>` : '';
    const note = myMode && cb?.note ? `<div style="font-size:12px;color:var(--text3);font-style:italic;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">“${esc(cb.note)}”</div>` : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;font-weight:700;color:var(--text3);font-family:'JetBrains Mono',monospace;min-width:22px;text-align:right">${rankLabel}</span>
        <span style="width:6px;height:6px;border-radius:50%;background:${posColor(p.pos)};flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)} ${tagBadge(p.pid)}${tier}</div>
          <div style="font-size:12px;color:var(--text3)">${esc(p.pos)}${p.team ? ' · ' + esc(p.team) : ''}${need ? ' · <span style="color:var(--accent);font-weight:700">need</span>' : ''}</div>
          ${note}
        </div>
        <span style="font-size:13px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${Math.round(p.val).toLocaleString()}</span>
      </div>`;
  }).join('');

  const boardLabel = myMode ? 'Your War Room board' : 'Best available';
  const board = `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">${boardLabel} · ${filtered.length} left</span>
        ${myMode ? '<span style="font-size:11px;color:var(--green)">● Synced from War Room</span>' : ''}
      </div>
      ${modeToggle}
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">${filterChips}</div>
      ${rows || '<div style="font-size:13px;color:var(--text3);padding:6px 0">No players match this filter.</div>'}
      <div style="font-size:12px;color:var(--text3);margin-top:10px;line-height:1.5">${hasCustom ? 'Showing the board you built in War Room. ' : ''}★ = target · ● = must-draft. Edit your full board in War Room.</div>
    </div>`;

  mount.innerHTML = header + feed + board;
}
window.renderLiveDraftUI = renderLiveDraftUI;

// ── DNA intel strip for mock draft on-the-clock ──────────────
function _renderDNAIntelStrip(round) {
  const LI = window.LI || {};
  const hitRates = LI.hitRateByRound?.[round] || {};
  const bestPos = (hitRates.bestPos || []).slice(0, 2).map(p => p.pos).join('/');
  const roundHitRate = hitRates.rate || null;

  if (!bestPos && roundHitRate === null) return '';

  return `<div style="background:rgba(52,211,153,.04);border:1px solid rgba(52,211,153,.12);border-radius:var(--r);padding:10px 12px;margin-bottom:10px">
    <div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Owner DNA · Round ${round}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${bestPos ? `<div style="font-size:13px;color:var(--text2)"><span style="color:var(--text3)">Historically hits at:</span> <span style="font-weight:700;color:var(--text)">${bestPos}</span></div>` : ''}
      ${roundHitRate !== null ? `<div style="font-size:13px;color:var(--text2)"><span style="color:var(--text3)">League hit rate:</span> <span style="font-weight:700;color:${roundHitRate >= 50 ? 'var(--green)' : roundHitRate >= 25 ? 'var(--amber)' : 'var(--red)'}">${roundHitRate}%</span></div>` : ''}
    </div>
  </div>`;
}
window._renderDNAIntelStrip = _renderDNAIntelStrip;

// ── Mock Draft Trade Offers (wired to real trade calculator) ──
// Uses calcAcceptanceLikelihood, calcPsychTaxes, calcOwnerPosture,
// and fairnessGrade from trade-calc.js (exposed on window.App).
let _mockLastOfferPickIdx = -10;

function _mockMaybeGenerateTradeOffer(justPickedRosterId, round) {
  if (!_mockState) return;
  if (_mockState.currentIdx - _mockLastOfferPickIdx < 3) return;
  if (justPickedRosterId === S.myRosterId) return;

  const LI = window.LI || {};
  const totalPicks = (S.rosters?.length || 16) * (S.leagues?.find(l => l.league_id === S.currentLeagueId)?.settings?.draft_rounds || 7);
  const totalTrades = LI.leagueTradeTendencies?.totalTrades || 0;
  const tradeRatePerPick = Math.min(0.15, totalTrades > 0 ? totalTrades / (totalPicks * 5) : 0.06);
  if (Math.random() > tradeRatePerPick) return;

  // Use real trade calc engine for posture + likelihood
  const assessments = window._mockAssessments || window._tcAssessments
    || (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []);
  window._mockAssessments = assessments;
  const theirAssess = assessments.find(a => a.rosterId === justPickedRosterId);
  const myAssess = assessments.find(a => a.rosterId === S.myRosterId);
  const theirDnaKey = window._tcDnaMap?.[justPickedRosterId] || 'NONE';

  const calcPosture = window.App?.calcOwnerPosture;
  const calcPsych = window.App?.calcPsychTaxes;
  const calcLikelihood = window.App?.calcAcceptanceLikelihood;
  const gradeFn = window.App?.fairnessGrade;

  if (calcPosture) {
    const posture = calcPosture(theirAssess, theirDnaKey);
    if (posture?.key === 'LOCKED') return;
  }

  const profile = LI.ownerProfiles?.[justPickedRosterId] || {};
  if (profile.dna?.includes('Holds firm')) return;

  // Find picks to swap
  const remaining = _mockState.pickOrder.slice(_mockState.currentIdx);
  const myPicks = remaining.filter(p => p.rosterId === S.myRosterId).sort((a, b) => a.round - b.round);
  const theirPicks = remaining.filter(p => p.rosterId === justPickedRosterId).sort((a, b) => a.round - b.round);
  if (!myPicks.length || !theirPicks.length) return;

  // AI team wants to move UP — they offer an earlier/equal pick for the user's later pick.
  // This ensures the user always gets equal or better value.
  const myWorstPick = myPicks[myPicks.length - 1]; // user's latest-round pick (least valuable)
  const theirOfferPick = theirPicks.find(p => p.round <= myWorstPick.round); // they offer something equal or earlier
  if (!theirOfferPick) return;

  // Real DHQ values — user gives myWorstPick, gets theirOfferPick
  const teams = S.rosters?.length || 16;
  const pvFn = typeof pickValue === 'function' ? pickValue : () => 2000;
  const myPickDHQ = pvFn(S.season, myWorstPick.round, teams, myWorstPick.pick || Math.ceil(teams / 2));
  const theirPickDHQ = pvFn(S.season, theirOfferPick.round, teams, theirOfferPick.pick || Math.ceil(teams / 2));

  // Only show offers that are equal or better value for the user
  if (theirPickDHQ < myPickDHQ) return;

  // Real acceptance likelihood
  let acceptance = 50;
  if (calcPsych && calcLikelihood && theirAssess && myAssess) {
    const posture = calcPosture ? calcPosture(theirAssess, theirDnaKey) : {};
    const taxes = calcPsych(myAssess, theirAssess, theirDnaKey, posture);
    acceptance = Math.round(calcLikelihood(theirPickDHQ, myPickDHQ, theirDnaKey, taxes, theirAssess, myAssess));
  }
  if (acceptance < 30) return;

  const grade = gradeFn ? gradeFn(myPickDHQ, theirPickDHQ) : { grade: '—', col: 'var(--text3)' };

  const roster = (S.rosters || []).find(r => r.roster_id === justPickedRosterId);
  const owner = roster ? (S.leagueUsers || []).find(u => u.user_id === roster.owner_id) : null;
  const ownerName = owner?.display_name || owner?.metadata?.team_name || 'An owner';
  const dna = profile.dna || 'Balanced';
  const theirNeeds = (theirAssess?.needs || []).map(n => typeof n === 'string' ? n : n.pos);
  const reason = theirNeeds.length > 0
    ? `They need ${theirNeeds[0]} and want to move up.`
    : `${dna} — looking to acquire early capital.`;

  _mockLastOfferPickIdx = _mockState.currentIdx;
  _showMockTradeOffer({
    fromRosterId: justPickedRosterId,
    fromName: ownerName,
    dna, reason,
    myPickRound: myWorstPick.round, myPickSlot: myWorstPick.pick || 0,
    theirPickRound: theirOfferPick.round, theirPickSlot: theirOfferPick.pick || 0,
    myPickDHQ, theirPickDHQ, acceptance,
    gradeLabel: grade.grade, gradeCol: grade.col,
  });
}

function _showMockTradeOffer(offer) {
  document.getElementById('mock-trade-offer')?.remove();

  const el = document.createElement('div');
  el.id = 'mock-trade-offer';
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:400px;z-index:500';
  // Store structured data for the accept handler
  el.dataset.fromRosterId = offer.fromRosterId;
  el.dataset.myRound = offer.myPickRound;
  el.dataset.mySlot = offer.myPickSlot;
  el.dataset.theirRound = offer.theirPickRound;
  el.dataset.theirSlot = offer.theirPickSlot;
  el.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--accent);border-radius:var(--rl);padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em">⚡ Trade Offer</span>
        <span style="font-size:11px;padding:1px 6px;border-radius:6px;background:var(--bg3);color:var(--text3)">${escHtml(offer.dna)}</span>
        <button onclick="document.getElementById('mock-trade-offer')?.remove()" style="margin-left:auto;background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:0">×</button>
      </div>
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">${escHtml(offer.fromName)} wants to deal</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:4px">${escHtml(offer.reason)}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px">
        <span style="color:${offer.gradeCol};font-weight:700">${escHtml(offer.gradeLabel)}</span> trade ·
        You give: ~${offer.myPickDHQ.toLocaleString()} DHQ ·
        You get: ~${offer.theirPickDHQ.toLocaleString()} DHQ ·
        ${offer.acceptance}% they'd accept
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:12px">
        <div style="background:var(--bg3);border-radius:var(--r);padding:8px;text-align:center">
          <div style="font-size:11px;color:var(--text3);margin-bottom:2px">You give</div>
          <div style="font-size:13px;font-weight:700;color:var(--red)">R${offer.myPickRound} pick</div>
          <div style="font-size:11px;color:var(--text3)">${offer.myPickDHQ.toLocaleString()} DHQ</div>
        </div>
        <span style="font-size:16px;color:var(--text3)">⇄</span>
        <div style="background:var(--bg3);border-radius:var(--r);padding:8px;text-align:center">
          <div style="font-size:11px;color:var(--text3);margin-bottom:2px">You get</div>
          <div style="font-size:13px;font-weight:700;color:var(--green)">R${offer.theirPickRound} pick</div>
          <div style="font-size:11px;color:var(--text3)">${offer.theirPickDHQ.toLocaleString()} DHQ</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button onclick="_acceptMockTradeFromEl()" style="padding:10px;background:var(--green);color:#fff;border:none;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Accept</button>
        <button onclick="document.getElementById('mock-trade-offer')?.remove()" style="padding:10px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Decline</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => { if (document.getElementById('mock-trade-offer')) el.remove(); }, 15000);
}
window._showMockTradeOffer = _showMockTradeOffer;

function _acceptMockTradeFromEl() {
  const el = document.getElementById('mock-trade-offer');
  if (!el || !_mockState?.pickOrder) return;
  const fromRid = parseInt(el.dataset.fromRosterId);
  const myRound = parseInt(el.dataset.myRound);
  const mySlot = parseInt(el.dataset.mySlot);
  const theirRound = parseInt(el.dataset.theirRound);
  const theirSlot = parseInt(el.dataset.theirSlot);
  el.remove();

  // Swap ownership using actual pick objects
  const remaining = _mockState.pickOrder.slice(_mockState.currentIdx);
  remaining.forEach(pick => {
    if (pick.round === myRound && pick.rosterId === S.myRosterId) {
      pick.rosterId = fromRid;
    } else if (pick.round === theirRound && pick.rosterId === fromRid) {
      pick.rosterId = S.myRosterId;
    }
  });

  if (typeof showToast === 'function') showToast(`Trade accepted — R${theirRound} pick acquired, R${myRound} sent`);
  const allRemaining = _mockState.pickOrder.slice(_mockState.currentIdx);
  if (typeof _mockUpdateDashboard === 'function') _mockUpdateDashboard(_mockState.picks?.length ? _mockState.picks[_mockState.picks.length - 1].round : 1, null, allRemaining);
  renderMockDraftUI();
}
window._acceptMockTradeFromEl = _acceptMockTradeFromEl;

// ── Mock draft player tabs (Available / All Prospects) ───────
let _mockPlayerTab = 'available'; // 'available' | 'all'

function _switchMockPlayerTab(tab) {
  _mockPlayerTab = tab;
  renderMockDraftUI();
}
window._switchMockPlayerTab = _switchMockPlayerTab;

function _renderAllProspectsTab(posFilter) {
  if (!_mockState) return '';
  const pool = _mockState.pool || [];
  const draftedPids = _mockState.draftedPids || new Map();

  // Build full prospect list: pool (available) + drafted players
  const allPlayers = [];
  // Available players from pool
  pool.forEach(p => allPlayers.push({ ...p, drafted: false, draftedBy: null }));
  // Drafted players from the map
  draftedPids.forEach((ownerName, pid) => {
    const pick = (_mockState.picks || []).find(pk => pk.pid === pid);
    if (pick) {
      allPlayers.push({ pid, name: pick.playerName, pos: pick.pos, val: pick.val, drafted: true, draftedBy: ownerName });
    }
  });

  // Sort using shared mock sort key
  allPlayers.sort((a, b) => {
    if (_mockSortKey === 'pos') return (a.pos || '').localeCompare(b.pos || '') || (b.val || 0) - (a.val || 0);
    if (_mockSortKey === 'name') return (a.name || '').localeCompare(b.name || '');
    return (b.val || 0) - (a.val || 0); // default: DHQ desc
  });

  // Apply position filter
  const filtered = posFilter ? allPlayers.filter(p => p.pos === posFilter) : allPlayers;

  return filtered.slice(0, 30).map(p => {
    const photoUrl = 'https://sleepercdn.com/content/nfl/players/thumb/' + p.pid + '.jpg';
    const canModal = !String(p.pid).startsWith('csv_');
    const opacity = p.drafted ? 'opacity:0.4;' : '';
    const draftBadge = p.drafted
      ? `<span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--bg4);color:var(--text3)">DRAFTED · ${escHtml(p.draftedBy || '')}</span>`
      : '';
    const clickAction = p.drafted
      ? (canModal ? `onclick="openPlayerModal('${p.pid}')"` : '')
      : `onclick="mockDraftPick('${p.pid}')"`;
    return `<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;${opacity}cursor:pointer" ${clickAction}>
      <img src="${photoUrl}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg4)">
      <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name || '')}</span>
      ${_mockPosBadge(p.pos)}
      ${draftBadge}
      <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${(p.val || 0).toLocaleString()}</span>
    </div>`;
  }).join('');
}

// ── Live AI Commentary Dashboard ─────────────────────────────
// Shows after every pick in the mock draft — team DHQ delta, health
// change, remaining gaps, next owners in queue, and Alex's contextual
// commentary. Entirely rule-based (no LLM call per pick).

function _mockGetAvailable() {
  if (!_mockState?.pool) return [];
  return _mockState.pool.slice(0, 12).map(p => ({
    ...p,
    // Use pre-computed val from pool — dynastyValue returns 0 for rookies not in the scoring engine
    dhq: p.val > 0 ? p.val : (typeof dynastyValue === 'function' ? dynastyValue(p.pid) : 0),
  }));
}

function _mockUpdateDashboard(currentRound, currentSlot, nextPicks) {
  const el = document.getElementById('mock-live-dashboard');
  if (!el) return;

  const myRoster = typeof myR === 'function' ? myR() : null;
  const allMyPlayers = [...(myRoster?.players || []), ..._mockDraftedByMe];
  const dhqFn = typeof dynastyValue === 'function' ? dynastyValue : (() => 0);
  const currentDHQ = allMyPlayers.reduce((s, pid) => s + dhqFn(pid), 0);
  const dhqDelta = currentDHQ - _mockStartDHQ;
  const dhqDeltaStr = (dhqDelta >= 0 ? '+' : '') + dhqDelta.toLocaleString();
  const dhqColor = dhqDelta >= 0 ? 'var(--green)' : 'var(--red)';

  const assess = typeof assessTeamFromGlobal === 'function' ? assessTeamFromGlobal(S.myRosterId) : null;
  const currentHealth = assess?.healthScore || 0;
  const healthDelta = currentHealth - _mockStartHealth;

  const gaps = (assess?.needs || []).map(n => typeof n === 'string' ? n : n.pos).slice(0, 3);

  // Next 3 owners to pick
  const nextOwnerHtml = (nextPicks || []).slice(0, 3).map(pick => {
    const rid = pick.rosterId || pick.currentOwner;
    const profile = (window.LI?.ownerProfiles || {})[rid] || {};
    const roster = (S.rosters || []).find(r => r.roster_id === rid);
    const owner = roster ? (S.leagueUsers || []).find(u => u.user_id === roster.owner_id) : null;
    const ownerName = owner?.display_name || owner?.metadata?.team_name || 'Team';
    const dna = profile.dna || '';
    const isMe = rid === S.myRosterId;
    return `<div style="font-size:12px;color:var(--text3);padding:2px 0">
      <span style="color:${isMe ? 'var(--accent)' : 'var(--text2)'};font-weight:${isMe ? '800' : '600'}">${isMe ? 'YOU →' : ownerName}</span>
      ${dna ? `<span style="font-size:11px;padding:1px 5px;border-radius:6px;background:var(--bg3);margin-left:4px">${escHtml(dna)}</span>` : ''}
    </div>`;
  }).join('');

  // Alex message — contextual, rule-based
  let alexMsg = _mockLastAlexMsg;
  const myNextPick = (nextPicks || []).find(p => (p.rosterId || p.currentOwner) === S.myRosterId);

  if (myNextPick) {
    const available = _mockGetAvailable();
    const topPick = available[0];
    const needPick = available.find(p => gaps.includes(p.pos));
    if (topPick) {
      const tierBreak = available[1] && (topPick.dhq - available[1].dhq) > 800;
      if (tierBreak) {
        alexMsg = `${topPick.name} is in a tier of his own right now. ${topPick.dhq.toLocaleString()} DHQ vs ${available[1].dhq.toLocaleString()} for the next best. Don't overthink it.`;
      } else if (needPick && needPick !== topPick) {
        alexMsg = `${needPick.name} fills your ${needPick.pos} gap and is within range of BPA. Take the need — gap gets harder to fill later.`;
      } else {
        alexMsg = `${topPick.name} (${topPick.pos}, ${topPick.dhq.toLocaleString()} DHQ) is your best option. ${gaps.length > 0 ? 'Still need ' + gaps[0] + '.' : 'No positional pull. BPA.'}`;
      }
      _mockLastAlexMsg = alexMsg;
    }
  } else if (_mockDraftedByMe.length > 0) {
    const lastPid = _mockDraftedByMe[_mockDraftedByMe.length - 1];
    const lastPos = typeof pPos === 'function' ? pPos(lastPid) : '';
    const lastName = typeof pName === 'function' ? pName(lastPid) : lastPid;
    const lastDhq = dhqFn(lastPid);
    if (gaps.includes(lastPos)) {
      const remaining = gaps.filter(g => g !== lastPos);
      alexMsg = `${lastName} addresses your ${lastPos} need. Good pick. ${remaining.length ? 'Remaining gaps: ' + remaining.join(', ') + '.' : 'All key positions addressed.'}`;
    } else {
      alexMsg = `${lastName} at ${lastDhq.toLocaleString()} DHQ. ${lastPos} surplus now — could be trade bait. Watching ${gaps[0] || 'remaining needs'}.`;
    }
    _mockLastAlexMsg = alexMsg;
  }

  el.innerHTML = `
    <div style="background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.2);border-radius:var(--rl);padding:14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
        <span style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em">🧠 Alex · Round ${currentRound}</span>
      </div>

      ${alexMsg && !_mockInsightInFlight ? `<div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:8px;padding:10px;background:var(--bg2);border-radius:var(--r);border-left:2px solid var(--accent)">${escHtml(alexMsg)}</div>` : ''}
      <div id="mock-alex-insight" style="margin-bottom:${_mockInsightInFlight ? '10px' : '0'}">
        <!-- AI insight populates here via _mockFireAlexInsight() — starts empty -->
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="background:var(--bg2);border-radius:var(--r);padding:10px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Team DHQ</div>
          <div style="font-size:16px;font-weight:800;color:var(--accent);font-family:'JetBrains Mono',monospace">${currentDHQ.toLocaleString()}</div>
          <div style="font-size:11px;font-weight:700;color:${dhqColor}">${dhqDeltaStr} this draft</div>
        </div>
        <div style="background:var(--bg2);border-radius:var(--r);padding:10px">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Health</div>
          <div style="font-size:16px;font-weight:800;color:${currentHealth >= 70 ? 'var(--green)' : currentHealth >= 55 ? 'var(--amber)' : 'var(--red)'};font-family:'JetBrains Mono',monospace">${currentHealth}</div>
          <div style="font-size:11px;font-weight:700;color:${healthDelta >= 0 ? 'var(--green)' : 'var(--red)'}">${healthDelta >= 0 ? '↑' : '↓'} ${Math.abs(healthDelta)} pts</div>
        </div>
      </div>

      ${gaps.length > 0 ? `<div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Remaining Gaps</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${gaps.map(g => `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2)">${g}</span>`).join('')}</div>
      </div>` : `<div style="font-size:12px;color:var(--green);margin-bottom:10px">✓ All key positions addressed</div>`}

      ${nextOwnerHtml ? `<div>
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Picking Next</div>
        ${nextOwnerHtml}
      </div>` : ''}
    </div>`;
}
window._mockUpdateDashboard = _mockUpdateDashboard;

// ── Automatic AI insights during mock draft ──────────────────
// Fires real AI calls at key moments (every N picks, on user pick,
// on round change). Renders directly into the dashboard panel.
let _mockInsightInFlight = false;
let _mockLastInsightPickIdx = -99;
const MOCK_INSIGHT_EVERY_N_PICKS = 3;

async function _mockFireAlexInsight(trigger, context) {
  if (_mockInsightInFlight) return;
  if (_mockState && (_mockState.currentIdx - _mockLastInsightPickIdx) < MOCK_INSIGHT_EVERY_N_PICKS) return;
  if (typeof hasAnyAI !== 'function' || !hasAnyAI(false)) return;

  _mockInsightInFlight = true;
  _mockLastInsightPickIdx = _mockState?.currentIdx || 0;

  const insightEl = document.getElementById('mock-alex-insight');
  if (insightEl) {
    insightEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg2);border-radius:var(--r);border-left:2px solid var(--accent)">
      <span class="ld"><span>.</span><span>.</span><span>.</span></span>
      <span style="font-size:12px;color:var(--text3)">Alex is watching...</span>
    </div>`;
  }

  try {
    const myRoster = typeof myR === 'function' ? myR() : null;
    const dhqFn = typeof dynastyValue === 'function' ? dynastyValue : (() => 0);
    const allMyPlayers = [...(myRoster?.players || []), ..._mockDraftedByMe];
    const currentDHQ = allMyPlayers.reduce((s, pid) => s + dhqFn(pid), 0);
    const assess = typeof assessTeamFromGlobal === 'function' ? assessTeamFromGlobal(S.myRosterId) : null;
    const gaps = (assess?.needs || []).map(n => typeof n === 'string' ? n : n.pos).slice(0, 4);
    const available = _mockGetAvailable().slice(0, 8);
    const round = _mockState?.picks?.length ? _mockState.picks[_mockState.picks.length - 1].round : 1;
    const myUpcoming = (_mockState?.pickOrder || [])
      .slice(_mockState?.currentIdx || 0)
      .filter(p => p.rosterId === S.myRosterId)
      .slice(0, 3)
      .map(p => 'R' + p.round);

    const myDrafted = _mockDraftedByMe.map(pid => {
      const pos = typeof pPos === 'function' ? pPos(pid) : '';
      const name = typeof pName === 'function' ? pName(pid) : pid;
      return `${name}(${pos},${dhqFn(pid)})`;
    }).join(', ');

    const availStr = available.map(p => `${p.name}(${p.pos},${p.dhq || p.val || 0})`).join(', ');

    const prompt = `You are Alex Ingram, dynasty GM advisor. Mock draft is live — Round ${round}.

TRIGGER: ${trigger}

MY DRAFT SO FAR: ${myDrafted || 'Nothing yet'}
MY REMAINING PICKS: ${myUpcoming.join(', ') || 'None'}
MY CURRENT DHQ: ${currentDHQ.toLocaleString()}
REMAINING GAPS: ${gaps.join(', ') || 'None'}
TOP AVAILABLE: ${availStr}
${context ? '\nADDITIONAL CONTEXT: ' + context : ''}

Give me ONE sharp, specific insight for this exact moment. 2-3 sentences max. Reference actual player names and DHQ values from the data above. Be direct and opinionated — this is a live draft, not a report. Do not start with "I" or "Alex". Do not repeat back the data I gave you.`;

    const reply = await callClaude([{ role: 'user', content: prompt }], false, 2, 200);

    if (insightEl && reply) {
      insightEl.innerHTML = `<div style="font-size:13px;color:var(--text2);line-height:1.5;padding:10px;background:var(--bg2);border-radius:var(--r);border-left:2px solid var(--accent)">
        ${escHtml(reply.trim())}
      </div>`;
      _mockLastAlexMsg = reply.trim();
    }
  } catch (e) {
    console.warn('[mock] Alex insight failed:', e?.message || e);
  } finally {
    _mockInsightInFlight = false;
  }
}
window._mockFireAlexInsight = _mockFireAlexInsight;

// ── Draft DNA helpers for mock draft opponents ───────────────
function _getDraftDNAForRoster(rosterId) {
  const S = window.S || {};
  const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const leagueId = league?.league_id || S.currentLeagueId;
  if (!leagueId) return null;
  const dnaMap = window.DraftHistory?.loadDraftDNA?.(leagueId) || {};
  const roster = (S.rosters || []).find(r => r.roster_id === rosterId);
  if (!roster) return null;
  const ownerId = roster.owner_id;
  if (dnaMap[ownerId]) return dnaMap[ownerId];
  const user = (S.leagueUsers || []).find(u => u.user_id === ownerId);
  const displayName = user?.display_name || user?.username;
  if (displayName) {
    const entry = Object.values(dnaMap).find(d => d.displayName === displayName);
    if (entry) return entry;
  }
  return null;
}
window._getDraftDNAForRoster = _getDraftDNAForRoster;

function _mockDNAInformedPick(rosterId, available, round, pickNumber) {
  if (!available.length) return available[0] || null;
  const assessTeamFromGlobal = window.assessTeamFromGlobal || window.App?.assessTeamFromGlobal;

  // Delegate to shared MockEngine when available (canonical 10-layer engine)
  if (window.App?.MockEngine?.personaPick) {
    const LI = window.LI || {};
    const assess = typeof assessTeamFromGlobal === 'function' ? assessTeamFromGlobal(rosterId) : null;
    const dna = _getDraftDNAForRoster(rosterId);
    const ownerProfile = LI.ownerProfiles?.[rosterId] || {};
    const tradeDnaKey = ownerProfile.tradeDna || ownerProfile.dna || 'NONE';
    const posture = window.App?.TradeEngine?.calcOwnerPosture?.(assess, tradeDnaKey) || { key: 'NEUTRAL' };

    // Build persona (same shape War Room's persona.js produces)
    const persona = {
      draftDna: dna || {},
      tradeDna: { key: tradeDnaKey },
      assessment: assess || {},
      posture: posture,
    };

    // Pass League Intelligence data for enrichment (Scout-only feature)
    const liData = {
      draftOutcomes: LI.draftOutcomes || [],
      hitRateByRound: LI.hitRateByRound || {},
    };

    const result = window.App.MockEngine.personaPick(persona, available, round, pickNumber || 0, {
      teamRoster: [],
      rosterId: rosterId,
      liData: liData,
    });
    return result?.player || available[0];
  }

  // Emergency fallback — BPA only (shared module should always be loaded)
  let best = available[0], bestVal = best?.val || 0;
  for (const p of available) {
    const val = p.val || 0;
    if (val > bestVal) { best = p; bestVal = val; }
  }
  return best;
}
window._mockDNAInformedPick = _mockDNAInformedPick;

// ── Opponent Scouting ──────────────────────────────────────────
// idealDepth: default depth targets per position (may be overridden by other modules)
const idealDepth=window.idealDepth||{QB:3,RB:6,WR:7,TE:3,K:1,DL:5,LB:5,DB:5};
// ── Draft Room ─────────────────────────────────────────────────
// draftChatHistory declared in ai-chat.js

function _radialProgress(pct,color){
  const r=18,c=2*Math.PI*r;
  const offset=c-(pct/100)*c;
  return`<div class="radial-progress">
    <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="${r}" fill="none" stroke="var(--bg4)" stroke-width="3"/>
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition:stroke-dashoffset .8s ease"/></svg>
    <span class="rp-val" style="color:${color}">${pct}%</span>
  </div>`;
}

function renderDraftNeeds(){
  const $ = window.$ || (id => document.getElementById(id));
  const S = window.S || window.App?.S || {};
  const LI = window.LI || window.App?.LI || {};
  const LI_LOADED = Boolean(window.LI_LOADED || window.App?.LI_LOADED);
  const myR = window.myR || window.App?.myR || (() => null);
  const getUser = window.getUser || window.App?.getUser || (() => '');
  const pPos = window.pPos || window.App?.pPos || (() => '');
  const pAge = window.pAge || window.App?.pAge || (() => '');
  const dynastyValue = window.dynastyValue || window.App?.dynastyValue || (() => 0);
  const pickValue = window.pickValue || window.App?.pickValue || (() => 0);
  const needsEl=$('draft-needs');if(!needsEl)return;
  if(!S.myRosterId)return;

  // Tier gate — Draft Archetype Analysis requires trial or paid
  if (typeof canAccess === 'function' && !canAccess(window.FEATURES?.DRAFT_ARCHETYPES || 'draft_archetypes')) {
    needsEl.innerHTML = typeof _tierGatePlaceholder === 'function'
      ? _tierGatePlaceholder('Draft Archetype Analysis', window.FEATURES?.DRAFT_ARCHETYPES || 'draft_archetypes')
      : '<div style="padding:24px;text-align:center;color:var(--text3)">Upgrade to unlock Draft Archetype Analysis.</div>';
    return;
  }
  if (typeof trackUsage === 'function') trackUsage('draft_targets_flagged');

  const my=myR();const allPlayers=my?.players||[];
  const league=S.leagues.find(l=>l.league_id===S.currentLeagueId);
  const year=S.season||String(new Date().getFullYear());
  const teams=S.rosters.length||12;
  const posMapD=p=>{if(['DE','DT'].includes(p))return'DL';if(['CB','S'].includes(p))return'DB';return p;};
  const draftRounds=league?.settings?.draft_rounds||7;

  // === Build owned picks list ===
  const allTP=S.tradedPicks;
  const ownedPicks=[];
  const ownPickRounds=[];
  for(let rd=1;rd<=draftRounds;rd++){
    const myTradedAway=allTP.find(p=>String(p.season)===year&&p.round===rd&&p.roster_id===S.myRosterId&&p.owner_id!==S.myRosterId);
    const acquired=allTP.filter(p=>String(p.season)===year&&p.round===rd&&p.owner_id===S.myRosterId&&p.roster_id!==S.myRosterId);
    if(!myTradedAway){ownedPicks.push({round:rd,own:true});ownPickRounds.push(rd);}
    acquired.forEach(p=>{
      const from=getUser(S.rosters.find(r=>r.roster_id===p.roster_id)?.owner_id);
      ownedPicks.push({round:rd,own:false,from,fromRosterId:p.roster_id});
      if(!ownPickRounds.includes(rd))ownPickRounds.push(rd);
    });
  }
  ownPickRounds.sort((a,b)=>a-b);

  // === Roster analysis ===
  const rp=league?.roster_positions||[];
  const starterSlots={QB:0,RB:0,WR:0,TE:0,K:0,DL:0,LB:0,DB:0};
  rp.forEach(slot=>{
    const s=posMapD(slot);
    if(s in starterSlots)starterSlots[s]++;
    else if(slot==='FLEX'){starterSlots.RB+=0.4;starterSlots.WR+=0.4;starterSlots.TE+=0.2;}
    else if(slot==='SUPER_FLEX'){starterSlots.QB+=0.5;starterSlots.WR+=0.25;starterSlots.RB+=0.25;}
    else if(slot==='IDP_FLEX'){starterSlots.DL+=0.35;starterSlots.LB+=0.35;starterSlots.DB+=0.3;}
    else if(slot==='REC_FLEX'){starterSlots.WR+=0.5;starterSlots.TE+=0.5;}
  });
  Object.keys(starterSlots).forEach(p=>starterSlots[p]=Math.round(starterSlots[p]));
  const activePositions=Object.keys(starterSlots).filter(p=>starterSlots[p]>0);

  const avgThresh=LI_LOADED&&LI.avgThresh?LI.avgThresh:{};
  const ageCurves=LI_LOADED&&LI.ageCurveWindows?LI.ageCurveWindows:window.App.ageCurveWindows;

  const posAnalysis=activePositions.map(pos=>{
    const posPlayers=allPlayers.filter(pid=>posMapD(pPos(pid))===pos);
    const withData=posPlayers.map(pid=>{
      const age=pAge(pid)||26;
      const dhqVal=dynastyValue(pid);
      const ppg=S.playerStats?.[pid]?.seasonAvg||S.playerStats?.[pid]?.prevAvg||(LI_LOADED&&LI.playerMeta?.[pid]?.ppg)||0;
      return{pid,age,dhqVal,ppg};
    });
    const starterPPG=avgThresh[pos]?+(avgThresh[pos].starterLine/17).toFixed(1):{QB:12,RB:8,WR:8,TE:6,DL:4,LB:4,DB:3}[pos]||6;
    const startable=withData.filter(p=>p.ppg>=starterPPG);
    const elite=withData.filter(p=>typeof window.App?.isElitePlayer==='function'?window.App.isElitePlayer(p.pid):dynastyValue(p.pid)>=7000);
	    const valueEnd=ageCurves?.[pos]?.decline?.[1]||window.App.peakWindows?.[pos]?.[1]||29;
	    const aging=withData.filter(p=>p.age>valueEnd);
    const young=withData.filter(p=>p.age<=25);
    const slotsNeeded=starterSlots[pos];
    const starterGap=Math.max(0,slotsNeeded-startable.length);
    let needScore=starterGap*30;
    needScore+=Math.max(0,(slotsNeeded+Math.ceil(slotsNeeded*0.5))-posPlayers.length)*5;
    needScore+=aging.length*8;needScore-=young.length*4;needScore-=elite.length*10;
    if(startable.length===0&&slotsNeeded>0)needScore+=50;
    if(LI_LOADED&&LI.scarcityMult?.[pos])needScore=Math.round(needScore*LI.scarcityMult[pos]);
    return{pos,slotsNeeded,startable:startable.length,total:posPlayers.length,elite:elite.length,
      aging:aging.length,young:young.length,starterGap,needScore};
  }).sort((a,b)=>b.needScore-a.needScore);

  // === RENDER: Your Picks — single large card, click to expand full list ===
  const pickEl=$('draft-my-picks');
  if(pickEl){
    const rosterRanks=S.rosters.map(r=>{
      const val=(r.players||[]).reduce((s,pid)=>s+dynastyValue(pid),0);
      return{rid:r.roster_id,val};
    }).sort((a,b)=>a.val-b.val);
    const getPickPos=(rosterId2)=>{
      const idx=rosterRanks.findIndex(r=>r.rid===rosterId2);
      return idx>=0?idx+1:Math.ceil(teams/2);
    };

    // Find best position to target per round
    const roundTarget=(rd)=>{
      if(rd<=2){const n=posAnalysis.find(p=>p.needScore>0&&p.pos!=='K');return n?n.pos:'BPA';}
      if(rd<=4)return posAnalysis.find(p=>p.needScore>10&&p.pos!=='K')?.pos||'BPA';
      return posAnalysis.find(p=>p.needScore>0&&['DL','LB','DB'].includes(p.pos))?.pos||'BPA';
    };

    if(!ownedPicks.length){
      pickEl.innerHTML=`<div style="padding:14px;color:var(--text3);font-size:13px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);text-align:center">No picks for ${year}</div>`;
    } else {
      // Summary numbers for the big card
      const totalPicks=ownedPicks.length;
      const totalVal=ownedPicks.reduce((s,p)=>{
        const estPos=getPickPos(p.own?S.myRosterId:p.fromRosterId);
        return s+pickValue(year,p.round,teams,estPos);
      },0);
      const rounds=[...new Set(ownedPicks.map(p=>p.round))].sort((a,b)=>a-b);
      const rangeLabel=rounds.length===1?`R${rounds[0]}`:`R${rounds[0]}–R${rounds[rounds.length-1]}`;

      // First pick details (UP NEXT)
      const first=ownedPicks[0];
      const firstEstPos=getPickPos(first.own?S.myRosterId:first.fromRosterId);
      const firstLabel=first.round+'.'+String(firstEstPos).padStart(2,'0');
      const firstTarget=roundTarget(first.round);

      // Expanded list (all picks, compact)
      const expandedRows=ownedPicks.map((p,i)=>{
        const fromRoster=p.own?S.myRosterId:p.fromRosterId;
        const estPos=getPickPos(fromRoster);
        const val=pickValue(year,p.round,teams,estPos);
        const pickLabel=p.round+'.'+String(estPos).padStart(2,'0');
        const fromName=p.own?'':'via '+p.from;
        const target=roundTarget(p.round);
        const isFirst=i===0;
        return`<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:${p.own?'var(--bg3)':'rgba(212,175,55,.06)'};border:1px solid ${isFirst?'var(--accent)':'var(--border)'};border-radius:8px;margin-bottom:4px;cursor:pointer" onclick="event.stopPropagation();fillGlobalChat('Who should I take at pick ${pickLabel}? My target position is ${target}.')">
          <div style="font-size:14px;font-weight:700;color:${p.own?'var(--text)':'var(--accent)'};font-family:'JetBrains Mono',monospace;min-width:46px">${pickLabel}</div>
          <div style="flex:1;font-size:12px;color:var(--text3)">${fromName||('~'+val.toLocaleString())}${isFirst?' · <span style="color:var(--accent);font-weight:700">UP NEXT</span>':''}</div>
          <span style="font-size:12px;font-weight:700;padding:2px 7px;border-radius:5px;background:var(--accentL);color:var(--accent)">${target}</span>
        </div>`;
      }).join('');

      pickEl.innerHTML=`
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);cursor:pointer;overflow:hidden" onclick="_toggleOwnedPicks()">
          <div style="padding:14px 16px;display:flex;align-items:center;gap:12px">
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Your picks · ${year}</div>
              <div style="font-size:14px;color:var(--text2)"><span style="color:var(--accent);font-weight:700">${firstLabel}</span> UP NEXT · target ${firstTarget}</div>
              <div style="font-size:12px;color:var(--text3);margin-top:2px">${rangeLabel} · ~${totalVal.toLocaleString()} DHQ total</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:28px;font-weight:900;color:var(--accent);font-family:'JetBrains Mono',monospace;line-height:1;letter-spacing:-.03em">${totalPicks}</div>
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-top:2px">picks</div>
            </div>
            <svg id="draft-picks-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text3);transition:transform .2s"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div id="draft-picks-expand" style="max-height:0;overflow:hidden;transition:max-height .28s ease;padding:0 12px">
            <div style="padding:6px 0 12px 0">${expandedRows}</div>
          </div>
        </div>`;
    }
  }

  // === RENDER: Draft Strategy (bar chart) ===
  const summaryEl=$('draft-summary');
  const summaryContent=$('draft-summary-content');
  if(!summaryEl||!summaryContent)return;
  summaryEl.style.display='block';

  const gradeColorD=ns=>ns>=50?'var(--red)':ns>=30?'var(--amber)':ns>=15?'var(--text3)':'var(--green)';
  const gradeLetterD=ns=>ns>=50?'!!':ns>=30?'!':ns>=15?'~':'OK';

  const sortedPos=posAnalysis.filter(p=>p.pos!=='K');

  let dhtml=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:12px 14px">
    <details>
    <summary style="font-size:14px;font-weight:700;color:var(--text);cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;padding:2px 0 8px">
      Draft Intel
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text3)" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    </summary>`;

  if(sortedPos.length){
    dhtml+=`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${sortedPos.map(p=>{
      const chipClass=p.needScore>=50?'strat-chip-critical':p.needScore>=30?'strat-chip-need':'strat-chip-ok';
      const gradeLetter=gradeLetterD(p.needScore);
      return`<span class="strat-chip ${chipClass}" onclick="_rookieFilter('${p.pos}')">${gradeLetter} ${p.pos} · ${p.startable}/${p.slotsNeeded} starters</span>`;
    }).join('')}</div>`;
    dhtml+=sortedPos.map(p=>{
      const gradeColor=gradeColorD(p.needScore);
      const gradeLetter=gradeLetterD(p.needScore);
      const barColor=p.needScore>=50?'var(--red)':p.needScore>=30?'var(--amber)':p.needScore>=15?'var(--text3)':'var(--green)';
      return`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="_rookieFilter('${p.pos}')">
        <span style="font-size:13px;font-weight:700;color:${gradeColor};min-width:20px">${gradeLetter}</span>
        <span style="font-size:13px;font-weight:600;color:var(--text);min-width:28px">${p.pos}</span>
        <div style="flex:1;height:6px;background:var(--bg4);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100,p.needScore)}%;background:${barColor};border-radius:3px;transition:width .4s"></div>
        </div>
        <span style="font-size:13px;color:var(--text3);min-width:40px;text-align:right">${p.startable}/${p.slotsNeeded}</span>
      </div>`;
    }).join('');
  } else {
    dhtml+=`<div style="font-size:13px;color:var(--green);padding:6px 0">No critical needs — draft best player available.</div>`;
  }

  // Append history INTO the strategy card (merged "Draft Intel")
  if(LI_LOADED&&LI.hitRateByRound){
    const myPickRoundsSet=new Set(ownPickRounds);
    const keyInsights=[];
    for(let rd=1;rd<=Math.min(draftRounds,7);rd++){
      const roundData=LI.hitRateByRound[rd];
      if(!roundData)continue;
      const rate=roundData.rate||0;
      const isMine=myPickRoundsSet.has(rd);
      const bestPos2=(roundData.bestPos||[]).slice(0,2).map(bp=>bp.pos).join('/');
      if(isMine)keyInsights.push({rd,rate,bestPos:bestPos2,mine:true});
    }

    if(keyInsights.length){
      dhtml+=`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Your Pick Hit Rates · ${LI.draftMeta?.length||0} drafts</div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:4px">`;
      dhtml+=keyInsights.map(k=>{
        const hitCol=k.rate>=50?'var(--green)':k.rate>=25?'var(--amber)':'var(--red)';
        return`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px">
          <span style="font-weight:700;color:var(--accent);min-width:24px">R${k.rd}</span>
          ${_radialProgress(k.rate,hitCol)}
          ${k.bestPos?`<span style="color:var(--text3);font-size:13px">best at ${k.bestPos}</span>`:''}
        </div>`;
      }).join('');
      dhtml+=`</div>`;
    }

    // Full grid (collapsed by default)
    dhtml+=`<details style="margin-top:8px"><summary style="font-size:13px;color:var(--text3);cursor:pointer;padding:4px 0">View all rounds</summary>
    <div style="display:grid;grid-template-columns:40px 1fr 50px 1fr;gap:4px 8px;align-items:center;font-size:13px;margin-top:8px">
      <span style="font-weight:700;color:var(--text3)">Rd</span><span style="font-weight:700;color:var(--text3)">Rate</span><span></span><span style="font-weight:700;color:var(--text3)">Best</span>`;

    for(let rd=1;rd<=draftRounds;rd++){
      const roundData=LI.hitRateByRound[rd];
      if(!roundData)continue;
      const rate=roundData.rate||0;
      const isMine=ownPickRounds.includes(rd);
      const hitColor=rate>=50?'var(--green)':rate>=25?'var(--amber)':'var(--red)';
      const posRecs=(roundData.bestPos||[]).slice(0,3).map(bp=>{
        const myNeed=posAnalysis.find(pa=>pa.pos===bp.pos);
        const needDot=myNeed&&myNeed.needScore>=20?'🎯':'';
        return`<span style="color:${bp.rate>=40?'var(--green)':bp.rate>=20?'var(--text2)':'var(--text3)'}">${bp.pos} ${bp.rate}%${needDot}</span>`;
      }).join(' · ');

      dhtml+=`
        <span style="font-weight:700;color:${isMine?'var(--accent)':'var(--text)'}">${isMine?'► ':''}R${rd}</span>
        <div style="background:var(--bg4);border-radius:2px;height:5px;overflow:hidden"><div style="width:${Math.max(3,rate)}%;height:100%;background:${hitColor};border-radius:2px"></div></div>
        <span style="color:${hitColor};font-weight:600">${rate}%</span>
        <span style="color:var(--text3)">${posRecs||'—'}</span>`;
    }
    dhtml+=`</div></details></div>`;
  }

  dhtml+=`</details></div>`;
  summaryContent.innerHTML=dhtml;
  needsEl.style.display='none';

  // renderRookieBoard() is now called by renderTopProspects() to avoid
  // overwriting draft-top-prospects (both target the same element).
}

// ── Rookie Scouting Board (sortable compact table) ────────────
let _rookieSort={key:'dhq',dir:-1};
let _rookiePosFilter='';
let _rookieExpanded=null;
let _rookieShowAll=false;
let _rookieGroupByPos=false;
let _rookieSearch='';
let _rookieTagFilter='';

function _rookieEsc(s) {
  const esc = window.escHtml || window.App?.escHtml;
  return typeof esc === 'function'
    ? esc(s)
    : String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _rookieTags() {
  const leagueId = window.S?.currentLeagueId || window.App?.S?.currentLeagueId || '';
  if (!window._playerTags) {
    try { window._playerTags = JSON.parse(localStorage.getItem('player_tags_' + leagueId) || '{}'); }
    catch { window._playerTags = {}; }
  }
  return window._playerTags || {};
}

function _saveRookieTags(tags) {
  const leagueId = window.S?.currentLeagueId || window.App?.S?.currentLeagueId || '';
  window._playerTags = tags || {};
  try { localStorage.setItem('player_tags_' + leagueId, JSON.stringify(window._playerTags)); } catch {}
  if (window.OD?.savePlayerTags) window.OD.savePlayerTags(leagueId, window._playerTags);
}

function _rookieTagLabel(tag) {
  if (tag === 'trade') return 'Target';
  if (tag === 'watch') return 'Watch';
  if (tag === 'untouchable') return 'Priority';
  if (tag === 'cut') return 'Fade';
  return '';
}

function _rookieTagClass(tag) {
  if (tag === 'trade') return 'target';
  if (tag === 'watch') return 'watch';
  if (tag === 'untouchable') return 'priority';
  if (tag === 'cut') return 'fade';
  return '';
}

function _rookieTag(pid, tag) {
  const tags = { ..._rookieTags() };
  if (tags[pid] === tag) delete tags[pid];
  else tags[pid] = tag;
  _saveRookieTags(tags);
  if (document.querySelector('.rookie-hq') && typeof renderTopProspects === 'function') renderTopProspects();
  else if (typeof renderRookieBoard === 'function') renderRookieBoard();
  if (typeof showToast === 'function') showToast(tags[pid] ? 'Tagged' : 'Tag removed');
}
window._rookieTag = _rookieTag;

function _rookieTagControls(pid) {
  const active = _rookieTags()[pid] || '';
  const options = [
    ['trade', 'Target'],
    ['watch', 'Watch'],
    ['untouchable', 'Priority'],
    ['cut', 'Fade'],
  ];
  return `<div class="rookie-tag-controls">${options.map(([key, label]) =>
    `<button class="rookie-tag-btn ${active === key ? 'active ' + _rookieTagClass(key) : ''}" onclick="event.stopPropagation();_rookieTag('${pid}','${key}')">${label}</button>`
  ).join('')}</div>`;
}

function _syncRookieHqTagCounts(counts) {
  if (!counts) return;
  const total = ['trade', 'watch', 'untouchable', 'cut'].reduce((sum, tag) => sum + (counts[tag] || 0), 0);
  document.querySelectorAll('[data-rookie-hq-tag-count]').forEach(el => {
    const tag = el.getAttribute('data-rookie-hq-tag-count');
    el.textContent = String(counts[tag] || 0);
  });
  document.querySelectorAll('[data-rookie-hq-tagged-total]').forEach(el => {
    el.textContent = String(total);
  });
}

function _rookieOpen(pid) {
  const cached = window._rookieCache?.[pid];
  if (String(pid || '').startsWith('csv_') && cached && typeof _mockShowInfo === 'function') {
    _mockShowInfo({ pid, name: cached.p?.full_name || cached.name, pos: cached.pos, val: cached.dhq || 0 });
    return;
  }
  if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
}
window._rookieOpen = _rookieOpen;

function renderRookieBoard(){
  const $ = window.$ || (id => document.getElementById(id));
  const S = window.S || window.App?.S || {};
  const LI = window.LI || window.App?.LI || {};
  const dynastyValue = window.dynastyValue || window.App?.dynastyValue || (() => 0);
  const assessTeamFromGlobal = window.assessTeamFromGlobal || window.App?.assessTeamFromGlobal;
  const pPos = window.pPos || window.App?.pPos || (() => '');
  const pName = window.pName || window.App?.pName || (id => id);
  // Target priority: rookie-board-mount (inside draft-top-prospects, created by
  // renderTopProspects) → draft-top-prospects → rookie-profiles (legacy stub).
  let el = document.getElementById('rookie-board-mount');
  if (!el) el = document.getElementById('draft-top-prospects');
  if (!el || el.style.display === 'none') el = document.getElementById('rookie-profiles');
  if (!el) return;
  // Don't block on LI_LOADED — show what we have from Sleeper data

  // Phase 8 v2: position mapper aligned with shared/utils.js normPos —
  // collapses raw NFL positions (NT/IDL/EDGE/MLB/SS/FS etc.) into the
  // fantasy display groups (DL/LB/DB). This must be wider than the old
  // narrow posMapD so IDP prospects match the DL/LB/DB filter chips.
  const posMapRookie = p => {
    if (['DE','DT','NT','IDL','EDGE'].includes(p)) return 'DL';
    if (['OLB','ILB','MLB'].includes(p)) return 'LB';
    if (['CB','S','SS','FS'].includes(p)) return 'DB';
    return p;
  };

  // Get rookies from player database — aligned with War Room's inclusion logic:
  // Include if DHQ > 0, OR if p.team exists (has an NFL team), OR if tagged FC_ROOKIE
  const league_rb = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const leagueHasIDP_rb = leagueHasIDPSlots(league_rb);
  const leagueHasK_rb = (league_rb?.roster_positions || []).some(s => s === 'K');
  const assess_rb = typeof assessTeamFromGlobal === 'function' ? assessTeamFromGlobal(S.myRosterId) : null;
  const needPos = assess_rb?.needs?.map(n => typeof n === 'string' ? n : n.pos) || [];

  let rookies = Object.entries(S.players || {})
    .filter(([pid, p]) => p.years_exp === 0 && p.status !== 'Inactive' && p.position && !['HC','OC','DC','GM'].includes(p.position))
    .map(([pid, p]) => {
      const dhq = dynastyValue(pid) || 0;
      const pos = posMapRookie(pPos(pid) || p.position);
      const rookieMeta = LI?.playerMeta?.[pid];
      const isIDP = isIDPPosition(p.position);
      // War Room logic: include if any signal of relevance
      const hasValue = (LI?.playerScores?.[pid] || 0) > 0 || dhq > 0;
      const hasLeagueSlot = (isIDP && leagueHasIDP_rb) || (p.position === 'K' && leagueHasK_rb);
      if (!hasValue && !p.team && rookieMeta?.source !== 'FC_ROOKIE' && !hasLeagueSlot) return null;
      if (isIDP && !leagueHasIDP_rb) return null;
      const meta = LI?.playerMeta?.[pid] || {};
      const college = p.college || '';
      const age = p.age || '';
      const csvProspect = typeof window.findProspect === 'function' ? window.findProspect((p.first_name || '') + ' ' + (p.last_name || '')) : null;
      const csvRank = csvProspect?.rank || null;
      const csvSummary = csvProspect?.summary || '';
      const csvSize = csvProspect ? [csvProspect.size, csvProspect.weight ? csvProspect.weight + 'lbs' : '', csvProspect.speed || ''].filter(Boolean).join(' · ') : '';
      const csvTier = csvProspect?.tier || '';
      const fit = needPos.includes(pos) ? 'high' : needPos.length && !assess_rb?.strengths?.includes(pos) ? 'med' : 'low';
      return { pid, p, dhq, pos, college: csvProspect?.college || college, age, meta, fit, csvRank, csvSummary, csvSize, csvTier,
        nflTeam: csvProspect?.nflTeam || '', draftRound: csvProspect?.draftRound || null, draftPick: csvProspect?.draftPick || null, isUDFA: !!csvProspect?.isUDFA };
    })
    .filter(Boolean);

  // Merge CSV-only prospects (from The Beast) — players not yet in Sleeper
  if (typeof window.getProspects === 'function') {
    const sleeperNames = new Set(rookies.map(r => (r.p?.full_name || '').toLowerCase().trim()));
    const allCsv = window.getProspects() || [];
    allCsv.forEach(csv => {
      if (sleeperNames.has((csv.name || '').toLowerCase().trim())) return;
      const pos = posMapRookie(csv.mappedPos || csv.pos || 'QB');
      const isIDPPos = ['DL', 'LB', 'DB'].includes(pos);
      if (isIDPPos && !leagueHasIDP_rb) return;
      if (pos === 'K' && !leagueHasK_rb) return;

      const nameParts = (csv.name || '').split(' ');
      const syntheticP = {
        full_name: csv.name,
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' ') || '',
        position: csv.pos || pos,
        college: csv.college || '',
        years_exp: 0,
        age: csv.age ? parseFloat(csv.age) : null,
        team: null,
        status: 'Active',
      };
      const syntheticPid = 'csv_' + (csv.name || '').toLowerCase().replace(/[^a-z]/g, '_');
      const fit = needPos.includes(pos) ? 'high' : needPos.length ? 'med' : 'low';
      rookies.push({
        pid: syntheticPid,
        p: syntheticP,
        dhq: csv.draftScore || csv.dynastyValue || 0,
        pos,
        college: csv.college || '',
        age: csv.age ? parseFloat(csv.age) : '',
        meta: {},
        fit,
        csvRank: csv.rank || null,
        csvSummary: csv.summary || '',
        csvSize: [csv.size, csv.weight ? csv.weight + 'lbs' : '', csv.speed || ''].filter(Boolean).join(' · '),
        csvTier: csv.tier || '',
        nflTeam: csv.nflTeam || '',
        draftRound: csv.draftRound || null,
        draftPick: csv.draftPick || null,
        isUDFA: !!csv.isUDFA,
      });
    });
  }

  const tags = _rookieTags();
  const allBoardTagCounts = ['trade','watch','untouchable','cut'].reduce((acc, tag) => {
    acc[tag] = rookies.filter(r => tags[r.pid] === tag).length;
    return acc;
  }, {});
  _syncRookieHqTagCounts(allBoardTagCounts);

  // Apply position filter
  if(_rookiePosFilter)rookies=rookies.filter(r=>r.pos===_rookiePosFilter);

  const search = (_rookieSearch || '').trim().toLowerCase();
  if(search){
    rookies = rookies.filter(r => {
      const hay = [
        r.p?.full_name,
        r.name,
        r.pos,
        r.college,
        r.nflTeam,
        r.csvTier,
        r.csvSummary,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  const tagCountBase = rookies.slice();
  if(_rookieTagFilter){
    rookies = rookies.filter(r => tags[r.pid] === _rookieTagFilter);
  }

  // Apply sort
  rookies.sort((a,b)=>{
    const k=_rookieSort.key,d=_rookieSort.dir;
    if(k==='dhq')return(a.dhq-b.dhq)*d;
    if(k==='name')return d*((a.p.full_name||'').localeCompare(b.p.full_name||''));
    if(k==='pos')return d*((a.pos||'').localeCompare(b.pos||''));
    if(k==='age')return d*((a.age||99)-(b.age||99));
    if(k==='fit'){const fo={high:0,med:1,low:2};return d*((fo[a.fit]||2)-(fo[b.fit]||2));}
    return 0;
  });

  rookies=rookies.slice(0,120);
  window._rookieCache = {};
  rookies.forEach(r => { window._rookieCache[r.pid] = r; });

  // Limit to top 25 unless user expanded
  const ROOKIE_PAGE=25;
  const totalRookies=rookies.length;
  const visibleRookies=_rookieShowAll?rookies:rookies.slice(0,ROOKIE_PAGE);
  const hiddenCount=totalRookies-visibleRookies.length;

  const sortInd=k=>_rookieSort.key===k?(_rookieSort.dir===-1?' \u25BC':' \u25B2'):'';
  const posFilters=['','QB','RB','WR','TE'];

  // Check if league has K/IDP slots (Phase 8 v2 — via shared helpers)
  const league=S.leagues?.find(l=>l.league_id===S.currentLeagueId);
  const rp=league?.roster_positions||[];
  const leagueHasK=rp.some(s=>s==='K');
  const leagueHasDST=rp.some(s=>window.App?.normPos?.(s)==='DEF'||['DEF','DST','D/ST'].includes(String(s||'').toUpperCase()));
  const leagueHasIDP=leagueHasIDPSlots(league);
  if(leagueHasK)posFilters.push('K');
  if(leagueHasDST)posFilters.push('DEF');
  if(leagueHasIDP)posFilters.push('DL','LB','DB');

  // Hero card — Alex's decisive pick, big and bold
  const _rbStrat = window.GMStrategy?.getStrategy ? window.GMStrategy.getStrategy() : {};
  const _rbDs = _rbStrat.draftStyle || 'bpa';
  const _rbAssess = typeof assessTeamFromGlobal === 'function' ? assessTeamFromGlobal(S.myRosterId) : null;
  const _rbNeeds = (_rbAssess?.needs || []).map(n => typeof n === 'string' ? n : n.pos);
  let _rbHero = '';
  if (rookies.length > 0) {
    let _rbPick = rookies[0];
    if (_rbDs === 'need' && _rbNeeds.length) _rbPick = rookies.find(r => _rbNeeds.includes(r.pos)) || _rbPick;
    else if (_rbDs === 'mix' && _rbNeeds.length) _rbPick = rookies.find(r => _rbNeeds.includes(r.pos) || (_rbStrat.targetPositions||[]).includes(r.pos)) || _rbPick;
    const _rbIsTop = _rbPick === rookies[0];
    const _rbNext = rookies[1];
    const _rbTierBreak = _rbIsTop && _rbNext && (_rbPick.dhq - _rbNext.dhq) > 1000;
    const _rbSubtitle = _rbTierBreak
      ? 'Clear tier break. Don\'t overthink it.'
      : _rbDs === 'need'
      ? 'Fills your ' + _rbPick.pos + ' gap. Best value at your position of need.'
      : _rbDs === 'mix'
      ? 'Best value + roster fit. Take him.'
      : '#1 overall value. BPA, no question.';
    // Strategy alignment
    const _rbAlignCheck = window.GMStrategy?.checkAlignment ? window.GMStrategy.checkAlignment({type:'draft',pos:_rbPick.pos}) : null;
    const _rbAlignLabel = _rbAlignCheck?.status === 'aligned' ? 'Strategy aligned' : _rbAlignCheck?.status === 'partial' ? 'Partial fit' : _rbPick.fit === 'high' ? 'Roster fit' : '';
    const _rbAlignCol = _rbAlignCheck?.status === 'aligned' ? 'var(--green)' : _rbPick.fit === 'high' ? 'var(--green)' : 'var(--amber)';
    _rbHero = `<div style="background:rgba(212,175,55,.08);border:2px solid rgba(212,175,55,.4);border-radius:var(--rl);padding:16px 18px;margin-bottom:14px;cursor:pointer;position:relative;overflow:hidden" onclick="openPlayerModal('${_rbPick.pid}')">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),transparent)"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em">Alex says</div>
        ${_rbAlignLabel ? `<span style="font-size:11px;font-weight:700;color:${_rbAlignCol};padding:1px 6px;border:1px solid ${_rbAlignCol};border-radius:8px;opacity:.9">${escHtml(_rbAlignLabel)}</span>` : ''}
        ${_rbTierBreak ? '<span style="font-size:11px;font-weight:700;color:var(--red);padding:1px 6px;border:1px solid rgba(231,76,60,.4);border-radius:8px">Tier break</span>' : ''}
      </div>
      <div style="font-size:22px;font-weight:900;color:var(--text);line-height:1.1;letter-spacing:-.02em">Take ${escHtml(pName(_rbPick.pid))}.</div>
      <div style="font-size:14px;color:var(--text2);margin-top:6px;font-weight:500">${escHtml(_rbSubtitle)}</div>
      ${_rbPick.dhq > 0 ? `<div style="font-size:12px;color:var(--text3);margin-top:6px;font-family:'JetBrains Mono',monospace">${_rbPick.pos} · ${_rbPick.dhq.toLocaleString()} DHQ${_rbPick.csvRank ? ' · Consensus #' + _rbPick.csvRank : ''}</div>` : ''}
    </div>`;
  }

  const activeTagCounts = ['trade','watch','untouchable','cut'].reduce((acc, tag) => {
    acc[tag] = tagCountBase.filter(r => tags[r.pid] === tag).length;
    return acc;
  }, {});
  const allTagCount = tagCountBase.length;
  const boardTitle = _rookieTagFilter ? `${_rookieTagLabel(_rookieTagFilter)} Board` : 'Market Board';

  el.innerHTML=`
    <section class="rookie-board-shell">
      <div class="rookie-board-top">
        <div>
          <div class="scout-kicker">${boardTitle}</div>
          <h2>${visibleRookies.length} prospects in view</h2>
          <p>${_rookieSearch ? `Search: "${_rookieEsc(_rookieSearch)}"` : _rookieTagFilter ? `${_rookieTagLabel(_rookieTagFilter)} tags only` : 'Sortable rookie market with roster fit, tags, draft capital context, and scout notes.'}</p>
        </div>
        <button class="scout-secondary-btn" onclick="openDynamicMockDraft()">Mock</button>
      </div>
      <div class="rookie-board-tools">
        <input value="${_rookieEsc(_rookieSearch)}" placeholder="Search rookies, college, team..." oninput="_rookieSetSearch(this.value)" />
        <button onclick="_rookieSetSearch('')" ${_rookieSearch ? '' : 'disabled'}>Clear</button>
      </div>
      <div class="rookie-tag-filter-row">
        ${[
          ['', 'All tags', allTagCount],
          ['trade', 'Targets', activeTagCounts.trade],
          ['watch', 'Watch', activeTagCounts.watch],
          ['untouchable', 'Priority', activeTagCounts.untouchable],
          ['cut', 'Fades', activeTagCounts.cut],
        ].map(([tag, label, count]) => `<button class="${_rookieTagFilter === tag ? 'active ' + _rookieTagClass(tag) : ''}" onclick="_rookieSetTagFilter('${tag}')">${label}<span>${count}</span></button>`).join('')}
      </div>
      <!-- Position filters + Group by Pos toggle -->
      <div class="rookie-board-pos-row">
      ${posFilters.map(pos=>`<button class="chip${_rookiePosFilter===pos?' chip-active':''}" onclick="_rookieFilter('${pos}')" style="padding:4px 10px;font-size:13px;border-radius:14px;cursor:pointer;border:1px solid ${_rookiePosFilter===pos?'var(--accent)':'var(--border2)'};background:${_rookiePosFilter===pos?'var(--accentL)':'transparent'};color:${_rookiePosFilter===pos?'var(--accent)':'var(--text3)'}">${pos?(window.App?.posLabel?.(pos)||(pos==='DEF'?'D/ST':pos)):'All'}</button>`).join('')}
      <button onclick="_toggleRookieGrouping()" style="margin-left:auto;padding:4px 10px;font-size:12px;border-radius:14px;cursor:pointer;border:1px solid ${_rookieGroupByPos?'var(--accent)':'var(--border2)'};background:${_rookieGroupByPos?'var(--accentL)':'transparent'};color:${_rookieGroupByPos?'var(--accent)':'var(--text3)'};font-family:inherit">Group by Pos</button>
      </div>
    </section>
    <!-- Table header -->
    <div class="rb-header-sticky" style="display:flex;align-items:center;padding:4px 8px;font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border2)">
      <span style="width:28px;text-align:center">#</span>
      <span style="flex:1;cursor:pointer" onclick="_rookieSortBy('name')">Player${sortInd('name')}</span>
      <span style="width:36px;text-align:center;cursor:pointer" onclick="_rookieSortBy('pos')">Pos${sortInd('pos')}</span>
      <span style="width:32px;text-align:center;cursor:pointer" onclick="_rookieSortBy('age')">Age${sortInd('age')}</span>
      <span style="width:54px;text-align:right;cursor:pointer" onclick="_rookieSortBy('dhq')">DHQ${sortInd('dhq')}</span>
      <span style="width:40px;text-align:center;cursor:pointer" onclick="_rookieSortBy('fit')">Fit${sortInd('fit')}</span>
    </div>
    <!-- Position header (when filtering) -->
    ${_rookiePosFilter ? `<div style="padding:8px 8px 4px;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em">${_rookiePosFilter} prospects · ${visibleRookies.length} players${visibleRookies[0]?.dhq ? ' · Top DHQ: ' + visibleRookies[0].dhq.toLocaleString() : ''}</div>` : ''}
    <!-- Rows (grouped or flat) -->
    ${_rookieGroupByPos && !_rookiePosFilter
      ? _renderGroupedRookies(visibleRookies)
      : visibleRookies.map((r, i) => _renderRookieRow(r, i)).join('')}
    ${visibleRookies.length===0?'<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">No rookies match this filter</div>':''}
    ${hiddenCount>0?`<button onclick="_rookieShowMore()" style="width:100%;padding:10px;margin-top:6px;font-size:13px;font-weight:600;color:var(--text3);background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);cursor:pointer;font-family:inherit;transition:all .15s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='var(--bg2)'">Show More (${hiddenCount} remaining)</button>`:''}
  `;
}

// Helper functions for rookie board
function _rookieSortBy(key){
  if(_rookieSort.key===key)_rookieSort.dir*=-1;
  else{_rookieSort.key=key;_rookieSort.dir=-1;}
  renderRookieBoard();
}
function _rookieFilter(pos){
  _rookiePosFilter=pos;
  _rookieShowAll=false; // reset pagination on filter change
  renderRookieBoard();
}
function _rookieToggle(pid){
  _rookieExpanded=_rookieExpanded===pid?null:pid;
  renderRookieBoard();
}
function _rookieShowMore(){
  _rookieShowAll=true;
  renderRookieBoard();
}
function _rookieSetSearch(value){
  _rookieSearch=value||'';
  _rookieShowAll=false;
  renderRookieBoard();
}
function _rookieSetTagFilter(tag){
  _rookieTagFilter=_rookieTagFilter===tag?'':tag;
  _rookieShowAll=false;
  renderRookieBoard();
}
function _toggleRookieGrouping(){
  _rookieGroupByPos=!_rookieGroupByPos;
  renderRookieBoard();
}
window._toggleRookieGrouping=_toggleRookieGrouping;
window._rookieSetSearch=_rookieSetSearch;
window._rookieSetTagFilter=_rookieSetTagFilter;

// Extracted row renderer for reuse in normal + grouped views
function _renderRookieRow(r, i) {
  const dhqCol=r.dhq>=7000?'var(--green)':r.dhq>=4000?'var(--blue)':r.dhq>=2000?'var(--text2)':'var(--text3)';
  const fitBadge=r.fit==='high'?'<span class="fit-high">FIT</span>':r.fit==='med'?'<span class="fit-med">VAL</span>':'<span class="fit-low">\u2014</span>';
  const isExp=_rookieExpanded===r.pid;
  const posStyle=typeof getPosBadgeStyle==='function'?getPosBadgeStyle(r.pos):'';
  const tag = _rookieTags()[r.pid] || '';
  const tagChip = tag ? `<span class="rookie-row-tag ${_rookieTagClass(tag)}">${_rookieTagLabel(tag)}</span>` : '';
  // Draft badge: drafted players get team + round.pick chip; UDFA gets a UDFA chip
  const draftChip = r.draftRound && r.draftPick
    ? `<span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--accentL);color:var(--accent);font-family:'JetBrains Mono',monospace;flex-shrink:0">${_rookieEsc(r.nflTeam||'???')} R${r.draftRound}.${String(r.draftPick).padStart(2,'0')}</span>`
    : r.isUDFA
      ? `<span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--bg4);color:var(--text3);flex-shrink:0">${r.nflTeam ? 'UDFA · ' + _rookieEsc(r.nflTeam) : 'UDFA'}</span>`
      : '';
  return `<div>
    <div onclick="_rookieToggle('${r.pid}')" style="display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;border-bottom:1px solid ${isExp?'transparent':'var(--border)'};background:${isExp?'var(--accentL2)':'transparent'};transition:background .12s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='${isExp?'var(--accentL2)':'transparent'}'">
      <span style="width:28px;text-align:center;font-size:13px;font-weight:700;color:${i<3?'var(--accent)':'var(--text3)'}">${i+1}</span>
      <div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden">
        <img src="https://sleepercdn.com/content/nfl/players/${r.pid}.jpg" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'" loading="lazy"/>
        <div style="min-width:0;overflow:hidden">
          <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_rookieEsc(r.p?.full_name||r.name||'Unknown')}</div>
          <div style="font-size:13px;color:var(--text3)">${_rookieEsc(r.college||r.p?.team||'')}</div>
        </div>
      </div>
      ${draftChip}
      ${tagChip}
      <span style="width:36px;text-align:center"><span class="rr-pos" style="${posStyle};font-size:13px;padding:1px 4px">${r.pos}</span></span>
      <span style="width:32px;text-align:center;font-size:13px;color:var(--text3)">${r.age||'\u2014'}</span>
      <span style="width:54px;text-align:right;font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${dhqCol}">${r.dhq>0?r.dhq.toLocaleString():'\u2014'}</span>
      <span style="width:40px;text-align:center">${fitBadge}</span>
    </div>
    ${isExp?`<div style="padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:0 0 var(--r) var(--r);margin-bottom:4px;animation:panelIn .2s ease">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
        <span style="font-size:13px;color:var(--text2)">${r.pos} \u00B7 ${r.nflTeam||r.p?.team||'TBD'} \u00B7 Age ${r.age||'?'}${r.csvSize?' \u00B7 '+r.csvSize:r.p?.height?' \u00B7 '+Math.floor(r.p.height/12)+"'"+r.p.height%12+'"':''}${!r.csvSize&&r.p?.weight?' \u00B7 '+r.p.weight+'lbs':''}</span>
        ${r.draftRound && r.draftPick ? `<span style="font-size:11px;padding:1px 6px;border-radius:4px;font-weight:700;background:var(--accentL);color:var(--accent)">Drafted R${r.draftRound}.${String(r.draftPick).padStart(2,'0')}${r.nflTeam?' \u00B7 '+_rookieEsc(r.nflTeam):''}</span>` : r.isUDFA ? `<span style="font-size:11px;padding:1px 6px;border-radius:4px;font-weight:700;background:var(--bg4);color:var(--text3)">UDFA${r.nflTeam?' \u00B7 '+_rookieEsc(r.nflTeam):''}</span>` : ''}
        ${r.csvRank?'<span style="font-size:11px;padding:1px 6px;border-radius:4px;font-weight:700;background:var(--accentL);color:var(--accent)">Consensus #'+r.csvRank+'</span>':''}
        ${r.csvTier?'<span style="font-size:11px;padding:1px 6px;border-radius:4px;font-weight:600;background:var(--bg4);color:var(--text3)">'+_rookieEsc(r.csvTier)+'</span>':''}
      </div>
      ${r.csvSummary?'<div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:8px;padding:8px;background:var(--bg3);border-radius:6px">'+_rookieEsc(r.csvSummary)+(r.csvSummary.length>=300?'...':'')+'</div>':''}
      ${_rookieTagControls(r.pid)}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="fillGlobalChat('Full scouting report on ${(r.p?.full_name||r.name||'').replace(/'/g,"\\'")} (${r.pos}, ${r.college||'Unknown'}). Include strengths, weaknesses, NFL comparison, and where I should draft them.')">Scout Report</button>
        <button class="btn btn-sm btn-ghost" onclick="_rookieOpen('${r.pid}')">Player Card</button>
      </div>
    </div>`:''}
  </div>`;
}

function _renderGroupedRookies(rookies) {
  const posOrder = ['QB','RB','WR','TE','K','DL','LB','DB'];
  const groups = {};
  rookies.forEach(r => { if (!groups[r.pos]) groups[r.pos] = []; groups[r.pos].push(r); });
  return posOrder
    .filter(pos => groups[pos]?.length)
    .map(pos => {
      const players = groups[pos].sort((a, b) => b.dhq - a.dhq);
      const topDHQ = players[0]?.dhq || 0;
      const header = `<div style="padding:8px 8px 4px;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;border-top:1px solid var(--border);margin-top:4px">${pos} · ${players.length} prospects · Top: ${topDHQ.toLocaleString()} DHQ</div>`;
      return header + players.map((r, i) => _renderRookieRow(r, i)).join('');
    }).join('');
}

// Legacy alias
function renderRookieProfiles(){renderRookieBoard();}

window._rookieSortBy=_rookieSortBy;
window._rookieFilter=_rookieFilter;
window._rookieToggle=_rookieToggle;
window._rookieShowMore=_rookieShowMore;
window.renderRookieBoard=renderRookieBoard;

// Toggle expand/collapse on the owned-picks big card (Phase 4).
function _toggleOwnedPicks(){
  const el=document.getElementById('draft-picks-expand');
  const chev=document.getElementById('draft-picks-chev');
  if(!el)return;
  const open=el.style.maxHeight&&el.style.maxHeight!=='0px';
  if(open){
    el.style.maxHeight='0';
    if(chev)chev.style.transform='';
  } else {
    el.style.maxHeight=el.scrollHeight+'px';
    if(chev)chev.style.transform='rotate(180deg)';
  }
}
window._toggleOwnedPicks=_toggleOwnedPicks;

// Toggle the "Tendencies" expand card inside the mock draft on-the-clock
// header (Phase 4). Shows league-wide draft intel — position runs, round
// hit-rates, round targets — sourced from posAnalysis + LI.leagueHistory.
function _toggleMockTendencies(){
  const body=document.getElementById('mock-tendencies-body');
  if(!body)return;
  const open=body.style.maxHeight&&body.style.maxHeight!=='0px';
  if(open){
    body.style.maxHeight='0';
    body.style.marginBottom='0';
    return;
  }
  // Lazy-populate on first open
  if(!body.dataset.populated){
    const LI_=window.LI||{};
    const history=LI_.leagueHistory||[];
    let html='<div style="padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">';
    html+='<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">League draft tendencies</div>';
    if(history.length){
      // Top 3 position runs by round from league history
      const byPos={};
      history.forEach(h=>{const pos=h.pos;if(!pos)return;byPos[pos]=(byPos[pos]||0)+1;});
      const top=Object.entries(byPos).sort((a,b)=>b[1]-a[1]).slice(0,3);
      html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">';
      top.forEach(([pos,ct])=>{
        html+=`<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--accentL);color:var(--accent)">${pos} × ${ct}</span>`;
      });
      html+='</div>';
      html+=`<div style="font-size:11px;color:var(--text3);line-height:1.5">Based on ${history.length} past picks. Ask the chat for round-by-round hit rates or positional runs.</div>`;
    } else {
      html+='<div style="font-size:12px;color:var(--text3);line-height:1.5">No league draft history yet. Ask the chat: "What are the draft tendencies in my league by round?"</div>';
    }
    html+='<button onclick="fillGlobalChat(\'Show me league-wide draft tendencies by round and position\')" style="margin-top:8px;padding:6px 12px;font-size:11px;font-weight:700;background:var(--bg4);border:1px solid var(--border2);border-radius:6px;color:var(--accent);cursor:pointer;font-family:inherit">Ask for full breakdown</button>';
    html+='</div>';
    body.innerHTML=html;
    body.dataset.populated='1';
  }
  body.style.maxHeight=body.scrollHeight+'px';
  body.style.marginBottom='8px';
}
window._toggleMockTendencies=_toggleMockTendencies;

async function runDraftScouting(){
  if(!hasAnyAI()){switchTab('settings');return;}
  if(typeof trackUsage==='function')trackUsage('draft_targets_flagged');
  const btn=$('draft-scout-btn');btn.textContent='Scouting...';btn.disabled=true;
  $('draft-scout-content').innerHTML='<div class="card"><div class="empty">Analyzing your picks, roster needs, and league draft history...</div></div>';
  try{
    const year=S.season||String(new Date().getFullYear());
    const my=myR();
    const allPlayers=my?.players||[];
    const league=S.leagues.find(l=>l.league_id===S.currentLeagueId);
    const rp=league?.roster_positions||[];
    const teams=S.rosters.length||12;
    const sc7=league?.scoring_settings||{};

    const starterSlots={QB:0,RB:0,WR:0,TE:0,K:0,DL:0,LB:0,DB:0};
    rp.forEach(s=>{
      if(s in starterSlots)starterSlots[s]++;
      else if(s==='FLEX'){starterSlots.RB+=0.4;starterSlots.WR+=0.4;starterSlots.TE+=0.2;}
      else if(s==='SUPER_FLEX'){starterSlots.QB+=0.5;starterSlots.WR+=0.25;starterSlots.RB+=0.25;}
      else if(s==='IDP_FLEX'){starterSlots.DL+=0.35;starterSlots.LB+=0.35;starterSlots.DB+=0.3;}
    });
    Object.keys(starterSlots).forEach(p=>starterSlots[p]=Math.round(starterSlots[p]));

    const needsStr=Object.keys(starterSlots).filter(p=>starterSlots[p]>0).map(pos=>{
      const posPlayers=allPlayers.filter(pid=>pPos(pid)===pos);
      const aging=posPlayers.filter(pid=>{const a=pAge(pid);const peaksD={QB:33,RB:27,WR:30,TE:30,DL:29,LB:28,DB:29};return a>(peaksD[pos]||29);}).length;
      return`${pos}: ${posPlayers.length} rostered / ${starterSlots[pos]} slots${aging?' ('+aging+' aging)':''}`;
    }).join(', ');

    const draftRounds=league?.settings?.draft_rounds||5;
    const pickRounds=[];
    for(let rd=1;rd<=draftRounds;rd++){
      const tradedAway=S.tradedPicks.find(p=>String(p.season)===year&&p.round===rd&&p.roster_id===S.myRosterId&&p.owner_id!==S.myRosterId);
      if(!tradedAway)pickRounds.push('R'+rd);
      const acquired=S.tradedPicks.filter(p=>String(p.season)===year&&p.round===rd&&p.owner_id===S.myRosterId&&p.roster_id!==S.myRosterId);
      acquired.forEach(p=>{const k='R'+p.round;if(!pickRounds.includes(k))pickRounds.push(k);});
    }
    const pickStr=pickRounds.join(', ')||'Unknown';

    let historyCtx='';
    if(LI_LOADED&&LI.hitRateByRound){
      const lines=Object.entries(LI.hitRateByRound).filter(([rd])=>parseInt(rd)<=draftRounds).map(([rd,d])=>{
        const best=d.bestPos?.slice(0,3).map(p=>p.pos+'('+p.rate+'% hit)').join(',')||'—';
        return`R${rd}:${d.rate}% overall hit,best=${best}`;
      });
      historyCtx='\nLEAGUE DRAFT HISTORY ('+LI.totalPicks+' picks over 5yrs):\n'+lines.join('\n');
      if(LI.pickSlotHistory){
        const slotSamples=pickRounds.slice(0,3).map(pr=>{
          const rd=parseInt(pr.replace('R',''));
          const midSlot=rd*teams-Math.floor(teams/2);
          const nearby=Object.entries(LI.pickSlotHistory)
            .filter(([slot])=>Math.abs(parseInt(slot)-midSlot)<=3)
            .flatMap(([,picks])=>picks);
          if(!nearby.length)return null;
          const hits=nearby.filter(p=>p.hit);
          const posDist={};nearby.forEach(p=>{posDist[p.pos]=(posDist[p.pos]||0)+1;});
          return`Picks near ${pr}(slot~${midSlot}):${nearby.length} historical, ${hits.length} hits. Positions drafted:${Object.entries(posDist).map(([p,c])=>p+':'+c).join(',')}`;
        }).filter(Boolean);
        if(slotSamples.length)historyCtx+='\n'+slotSamples.join('\n');
      }
    }

    // Build positional scarcity context from starterSlots
    const scarcityCtx=Object.keys(starterSlots).filter(pos=>starterSlots[pos]>0).map(pos=>{
      const posPlayers=allPlayers.filter(pid=>pPos(pid)===pos);
      const peaksD={QB:33,RB:27,WR:30,TE:30,DL:29,LB:28,DB:29};
      const aging=posPlayers.filter(pid=>{const a=pAge(pid);return a>(peaksD[pos]||29);}).length;
      const young=posPlayers.filter(pid=>pAge(pid)<25).length;
      const elite=posPlayers.filter(pid=>dynastyValue(pid)>=5000).length;
      const startable=posPlayers.filter(pid=>dynastyValue(pid)>=2000).length;
      const slotsNeeded=starterSlots[pos];
      const status=startable>=slotsNeeded?'FILLED':'GAP';
      return`${pos}: ${startable}/${slotsNeeded} starters (${status}), ${aging} aging, ${young} young, ${elite} elite`;
    }).join('\n');

    const prompt=`${year} rookie draft scouting for ${teams}-team dynasty league.
${typeof dhqContext === 'function' ? dhqContext(false) : ''}
MY ROSTER NEEDS (starters/slots):
${scarcityCtx}
MY PICKS: ${pickStr}
${dhqBuildMentalityContext()}
${historyCtx}
SCORING: IDP sack=${sc7.idp_sack||4}, INT=${sc7.idp_int||5}, PD=${sc7.idp_pass_def||3}, PPR=${sc7.rec||1}

CRITICAL RULES:
- Consider POSITIONAL SCARCITY in the rookie class — how many startable rookies exist at each position
- Factor in STARTER THRESHOLDS — if I need 4 DL starters and only have 2, that's more urgent than needing 6 WR and having 5
- Use HIT PROBABILITY BY ROUND AND POSITION — don't recommend a position in a round where hit rates are historically terrible
- Ensure all recommendations are INTERNALLY CONSISTENT — do not recommend targeting a position in one section and avoiding it in another
- Be SPECIFIC about which rounds to target which positions based on value intersection

Based on the ${year} rookie class and my league's ACTUAL historical draft data, give me a CONCISE scout briefing (this is mobile — keep it tight):

1. TOP 3 TARGETS — specific rookie names, position, and which of MY picks to use. One sentence each on why they fit my roster.

2. QUICK STRATEGY — one paragraph: should I trade up/down? What positions to hammer vs avoid? What's the key value play?

3. ONE THING TO WATCH — the single most important insight for my draft (a position run risk, a sleeper, a trap to avoid).

Keep the total response under 300 words. Be specific with prospect names. Search the web for current ${year} rookie rankings.`;

    const timeoutMs=90000;
    const reply=await Promise.race([
      callClaude([{role:'user',content:prompt}],true,2,1200),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Scouting report timed out — try again')),timeoutMs))
    ]);
    if(!reply||!reply.trim()){throw new Error('No response from AI — check your connection and try again');}
    $('draft-scout-content').innerHTML=`
      <div class="card" style="border-color:rgba(212,175,55,.2)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <div style="font-size:15px;font-weight:600">${year} Draft Scouting Report</div>
          <button class="copy-btn" style="margin-left:auto" onclick="copyText(${JSON.stringify(reply)},this)">Copy</button>
        </div>
        <div style="font-size:14px;color:var(--text2);line-height:1.7">${reply.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--text)">$1</strong>').replace(/#{1,3} /g,'').replace(/\n\n/g,'</p><p style="margin-top:10px">').replace(/\n/g,'<br>')}</div>
      </div>`;
    draftChatHistory=[];
    addDraftMsg(`I've analyzed your ${year} draft position. What would you like to dig into?`,'a');
  }catch(e){$('draft-scout-content').innerHTML=`<div class="card"><div class="empty" style="color:var(--red)">Error: ${escHtml(e.message||'Unknown error')}</div><button class="btn btn-ghost btn-sm" onclick="runDraftScouting()" style="margin-top:8px">Try Again</button></div>`;}
  btn.textContent='Scout ↗';btn.disabled=false;
}

// sendDraftChatMsg: defined in ai-chat.js
// addDraftMsg: defined in ai-chat.js


// ── Top Prospects (card-based layout) ─────────────────────────────
let _draftPosFilter = '';

function _setDraftPosFilter(pos) {
  _draftPosFilter = _draftPosFilter === pos ? '' : pos;
  renderTopProspects();
}
window._setDraftPosFilter = _setDraftPosFilter;

function renderTopProspects(){
  const $ = window.$ || (id => document.getElementById(id));
  const S = window.S || window.App?.S || {};
  const LI = window.LI || window.App?.LI || {};
  const LI_LOADED = Boolean(window.LI_LOADED || window.App?.LI_LOADED);
  const escHtml = window.escHtml || window.App?.escHtml || (s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const assessTeamFromGlobal = window.assessTeamFromGlobal || window.App?.assessTeamFromGlobal;
  const dynastyValue = window.dynastyValue || window.App?.dynastyValue || (() => 0);
  const pickValue = window.pickValue || window.App?.pickValue || (() => 0);
  const pName = window.pName || window.App?.pName || (id => id);
  const pPos = window.pPos || window.App?.pPos || (() => '');
  const el=$('draft-top-prospects');if(!el)return;
  if(!LI_LOADED||!LI.playerMeta){
    // Hero cards need LI data, but the rookie board can render from Sleeper + CSV.
    // Create the mount point and let renderRookieBoard() run independently.
    el.innerHTML='<div id="rookie-board-mount"></div>';
    if(typeof renderRookieBoard==='function')renderRookieBoard();
    return;
  }

  // Get team needs from assessment
  const assess = typeof assessTeamFromGlobal === 'function' ? assessTeamFromGlobal(S.myRosterId) : null;
  const needPositions = (assess?.needs || []).map(n => typeof n === 'string' ? n : n.pos);

  // Strategy context
  const strat = window.GMStrategy?.getStrategy ? window.GMStrategy.getStrategy() : {};
  const draftStyle = strat.draftStyle || 'bpa';
  const targetPos = strat.targetPositions || [];

  // Find rookies by source=FC_ROOKIE, sorted by DHQ value
  let allRookies = Object.entries(LI.playerMeta)
    .filter(([pid,m]) => m.source === 'FC_ROOKIE' && (LI.playerScores?.[pid] || 0) > 0)
    .map(([pid,m]) => {
      const p = S.players?.[pid] || {};
      const pos = m.pos || pPos(pid);
      return {
        pid, name: pName(pid), pos, team: p.team || '',
        college: p.college || '', val: LI.playerScores[pid] || 0,
        height: p.height, weight: p.weight
      };
    })
    .sort((a,b) => b.val - a.val);

  if(!allRookies.length){el.innerHTML='';return;}

  // Best Available (overall #1)
  const bestAvail = allRookies[0];

  // Best Fit (highest DHQ at a need position)
  const bestFit = needPositions.length
    ? allRookies.find(r => needPositions.includes(r.pos)) || bestAvail
    : bestAvail;

  // Get user's next pick info — build full owned picks list
  const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const draftRounds = league?.settings?.draft_rounds || 4;
  const teams = S.rosters?.length || 12;
  const year = S.season || String(new Date().getFullYear());
  const allTP = S.tradedPicks || [];
  const rosterRanks = S.rosters.map(r => ({ rid: r.roster_id, val: (r.players || []).reduce((s, pid) => s + dynastyValue(pid), 0) })).sort((a, b) => a.val - b.val);
  const getPickPos = rid => { const idx = rosterRanks.findIndex(r => r.rid === rid); return idx >= 0 ? idx + 1 : Math.ceil(teams / 2); };

  // Build owned picks: own picks not traded away + acquired picks
  const myOwnedDraftPicks = [];
  for (let rd = 1; rd <= draftRounds; rd++) {
    const tradedAway = allTP.find(p => String(p.season) === year && p.round === rd && p.roster_id === S.myRosterId && p.owner_id !== S.myRosterId);
    if (!tradedAway) myOwnedDraftPicks.push({ round: rd, fromRosterId: S.myRosterId });
    const acquired = allTP.filter(p => String(p.season) === year && p.round === rd && p.owner_id === S.myRosterId && p.roster_id !== S.myRosterId);
    acquired.forEach(p => myOwnedDraftPicks.push({ round: rd, fromRosterId: p.roster_id }));
  }
  // Sort by overall pick position
  myOwnedDraftPicks.sort((a, b) => {
    const aOverall = (a.round - 1) * teams + getPickPos(a.fromRosterId);
    const bOverall = (b.round - 1) * teams + getPickPos(b.fromRosterId);
    return aOverall - bOverall;
  });

  let nextRound = null, nextPick = null;
  if (myOwnedDraftPicks.length) {
    const first = myOwnedDraftPicks[0];
    nextRound = first.round;
    nextPick = getPickPos(first.fromRosterId);
  }

  // Position filter for prospect grid — dynamic based on league roster slots
  const league2 = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const rp2 = league2?.roster_positions || [];
  const hasIDPSlots = typeof leagueHasIDPSlots === 'function' ? leagueHasIDPSlots(league2) : false;
  const hasKSlot = rp2.some(s => s === 'K');
  const hasDSTSlot = rp2.some(s => window.App?.normPos?.(s) === 'DEF' || ['DEF','DST','D/ST'].includes(String(s || '').toUpperCase()));
  const posFilters = ['All', 'QB', 'RB', 'WR', 'TE',
    ...(hasKSlot ? ['K'] : []),
    ...(hasDSTSlot ? ['DEF'] : []),
    ...(hasIDPSlots ? ['DL', 'LB', 'DB'] : [])
  ];
  const filteredRookies = _draftPosFilter
    ? allRookies.filter(r => r.pos === _draftPosFilter)
    : allRookies;
  const gridRookies = filteredRookies.slice(0, 8);

  // Helper: format height
  const fmtHt = (h) => h ? Math.floor(h / 12) + "'" + (h % 12) + '"' : '';

  // Helper: position rank (1-based rank within that position group)
  const posRank = (pid, pos) => {
    const samePosAll = allRookies.filter(r => r.pos === pos);
    const idx = samePosAll.findIndex(r => r.pid === pid);
    return idx >= 0 ? idx + 1 : '—';
  };

  // Helper: prospect card for hero section (64px photo)
  const heroCard = (r, label) => {
    const ht = fmtHt(r.height);
    const wt = r.weight ? r.weight + 'lbs' : '';
    const details = [r.college, [ht, wt].filter(Boolean).join(', ')].filter(Boolean).join(' | ');
    return `<div style="flex:1;min-width:140px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;cursor:pointer" onclick="openPlayerModal('${r.pid}')">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${label}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <img src="https://sleepercdn.com/content/nfl/players/thumb/${r.pid}.jpg" onerror="this.style.display='none'" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;background:var(--bg4)" loading="lazy"/>
        <div style="min-width:0;overflow:hidden">
          <div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.name)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(details)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:8px;background:rgba(212,175,55,.1);color:var(--accent)">${r.pos}</span>
            <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">#${posRank(r.pid, r.pos)} ${r.pos}</span>
            <span style="font-size:11px;color:var(--text3)">|</span>
            <span style="font-size:12px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${r.val.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>`;
  };

  // Helper: grid card (48px photo) with strategy alignment
  const gridCard = (r) => {
    const isStratTarget = targetPos.includes(r.pos);
    const isNeedFit = needPositions.includes(r.pos);
    const badgeHtml = isStratTarget
      ? '<span style="font-size:11px;font-weight:700;padding:1px 4px;border-radius:5px;background:rgba(212,175,55,.18);color:var(--accent);letter-spacing:.03em">TARGET</span>'
      : isNeedFit
      ? '<span style="font-size:11px;font-weight:700;padding:1px 4px;border-radius:5px;background:rgba(52,211,153,.12);color:var(--green);letter-spacing:.03em">NEED</span>'
      : '';
    const borderColor = isStratTarget ? 'rgba(212,175,55,.4)' : isNeedFit ? 'rgba(52,211,153,.3)' : 'var(--border)';
    return `<div style="background:var(--bg2);border:1px solid ${borderColor};border-radius:var(--r);padding:8px;cursor:pointer;transition:border-color .15s" onclick="openPlayerModal('${r.pid}')" onmouseover="this.style.borderColor='rgba(212,175,55,.55)'" onmouseout="this.style.borderColor='${borderColor}'">
      <div style="display:flex;align-items:center;gap:8px">
        <img src="https://sleepercdn.com/content/nfl/players/thumb/${r.pid}.jpg" onerror="this.style.display='none'" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--bg4)" loading="lazy"/>
        <div style="min-width:0;overflow:hidden;flex:1">
          <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.name)}</div>
          <div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.college || r.team || '')}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;padding:1px 5px;border-radius:6px;background:rgba(212,175,55,.1);color:var(--accent)">${r.pos}</span>
            <span style="font-size:11px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${r.val.toLocaleString()}</span>
            ${badgeHtml}
          </div>
        </div>
      </div>
    </div>`;
  };

  // Hide the separate picks card — we'll inline it here
  const _myPicksEl = $('draft-my-picks');
  if (_myPicksEl) _myPicksEl.style.display = 'none';

  // Count all owned picks for summary row
  let _ownedCount = 0;
  const _ownedRounds = [];
  for (let rd = 1; rd <= draftRounds; rd++) {
    const away = allTP.find(p => String(p.season) === year && p.round === rd && p.roster_id === S.myRosterId && p.owner_id !== S.myRosterId);
    const acq = allTP.filter(p => String(p.season) === year && p.round === rd && p.owner_id === S.myRosterId && p.roster_id !== S.myRosterId);
    if (!away) { _ownedCount++; _ownedRounds.push(rd); }
    _ownedCount += acq.length;
    acq.forEach(() => { if (!_ownedRounds.includes(rd)) _ownedRounds.push(rd); });
  }
  _ownedRounds.sort((a, b) => a - b);
  const _picksRange = _ownedRounds.length === 1 ? 'R' + _ownedRounds[0] : _ownedRounds.length ? 'R' + _ownedRounds[0] + '–R' + _ownedRounds[_ownedRounds.length - 1] : '';

  // Build HTML — single consolidated draft intel card
  let html = '';

  // Estimate how many rookies will be drafted before user's pick
  const overallPick = nextRound ? (nextRound - 1) * teams + (nextPick || Math.ceil(teams / 2)) : 0;
  // In a rookie draft, each pick before us takes one prospect off the board.
  // Cap at the number of available rookies so we always have candidates.
  const picksBeforeMe = Math.min(Math.max(0, overallPick - 1), Math.max(0, allRookies.length - 5));
  const likelyAvailable = allRookies.slice(picksBeforeMe);
  const realisticBestAvail = likelyAvailable[0] || allRookies[allRookies.length - 1];
  const realisticBestFit = needPositions.length
    ? likelyAvailable.find(r => needPositions.includes(r.pos)) || realisticBestAvail
    : realisticBestAvail;

  // ALEX'S PICK — realistic recommendation based on pick position
  const alexPool = likelyAvailable.length ? likelyAvailable : allRookies;
  const alexPick = draftStyle === 'need'
    ? (alexPool.find(r => needPositions.includes(r.pos)) || realisticBestFit)
    : draftStyle === 'mix'
    ? (alexPool.find(r => needPositions.includes(r.pos) || targetPos.includes(r.pos)) || realisticBestAvail)
    : realisticBestAvail;

  const alexPickNeedFit = needPositions.includes(alexPick.pos);
  const alexPickTargetFit = targetPos.includes(alexPick.pos);
  const alexWhyParts = [];
  if(alexPickNeedFit) alexWhyParts.push('Fills your biggest '+alexPick.pos+' gap');
  else if(alexPickTargetFit) alexWhyParts.push('Hits your target position');
  else alexWhyParts.push('Best projected available at pick ' + overallPick);
  if(alexPick.val>=5000) alexWhyParts.push('Elite dynasty upside');
  else if(alexPick.val>=3000) alexWhyParts.push('Strong dynasty value');
  else if(alexPick.val>=1500) alexWhyParts.push('Solid depth add');
  const alexWhy = alexWhyParts.slice(0,2).join('. ');

  const pickBadges = myOwnedDraftPicks.map((pk, i) => {
    const pos = getPickPos(pk.fromRosterId);
    const label = pk.round + '.' + String(pos).padStart(2, '0');
    const isFirst = i === 0;
    return `<span class="${isFirst ? 'primary' : ''}">${label}</span>`;
  }).join('');
  const firstPickLabel = myOwnedDraftPicks[0] ? `${myOwnedDraftPicks[0].round}.${String(getPickPos(myOwnedDraftPicks[0].fromRosterId)).padStart(2, '0')}` : '—';
  const pickCapital = myOwnedDraftPicks.reduce((sum, pk) => sum + pickValue(year, pk.round, teams, getPickPos(pk.fromRosterId)), 0);
  const tierGap = allRookies[0] && allRookies[1] ? Math.max(0, allRookies[0].val - allRookies[1].val) : 0;
  const tags = _rookieTags();
  const taggedIds = new Set(Object.keys(tags));
  const tagCounts = ['trade','watch','untouchable','cut'].reduce((acc, tag) => {
    acc[tag] = allRookies.filter(r => tags[r.pid] === tag).length;
    return acc;
  }, {});
  const needFits = needPositions.length ? allRookies.filter(r => needPositions.includes(r.pos)).length : 0;
  const topByPos = posFilters.filter(pos => pos !== 'All').map(pos => {
    const room = allRookies.filter(r => r.pos === pos);
    return { pos, count: room.length, top: room[0] };
  }).filter(row => row.count).slice(0, 6);
  const needPills = needPositions.slice(0, 5).map((p, i) =>
    `<span class="${i === 0 ? 'danger' : ''}">${window.App?.posLabel?.(p)||(p==='DEF'?'D/ST':p)}</span>`
  ).join('');
  const scoutPlanPrompt = `Build my rookie draft plan. My first pick is ${firstPickLabel}, my needs are ${needPositions.join(', ') || 'none'}, and Alex currently recommends ${alexPick.name}.`;

  html += `<section class="rookie-hq">
    <div class="rookie-hq-hero">
      <div>
        <div class="scout-kicker">Rookie Big Board</div>
        <h1>Build the board before the room moves.</h1>
        <p>${_ownedCount} picks · ${pickCapital.toLocaleString()} pick capital · ${allRookies.length} ranked rookies · <span data-rookie-hq-tagged-total>${taggedIds.size}</span> tagged players</p>
      </div>
      <div class="rookie-hq-actions">
        <button class="scout-primary-btn" onclick="openDynamicMockDraft()">Run Mock</button>
        <button class="scout-secondary-btn" onclick="fillGlobalChat(${JSON.stringify(scoutPlanPrompt)})">Ask Scout</button>
      </div>
    </div>

    <div class="rookie-hq-kpis">
      <div><span>First Pick</span><strong>${firstPickLabel}</strong><small>${_picksRange || 'no pick range'}</small></div>
      <div><span>Pick Capital</span><strong>${pickCapital.toLocaleString()}</strong><small>${_ownedCount} picks</small></div>
      <div><span>Need Fits</span><strong>${needFits}</strong><small>${needPositions.slice(0,3).join(', ') || 'BPA mode'}</small></div>
      <div><span>Tier Gap</span><strong>${tierGap.toLocaleString()}</strong><small>${tierGap > 1000 ? 'clear break' : 'flat board'}</small></div>
    </div>

    <div class="rookie-hq-grid">
      <button class="rookie-priority-card" onclick="openPlayerModal('${alexPick.pid}')">
        <div class="rookie-card-head"><span>Scout Priority</span><em>${alexPick.pos} · ${alexPick.val.toLocaleString()} DHQ</em></div>
        <strong>Take ${escHtml(alexPick.name)}</strong>
        <p>${escHtml(alexWhy)}.</p>
        <div class="rookie-priority-tags">
          ${alexPickNeedFit || alexPickTargetFit ? '<span class="good">Aligned</span>' : '<span>Best available</span>'}
          ${tierGap > 1000 ? '<span class="danger">Tier break</span>' : ''}
        </div>
      </button>

      <div class="rookie-hq-card">
        <div class="rookie-card-head"><span>Draft Path</span><em>${_ownedCount} picks</em></div>
        <div class="rookie-pick-strip">${pickBadges || '<span>None</span>'}</div>
        <div class="rookie-need-strip">${needPills || '<span>Balanced roster</span>'}</div>
      </div>
    </div>

    <div class="rookie-hq-grid">
      <div class="rookie-hq-card">
        <div class="rookie-card-head"><span>Position Heat</span><em>top rooms</em></div>
        ${topByPos.map(row => `<button class="rookie-pos-heat" onclick="_rookieFilter('${row.pos}')">
          <strong>${window.App?.posLabel?.(row.pos)||(row.pos==='DEF'?'D/ST':row.pos)}</strong>
          <span>${row.count} prospects</span>
          <em>${row.top ? row.top.val.toLocaleString() : '—'}</em>
        </button>`).join('')}
      </div>
      <div class="rookie-hq-card">
        <div class="rookie-card-head"><span>Board Tags</span><em>tap rows to manage</em></div>
        <div class="rookie-tag-summary">
          <button onclick="_rookieSetTagFilter('trade')"><strong data-rookie-hq-tag-count="trade">${tagCounts.trade}</strong><span>Targets</span></button>
          <button onclick="_rookieSetTagFilter('watch')"><strong data-rookie-hq-tag-count="watch">${tagCounts.watch}</strong><span>Watch</span></button>
          <button onclick="_rookieSetTagFilter('untouchable')"><strong data-rookie-hq-tag-count="untouchable">${tagCounts.untouchable}</strong><span>Priority</span></button>
          <button onclick="_rookieSetTagFilter('cut')"><strong data-rookie-hq-tag-count="cut">${tagCounts.cut}</strong><span>Fades</span></button>
        </div>
      </div>
    </div>
  </section>`;

  // Prospect grid removed — rookie board table below has the full sortable list

  el.innerHTML = html + '<div id="rookie-board-mount"></div>';
  // Render the full sortable rookie table below the hero cards
  if (typeof renderRookieBoard === 'function') renderRookieBoard();
}
window.renderTopProspects=renderTopProspects;

// ── Mock Draft ───────────────────────────────────────────────────
// Interactive: user picks for their team, AI picks for all others
let _mockState=null;
let mockDraftPaused=false;
let _mockMode='rookie'; // 'rookie' or 'startup'

function startMockDraft(mode){
  const $ = window.$ || (id => document.getElementById(id));
  const S = window.S || window.App?.S || {};
  const LI = window.LI || window.App?.LI || {};
  const LI_LOADED = Boolean(window.LI_LOADED || window.App?.LI_LOADED);
  const myR = window.myR || window.App?.myR || (() => null);
  const dynastyValue = window.dynastyValue || window.App?.dynastyValue || (() => 0);
  const assessTeamFromGlobal = window.assessTeamFromGlobal || window.App?.assessTeamFromGlobal;
  const pM = window.pM || window.App?.pM || (p => p);
  const pPos = window.pPos || window.App?.pPos || (() => '');
  const pName = window.pName || window.App?.pName || (id => id);
  const getUser = window.getUser || window.App?.getUser || (() => '');
  const el=$('draft-mock');if(!el)return;
  if(!S.rosters?.length||!LI_LOADED){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:13px">Connect league and wait for data to load.</div>';return;}
  if(mode)_mockMode=mode;

  // Initialize live dashboard + trade offer baselines
  const _myR = typeof myR === 'function' ? myR() : null;
  _mockStartDHQ = (_myR?.players || []).reduce((s, p) => s + (typeof dynastyValue === 'function' ? dynastyValue(p) : 0), 0);
  _mockStartHealth = typeof assessTeamFromGlobal === 'function' ? (assessTeamFromGlobal(S.myRosterId)?.healthScore || 0) : 0;
  _mockDraftedByMe = [];
  _mockLastAlexMsg = '';
  _mockLastOfferPickIdx = -10;
  _mockInsightInFlight = false;
  _mockLastInsightPickIdx = -99;
  _mockPosFilter = '';
  _mockSortKey = 'dhq';
  // Clean up any lingering trade offer popup
  document.getElementById('mock-trade-offer')?.remove();

  const league=S.leagues.find(l=>l.league_id===S.currentLeagueId);
  const draftRounds=_mockMode==='rookie'?(league?.settings?.draft_rounds||4):Math.min(league?.settings?.draft_rounds||4,30);
  const teams=S.rosters.length;
  const rp=league?.roster_positions||[];
  const leagueHasIDP=leagueHasIDPSlots(league);
  const leagueHasK=rp.some(s=>s==='K');

  // Build available player pool
  let pool;
  if(_mockMode==='rookie'){
    // Rookies only — unified pool from CSV enrichment data (The Beast)
    // Primary: CSV prospects from getProspects() (shared across War Room + Scout)
    // Supplement: Sleeper rookies with DHQ values not in CSV
    const csvProspects = typeof window.getProspects === 'function' ? window.getProspects() : [];
    const csvNames = new Set(csvProspects.map(p => (p.name || '').toLowerCase().trim()));

    // CSV prospects as the base pool
    pool = csvProspects
      .filter(csv => {
        const pos = pM(csv.mappedPos || csv.pos) || csv.pos;
        if (!leagueHasIDP && ['DL','LB','DB'].includes(pos)) return false;
        if (!leagueHasK && pos === 'K') return false;
        return true;
      })
      .map(csv => {
        const pos = pM(csv.mappedPos || csv.pos) || csv.pos;
        // Try to find matching Sleeper PID for photo/linking
        const sleeperMatch = Object.entries(S.players || {}).find(([, p]) =>
          (p.full_name || '').toLowerCase().trim() === (csv.name || '').toLowerCase().trim() && p.years_exp === 0
        );
        const pid = sleeperMatch ? sleeperMatch[0] : 'csv_' + (csv.name || '').toLowerCase().replace(/[^a-z]/g, '_');
        const dhq = sleeperMatch ? (LI.playerScores?.[sleeperMatch[0]] || 0) : 0;
        const val = dhq > 0 ? dhq : (csv.draftScore || 0);
        return { pid, name: csv.name, pos, val };
      })
      .filter(p => {
        // Include if has value OR if position has a league slot (IDP/K with 0 DHQ)
        const hasValue = p.val > 0;
        const isIDPPos = ['DL','LB','DB'].includes(p.pos);
        const isKPos = p.pos === 'K';
        const hasLeagueSlot = (isIDPPos && leagueHasIDP) || (isKPos && leagueHasK);
        return hasValue || hasLeagueSlot;
      })
      .sort((a, b) => b.val - a.val);

    // Supplement with Sleeper rookies not in CSV — include if has value OR has a team OR has a league slot
    Object.entries(S.players || {}).forEach(([pid, p]) => {
      if (!p || p.years_exp !== 0) return;
      const name = (p.full_name || '').toLowerCase().trim();
      if (csvNames.has(name)) return;
      if (pool.some(x => x.pid === pid)) return;
      const val = LI.playerScores?.[pid] || 0;
      const pos = pM(pPos(pid)) || pPos(pid);
      const isIDPPos = ['DL','LB','DB'].includes(pos);
      const isKPos = pos === 'K';
      const hasLeagueSlot = (isIDPPos && leagueHasIDP) || (isKPos && leagueHasK);
      if (val <= 0 && !p.team && !hasLeagueSlot) return;
      if (!leagueHasIDP && isIDPPos) return;
      if (!leagueHasK && isKPos) return;
      pool.push({ pid, name: p.full_name || pName(pid), pos, val });
    });
    pool.sort((a, b) => b.val - a.val);
  }else{
    // Startup: all players with DHQ value
    pool=Object.entries(LI.playerScores||{})
      .filter(([pid,val])=>val>500&&S.players[pid])
      .map(([pid,val])=>({pid,name:pName(pid),pos:pPos(pid)||'?',val}))
      .sort((a,b)=>b.val-a.val);
  }

  // Build pick order using real Sleeper draft_order + traded picks
  const pickOrder=[];
  const year=S.season||String(new Date().getFullYear());
  const tradedPicks=S.tradedPicks||[];

  // Get real draft order from Sleeper drafts API
  const drafts=S.drafts||[];
  const upcomingDraft=drafts.find(d=>d.status==='pre_draft')||drafts[0];
  const sleeperDraftOrder=upcomingDraft?.draft_order||{};
  const draftType=upcomingDraft?.type||'snake';

  let rosterOrder;
  if(Object.keys(sleeperDraftOrder).length>0){
    const slotMap=[];
    Object.entries(sleeperDraftOrder).forEach(([uid,slot])=>{
      const roster=S.rosters.find(r=>r.owner_id===uid);
      if(roster)slotMap.push({slot,roster});
    });
    slotMap.sort((a,b)=>a.slot-b.slot);
    rosterOrder=slotMap.map(s=>s.roster);
  }else{
    // Fallback: DHQ ascending (worst team picks first)
    rosterOrder=[...S.rosters]
      .map(r=>({...r,_dhq:(r.players||[]).reduce((s,p)=>s+(typeof dynastyValue==='function'?dynastyValue(p):0),0)}))
      .sort((a,b)=>a._dhq-b._dhq);
  }

  for(let rd=1;rd<=draftRounds;rd++){
    const isReversed=draftType==='snake'&&rd%2===0;
    const order=isReversed?[...rosterOrder].reverse():[...rosterOrder];
    order.forEach((r,i)=>{
      const rid=r.roster_id;
      // Check if this team's pick in this round was traded away
      const tradedAway=tradedPicks.find(tp=>
        String(tp.season)===String(year)&&tp.round===rd&&
        tp.roster_id===rid&&tp.owner_id!==rid
      );
      const currentOwner=tradedAway?tradedAway.owner_id:rid;
      pickOrder.push({round:rd,pick:i+1,rosterId:currentOwner,originalRosterId:rid,overall:pickOrder.length+1});
    });
    // Also add acquired extra picks in this round (teams that own more
    // than one pick in the same round via trade)
    tradedPicks
      .filter(tp=>String(tp.season)===String(year)&&tp.round===rd&&tp.owner_id!==tp.roster_id)
      .forEach(tp=>{
        // Only add if not already counted (the owner already got one pick
        // via the tradedAway replacement above, so only add truly extra picks)
        const alreadyHas=pickOrder.filter(pk=>pk.round===rd&&pk.rosterId===tp.owner_id).length;
        const shouldHave=tradedPicks.filter(tp2=>
          String(tp2.season)===String(year)&&tp2.round===rd&&tp2.owner_id===tp.owner_id
        ).length + (rosterOrder.some(r=>r.roster_id===tp.owner_id&&
          !tradedPicks.find(tp3=>String(tp3.season)===String(year)&&tp3.round===rd&&tp3.roster_id===tp.owner_id&&tp3.owner_id!==tp.owner_id)
        ) ? 1 : 0);
        if(alreadyHas<shouldHave){
          pickOrder.push({round:rd,pick:order.length+1,rosterId:tp.owner_id,originalRosterId:tp.roster_id,overall:pickOrder.length+1});
        }
      });
  }

  // Pre-compute team assessments + owner DNA for AI picks
  const teamProfiles={};
  S.rosters.forEach(r=>{
    const assess=typeof assessTeamFromGlobal==='function'?assessTeamFromGlobal(r.roster_id):null;
    const ownerProfile=LI.ownerProfiles?.[r.roster_id]||{};
    const owner=(S.leagueUsers||[]).find(u=>u.user_id===r.owner_id);
    teamProfiles[r.roster_id]={
      assess,
      dna:ownerProfile.dna||'balanced',
      tier:assess?.tier||'CROSSROADS',
      needs:(assess?.needs||[]).slice(0,4).map(n=>typeof n==='string'?n:n.pos),
      teamName:(owner?.metadata?.team_name||owner?.display_name||'Team').substring(0,12),
    };
  });

  mockDraftPaused=false;
  _mockState={pool:[...pool],pickOrder,picks:[],currentIdx:0,teamProfiles,mode:_mockMode,draftedPids:new Map()};

  // Pre-load draft DNA so _mockDNAInformedPick has real history data
  if (window.DraftHistory?.loadDraftDNA) {
    const _league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
    if (_league?.league_id && !window._mockDraftDNALoaded) {
      const cached = window.DraftHistory.loadDraftDNA(_league.league_id);
      if (!cached && window.DraftHistory.syncDraftDNA) {
        window.DraftHistory.syncDraftDNA(_league.league_id)
          .then(() => console.log('[mock] Draft DNA loaded'))
          .catch(e => console.warn('[mock] Draft DNA fetch failed:', e?.message || e));
      }
      window._mockDraftDNALoaded = true;
    }
  }

  renderMockDraftUI();
}
window.startMockDraft=startMockDraft;

function _mockPosBadge(pos){
  const cols={QB:'rgba(96,165,250,.2);color:#60a5fa',RB:'rgba(52,211,153,.2);color:#34d399',WR:'rgba(108,99,245,.2);color:#a78bfa',TE:'rgba(251,191,36,.2);color:#fbbf24',DL:'rgba(251,146,60,.2);color:#fb923c',LB:'rgba(167,139,250,.2);color:#a78bfa',DB:'rgba(244,114,182,.2);color:#f472b6'};
  const style=cols[pos]||'rgba(74,78,90,.2);color:var(--text3)';
  return `<span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:8px;background:${style};white-space:nowrap">${pos}</span>`;
}

function _mockPickCard(p,showTeam){
  const photoUrl=`https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg`;
  const canModal=p.pid&&!String(p.pid).startsWith('csv_');
  const clickAttr=canModal?`onclick="openPlayerModal('${p.pid}')" style="cursor:pointer"`:'';
  return `<div ${clickAttr} style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;margin-bottom:3px;${canModal?'cursor:pointer':''}">
    <img src="${photoUrl}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg4)">
    ${showTeam?`<span style="font-size:11px;color:var(--text3);min-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.teamName||'')}</span>`:''}
    <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.playerName||p.name||'')}</span>
    ${_mockPosBadge(p.pos)}
    <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace;flex-shrink:0">${(p.val||0).toLocaleString()}</span>
  </div>`;
}

function _mockDraftGrid(picks,pickOrder){
  if(!picks.length)return'';
  const rounds=Math.max(...picks.map(p=>p.round));
  const teamIds=[...new Set(pickOrder.map(p=>p.rosterId))];
  // Build team name lookup
  const teamNames={};
  teamIds.forEach(rid=>{
    const owner=(S.leagueUsers||[]).find(u=>{const r=S.rosters.find(r2=>r2.roster_id===rid);return r&&u.user_id===r.owner_id;});
    teamNames[rid]=(owner?.metadata?.team_name||owner?.display_name||'T'+rid).substring(0,8);
  });
  const cols=teamIds.length;
  let gridHtml=`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Draft Board</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
    <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:${cols*70}px">
    <thead><tr>
      <th style="padding:3px 4px;color:var(--text3);font-weight:700;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">Rd</th>
      ${teamIds.map(rid=>`<th style="padding:3px 4px;color:${rid===S.myRosterId?'var(--accent)':'var(--text3)'};font-weight:600;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap">${escHtml(teamNames[rid])}</th>`).join('')}
    </tr></thead><tbody>`;
  for(let rd=1;rd<=rounds;rd++){
    gridHtml+=`<tr>`;
    gridHtml+=`<td style="padding:3px 4px;font-weight:700;color:var(--text3);border-bottom:1px solid var(--border)">${rd}</td>`;
    teamIds.forEach(rid=>{
      const pick=picks.find(p=>p.round===rd&&p.rosterId===rid);
      const isMe=rid===S.myRosterId;
      if(pick){
        gridHtml+=`<td style="padding:3px 4px;text-align:center;border-bottom:1px solid var(--border);${isMe?'background:rgba(212,175,55,.06)':''}" title="${pick.playerName} (${pick.pos})">
          <div style="font-weight:600;color:${isMe?'var(--accent)':'var(--text2)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65px">${(pick.playerName||'').split(' ').pop()}</div>
          <div style="font-size:11px;color:var(--text3)">${pick.pos}</div>
        </td>`;
      }else{
        gridHtml+=`<td style="padding:3px 4px;border-bottom:1px solid var(--border);color:var(--text3);text-align:center">—</td>`;
      }
    });
    gridHtml+=`</tr>`;
  }
  gridHtml+=`</tbody></table></div></div>`;
  return gridHtml;
}

function _mockPosBreakdown(picks){
  const myPicks=picks.filter(p=>p.rosterId===S.myRosterId);
  if(!myPicks.length)return'';
  const counts={};
  myPicks.forEach(p=>{counts[p.pos]=(counts[p.pos]||0)+1;});
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    ${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([pos,ct])=>`<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--bg4);color:var(--text2)">${pos} x${ct}</span>`).join('')}
  </div>`;
}

function toggleMockDraftPause(){
  mockDraftPaused=!mockDraftPaused;
  if(!mockDraftPaused&&_mockState){
    // Resume — continue AI picks
    renderMockDraftUI();
  }
  // Update pause button label
  const btn=document.getElementById('mock-pause-btn');
  if(btn){
    btn.textContent=mockDraftPaused?'Resume':'Pause';
    btn.style.borderColor=mockDraftPaused?'var(--green)':'var(--border2)';
    btn.style.color=mockDraftPaused?'var(--green)':'var(--text3)';
  }
}
window.toggleMockDraftPause=toggleMockDraftPause;

// ── User-initiated trade proposal during mock draft ──────────
function _showMockTradePropose() {
  if (!_mockState) return;
  const remaining = _mockState.pickOrder.slice(_mockState.currentIdx);
  const myPicks = remaining.filter(p => p.rosterId === S.myRosterId);
  if (!myPicks.length) {
    if (typeof showToast === 'function') showToast('No picks left to offer');
    return;
  }

  const assessments = window._mockAssessments || window._tcAssessments || [];
  const myAssess = assessments.find(a => a.rosterId === S.myRosterId);
  const teams = S.rosters?.length || 16;
  const pvFn = typeof pickValue === 'function' ? pickValue : () => 0;

  const pickRows = myPicks.slice(0, 5).map(p => {
    const dhq = pvFn(S.season, p.round, teams, p.pick || Math.ceil(teams / 2));
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;font-weight:700">R${p.round} pick</span>
      <span style="font-size:12px;color:var(--accent);font-family:'JetBrains Mono',monospace">~${dhq.toLocaleString()} DHQ</span>
    </div>`;
  }).join('');

  const myGaps = (myAssess?.needs || []).map(n => typeof n === 'string' ? n : n.pos).slice(0, 2);
  const bestPartner = assessments
    .filter(a => a.rosterId !== S.myRosterId)
    .sort((a, b) => {
      const aHas = myGaps.some(g => (a.strengths || []).includes(g));
      const bHas = myGaps.some(g => (b.strengths || []).includes(g));
      return (bHas ? 1 : 0) - (aHas ? 1 : 0);
    })[0];
  const suggestion = bestPartner
    ? `Best target: ${bestPartner.ownerName} — has ${(bestPartner.strengths || []).join('/')} surplus`
    : 'Use the chat to find trade partners';

  document.getElementById('mock-trade-propose')?.remove();
  const el = document.createElement('div');
  el.id = 'mock-trade-propose';
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:400px;z-index:500';
  el.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:13px;font-weight:700;color:var(--text)">Your Draft Picks</span>
        <button onclick="document.getElementById('mock-trade-propose')?.remove()" style="background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer">×</button>
      </div>
      ${pickRows}
      <div style="margin-top:10px;padding:8px;background:var(--bg3);border-radius:var(--r);font-size:12px;color:var(--text3)">${escHtml(suggestion)}</div>
      <button onclick="document.getElementById('mock-trade-propose')?.remove();fillGlobalChat('During my mock draft, I want to propose a trade. My remaining picks are rounds ${myPicks.map(p => 'R' + p.round).join(', ')}. My biggest needs are ${myGaps.join(' and ') || 'none'}. Who should I trade with and what should I offer?')"
        style="width:100%;margin-top:10px;padding:10px;background:var(--accent);color:var(--bg1);border:none;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
        Ask Alex for Trade Advice
      </button>
    </div>`;
  document.body.appendChild(el);
}
window._showMockTradePropose = _showMockTradePropose;

function renderMockDraftUI(){
  const $ = window.$ || (id => document.getElementById(id));
  const S = window.S || window.App?.S || {};
  const escHtml = window.escHtml || window.App?.escHtml || (s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const el=$('draft-mock');if(!el||!_mockState)return;
  const{pool,pickOrder,picks,currentIdx}=_mockState;

  // Pause/resume button HTML
  const pauseBtn=`<button id="mock-pause-btn" onclick="toggleMockDraftPause()" style="padding:5px 12px;font-size:11px;font-weight:600;background:none;border:1px solid ${mockDraftPaused?'var(--green)':'var(--border2)'};border-radius:8px;color:${mockDraftPaused?'var(--green)':'var(--text3)'};cursor:pointer;font-family:inherit;flex-shrink:0">${mockDraftPaused?'Resume':'Pause'}</button>`;

  if(currentIdx>=pickOrder.length){
    // Draft complete — show results with grade and consensus comparison
    const myPicks=picks.filter(p=>p.rosterId===S.myRosterId);

    // Calculate post-mock draft grade
    const totalVal=myPicks.reduce((s,p)=>s+p.val,0);
    const avgVal=myPicks.length?Math.round(totalVal/myPicks.length):0;
    const leagueAvgByTeam={};
    picks.forEach(p=>{leagueAvgByTeam[p.rosterId]=(leagueAvgByTeam[p.rosterId]||0)+p.val;});
    const leagueAvgs=Object.values(leagueAvgByTeam);
    const leagueAvg=leagueAvgs.length?Math.round(leagueAvgs.reduce((s,v)=>s+v,0)/leagueAvgs.length):0;
    const myRank=leagueAvgs.sort((a,b)=>b-a).indexOf(totalVal)+1||leagueAvgs.length;
    const gradePct=leagueAvgs.length?Math.round((1-((myRank-1)/leagueAvgs.length))*100):50;
    const gradeLabel=gradePct>=85?'A+':gradePct>=75?'A':gradePct>=65?'B+':gradePct>=55?'B':gradePct>=45?'C+':gradePct>=35?'C':'D';
    const gradeCol=gradePct>=65?'var(--green)':gradePct>=45?'var(--amber)':'var(--red)';

    // Consensus comparison — check if each pick was a reach or steal
    const pickAnalysis=myPicks.map(p=>{
      const csvP=typeof window.findProspect==='function'?window.findProspect(p.playerName):null;
      const consensusRank=csvP?.rank||null;
      const pickOverall=p.overall||0;
      let verdict='';
      if(consensusRank&&pickOverall){
        const diff=consensusRank-pickOverall;
        if(diff>=10)verdict='STEAL';
        else if(diff>=3)verdict='Value';
        else if(diff<=-10)verdict='REACH';
        else if(diff<=-3)verdict='Early';
      }
      return{...p,consensusRank,verdict};
    });

    el.innerHTML=`<div style="padding:14px;background:var(--bg2);border:1px solid var(--accent);border-radius:var(--rl)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:48px;height:48px;border-radius:12px;background:${gradeCol};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:var(--bg1);font-family:'JetBrains Mono',monospace">${gradeLabel}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--accent)">Mock Draft Complete</div>
          <div style="font-size:13px;color:var(--text3)">${picks.length} picks · Ranked #${myRank} of ${Object.keys(leagueAvgByTeam).length} teams · ${totalVal.toLocaleString()} total DHQ</div>
        </div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Your Picks</div>
      <div style="display:flex;flex-direction:column;gap:2px">${pickAnalysis.map(p=>{
        const photoUrl='https://sleepercdn.com/content/nfl/players/thumb/'+p.pid+'.jpg';
        const verdictHtml=p.verdict?`<span style="font-size:11px;font-weight:700;padding:1px 5px;border-radius:4px;background:${p.verdict==='STEAL'||p.verdict==='Value'?'var(--greenL)':'var(--redL)'};color:${p.verdict==='STEAL'||p.verdict==='Value'?'var(--green)':'var(--red)'}">${p.verdict}</span>`:'';
        const consensusHtml=p.consensusRank?`<span style="font-size:11px;color:var(--text3)">C#${p.consensusRank}</span>`:'';
        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px" onclick="openPlayerModal('${p.pid}')">
          <span style="font-size:11px;font-weight:700;color:var(--text3);font-family:'JetBrains Mono',monospace;min-width:32px">R${p.round}.${p.pick}</span>
          <img src="${photoUrl}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg4)">
          <span style="font-size:13px;font-weight:700;color:var(--accent);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.playerName)}</span>
          ${_mockPosBadge(p.pos)}
          ${verdictHtml}
          ${consensusHtml}
          <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${p.val.toLocaleString()}</span>
        </div>`;
      }).join('')}</div>
      ${_mockPosBreakdown(picks)}
      ${_mockDraftGrid(picks,pickOrder)}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="startMockDraft()" style="flex:1;padding:8px;font-size:13px;font-weight:700;background:var(--bg3);border:1px solid var(--accent);border-radius:8px;color:var(--accent);cursor:pointer;font-family:inherit">Run Again</button>
        <button onclick="sendDraftChatMsg('Grade my mock draft: ${myPicks.map(p=>p.playerName+' ('+p.pos+', R'+p.round+')').join(', ')}. How did I do? What would you change?')" style="flex:1;padding:8px;font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--accent),#b8941f);border:none;border-radius:8px;color:var(--bg1);cursor:pointer;font-family:inherit">Ask Alex</button>
      </div>
      <button onclick="_saveMockTemplate()" style="width:100%;margin-top:6px;padding:6px;font-size:12px;font-weight:600;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text3);cursor:pointer;font-family:inherit" id="save-mock-btn">Save Draft Template</button>
    </div>`;
    return;
  }

  const current=pickOrder[currentIdx];
  const isMyPick=current.rosterId===S.myRosterId;
  const profile=_mockState.teamProfiles?.[current.rosterId]||{};
  const teamName=profile.teamName||'Team '+current.pick;

  // Recent picks — enhanced with photos
  const recentHtml=picks.slice(-5).map(p=>_mockPickCard(p,true)).join('');

  if(isMyPick){
    // User picks — show 8 best available players with Alex recommendation
    const available=pool.slice(0,8);
    const myProfile=_mockState.teamProfiles?.[S.myRosterId]||{};
    const myNeeds=myProfile.needs||[];

    // Alex recommendation: top pick at need position or BPA
    let alexPick=null,alexReason='';
    for(const pos of myNeeds){
      const candidate=available.find(p=>p.pos===pos);
      if(candidate){alexPick=candidate;alexReason=`fills your ${pos} gap`;break;}
    }
    if(!alexPick&&available.length){alexPick=available[0];alexReason='best player available';}

    // Consensus rank for top picks
    const enriched=available.map(p=>{
      const csv=typeof window.findProspect==='function'?window.findProspect(p.name):null;
      return{...p,consensusRank:csv?.rank||null};
    });

    el.innerHTML=`<div style="padding:14px;background:var(--bg2);border:1px solid var(--accent);border-radius:var(--rl)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="flex:1">
          <div style="font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;font-weight:700">ON THE CLOCK — R${current.round}.${current.pick}</div>
          <div style="font-size:16px;font-weight:800;color:var(--text);margin-top:2px">Your Pick</div>
        </div>
        <button onclick="_showMockTradePropose()" style="padding:6px 10px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;font-size:11px;font-weight:700;color:var(--text2);cursor:pointer;font-family:inherit;flex-shrink:0" title="Propose a pick trade">💱 Trade</button>
        <button onclick="_toggleMockTendencies()" title="League draft tendencies" style="width:28px;height:28px;border-radius:50%;background:var(--bg3);border:1px solid var(--border2);color:var(--text3);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0" aria-label="Tendencies">📈</button>
        ${pauseBtn}
      </div>
      <div id="mock-tendencies-body" style="max-height:0;overflow:hidden;transition:max-height .28s ease;margin-bottom:0"></div>
      ${alexPick?`<div style="padding:8px 10px;background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.15);border-radius:8px;margin-bottom:8px;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="mockDraftPick('${alexPick.pid}')">
        <div style="font-size:13px">💡</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--accent)">Alex says: take ${escHtml(alexPick.name)}</div>
          <div style="font-size:11px;color:var(--text3)">${escHtml(alexPick.pos)} · ${alexPick.val.toLocaleString()} DHQ · ${alexReason}</div>
        </div>
        ${_mockPosBadge(alexPick.pos)}
      </div>`:''}
      ${typeof _renderDNAIntelStrip==='function'?_renderDNAIntelStrip(current.round):''}
      <div id="mock-live-dashboard"></div>
      ${recentHtml?'<div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)"><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Recent Picks</div>'+recentHtml+'</div>':''}
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <button onclick="_switchMockPlayerTab('available')" style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;border:1px solid ${_mockPlayerTab==='available'?'var(--accent)':'var(--border)'};background:${_mockPlayerTab==='available'?'var(--accentL)':'transparent'};color:${_mockPlayerTab==='available'?'var(--accent)':'var(--text3)'}">Available</button>
        <button onclick="_switchMockPlayerTab('all')" style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;border:1px solid ${_mockPlayerTab==='all'?'var(--accent)':'var(--border)'};background:${_mockPlayerTab==='all'?'var(--accentL)':'transparent'};color:${_mockPlayerTab==='all'?'var(--accent)':'var(--text3)'}">All Prospects</button>
        ${myNeeds.length?`<span style="font-size:11px;color:var(--accent);margin-left:auto">Need: ${myNeeds.slice(0,3).join(', ')}</span>`:''}
      </div>
      ${(() => {
        // Position filter + sort controls for mock draft player list
        const lg2 = S.leagues?.find(l => l.league_id === S.currentLeagueId);
        const hasIDP2 = typeof leagueHasIDPSlots === 'function' ? leagueHasIDPSlots(lg2) : false;
        const rp2 = lg2?.roster_positions || [];
        const hasK2 = rp2.some(s => s === 'K');
        const hasDST2 = rp2.some(s => window.App?.normPos?.(s) === 'DEF' || ['DEF','DST','D/ST'].includes(String(s || '').toUpperCase()));
        const mockPosOpts = ['',
          ...(typeof window.getLeaguePositions === 'function'
            ? window.getLeaguePositions()
            : ['QB','RB','WR','TE', ...(hasK2 ? ['K'] : []), ...(hasDST2 ? ['DEF'] : []), ...(hasIDP2 ? ['DL','LB','DB'] : [])])
        ];
        return `<div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
          ${mockPosOpts.map(pos => `<button onclick="_setMockPosFilter('${pos}')" style="padding:3px 8px;font-size:12px;border-radius:12px;cursor:pointer;border:1px solid ${_mockPosFilter===pos?'var(--accent)':'var(--border2)'};background:${_mockPosFilter===pos?'var(--accentL)':'transparent'};color:${_mockPosFilter===pos?'var(--accent)':'var(--text3)'};font-family:inherit">${pos?(window.App?.posLabel?.(pos)||(pos==='DEF'?'D/ST':pos)):'All'}</button>`).join('')}
          <div style="margin-left:auto;display:flex;gap:4px">
            ${['dhq','pos','name'].map(k => `<button onclick="_setMockSort('${k}')" style="padding:3px 8px;font-size:12px;border-radius:12px;cursor:pointer;border:1px solid ${_mockSortKey===k?'var(--accent)':'var(--border2)'};background:${_mockSortKey===k?'var(--accentL)':'transparent'};color:${_mockSortKey===k?'var(--accent)':'var(--text3)'};font-family:inherit">${k==='dhq'?'DHQ':k==='pos'?'Pos':'A-Z'}</button>`).join('')}
          </div>
        </div>`;
      })()}
      <div style="display:flex;flex-direction:column;gap:3px">${_mockPlayerTab==='all'
        ? _renderAllProspectsTab(_mockPosFilter || null)
        : (() => {
        // Apply position filter + sort to the available pool
        let displayPool = [...enriched];
        if (_mockPosFilter) displayPool = displayPool.filter(p => p.pos === _mockPosFilter);
        displayPool.sort((a, b) => {
          if (_mockSortKey === 'pos') return (a.pos||'').localeCompare(b.pos||'') || (b.val||0) - (a.val||0);
          if (_mockSortKey === 'name') return (a.name||'').localeCompare(b.name||'');
          return (b.val||0) - (a.val||0);
        });
        return displayPool.map(p => {
          const photoUrl='https://sleepercdn.com/content/nfl/players/thumb/'+p.pid+'.jpg';
          const isNeed=myNeeds.includes(p.pos);
          const pTag=window._playerTags?.[p.pid]||'';
          const tagBorder=pTag==='trade'?'rgba(251,191,36,.4)':pTag==='untouchable'?'rgba(52,211,153,.4)':pTag==='cut'?'rgba(248,113,113,.4)':'';
          const borderColor=tagBorder||(isNeed?'rgba(212,175,55,.2)':'var(--border)');
          const canModal=!p.pid.startsWith('csv_');
          return `<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:${isNeed?'rgba(212,175,55,.04)':'var(--bg3)'};border:1px solid ${borderColor};border-radius:8px;cursor:pointer;transition:border-color .15s" onclick="mockDraftPick('${p.pid}')" onmouseover="this.style.borderColor='rgba(212,175,55,.4)'" onmouseout="this.style.borderColor='${borderColor}'">
            <img src="${photoUrl}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg4)">
            <span onclick="event.stopPropagation();${canModal?`openPlayerModal('${p.pid}')`:`_mockShowInfo(${JSON.stringify(p)})`}" style="font-size:13px;font-weight:600;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:underline;text-decoration-color:rgba(255,255,255,.15)">${escHtml(p.name)}</span>
            ${_mockPosBadge(p.pos)}
            ${p.consensusRank?`<span style="font-size:11px;color:var(--text3)">C#${p.consensusRank}</span>`:''}
            <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${(p.val||0).toLocaleString()}</span>
            <span onclick="event.stopPropagation();_mockTag('${p.pid}','trade')" style="font-size:11px;cursor:pointer;padding:1px 4px;border-radius:3px;background:${pTag==='trade'?'var(--amberL)':'transparent'};color:${pTag==='trade'?'var(--amber)':'var(--text3)'}" title="Target">\u2605</span>
          </div>`;
        }).join('');
      })()}</div>
    </div>`;
    // Populate the live dashboard now that DOM is ready
    setTimeout(()=>{
      const remaining3=pickOrder.slice(currentIdx);
      if(typeof _mockUpdateDashboard==='function')_mockUpdateDashboard(current.round,current.pick,remaining3);
    },10);
  }else{
    // AI picks for other teams
    if(mockDraftPaused){
      // Paused — show current state without advancing
      el.innerHTML=`<div style="padding:14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--amber);text-transform:uppercase;letter-spacing:.06em;font-weight:700">PAUSED — R${current.round}.${current.pick}</div>
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-top:2px">${escHtml(teamName)} on the clock</div>
          </div>
          ${pauseBtn}
        </div>
        ${recentHtml?'<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Recent Picks</div>'+recentHtml:''}
      </div>`;
      return;
    }
    const profile=_mockState.teamProfiles?.[current.rosterId]||{};
    const needs=profile.needs||[];
    const dna=profile.dna||'balanced';
    const tier=profile.tier||'CROSSROADS';

    // AI pick logic: uses real draft history DNA + roster needs + league hit rates
    const pick = typeof _mockDNAInformedPick === 'function'
      ? _mockDNAInformedPick(current.rosterId, pool, current.round)
      : pool[0];
    if(pick){
      pool.splice(pool.indexOf(pick),1);
      picks.push({...current,pid:pick.pid,playerName:pick.name,pos:pick.pos,val:pick.val,teamName});
      // Track drafted player for the All Prospects view
      if(_mockState.draftedPids)_mockState.draftedPids.set(pick.pid,teamName);
      // Toast so the user knows where value went
      if(typeof showToast==='function')showToast(`${pick.name} → ${teamName} (R${current.round}.${current.pick})`);
      _mockState.currentIdx++;
      // Update live dashboard after every AI pick
      const remaining=pickOrder.slice(_mockState.currentIdx);
      if(typeof _mockUpdateDashboard==='function')_mockUpdateDashboard(current.round,current.pick,remaining);
      // Maybe generate a trade offer from this AI team
      _mockMaybeGenerateTradeOffer(current.rosterId, current.round);
      // Fire AI insight at key moments:
      const nextPick = pickOrder[_mockState.currentIdx];
      if (typeof _mockFireAlexInsight === 'function') {
        // Trigger 1: User's pick is coming up next
        if (nextPick && nextPick.rosterId === S.myRosterId) {
          _mockFireAlexInsight(
            `${pick.name} (${pick.pos}) just went to ${teamName}. User picks next at R${nextPick.round}.${nextPick.pick}.`,
            'What should the user target now that ' + pick.name + ' is off the board?'
          );
        }
        // Trigger 2: Round just changed — mid-draft assessment
        else if (nextPick && nextPick.round !== current.round) {
          const myDraftedCount = _mockDraftedByMe.length;
          _mockFireAlexInsight(
            `Round ${current.round} complete. Round ${nextPick.round} starting. User has drafted ${myDraftedCount} player${myDraftedCount === 1 ? '' : 's'} so far.`,
            'Give a brief mid-draft assessment. How is the draft going for the user? What should they prioritize in the next round?'
          );
        }
        // Trigger 3: Top prospect fell — a player ranked in the top 5 by DHQ is still available in Round 2+
        else if (current.round >= 2 && pool.length > 0) {
          const topAvail = pool[0];
          const originalRank = _mockState.pool?.length ? (_mockState.pool.length - pool.length) : 0;
          // If the best available player has higher DHQ than the average of what's been picked, it's a fall
          const avgPickedDHQ = picks.length ? picks.reduce((s, p) => s + (p.val || 0), 0) / picks.length : 0;
          if (topAvail.val > avgPickedDHQ * 1.3 && !_mockState._fallAlerted) {
            _mockState._fallAlerted = true;
            _mockFireAlexInsight(
              `${topAvail.name} (${topAvail.pos}, ${(topAvail.val || 0).toLocaleString()} DHQ) has fallen to Round ${current.round}. This is significantly above the average pick value.`,
              'Should the user trade up to get this player? Is this a steal opportunity?'
            );
          }
        }
      }
      // Auto-advance AI picks at user-selected speed
      setTimeout(()=>renderMockDraftUI(), MOCK_SPEED_MS[_mockSpeed] || 2000);
      const photoUrl='https://sleepercdn.com/content/nfl/players/thumb/'+pick.pid+'.jpg';
      el.innerHTML=`<div style="padding:14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="flex:1;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">R${current.round}.${current.pick}</div>
          ${pauseBtn}
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2)">
          <img src="${photoUrl}" onerror="this.style.display='none'" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg4)">
          ${escHtml(teamName)} ${needs.length?'(needs '+needs.join(', ')+')':''} selects
          <strong style="color:var(--text)">${escHtml(pick.name)}</strong>
          ${_mockPosBadge(pick.pos)}
        </div>
      </div>
      <div id="mock-live-dashboard"></div>`;
      // Populate dashboard after DOM update
      setTimeout(()=>{
        const remaining2=pickOrder.slice(_mockState.currentIdx);
        if(typeof _mockUpdateDashboard==='function')_mockUpdateDashboard(current.round,current.pick,remaining2);
      },10);
    }else{
      _mockState.currentIdx++;
      renderMockDraftUI();
    }
  }
}

function mockDraftPick(pid){
  const S = window.S || window.App?.S || {};
  if(!_mockState)return;
  const{pool,pickOrder,picks,currentIdx}=_mockState;
  const current=pickOrder[currentIdx];
  const pIdx=pool.findIndex(p=>p.pid===pid);
  if(pIdx<0)return;
  const pick=pool.splice(pIdx,1)[0];
  const owner=(S.leagueUsers||[]).find(u=>u.user_id===current.rosterId);
  const teamName=owner?.metadata?.team_name||owner?.display_name||'You';
  picks.push({...current,pid:pick.pid,playerName:pick.name,pos:pick.pos,val:pick.val,teamName});
  // Track in draftedPids map + user's own list for dashboard
  if(_mockState.draftedPids)_mockState.draftedPids.set(pick.pid,teamName);
  if(current.rosterId===S.myRosterId){
    _mockDraftedByMe.push(pick.pid);
  }
  _mockState.currentIdx++;
  // Update live dashboard with remaining pick queue
  const remaining=pickOrder.slice(_mockState.currentIdx);
  if(typeof _mockUpdateDashboard==='function')_mockUpdateDashboard(current.round,current.pick,remaining);
  // Fire AI insight after user makes a pick
  if(current.rosterId===S.myRosterId&&typeof _mockFireAlexInsight==='function'){
    _mockFireAlexInsight('User just drafted '+pick.name+' ('+pick.pos+')',
      'Was this BPA or a need fill? How does this change the board for my next pick?');
  }
  renderMockDraftUI();
}
window.mockDraftPick=mockDraftPick;

// ── Auto-run scouting when draft tab opens ────────────────────────
let _draftScoutingRun=false;

function _mockOwnedDraftPicks() {
  const state = window.S || window.App?.S || {};
  const league = state.leagues?.find(l => l.league_id === state.currentLeagueId);
  const year = state.season || String(new Date().getFullYear());
  const myId = state.myRosterId;
  const teams = state.rosters?.length || 16;
  const rounds = league?.settings?.draft_rounds || 4;
  const tradedPicks = state.tradedPicks || [];
  const valuePick = window.pickValue || window.App?.pickValue || (() => 0);
  const userName = window.getUser || window.App?.getUser || (() => '');
  if (!myId) return [];

  const picks = [];
  for (let rd = 1; rd <= rounds; rd++) {
    const ownTradedAway = tradedPicks.find(tp =>
      String(tp.season) === String(year) &&
      Number(tp.round) === rd &&
      tp.roster_id === myId &&
      tp.owner_id !== myId
    );
    if (!ownTradedAway) {
      picks.push({
        round: rd,
        label: `${year} R${rd}`,
        source: 'Own',
        own: true,
        value: valuePick(year, rd, teams, Math.ceil(teams / 2)),
      });
    }

    tradedPicks
      .filter(tp => String(tp.season) === String(year) && Number(tp.round) === rd && tp.owner_id === myId && tp.roster_id !== myId)
      .forEach(tp => {
        const originalRoster = state.rosters?.find(r => r.roster_id === tp.roster_id);
        picks.push({
          round: rd,
          label: `${year} R${rd}`,
          source: originalRoster ? (userName(originalRoster.owner_id) || `Team ${tp.roster_id}`) : `Team ${tp.roster_id}`,
          own: false,
          value: valuePick(year, rd, teams, Math.ceil(teams / 2)),
        });
      });
  }
  return picks.sort((a, b) => a.round - b.round || (a.own === b.own ? 0 : a.own ? -1 : 1));
}

function _mockOwnerWatchlist() {
  const state = window.S || window.App?.S || {};
  const LI = window.LI || {};
  const assess = window.assessTeamFromGlobal || window.App?.assessTeamFromGlobal;
  const userName = window.getUser || window.App?.getUser || (() => '');
  const myNeeds = (typeof assess === 'function' ? assess(state.myRosterId)?.needs : [])
    ?.map(n => typeof n === 'string' ? n : n.pos)
    .filter(Boolean) || [];
  return (state.rosters || [])
    .filter(r => r.roster_id !== state.myRosterId)
    .map(r => {
      const roomAssessment = typeof assess === 'function' ? assess(r.roster_id) : null;
      const profile = LI.ownerProfiles?.[r.roster_id] || {};
      const needs = (roomAssessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);
      const overlap = needs.filter(pos => myNeeds.includes(pos)).length;
      const dna = profile.dna || 'Balanced';
      const tradeBias = /trade|aggressive|fleece|deal/i.test(dna) ? 2 : /desperate|panic/i.test(dna) ? 1 : 0;
      return {
        rosterId: r.roster_id,
        name: userName(r.owner_id) || `Team ${r.roster_id}`,
        dna,
        tier: roomAssessment?.tier || 'Unknown',
        needs: needs.slice(0, 3),
        score: overlap * 3 + tradeBias + (profile.totalTrades || 0) / 25,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function renderDynamicMockSetup() {
  const state = window.S || window.App?.S || {};
  const escapeHtml = window.escHtml || window.App?.escHtml || (s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const mockEl = document.getElementById('draft-mock');
  if (!mockEl) return;
  const league = state.leagues?.find(l => l.league_id === state.currentLeagueId);
  const teams = state.rosters?.length || 0;
  const leagueIntelLoaded = Boolean(window.LI_LOADED || window.App?.LI_LOADED);
  if (!teams || !leagueIntelLoaded) {
    mockEl.innerHTML = '<div class="scout-empty-card"><div class="scout-empty-title">Building Dynamic Mock Draft</div><div class="scout-empty-body">Scout is loading owner DNA, traded picks, and rookie values.</div></div>';
    return;
  }

  _mockMode = 'rookie';
  const LI = window.LI || {};
  const picks = _mockOwnedDraftPicks();
  const capital = picks.reduce((sum, p) => sum + (p.value || 0), 0);
  const firstPick = picks[0];
  const ownerDnaCount = Object.keys(LI.ownerProfiles || {}).length;
  const savedMocks = typeof _loadMockTemplates === 'function' ? _loadMockTemplates().slice(0, 3) : [];
  const watch = _mockOwnerWatchlist();
  const rounds = league?.settings?.draft_rounds || 4;

  mockEl.innerHTML = `<div class="mock-hq">
    <section class="mock-hq-hero">
      <div class="scout-kicker">Dynamic Mock Draft</div>
      <h1>Run the room before the room runs you.</h1>
      <p>${teams} teams · ${rounds} rounds · ${ownerDnaCount || teams} owner profiles · ${picks.length} picks in your path</p>
      <div class="mock-hq-actions">
        <button class="scout-primary-btn" onclick="openDynamicMockRun()">Start Mock</button>
        <button class="scout-secondary-btn" onclick="openRookieBigBoard()">Big Board</button>
        <button class="scout-secondary-btn" onclick="fillGlobalChat('Build my rookie draft strategy before I run a mock. My pick capital is ${capital.toLocaleString()} DHQ and my first pick is ${firstPick ? firstPick.label : 'unknown'}.')">Ask Scout</button>
      </div>
    </section>

    <section class="mock-hq-kpis">
      <div><span>Pick Capital</span><strong>${capital.toLocaleString()}</strong><small>${picks.length} picks</small></div>
      <div><span>First Pick</span><strong>${firstPick ? `R${firstPick.round}` : '-'}</strong><small>${firstPick ? escapeHtml(firstPick.source) : 'no pick path'}</small></div>
      <div><span>Owner DNA</span><strong>${ownerDnaCount || teams}</strong><small>profiles loaded</small></div>
      <div><span>Mode</span><strong>Rookie</strong><small>${rounds} rounds</small></div>
    </section>

    <section class="mock-hq-grid">
      <div class="mock-hq-card">
        <div class="mock-hq-head"><span>Scenario</span><em>owner-DNA sim</em></div>
        <div class="mock-control-label">AI Pick Speed</div>
        <div class="mock-control-grid three" id="mock-speed-btns">
          <button onclick="_setMockSpeed('slow')" class="mock-control-btn mock-speed-btn" data-speed="slow"><div>Slow</div><small>5s</small></button>
          <button onclick="_setMockSpeed('medium')" class="mock-control-btn mock-speed-btn active" data-speed="medium"><div>Medium</div><small>2s</small></button>
          <button onclick="_setMockSpeed('fast')" class="mock-control-btn mock-speed-btn" data-speed="fast"><div>Fast</div><small>0.5s</small></button>
        </div>
        <div class="mock-control-label">Draft Type</div>
        <div class="mock-control-grid two">
          <button onclick="_setMockType('rookie')" id="mock-type-rookie" class="mock-control-btn active"><div>Rookie</div><small>class only</small></button>
          <button onclick="_setMockType('startup')" id="mock-type-startup" class="mock-control-btn"><div>Startup</div><small>full pool</small></button>
        </div>
      </div>

      <div class="mock-hq-card">
        <div class="mock-hq-head"><span>My Pick Path</span><em>${picks.length} picks</em></div>
        ${picks.length ? picks.slice(0, 8).map(p => `<div class="mock-pick-row">
          <strong>R${p.round}</strong>
          <span>${escapeHtml(p.source)}</span>
          <em>${Math.round(p.value || 0).toLocaleString()}</em>
        </div>`).join('') : '<div class="mock-hq-empty">No current pick path found.</div>'}
      </div>
    </section>

    <section class="mock-hq-grid">
      <div class="mock-hq-card">
        <div class="mock-hq-head"><span>Room Pressure</span><em>trade-up targets</em></div>
        ${watch.length ? watch.map(w => `<div class="mock-owner-row">
          <div><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(w.dna)} · ${escapeHtml(w.tier)}</small></div>
          <span>${w.needs.length ? escapeHtml(w.needs.join(', ')) : 'Balanced'}</span>
        </div>`).join('') : '<div class="mock-hq-empty">Owner DNA will appear after league intel loads.</div>'}
      </div>

      <div class="mock-hq-card">
        <div class="mock-hq-head"><span>Saved Mocks</span><em>${savedMocks.length} recent</em></div>
        ${savedMocks.length ? savedMocks.map(m => `<div class="mock-saved-row">
          <div><strong>${escapeHtml(m.mode || 'rookie')} · ${escapeHtml(m.date || '')}</strong><small>${escapeHtml((m.picks || []).map(p => `${p.name} ${p.pos ? '(' + p.pos + ')' : ''}`).slice(0, 2).join(' · ') || 'No picks saved')}</small></div>
          <em>${(m.picks || []).length}</em>
        </div>`).join('') : '<div class="mock-hq-empty">Saved mocks appear here after a completed run.</div>'}
      </div>
    </section>
  </div>`;
}
window.renderDynamicMockSetup = renderDynamicMockSetup;

function onDraftTabOpen(){
  renderTopProspects();
  if(!_draftScoutingRun&&LI_LOADED&&hasAnyAI()){
    _draftScoutingRun=true;
    const contentEl=$('draft-scout-content');
    if(contentEl)contentEl.style.display='block';
    runDraftScouting();
  }
  // Show pre-draft settings screen (speed + type selector) if no mock is in progress
  const mockEl=$('draft-mock');
  if(mockEl&&!_mockState){
    renderDynamicMockSetup();
  }
}
window.onDraftTabOpen=onDraftTabOpen;

// ── Mock Draft Save/Load Templates ──────────────────────────────
const MOCK_TEMPLATES_KEY = () => 'wr_mock_templates_' + (S?.currentLeagueId || '');

function _saveMockTemplate() {
  if (!_mockState) return;
  const myPicks = _mockState.picks.filter(p => p.rosterId === S.myRosterId);
  if (!myPicks.length) return;
  try {
    let templates = [];
    try { templates = JSON.parse(localStorage.getItem(MOCK_TEMPLATES_KEY()) || '[]'); } catch (e) { templates = []; }
    const saved = {
      id: Date.now(),
      date: new Date().toLocaleDateString(),
      mode: _mockState.mode || 'rookie',
      picks: myPicks.map(p => ({ name: p.playerName, pos: p.pos, round: p.round, pick: p.pick, val: p.val })),
    };
    templates.unshift(saved);
    localStorage.setItem(MOCK_TEMPLATES_KEY(), JSON.stringify(templates.slice(0, 10)));
    const btn = document.getElementById('save-mock-btn');
    if (btn) { btn.textContent = 'Saved!'; setTimeout(() => btn.textContent = 'Save Draft Template', 1500); }
    // Phase 7: log mock draft save to the field log
    if (window.addFieldLogEntry) {
      try {
        window.addFieldLogEntry('🎯', `Mock draft saved (${myPicks.length} picks)`, 'draft', { actionType: 'mock_saved', picks: saved.picks });
      } catch (e) {}
    }
  } catch (e) { console.warn('[MockDraft] Save error:', e); }
}
window._saveMockTemplate = _saveMockTemplate;

function _loadMockTemplates() {
  try { return JSON.parse(localStorage.getItem(MOCK_TEMPLATES_KEY()) || '[]'); } catch { return []; }
}
window._loadMockTemplates = _loadMockTemplates;

// ── Mock Draft Tagging ──────────────────────────────────────────
function _mockTag(pid, tag) {
  if (!window._playerTags) _rookieTags();
  if (window._playerTags[pid] === tag) {
    delete window._playerTags[pid];
  } else {
    window._playerTags[pid] = tag;
  }
  // Persist tags to localStorage
  _saveRookieTags(window._playerTags);
  renderMockDraftUI();
  const board = document.getElementById('rookie-board-mount');
  if (board && typeof renderRookieBoard === 'function') renderRookieBoard();
}
window._mockTag = _mockTag;

// ── Compact info popup for CSV-only prospects (no Sleeper PID) ───
function _mockShowInfo(p) {
  const existing = document.getElementById('mock-info-popup');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'mock-info-popup';
  div.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-family:"DM Sans",sans-serif';
  div.onclick = () => div.remove();
  div.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--accent);border-radius:16px;padding:20px;max-width:320px;width:90%;margin:0 16px" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800;color:var(--text)">${escHtml(p.name||'')}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${escHtml(p.pos||'')} · Rookie Prospect</div>
      </div>
      ${p.val>0?`<div style="font-size:14px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${p.val.toLocaleString()}</div>`:''}
    </div>
    ${p.consensusRank?`<div style="font-size:12px;color:var(--text3);margin-bottom:8px">Consensus Rank: #${p.consensusRank}</div>`:''}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button onclick="document.getElementById('mock-info-popup').remove()" style="flex:1;padding:8px;font-size:13px;font-weight:600;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text3);cursor:pointer;font-family:inherit">Close</button>
      <button onclick="document.getElementById('mock-info-popup').remove();mockDraftPick('${escHtml(p.pid||'')}')" style="flex:1;padding:8px;font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--accent),#b8941f);border:none;border-radius:8px;color:var(--bg1);cursor:pointer;font-family:inherit">Draft</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}
window._mockShowInfo = _mockShowInfo;

// ── Expose on window.App and window ─────────────────────────────
Object.assign(window.App, {
  idealDepth,
  renderDraftNeeds, runDraftScouting,
  renderRookieBoard, renderRookieProfiles,
  renderTopProspects, startMockDraft, onDraftTabOpen, renderDynamicMockSetup,
  openDynamicMockDraft, openRookieBigBoard, openDynamicMockRun,
  toggleMockDraftPause, switchDraftView,
});
window.idealDepth          = idealDepth;
window.renderDraftNeeds    = renderDraftNeeds;
window.runDraftScouting    = runDraftScouting;
window.renderRookieBoard   = renderRookieBoard;
window.renderRookieProfiles = renderRookieProfiles;
// _rookieSortBy, _rookieFilter, _rookieToggle exposed inline via window.* above

// ── Event bus: re-render draft needs when LeagueIntel finishes loading ──
// dhq-engine.js emits 'li:loaded' after both fresh compute and cache hits.
// This replaces the direct renderDraftNeeds() call that was inside dhq-engine.js.
if(window.DhqEvents){
  DhqEvents.on('li:loaded',()=>{
    try{if(typeof renderDraftNeeds==='function')renderDraftNeeds();}
    catch(e){dhqLog('li:loaded.renderDraftNeeds',e);}
  });
}

// ── Module global exports (Vite migration) ───────────────────────
window.renderMockDraftUI          = renderMockDraftUI;
window._radialProgress            = _radialProgress;
window._mockPosBadge              = _mockPosBadge;
window._mockPickCard              = _mockPickCard;
window._mockDraftGrid             = _mockDraftGrid;
window._mockPosBreakdown          = _mockPosBreakdown;
window._renderAllProspectsTab     = _renderAllProspectsTab;
window._mockMaybeGenerateTradeOffer = _mockMaybeGenerateTradeOffer;
window._renderRookieRow           = _renderRookieRow;
window._renderGroupedRookies      = _renderGroupedRookies;
