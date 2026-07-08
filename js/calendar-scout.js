// ══════════════════════════════════════════════════════════════════
// js/calendar-scout.js — Scout League Calendar (premium module)
// Ported from warroom/js/tabs/calendar.js: the WrCalendar event engine is
// copied verbatim (self-contained vanilla IIFE), then rendered as a compact
// mobile module. Gated behind FEATURES.LEAGUE_CALENDAR (trial + paid).
// ══════════════════════════════════════════════════════════════════

// ─── Shared calendar engine — window.WrCalendar (verbatim from War Room) ───
const WrCalendar = (function () {
  function eventsKey(leagueId) { return 'wr_calendar_' + leagueId; }
  function readCustomEvents(leagueId) {
    try { return JSON.parse(localStorage.getItem(eventsKey(leagueId)) || '[]'); } catch { return []; }
  }

  // Build the full league calendar (league-derived events + custom events),
  // sorted ascending by date. Returns items with real Date objects so callers
  // can compute countdowns. Past events are included — callers filter.
  function build(currentLeague, leagueSkin, customEvents) {
    const items = [];
    const settings = currentLeague?.settings || {};
    const season = currentLeague?.season || new Date().getFullYear();
    const now = Date.now();
    const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const isSeasonalLeague = !!resolvedLeagueSkin?.state?.isSeasonal;
    const rosteredPlayerCount = resolvedLeagueSkin?.state?.rosterPlayerCount ?? (currentLeague?.rosters || []).reduce((sum, roster) => {
      const ids = []
        .concat(roster?.players || [])
        .concat(roster?.starters || [])
        .concat(roster?.reserve || [])
        .concat(roster?.taxi || [])
        .filter(id => id && String(id) !== '0');
      return sum + new Set(ids.map(String)).size;
    }, 0);
    const suppressSeasonalWaivers = isSeasonalLeague && (
      resolvedLeagueSkin?.phase === 'pre_draft' ||
      resolvedLeagueSkin?.phase === 'offseason' ||
      resolvedLeagueSkin?.phase === 'complete' ||
      rosteredPlayerCount === 0
    );
    const draftTitle = isSeasonalLeague ? 'League Draft' : 'Rookie Draft';

    // Draft date — prefer metadata, fall back to drafts[].start_time.
    if (currentLeague?.draft_id || settings.draft_rounds) {
      let draftTs = currentLeague?.metadata?.draft_date;
      let draftType = currentLeague?.metadata?.draft_type;
      let draftRounds = Number(settings.draft_rounds || 0);
      let latestDraft = null;
      const drafts = (window.S && window.S.drafts) || currentLeague?.drafts || [];
      if (!draftTs) {
        const sameSeason = drafts.find(d => String(d.season) === String(season));
        latestDraft = sameSeason || drafts[0] || null;
        if (latestDraft) {
          draftTs = latestDraft.start_time || latestDraft.scheduled_time || latestDraft.start_ts;
          draftType = draftType || latestDraft.type || latestDraft.settings?.slot_type || 'snake';
          draftRounds = Number(latestDraft.settings?.rounds || latestDraft.settings?.round_count || latestDraft.rounds || draftRounds || 0);
        }
      }
      draftRounds = window.App?.LeagueSkin?.resolveDraftRounds?.({
        league: currentLeague,
        leagueSkin: resolvedLeagueSkin,
        draft: latestDraft,
        drafts,
        fallbackRounds: draftRounds || settings.draft_rounds || 0,
      }) || draftRounds;
      if (draftTs) {
        items.push({
          id: 'draft', title: draftTitle, date: new Date(Number(draftTs)), icon: '🏈', type: 'league',
          detail: (draftRounds ? draftRounds + ' rounds' : 'Draft') + ', ' + (draftType || 'snake'),
        });
      } else {
        items.push({
          id: 'draft', title: draftTitle, date: new Date(season, 7, 15), icon: '🏈', type: 'league',
          detail: (draftRounds ? draftRounds + ' rounds' : 'Draft') + ' · date TBD', tbd: true,
        });
      }
    }

    // Trade deadline (Sleeper stores a week number)
    const tradeDeadline = settings.trade_deadline;
    if (tradeDeadline && tradeDeadline > 0) {
      const seasonStart = new Date(season, 8, 5); // Sept 5
      const deadlineDate = new Date(seasonStart.getTime() + tradeDeadline * 7 * 86400000);
      items.push({ id: 'trade-deadline', title: 'Trade Deadline', date: deadlineDate, icon: '🔒', type: 'league', detail: 'Week ' + tradeDeadline });
    }

    // Playoff start + championship
    const playoffStart = settings.playoff_week_start;
    if (playoffStart && playoffStart > 0) {
      const seasonStart = new Date(season, 8, 5);
      const playoffDate = new Date(seasonStart.getTime() + playoffStart * 7 * 86400000);
      items.push({ id: 'playoffs', title: 'Playoffs Begin', date: playoffDate, icon: '⭐', type: 'league', detail: (settings.playoff_teams || 6) + ' teams qualify' });
      const playoffWeeks = settings.playoff_round_type === 2 ? 4 : 3;
      const champDate = new Date(playoffDate.getTime() + (playoffWeeks - 1) * 7 * 86400000);
      items.push({ id: 'championship', title: 'Championship Week', date: champDate, icon: '🏆', type: 'league' });
    }

    // Season kickoff (Week 1)
    const seasonStartDate = new Date(season, 8, 5);
    if (seasonStartDate.getTime() > now - 30 * 86400000) {
      items.push({ id: 'season-start', title: 'Season Kickoff', date: seasonStartDate, icon: '🚀', type: 'league', detail: season + ' NFL Season' });
    }

    // Waiver processing (ongoing — next occurrence)
    const waiverType = settings.waiver_type;
    if (waiverType && !suppressSeasonalWaivers) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const waiverDay = settings.waiver_day_of_week || 3; // Default Wednesday
      const nextWaiver = new Date();
      nextWaiver.setDate(nextWaiver.getDate() + ((waiverDay - nextWaiver.getDay() + 7) % 7 || 7));
      nextWaiver.setHours(0, 0, 0, 0);
      items.push({ id: 'waivers', title: 'Waivers Process', date: nextWaiver, icon: '💰', type: 'recurring', detail: 'Every ' + dayNames[waiverDay] + (settings.waiver_budget ? ' · $' + settings.waiver_budget + ' FAAB' : '') });
    }

    // Custom events. Parse the bare yyyy-mm-dd from <input type=date> as LOCAL
    // time — `new Date('2026-08-15')` is UTC midnight, which rolls back a day in
    // negative-UTC zones (the whole US user base).
    (customEvents || []).forEach(e => {
      const p = String(e.date).split('-').map(Number);
      const dt = (p.length === 3 && p[0] && p[1] && p[2]) ? new Date(p[0], p[1] - 1, p[2]) : new Date(e.date);
      items.push({ id: e.id, title: e.title, date: dt, icon: '📌', type: 'custom', isCustom: true });
    });

    return items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  function getEvents(currentLeague, leagueSkin) {
    const leagueId = currentLeague?.id || currentLeague?.league_id || '';
    return build(currentLeague, leagueSkin, readCustomEvents(leagueId));
  }

  function getUpcoming(currentLeague, leagueSkin) {
    const cutoff = Date.now() - 12 * 3600000;
    return getEvents(currentLeague, leagueSkin).filter(e => e.date.getTime() >= cutoff);
  }

  return { eventsKey, readCustomEvents, build, getEvents, getUpcoming };
})();
window.WrCalendar = WrCalendar;

// ─── Scout mobile render ─────────────────────────────────────────────
function _calEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _calLeague() {
  const S = window.S || {};
  return (S.leagues || []).find(l => l.league_id === S.currentLeagueId) || (S.leagues || [])[0] || null;
}
function _calLeagueId(league) {
  return league?.id || league?.league_id || '';
}
function _calCountdown(date) {
  const days = Math.round((date.getTime() - Date.now()) / 86400000);
  if (days <= 0) return { text: 'Today', col: 'var(--accent)' };
  if (days === 1) return { text: 'Tomorrow', col: 'var(--accent)' };
  const col = days <= 7 ? 'var(--accent)' : days <= 30 ? 'var(--text)' : 'var(--text3)';
  if (days < 14) return { text: days + ' days', col };
  if (days < 60) return { text: Math.round(days / 7) + ' wks', col };
  return { text: Math.round(days / 30) + ' mo', col };
}
function _calDateLabel(date) {
  try { return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function renderCalendarPanel() {
  const host = document.getElementById('panel-calendar-content');
  if (!host) return;

  // Premium gate
  if (typeof canAccess === 'function' && !canAccess(window.FEATURES?.LEAGUE_CALENDAR || 'league_calendar')) {
    host.innerHTML = `<div class="scout-command-shell">
      <section class="scout-hero"><div class="scout-kicker">League Calendar</div>
        <h1>Never miss a deadline.</h1>
        <p>Draft dates, trade deadline, playoffs, waivers, and your own custom events — with live countdowns.</p>
      </section>
      ${typeof _tierGatePlaceholder === 'function' ? _tierGatePlaceholder('League Calendar', window.FEATURES?.LEAGUE_CALENDAR || 'league_calendar') : ''}
    </div>`;
    return;
  }

  const league = _calLeague();
  if (!league || !(window.S && window.S.user)) {
    host.innerHTML = `<div class="scout-command-shell"><div class="scout-empty-card">
      <div class="scout-empty-title">Connect a league to see your calendar</div>
      <div class="scout-empty-body">Scout reads your league's draft, deadline, playoff, and waiver dates automatically.</div>
      <button class="scout-primary-btn" onclick="mobileTab('digest')">Back to Today</button>
    </div></div>`;
    return;
  }

  const phase = window.SeasonCalendar?.describe ? window.SeasonCalendar.describe(league) : null;
  const events = WrCalendar.getUpcoming(league);
  const milestone = phase?.nextMilestone
    ? `${_calEsc(phase.nextMilestone)}${phase.weeksToNext != null ? ` · ${phase.weeksToNext === 0 ? 'this week' : phase.weeksToNext + ' wk' + (phase.weeksToNext === 1 ? '' : 's')}` : ''}`
    : (events[0] ? `${_calEsc(events[0].title)} · ${_calCountdown(events[0].date).text}` : 'No upcoming milestones');

  const rows = events.length ? events.map(e => {
    const cd = _calCountdown(e.date);
    return `<div class="scout-action-row" style="cursor:default">
      <span style="display:flex;align-items:center;gap:10px;min-width:0">
        <span style="font-size:18px;flex-shrink:0" aria-hidden="true">${e.icon || '📅'}</span>
        <span style="min-width:0"><strong>${_calEsc(e.title)}</strong><small>${_calDateLabel(e.date)}${e.detail ? ' · ' + _calEsc(e.detail) : ''}</small></span>
      </span>
      <span style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <em class="mono" style="color:${cd.col}">${cd.text}</em>
        ${e.isCustom ? `<button aria-label="Remove" style="background:none;border:none;color:var(--text3);font-size:18px;line-height:1;cursor:pointer;padding:0 2px" onclick="_calRemoveEvent('${_calEsc(e.id)}')">&times;</button>` : ''}
      </span>
    </div>`;
  }).join('') : '<div class="scout-empty-body" style="padding:12px">No upcoming events. Add a custom reminder below.</div>';

  host.innerHTML = `<div class="scout-command-shell">
    <section class="scout-hero">
      <div class="scout-kicker">League Calendar</div>
      <h1>${_calEsc(phase?.label || 'Season')}</h1>
      <p>Next up: ${milestone}</p>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head"><div><span class="scout-kicker">Upcoming</span><h2>Key dates &amp; deadlines</h2></div></div>
      <div class="scout-action-list">${rows}</div>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head"><div><span class="scout-kicker">Custom reminder</span><h2>Add your own date</h2></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="cal-evt-title" type="text" placeholder="e.g. Keeper deadline" style="flex:1;min-width:140px;padding:11px 12px;border:1px solid var(--border2);border-radius:10px;background:var(--bg2);color:var(--text);font-size:16px">
        <input id="cal-evt-date" type="date" style="padding:10px 12px;border:1px solid var(--border2);border-radius:10px;background:var(--bg2);color:var(--text);font-size:16px">
        <button class="scout-primary-btn" onclick="_calAddEvent()">Add</button>
      </div>
    </section>
  </div>`;
}
window.renderCalendarPanel = renderCalendarPanel;

function _calAddEvent() {
  const league = _calLeague();
  if (!league) return;
  const titleEl = document.getElementById('cal-evt-title');
  const dateEl = document.getElementById('cal-evt-date');
  const title = (titleEl?.value || '').trim();
  const date = dateEl?.value || '';
  if (!title || !date) { if (typeof showToast === 'function') showToast('Add a title and date'); return; }
  const leagueId = _calLeagueId(league);
  const events = WrCalendar.readCustomEvents(leagueId);
  events.push({ id: 'c' + Date.now(), title, date });
  try { localStorage.setItem(WrCalendar.eventsKey(leagueId), JSON.stringify(events)); } catch {}
  renderCalendarPanel();
}
window._calAddEvent = _calAddEvent;

function _calRemoveEvent(id) {
  const league = _calLeague();
  if (!league) return;
  const leagueId = _calLeagueId(league);
  const events = WrCalendar.readCustomEvents(leagueId).filter(e => String(e.id) !== String(id));
  try { localStorage.setItem(WrCalendar.eventsKey(leagueId), JSON.stringify(events)); } catch {}
  renderCalendarPanel();
}
window._calRemoveEvent = _calRemoveEvent;
