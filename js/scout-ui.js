// ══════════════════════════════════════════════════════════════════
// reconai/js/scout-ui.js — War Room Scout v4 UI Components
// Persistent chat bar, contextual chips, team bar, scout briefing,
// field log, league panel
// ══════════════════════════════════════════════════════════════════

// ── Escape helper (app.js defines this but may not be loaded yet) ─
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Active tab tracker ──────────────────────────────────────────
window._activeTab = 'digest';

// ════════════════════════════════════════════════════════════════
// CONTEXTUAL PROMPT CHIPS
// ════════════════════════════════════════════════════════════════

const TAB_CHIPS = {
  digest: [
    { title: 'Find a WR upgrade',  sub: 'via trade or waivers' },
    { title: 'Roster risks',       sub: 'age, depth, bye weeks' },
    { title: 'Trade partners',     sub: 'based on owner DNA' },
  ],
  team: [
    { title: 'Audit my roster rooms', sub: 'starters, depth, age' },
    { title: 'What should I fix first', sub: 'rank the next 3 moves' },
    { title: 'Who can I afford to move', sub: 'surplus into leverage' },
  ],
  tools: [
    { title: 'Build a trade package', sub: 'players, picks, FAAB' },
    { title: 'Run a mock draft', sub: 'dynamic room strategy' },
    { title: 'Find waiver upgrades', sub: 'add/drop and bid plan' },
  ],
  portfolio: [
    { title: 'Compare all my leagues', sub: 'where should I act first' },
    { title: 'Cross-league queue', sub: 'highest-leverage decisions' },
    { title: 'Which roster has the best window', sub: 'redraft and dynasty' },
  ],
  league: [
    { title: 'Weakest teams',      sub: 'exploit their gaps' },
    { title: 'Owner tendencies',   sub: 'behavioral patterns' },
    { title: 'Trade targets',      sub: 'who needs what' },
  ],
  draftroom: [
    { title: 'My draft plan',      sub: 'picks & priorities' },
    { title: 'Best available',     sub: 'at my pick range' },
    { title: 'Positional needs',   sub: 'fill my weakest spot' },
  ],
  waivers: [
    { title: 'Hidden gems',        sub: 'low-rostered upside' },
    { title: 'FAAB strategy',      sub: 'budget allocation' },
    { title: 'Spot starter',       sub: "this week's pickup" },
  ],
  fieldlog: [
    { title: 'Summarize my log',   sub: 'recent decisions' },
    { title: 'What changed',       sub: 'since last week' },
  ],
};

function renderCtxChips(tab) {
  const container = document.getElementById('ctx-chips-row');
  if (!container) return;
  const chips = TAB_CHIPS[tab] || TAB_CHIPS.digest;
  // Use data attributes + delegated click instead of inline onclick to
  // avoid HTML attribute escaping issues (JSON.stringify produces " which
  // the HTML parser reads as end-of-attribute, truncating the handler).
  container.innerHTML = chips.map((c, i) =>
    `<button class="ctx-chip" data-chip-idx="${i}">
      <div class="ctx-chip-title">${_esc(c.title)}</div>
      <div class="ctx-chip-sub">${_esc(c.sub)}</div>
    </button>`
  ).join('');
  // Delegated click handler
  container.onclick = (e) => {
    const btn = e.target.closest('.ctx-chip');
    if (!btn) return;
    const idx = parseInt(btn.dataset.chipIdx);
    const chip = chips[idx];
    if (chip && typeof fillGlobalChat === 'function') {
      fillGlobalChat(chip.title + ': ' + chip.sub);
    }
  };
  if (typeof _renderGMBarAlexBlock === 'function') _renderGMBarAlexBlock();
  if (typeof _updateGlobalChatPlaceholder === 'function') _updateGlobalChatPlaceholder();
}
window.renderCtxChips = renderCtxChips;

// ── GM bar (Phase 6) — expanding unified AI surface ────────────
// The global chat overlay becomes the central prompt hub. When the input is
// focused, it expands to reveal: (1) GM Strategy + GM Insights summary,
// (2) context chips. Placeholder text is dynamic, driven by field intel.

function _renderGMBarAlexBlock() {
  const el = document.getElementById('gm-bar-alex');
  if (!el) return;
  const strat = window.GMStrategy?.getStrategy?.() || {};
  const eng = window.GMEngine;
  const fi = eng?.generateFieldIntel?.() || [];
  const mode = (strat.mode || 'balanced').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const aggr = strat.aggression || 'medium';
  const targets = (strat.targetPositions || []).map(_scoutPosLabel).join(', ') || '—';
  const fiBullets = fi.slice(0, 2).map(s => `<div style="font-size:11px;color:var(--text3);padding:2px 0">· ${_esc(s)}</div>`).join('');
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:${fiBullets ? '6px' : '0'}">
      <div style="font-size:11px;font-weight:700;color:var(--accent);letter-spacing:.06em;text-transform:uppercase">AI GM · Alex ${strat.alexPersonality || 'balanced'}</div>
      <div style="font-size:11px;color:var(--text3)">${_esc(mode)} · ${_esc(aggr)} · ${_esc(targets)}</div>
    </div>
    ${fiBullets}
  `;
}
window._renderGMBarAlexBlock = _renderGMBarAlexBlock;

function _updateGlobalChatPlaceholder() {
  const inp = document.getElementById('global-chat-in');
  if (!inp) return;
  inp.placeholder = 'Message Alex...';
}
window._updateGlobalChatPlaceholder = _updateGlobalChatPlaceholder;

// ── GM Bar expand / collapse / launcher nav (Phase 7 v2) ────────
// The expanded state takes over ~70% of the viewport, shows the 3
// quick-launch buttons (Waivers / Trades / Draft), a GM Insights /
// GM Strategy summary, and prompt chips. A semi-transparent scrim
// covers the rest of the app and is tappable to dismiss.

function _isMobileScoutViewport() {
  return window.matchMedia?.('(max-width: 768px)').matches || window.innerWidth <= 768;
}

function _gmBarExpand() {
  const ov = document.getElementById('global-chat-overlay');
  if (!ov) return;
  if (_isMobileScoutViewport()) {
    ov.classList.remove('expanded');
    document.body.classList.remove('gm-bar-active');
    document.body.classList.add('gm-bar-typing');
    if (typeof _updateGlobalChatPlaceholder === 'function') _updateGlobalChatPlaceholder();
    return;
  }
  ov.classList.add('expanded');
  document.body.classList.add('gm-bar-active');
  document.body.classList.remove('gm-bar-typing');
  if (typeof _renderGMBarAlexBlock === 'function') _renderGMBarAlexBlock();
  if (typeof _updateGlobalChatPlaceholder === 'function') _updateGlobalChatPlaceholder();
}
window._gmBarExpand = _gmBarExpand;

function _gmBarCollapse() {
  const ov = document.getElementById('global-chat-overlay');
  if (!ov) return;
  ov.classList.remove('expanded');
  document.body.classList.remove('gm-bar-active');
  document.body.classList.remove('gm-bar-typing');
  const inp = document.getElementById('global-chat-in');
  if (inp && document.activeElement === inp) inp.blur();
  // Hide chat messages, restore Alex block + chips for next expand
  const msgs = document.getElementById('gm-bar-msgs');
  if (msgs) msgs.style.display = 'none';
  const body = document.querySelector('.gm-bar-body');
  if (body) body.style.display = '';
}
window._gmBarCollapse = _gmBarCollapse;

// Legacy no-op kept for any leftover references (Phase 6 v1 had a blur-debounced collapse)
function _gmBarCollapseSoon() { /* replaced by scrim click / Esc / programmatic collapse */ }
window._gmBarCollapseSoon = _gmBarCollapseSoon;

// Fill global chat and auto-send
function fillGlobalChat(text) {
  const inp = document.getElementById('global-chat-in');
  if (!inp) return;
  inp.value = text;
  inp.focus();
  setTimeout(() => { if (typeof sendGlobalChat === 'function') sendGlobalChat(); }, 150);
}
window.fillGlobalChat = fillGlobalChat;

// ════════════════════════════════════════════════════════════════
// UNIFIED SEARCH + CHAT INPUT
// ════════════════════════════════════════════════════════════════

let _unifiedDebounce = null;

function handleUnifiedInput(val) {
  clearTimeout(_unifiedDebounce);
  const results = document.getElementById('unified-search-results');
  if (!results) return;
  if (!val || val.length < 2) { results.style.display = 'none'; return; }

  _unifiedDebounce = setTimeout(() => {
    const q = val.toLowerCase();
    const players = window.S?.players || {};
    const matches = Object.entries(players)
      .filter(([, p]) => {
        const full = ((p.first_name || '') + ' ' + (p.last_name || '')).toLowerCase();
        return full.includes(q) && p.position && !['HC','OC','DC','GM'].includes(p.position);
      })
      .map(([pid, p]) => {
        const dhq = typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
        return { pid, name: (p.first_name || '') + ' ' + (p.last_name || ''), pos: p.position, team: p.team || 'FA', dhq };
      })
      .sort((a, b) => b.dhq - a.dhq)
      .slice(0, 5);

    let html = '';
    if (matches.length) {
      html += matches.map(m =>
        `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s" onclick="document.getElementById('unified-search-results').style.display='none';document.getElementById('global-chat-in').value='';openPlayerModal('${m.pid}')">
          <img src="https://sleepercdn.com/content/nfl/players/${m.pid}.jpg" style="width:28px;height:28px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'"/>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--text)">${_esc(m.name)}</div>
            <div style="font-size:12px;color:var(--text3)">${m.pos} · ${m.team}${m.dhq > 0 ? ' · ' + m.dhq.toLocaleString() + ' DHQ' : ''}</div>
          </div>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`
      ).join('');
    }
    // Always show "Ask Scout" option at bottom
    html += `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;background:var(--accentL);transition:background .1s" onclick="document.getElementById('unified-search-results').style.display='none';sendGlobalChat()">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600;color:var(--accent)">Ask Scout</div>
        <div style="font-size:12px;color:var(--text3)">"${_esc(val.slice(0, 50))}"</div>
      </div>
    </div>`;

    results.innerHTML = html;
    results.style.display = '';
  }, 200);
}
window.handleUnifiedInput = handleUnifiedInput;

function handleUnifiedEnter(event) {
  const results = document.getElementById('unified-search-results');
  if (results) results.style.display = 'none';
  sendGlobalChat();
}
window.handleUnifiedEnter = handleUnifiedEnter;

// ════════════════════════════════════════════════════════════════
// GLOBAL CHAT SEND
// ════════════════════════════════════════════════════════════════

function sendGlobalChat() {
  const inp = document.getElementById('global-chat-in');
  const text = inp ? inp.value.trim() : '';
  if (!text) return;
  if (inp) inp.value = '';

  // Chat stays in the GM bar panel — no tab switch needed
  if (typeof sendHomeChat === 'function') sendHomeChat(text);
}
window.sendGlobalChat = sendGlobalChat;

function _routeToHomeChat(text) {
  if (typeof sendHomeChat === 'function') sendHomeChat(text);
}

// ════════════════════════════════════════════════════════════════
// TEAM BAR
// ════════════════════════════════════════════════════════════════

function toggleTeamBar() {
  const bar = document.getElementById('team-bar');
  if (!bar) return;
  const expanded = bar.classList.toggle('expanded');
  const roster = document.getElementById('team-bar-roster');
  if (!roster) return;
  if (expanded) {
    renderTeamBarRoster();
  }
}
window.toggleTeamBar = toggleTeamBar;

function renderTeamBar() {
  const S = window.S;
  if (!S || !S.user) return;

  const nameEl  = document.getElementById('tbar-name');
  const recEl   = document.getElementById('tbar-record');
  const rankEl  = document.getElementById('tbar-rank');
  if (!nameEl && !recEl && !rankEl) return;

  const myRoster = typeof myR === 'function' ? myR() : null;
  if (!myRoster) {
    // User is logged in but the roster hasn't been resolved yet (S.myRosterId
    // may populate after S.user on cold start). Show a loading state instead
    // of leaving the default "— Connect to see your team —" fallback visible.
    if (nameEl) nameEl.textContent = 'Loading your team…';
    if (recEl)  recEl.textContent  = '';
    if (rankEl) rankEl.style.display = 'none';
    return;
  }

  // Team avatar + name
  const owner = (S.leagueUsers || []).find(u => u.user_id === myRoster.owner_id);
  const avatarEl = document.getElementById('tbar-avatar');
  if (avatarEl) {
    const avatarId = owner?.avatar || S.user?.avatar;
    if (avatarId) {
      avatarEl.src = `https://sleepercdn.com/avatars/thumbs/${avatarId}`;
      avatarEl.style.display = '';
    }
  }
  if (nameEl) {
    const tname = owner?.metadata?.team_name || owner?.display_name || 'My Team';
    nameEl.textContent = tname;
  }

  // Record
  if (recEl) {
    const w = myRoster.settings?.wins || 0;
    const l = myRoster.settings?.losses || 0;
    const t = myRoster.settings?.ties || 0;
    recEl.textContent = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
  }

  // Health score (replaces power rank in offseason)
  if (rankEl) {
    try {
      const assess = typeof window.assessTeamFromGlobal === 'function'
        ? window.assessTeamFromGlobal(myRoster.roster_id)
        : null;
      const health = assess?.healthScore ?? assess?.health ?? assess?.overallGrade ?? null;
      if (health != null) {
        rankEl.style.display = '';
        const score = typeof health === 'number' ? Math.round(health) : health;
        const tierLabel = assess?.tier ? assess.tier.charAt(0) + assess.tier.slice(1).toLowerCase() : '';
        rankEl.textContent = tierLabel ? `${tierLabel} · ${score}` : `Health: ${score}`;
      }
    } catch (e) {}
  }
}
window.renderTeamBar = renderTeamBar;

let _tbarExpanded = null;

function _tbarToggle(pid) {
  // Collapse previous
  if (_tbarExpanded && _tbarExpanded !== pid) {
    const prev = document.getElementById('tbar-expand-' + _tbarExpanded);
    if (prev) prev.style.maxHeight = '0';
  }
  const el = document.getElementById('tbar-expand-' + pid);
  if (!el) return;
  if (_tbarExpanded === pid) {
    el.style.maxHeight = '0';
    _tbarExpanded = null;
  } else {
    el.style.maxHeight = el.scrollHeight + 'px';
    _tbarExpanded = pid;
  }
}
window._tbarToggle = _tbarToggle;

function renderTeamBarRoster() {
  const S = window.S;
  const container = document.getElementById('team-bar-roster');
  if (!container) return;

  if (!S || !S.user) {
    container.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--text3)">Connect your Sleeper account to see your roster.</div>';
    return;
  }

  const myRoster = typeof myR === 'function' ? myR() : null;
  if (!myRoster || !myRoster.players?.length) {
    container.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--text3)">No roster data yet.</div>';
    return;
  }

  // Group by normalized position in display order
  const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  const groups = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [], DL: [], LB: [], DB: [] };
  myRoster.players.forEach(pid => {
    const rawPos = typeof pPos === 'function' ? pPos(pid) : '';
    let norm = window.App?.normPos?.(rawPos);
    if (groups[norm]) groups[norm].push(pid);
  });

  // Sort each position group by DHQ descending
  const _dhqVal = pid => typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
  POS_ORDER.forEach(pos => groups[pos].sort((a, b) => _dhqVal(b) - _dhqVal(a)));

  const weeksDone = Math.max(1, (S.currentWeek || 1) - 1);

  let html = '';
  POS_ORDER.forEach(pos => {
    const players = groups[pos];
    if (!players.length) return;
    html += `<div class="tbar-pos-group"><div class="tbar-pos-label">${_scoutPosLabel(pos)}</div>`;
    players.forEach(pid => {
      const name     = typeof pName === 'function' ? pName(pid) : pid;
      const team     = typeof pTeam === 'function' ? pTeam(pid) : '';
      const total    = S.playerStats?.[pid]?.pts_ppr;
      const ppg      = total != null ? (total / weeksDone).toFixed(1) : '—';
      const dhq      = typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
      const dhqStr   = dhq > 0 ? dhq.toLocaleString() : '—';
      const safeName = _esc(name).replace(/'/g, "\\'");

      // Inline card data
      const p         = S.players?.[pid] || {};
      const age       = p.age || '—';
      const prevAvg   = S.playerStats?.[pid]?.prevAvg;
      const prevPpg   = prevAvg != null ? prevAvg.toFixed(1) : '—';
      const pk        = typeof peakYears === 'function' ? peakYears(pid) : null;
      const pkLabel   = pk ? pk.label : '—';
      const pkDesc    = pk ? pk.desc : '';
      const pkColor   = pk ? pk.color : 'var(--text3)';
      const trend     = (typeof LI !== 'undefined' ? LI?.playerMeta?.[pid]?.trend : 0) || 0;
      const trendStr  = trend > 5 ? `↑ ${trend}%` : trend < -5 ? `↓ ${Math.abs(trend)}%` : '—';
      const trendCol  = trend > 5 ? 'var(--green)' : trend < -5 ? 'var(--red)' : 'var(--text3)';

      // Age curve bar segments
      const ageCurves = window.App?.ageCurveWindows || {};
      const peakMap = window.App?.peakWindows || {QB:[28,34],RB:[23,25],WR:[25,28],TE:[26,29],DL:[25,29],LB:[24,28],DB:[24,27],K:[28,35]};
      const rawPos2 = p.position || pos;
      const mappedPos = ['DE','DT'].includes(rawPos2) ? 'DL' : ['CB','S','SS','FS'].includes(rawPos2) ? 'DB' : rawPos2;
      const [pLo, pHi] = peakMap[mappedPos] || [24, 29];
      const declineHi = ageCurves[mappedPos]?.decline?.[1] || pHi + 2;
      const ageNum = parseInt(age) || 25;
      const curveAges = [20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36];
      const segColor = a => a < pLo - 3 ? 'rgba(96,165,250,.3)' : a < pLo ? 'rgba(52,211,153,.5)' : a >= pLo && a <= pHi ? 'rgba(52,211,153,.8)' : a <= declineHi ? 'rgba(251,191,36,.5)' : 'rgba(248,113,113,.4)';
      const curveHtml = curveAges.map(a => `<div style="flex:1;height:6px;background:${segColor(a)};opacity:${a===ageNum?1:0.5};border-radius:1px;${a===ageNum?'outline:1.5px solid white;outline-offset:-1px;':''}"></div>`).join('');

      // Trade profile verdict
      const action = typeof getPlayerAction === 'function' ? getPlayerAction(pid) : null;
      const actionLabel = action?.label || '';
      const actionCol = action?.col || 'var(--text3)';

      html += `
      <div class="tbar-player-row" id="tbar-row-${pid}">
        <span class="pos p${pos}" style="font-size:11px;padding:1px 5px;flex-shrink:0">${pos}</span>
        <button class="tbar-pname tbar-name-btn" onclick="event.stopPropagation();_tbarToggle('${pid}')">${_esc(name)}</button>
        <span class="tbar-pteam">${_esc(team)}</span>
        <div class="tbar-ppg-col">
          <span class="tbar-dhq">${dhqStr}</span>
          <span class="tbar-ppg" title="Points per game">${ppg} ppg</span>
        </div>
      </div>
      <div class="tbar-expand" id="tbar-expand-${pid}">
        <div class="tbar-expand-inner" style="padding:10px 12px">
          <!-- Row 1: Photo + name + team + DHQ -->
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <img src="https://sleepercdn.com/content/nfl/players/${pid}.jpg" style="width:40px;height:40px;border-radius:10px;object-fit:cover;object-position:top;border:1px solid var(--border2);flex-shrink:0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
            <div style="display:none;width:40px;height:40px;border-radius:10px;background:var(--bg4);align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--text3);flex-shrink:0">${(name[0]||'?').toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="event.stopPropagation();openPlayerModal('${pid}')">${_esc(name)}</div>
              <div style="font-size:11px;color:var(--text3)">${pos} · Age ${age} · ${ppg} PPG${prevPpg !== '—' ? ' · Prev ' + prevPpg : ''} · <span style="color:${trendCol}">${trendStr}</span></div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:14px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${dhqStr}</div>
              ${actionLabel ? `<div style="font-size:11px;font-weight:700;color:${actionCol}">${actionLabel}</div>` : ''}
            </div>
          </div>
          <!-- Row 2: Age curve bar -->
          <div style="margin-bottom:8px">
            <div style="display:flex;gap:1px;border-radius:3px;overflow:hidden">${curveHtml}</div>
            <div style="display:flex;justify-content:space-between;margin-top:2px">
              <span style="font-size:11px;color:var(--text3)">20</span>
              <span style="font-size:11px;color:${pkColor};font-weight:600">${pkLabel} · ${pkDesc}</span>
              <span style="font-size:11px;color:var(--text3)">36</span>
            </div>
          </div>
          <!-- Row 3: Action buttons -->
          <div class="tbar-card-actions" style="display:flex;gap:4px">
            <button class="tbar-card-btn tbar-card-hold" onclick="event.stopPropagation();fillGlobalChat('Should I hold ${safeName}?')">Hold</button>
            <button class="tbar-card-btn tbar-card-trade" onclick="event.stopPropagation();if(typeof openTradeBuilderForPlayer==='function'){openTradeBuilderForPlayer('${pid}')}else{fillGlobalChat('What can I get for ${safeName} in a trade?')}">Trade</button>
            <button class="tbar-card-btn tbar-card-sell" onclick="event.stopPropagation();fillGlobalChat('Is now a good time to sell ${safeName}?')">Sell High</button>
            <button class="tbar-card-btn tbar-card-replace" onclick="event.stopPropagation();fillGlobalChat('Who can replace ${safeName} on waivers?')">Replace</button>
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
  });

  container.innerHTML = html || '<div style="padding:12px;font-size:13px;color:var(--text3)">No players found.</div>';

  // Restore expanded state after re-render
  if (_tbarExpanded) {
    const el = document.getElementById('tbar-expand-' + _tbarExpanded);
    if (el) el.style.maxHeight = el.scrollHeight + 'px';
  }
}

// ════════════════════════════════════════════════════════════════
// SCOUT BRIEFING
// ════════════════════════════════════════════════════════════════

function toggleScoutBriefing() {
  const el = document.getElementById('scout-briefing');
  if (!el) return;
  const expanded = el.classList.toggle('expanded');
  const items = document.getElementById('scout-briefing-items');
  if (!items) return;
  if (expanded) {
    items.style.display = 'flex';
    // Render if empty
    if (!items.children.length) renderScoutBriefing();
  } else {
    items.style.display = 'none';
  }
}
window.toggleScoutBriefing = toggleScoutBriefing;

function renderScoutBriefing() {
  const titleEl = document.getElementById('scout-briefing-title');
  const countEl = document.getElementById('scout-briefing-count');
  const itemsEl = document.getElementById('scout-briefing-items');
  if (!itemsEl) return;

  const S = window.S;
  if (!S || !S.user) {
    if (titleEl) titleEl.textContent = '3 things worth your attention';
    if (itemsEl) itemsEl.innerHTML = `<div class="scout-item">
      <div class="scout-item-dot watch"></div>
      <div class="scout-item-body">
        <div class="scout-item-title">Connect to get your personalized briefing</div>
        <div class="scout-item-desc">Enter your Sleeper username above to see intel tailored to your exact roster and league.</div>
      </div>
    </div>`;
    return;
  }

  const items = _generateBriefingItems();
  if (typeof trackUsage === 'function') trackUsage('briefings_received');

  if (titleEl) titleEl.textContent = `${items.length} thing${items.length !== 1 ? 's' : ''} worth your attention`;
  if (countEl) { countEl.textContent = items.length; countEl.style.display = ''; }

  // Determine if briefing reasoning (desc + actions) is gated
  const _reasoningGated = typeof canAccess === 'function'
    && !canAccess(window.FEATURES?.BRIEFING_REASONING || 'briefing_reasoning');
  const _feat = window.FEATURES?.BRIEFING_REASONING || 'briefing_reasoning';

  itemsEl.innerHTML = items.map(item => {
    if (_reasoningGated) {
      // Show headline and dot, but gate the "why" behind an upgrade tap
      return `
        <div class="scout-item">
          <div class="scout-item-dot ${item.priority}"></div>
          <div class="scout-item-body">
            <div class="scout-item-title">${_esc(item.title)}</div>
            <div style="font-size:13px;color:var(--text3);margin-top:3px">
              <a onclick="showUpgradePrompt('${_feat}')" style="color:var(--accent);cursor:pointer;text-decoration:none;font-size:13px">Why this matters →</a>
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="scout-item">
        <div class="scout-item-dot ${item.priority}"></div>
        <div class="scout-item-body">
          <div class="scout-item-title">${_esc(item.title)}</div>
          <div class="scout-item-desc">${_esc(item.desc)}</div>
          ${item.action ? `<button class="scout-item-action" onclick="${_esc(item.actionFn)}">${_esc(item.action)}</button>` : ''}
        </div>
      </div>`;
  }).join('');
}
window.renderScoutBriefing = renderScoutBriefing;

function _generateBriefingItems() {
  const S = window.S;
  const items = [];
  const myRoster = typeof myR === 'function' ? myR() : null;
  if (!myRoster) return [];

  // Get team assessment (same engine as War Room)
  const assess = typeof window.assessTeamFromGlobal === 'function'
    ? window.assessTeamFromGlobal(myRoster.roster_id) : null;
  const tier = assess?.tier || '';
  const hs = assess?.healthScore || 0;
  const needs = (assess?.needs || []).slice(0, 3);
  const elites = assess?.elites || 0;
  const needPos = needs.map(n => typeof n === 'string' ? n : n.pos).filter(Boolean).join(', ');

  const w = myRoster.settings?.wins || 0;
  const l = myRoster.settings?.losses || 0;
  const total = w + l;
  const winPct = total > 0 ? w / total : 0.5;

  // Item 1: Team health diagnosis (assessment-driven, not just record)
  if (assess) {
    const healthDesc = hs >= 85
      ? `Elite roster (${hs} health). ${elites} franchise player${elites !== 1 ? 's' : ''} anchoring your team.`
      : hs >= 70
      ? `Contender-class roster (${hs} health).${needPos ? ' Biggest gap: ' + needPos + '.' : ''}`
      : hs >= 55
      ? `Roster at a crossroads (${hs} health).${needPos ? ' Priority needs: ' + needPos + '.' : ''} A smart trade could shift momentum.`
      : `Rebuild mode (${hs} health).${needPos ? ' Critical gaps at ' + needPos + '.' : ''} Focus on acquiring young talent and draft capital.`;

    items.push({
      priority: hs >= 70 ? 'opportunity' : hs >= 55 ? 'watch' : 'urgent',
      title: `${tier || 'Team'} · Health ${hs}${total > 0 ? ' · ' + w + '-' + l : ''}`,
      desc: healthDesc,
      action: hs >= 70 ? 'Find upgrades →' : 'Build trade →',
      actionFn: hs >= 70
        ? "fillGlobalChat('What upgrades should I target to push for a championship?')"
        : "fillGlobalChat('What trades should I make to improve my roster health?')",
    });
  } else if (total > 0) {
    // Fallback: record-based if assessment unavailable
    const title = winPct < 0.40 ? `Rebuild window — ${w}-${l}` : winPct >= 0.65 ? `Win-now — ${w}-${l}` : `${w}-${l} record`;
    items.push({
      priority: winPct < 0.40 ? 'urgent' : 'opportunity',
      title,
      desc: winPct < 0.40 ? 'Consider trading vets for draft capital.' : 'Explore upgrades before the deadline.',
      action: 'Find moves →',
      actionFn: "mobileTab('trades')",
    });
  }

  // Item 2: Positional need action (if assessment found needs)
  if (needs.length > 0) {
    const topNeed = typeof needs[0] === 'string' ? needs[0] : needs[0].pos;
    const avail = typeof getAvailablePlayers === 'function' ? getAvailablePlayers() : [];
    const bestAtNeed = avail
      .filter(a => _scoutNormPos(a?.p?.position || window.S?.players?.[a.id]?.position) === topNeed)
      .sort((a, b) => (b.val || 0) - (a.val || 0))[0];
    const waiverViable = Number(bestAtNeed?.val || 0) >= 1000;
    const cal = window.SeasonCalendar?.describe ? window.SeasonCalendar.describe(_scoutCurrentLeague()) : null;
    const draftWindow = cal && ['pre_draft', 'draft_week', 'early_offseason'].includes(cal.phase);
    items.push({
      priority: 'watch',
      title: `${topNeed} is your biggest gap`,
      desc: waiverViable
        ? `Your roster is thinnest at ${topNeed}. ${bestAtNeed.p?.full_name || bestAtNeed.id} is the top waiver option at ${Math.round(bestAtNeed.val).toLocaleString()} DHQ; compare price against trade targets.`
        : draftWindow
          ? `Your roster is thinnest at ${topNeed}, but the waiver pool does not clear the action floor. Use the draft board and trade market first.`
          : `Your roster is thinnest at ${topNeed}, but the waiver pool does not clear the action floor. Shop for a real upgrade or hold.`,
      action: draftWindow && !waiverViable ? 'Open draft room →' : 'Find ' + topNeed + ' →',
      actionFn: draftWindow && !waiverViable
        ? "mobileTab('draftroom')"
        : `fillGlobalChat('Who are the best ${topNeed} targets I can acquire without overpaying?')`,
    });
  } else {
    items.push({
      priority: 'opportunity',
      title: 'Waiver wire has upside',
      desc: 'Low-ownership players with breakout potential are available.',
      action: 'View waivers →',
      actionFn: "mobileTab('waivers')",
    });
  }

  // Item 3: Draft capital (use tradedPicks API, not roster.draft_picks)
  if (items.length < 3) {
    const curYear = parseInt(S.season) || new Date().getFullYear();
    const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
    const draftRounds = league?.settings?.draft_rounds || 4;
    const allTP = S.tradedPicks || [];
    let futureCapital = 0;
    for (let yr = curYear; yr <= curYear + 2; yr++) {
      for (let rd = 1; rd <= draftRounds; rd++) {
        const tradedAway = allTP.find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === myRoster.roster_id && p.owner_id !== myRoster.roster_id);
        if (!tradedAway) futureCapital++;
        const acquired = allTP.filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === myRoster.roster_id && p.roster_id !== myRoster.roster_id);
        futureCapital += acquired.length;
      }
    }
    if (futureCapital === 0) {
      items.push({
        priority: 'watch',
        title: 'Low draft capital',
        desc: "No future picks in hand. Acquire picks before the rookie draft.",
        action: 'Acquire picks →',
        actionFn: "fillGlobalChat('How can I acquire more draft picks this offseason?')",
      });
    } else {
      items.push({
        priority: 'opportunity',
        title: `${futureCapital} pick${futureCapital !== 1 ? 's' : ''} in hand`,
        desc: 'Use the draft room to map your targets. Good capital = leverage.',
        action: 'Open draft room →',
        actionFn: "mobileTab('draftroom')",
      });
    }
  }

  return items.slice(0, 3);
}

// ════════════════════════════════════════════════════════════════
// SCOUT APP SHELL — Team, Tools, Portfolio
// ════════════════════════════════════════════════════════════════

const SCOUT_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

function _scoutCurrentLeague() {
  const S = window.S || {};
  return (S.leagues || []).find(l => l.league_id === S.currentLeagueId) || (S.leagues || [])[0] || {};
}

function _scoutNormPos(pos) {
  if (!pos) return '';
  if (['DE', 'DT', 'NT', 'IDL', 'EDGE'].includes(pos)) return 'DL';
  if (['CB', 'S', 'SS', 'FS'].includes(pos)) return 'DB';
  return pos;
}

function _scoutOwnerForRoster(roster) {
  const S = window.S || {};
  return (S.leagueUsers || []).find(u => u.user_id === roster?.owner_id) || null;
}

function _scoutTeamName(roster) {
  const owner = _scoutOwnerForRoster(roster);
  return owner?.metadata?.team_name || owner?.display_name || owner?.username || `Team ${roster?.roster_id || ''}`.trim();
}

function _scoutValue(pid) {
  let val = 0;
  try {
    if (typeof dynastyValue === 'function') val = Number(dynastyValue(pid) || 0);
  } catch {}
  if (val > 0) return val;
  const scores = window.App?.LI?.playerScores || window.LI?.playerScores || {};
  return Number(scores?.[pid] || scores?.[String(pid)] || 0);
}

function _scoutRosterValue(roster) {
  return (roster?.players || []).reduce((sum, pid) => {
    return sum + _scoutValue(pid);
  }, 0);
}

function _scoutAssessment(rosterId) {
  try {
    return typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(rosterId) : null;
  } catch {
    return null;
  }
}

function _scoutAllAssessments() {
  try {
    if (typeof window.assessAllTeamsFromGlobal === 'function') return window.assessAllTeamsFromGlobal() || [];
  } catch {}
  return [];
}

function _scoutRankFor(rosterId) {
  const S = window.S || {};
  const assessed = _scoutAllAssessments();
  if (assessed.length) {
    const byHealth = [...assessed].sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
    const maxHealth = Math.max(...byHealth.map(a => Number(a.healthScore || 0)), 0);
    const idx = byHealth.findIndex(a => String(a.rosterId) === String(rosterId));
    if (idx >= 0 && maxHealth > 0) return { rank: idx + 1, total: byHealth.length, basis: 'Health' };
  }
  const values = (S.rosters || [])
    .map(r => ({ rid: r.roster_id, value: _scoutRosterValue(r) }))
    .sort((a, b) => b.value - a.value);
  const idx = values.findIndex(v => String(v.rid) === String(rosterId));
  return { rank: idx >= 0 ? idx + 1 : null, total: values.length || 0, basis: 'DHQ' };
}

function _scoutFaab(roster) {
  const league = _scoutCurrentLeague();
  const budget = Number(league?.settings?.waiver_budget || 0);
  const spent = Number(roster?.settings?.waiver_budget_used || 0);
  const isFAAB = budget > 0 || league?.settings?.waiver_type === 2;
  return { isFAAB, budget, spent, remaining: Math.max(0, budget - spent) };
}

function _scoutPicksForRoster(rosterId) {
  const S = window.S || {};
  const league = _scoutCurrentLeague();
  const rounds = Number(league?.settings?.draft_rounds || 4);
  const curYear = parseInt(league?.season || S.season || new Date().getFullYear(), 10);
  const years = [curYear, curYear + 1, curYear + 2];
  const picks = [];
  const traded = S.tradedPicks || [];
  const teams = (S.rosters || []).length || 12;

  years.forEach(year => {
    for (let round = 1; round <= rounds; round++) {
      const tradedAway = traded.find(p =>
        parseInt(p.season, 10) === year &&
        Number(p.round) === round &&
        String(p.roster_id) === String(rosterId) &&
        String(p.owner_id) !== String(rosterId)
      );
      if (!tradedAway) picks.push({ year, round, originalOwnerRid: rosterId, own: true });

      traded.filter(p =>
        parseInt(p.season, 10) === year &&
        Number(p.round) === round &&
        String(p.owner_id) === String(rosterId) &&
        String(p.roster_id) !== String(rosterId)
      ).forEach(p => picks.push({ year, round, originalOwnerRid: p.roster_id, own: false }));
    }
  });

  picks.forEach(pk => {
    try {
      pk.value = typeof window.pickValue === 'function'
        ? window.pickValue(pk.year, pk.round, teams, Math.ceil(teams / 2))
        : ({ 1: 3000, 2: 1000, 3: 450, 4: 160 }[pk.round] || 50);
    } catch {
      pk.value = 0;
    }
    if (!pk.value && typeof window.getPickValueBySlot === 'function') {
      pk.value = window.getPickValueBySlot(pk.round, Math.ceil(teams / 2), teams, rounds);
    }
    if (!pk.value) pk.value = ({ 1: 3000, 2: 1000, 3: 450, 4: 160 }[pk.round] || 50);
  });
  return picks.sort((a, b) => (b.value || 0) - (a.value || 0));
}

function _scoutRosterRooms(roster, assessment) {
  const groups = {};
  SCOUT_POS_ORDER.forEach(pos => { groups[pos] = { pos, players: [], value: 0, count: 0, top: null, status: 'ok' }; });
  (roster?.players || []).forEach(pid => {
    const pos = _scoutNormPos(typeof pPos === 'function' ? pPos(pid) : '');
    if (!groups[pos]) return;
    const val = _scoutValue(pid);
    const ppg = window.S?.playerStats?.[pid]?.seasonAvg || window.S?.playerStats?.[pid]?.prevAvg || 0;
    groups[pos].players.push({ pid, val, ppg, age: typeof pAge === 'function' ? pAge(pid) : '' });
    groups[pos].value += val;
    groups[pos].count++;
  });
  Object.values(groups).forEach(room => {
    room.players.sort((a, b) => b.val - a.val);
    room.top = room.players[0] || null;
    const pa = assessment?.posAssessment?.[room.pos];
    const needEntry = (assessment?.needs || []).slice(0, 3).find(n => (typeof n === 'string' ? n : n.pos) === room.pos);
    if (pa?.status && (assessment?.healthScore || 0) > 0) room.status = pa.status;
    else if (needEntry) room.status = typeof needEntry === 'string' ? 'thin' : (needEntry.urgency || 'thin');
    else if (room.count === 0) room.status = 'deficit';
    else if (room.count <= 1 && room.pos !== 'K') room.status = 'thin';
    else if (room.count >= 5) room.status = 'surplus';
  });
  return SCOUT_POS_ORDER.map(pos => groups[pos]).filter(r => r.count || assessment?.posAssessment?.[r.pos]);
}

function _scoutStatusTone(status) {
  if (status === 'surplus') return { label: 'Surplus', cls: 'good' };
  if (status === 'deficit') return { label: 'Deficit', cls: 'bad' };
  if (status === 'thin') return { label: 'Thin', cls: 'warn' };
  return { label: 'Stable', cls: 'neutral' };
}

function _scoutRecord(roster) {
  const s = roster?.settings || {};
  const ties = Number(s.ties || 0);
  return ties > 0 ? `${s.wins || 0}-${s.losses || 0}-${ties}` : `${s.wins || 0}-${s.losses || 0}`;
}

function _scoutEmpty(title, body, actionLabel, action) {
  return `<div class="scout-command-shell">
    <div class="scout-empty-card">
      <div class="scout-kicker">Scout</div>
      <div class="scout-empty-title">${_esc(title)}</div>
      <div class="scout-empty-body">${_esc(body)}</div>
      ${actionLabel ? `<button class="scout-primary-btn" onclick="${action || "mobileTab('digest')"}">${_esc(actionLabel)}</button>` : ''}
    </div>
  </div>`;
}

function _scoutLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function _scoutPosLabel(pos) {
  return window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
}

function _scoutListLabel(items, fallback) {
  const arr = (items || []).filter(Boolean);
  return arr.length ? arr.slice(0, 3).map(_scoutPosLabel).join(', ') : fallback;
}

function _scoutJsonAttr(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

function _scoutFillAction(prompt) {
  return `fillGlobalChat(${_scoutJsonAttr(prompt)})`;
}

function _scoutStrategy() {
  return window.GMStrategy?.getStrategy ? window.GMStrategy.getStrategy() : {};
}

function _scoutAlexLabel(strategy) {
  return _scoutLabel(strategy.alexPersonality || strategy.alexStyle || 'balanced');
}

function _scoutStrategySummary(strategy) {
  const mode = _modeLabel(strategy.mode || 'balanced_rebuild');
  const target = _scoutListLabel(strategy.targetPositions, 'Any value');
  const sell = _scoutListLabel(strategy.sellPositions, 'No forced sells');
  const aggression = _scoutLabel(strategy.aggression || 'medium');
  return `${mode} · Target ${target} · Sell ${sell} · ${aggression}`;
}

function _scoutSyncMeta(strategy) {
  const ts = Number(strategy.lastSyncedAt || 0);
  const age = ts ? Date.now() - ts : Infinity;
  const stale = age > 6 * 60 * 60 * 1000;
  const label = stale ? 'Stale' : 'Synced from War Room';
  return { stale, label };
}

function _scoutHealth(assessment, roster) {
  const raw = Number(assessment?.healthScore || 0);
  if (raw > 0) return Math.round(raw);
  const totalValue = roster ? _scoutRosterValue(roster) : 0;
  const allValues = (window.S?.rosters || []).map(r => _scoutRosterValue(r)).filter(v => v > 0);
  const maxValue = Math.max(...allValues, 0);
  if (!totalValue || !maxValue) return null;
  return Math.max(10, Math.round((totalValue / maxValue) * 100));
}

function _scoutHealthTone(health) {
  if (health == null) return 'neutral';
  if (health >= 75) return 'good';
  if (health >= 55) return 'warn';
  return 'bad';
}

function _scoutAlignmentBadge(alignment) {
  const key = alignment?.alignment || alignment || 'partial';
  const map = {
    aligned: { label: 'Aligned', cls: 'aligned' },
    partial: { label: 'Partial', cls: 'partial' },
    conflicts: { label: 'Conflicts', cls: 'conflicts' },
  };
  const m = map[key] || map.partial;
  return `<span class="scout-align-badge ${m.cls}">${m.label}</span>`;
}

function _scoutUrgencyLabel(urgency) {
  const labels = {
    this_week: 'This week',
    '2_weeks': 'Next 2 weeks',
    before_draft: 'Before draft',
    no_rush: 'No rush',
  };
  return labels[urgency] || _scoutLabel(urgency || 'Monitor');
}

function _scoutConfidenceLabel(confidence) {
  const c = String(confidence || 'medium').toLowerCase();
  return c === 'high' ? 'High confidence' : c === 'low' ? 'Low confidence' : 'Medium confidence';
}

function _scoutShortSentence(text) {
  return String(text || '').replace(/\s+/g, ' ').replace(/[.?!]\s*$/, '').trim();
}

function _scoutReasoningSentences(text) {
  const raw = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return raw.map(_scoutShortSentence).filter(Boolean);
}

function _scoutStrategyChips(strategy) {
  const mode = _modeLabel(strategy?.mode || 'balanced_rebuild');
  const target = (strategy?.targetPositions || []).length
    ? (strategy.targetPositions || []).slice(0, 2).map(_scoutPosLabel).join(', ')
    : 'Any value';
  const urgency = _scoutLabel(strategy?.aggression || 'medium');
  return [mode, `Target ${target}`, urgency];
}

function _scoutHeroMeta(league, phase, state) {
  const milestone = phase?.nextMilestone
    ? `${phase.nextMilestone}${phase.weeksToNext != null ? ` in ${phase.weeksToNext}w` : ''}`
    : null;
  return [league?.name || 'Active league', milestone || phase?.label, state].filter(Boolean);
}

function _scoutNextMoveRows(move, phase, health) {
  const reasoning = move?.reasoning || '';
  const sentences = _scoutReasoningSentences(reasoning);
  const rows = [];
  const milestone = phase?.nextMilestone
    ? `${phase.nextMilestone}${phase.weeksToNext != null ? ` in ${phase.weeksToNext}w` : ''}`
    : phase?.label;
  if (milestone) rows.push({ label: 'Timing', value: milestone });

  const marketSentence = sentences.find(s => /best available|no usable|waiver target|waiver pool/i.test(s));
  if (marketSentence) {
    const compactMarket = marketSentence
      .replace(/^Best available ([A-Z]+) is /i, '')
      .replace(/, below the /i, ' | floor ')
      .replace(/ DHQ action floor/i, ' DHQ');
    rows.push({ label: 'Market', value: compactMarket });
  }

  const planSentence = sentences.find(s => /Use draft capital|trade-down|planning window|Let roster churn|holding is better|Playoff moves/i.test(s))
    || sentences.find(s => /War Room strategy|target position|Health/i.test(s))
    || sentences[sentences.length - 1];
  if (planSentence) rows.push({ label: 'Plan', value: planSentence });

  if (health != null && !rows.some(r => /Health/i.test(r.value))) {
    rows.push({ label: 'Roster', value: `Health ${health}` });
  }
  return rows.slice(0, 3);
}

function _scoutTabForMove(move) {
  if (move?.type === 'trade') return 'trades';
  if (move?.type === 'waiver') return 'waivers';
  if (move?.type === 'draft') return 'draftroom';
  return 'digest';
}

function _scoutActionForMove(move) {
  if (move?.type === 'trade') return 'open_trade_builder';
  if (move?.type === 'waiver') return 'open_waivers';
  if (move?.type === 'draft') return 'open_draft_room';
  return 'review_today';
}

function _scoutBuildNextMoveContract(move, league, roster, assessment, strategy, phase, health) {
  const intel = window.App?.Intelligence;
  if (!intel?.createRecommendation || !intel?.buildRecommendationContract) return null;
  const S = window.S || {};
  const profile = intel.buildLeagueProfile ? intel.buildLeagueProfile({
    league,
    rosters: S.rosters || league?.rosters || [],
    platform: S.platform || league?._platform || 'sleeper',
  }) : null;
  const buildEvidence = intel.buildSourceEvidence || (item => item);
  const confidence = String(move?.confidence || 'medium').toLowerCase();
  const baseScore = confidence === 'high' ? 84 : confidence === 'low' ? 48 : 68;
  const urgencyBoost = move?.urgency === 'this_week' ? 8 : move?.urgency === '2_weeks' ? 4 : 0;
  const reasonText = _scoutShortSentence(move?.reasoning || move?.action || 'Alex is waiting for current league context');
  const needLabels = (assessment?.needs || [])
    .map(n => typeof n === 'string' ? n : n?.pos)
    .filter(Boolean)
    .slice(0, 3);
  const strategyLabel = _scoutStrategySummary(strategy);
  const actionType = move?.type || 'hold';
  const reasonCode = actionType === 'trade' ? 'acceptance_fit'
    : actionType === 'draft' ? 'draft_history'
      : actionType === 'waiver' ? 'roster_need'
        : 'contender_fit';
  const rec = intel.createRecommendation({
    id: 'scout_next_move',
    type: actionType,
    subject: {
      id: move?.targetPlayer?.pid || String(roster?.roster_id || ''),
      name: move?.action || 'Scout next move',
      label: 'Scout Today',
    },
    action: _scoutActionForMove(move),
    score: Math.min(100, baseScore + urgencyBoost),
    confidence,
    reasons: [
      { code: reasonCode, detail: reasonText, weight: 1.1 },
      { code: 'behavioral_fit', detail: `GM Strategy: ${strategyLabel}`, weight: 0.7 },
    ],
    evidence: [
      buildEvidence({ sourceKey: 'league_roster', source: 'team_assessment', signal: 'health', value: health, freshness: 'live', present: health != null, entityId: roster?.roster_id }),
      buildEvidence({ sourceKey: 'league_roster', source: 'team_assessment', signal: 'needs', value: needLabels, freshness: 'live', present: needLabels.length > 0, entityId: roster?.roster_id }),
      buildEvidence({ sourceKey: 'league_scoring', source: 'league.scoring_settings', signal: 'format_context', value: profile?.formatTags || [], freshness: 'live', present: !!profile }),
      buildEvidence({ sourceKey: 'decision_history', source: 'GM Strategy', signal: 'strategy_sync', value: strategyLabel, freshness: 'live', present: !!Object.keys(strategy || {}).length }),
      buildEvidence({ sourceKey: 'sleeper', source: 'Season calendar', signal: 'phase', value: phase?.label || phase?.nextMilestone || '', freshness: 'live', present: !!(phase?.label || phase?.nextMilestone) }),
    ],
    headline: 'Next Move',
    detail: move?.reasoning || '',
    badge: confidence,
    alexSummary: reasonText,
    clickTarget: { type: actionType, tab: _scoutTabForMove(move), action: move?.action || '' },
    context: { leagueProfile: profile, teamAssessment: assessment, phase, strategy },
  });
  return intel.buildRecommendationContract(rec, { title: 'Grounded by', limit: 3, evidenceLimit: 3, contextChipLimit: 5 });
}

function _scoutRenderRecommendationContract(contract) {
  if (!contract) return '';
  const grounded = contract.truth?.grounded;
  const label = grounded ? 'Grounded by' : 'Needs more data';
  const sourceLine = (contract.sources || []).slice(0, 3).join(' + ') || 'Scout context';
  const chips = (contract.contextChips || []).slice(0, 5);
  const lines = (contract.lines || []).slice(0, 2);
  const sources = (contract.sources || []).slice(0, 4);
  return `<div class="scout-reco-proof ${grounded ? '' : 'is-caution'}">
    <div class="scout-reco-proof-head">
      <span>${_esc(label)}</span>
      <strong>${_esc(sourceLine)}</strong>
    </div>
    <div class="scout-reco-proof-chips">
      ${chips.map(chip => `<i>${_esc(chip)}</i>`).join('')}
    </div>
    ${lines.length ? `<div class="scout-reco-proof-lines">${lines.map(line => `<p>${_esc(line)}</p>`).join('')}</div>` : ''}
    ${sources.length ? `<div class="scout-reco-proof-sources">${sources.map(source => `<span>${_esc(source)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function _scoutPriorityAction(priority) {
  const label = priority?.actionLabel || 'Act';
  const type = priority?.actionType || '';
  if (/untouch|strategy|posture/i.test(label)) return 'openStrategyEditor()';
  if (type === 'draft') return "mobileTab('draftroom')";
  if (type === 'waiver' || type === 'waivers') return "mobileTab('waivers')";
  if (type === 'trade') return "mobileTab('trades')";
  return _scoutFillAction(`Help me with this priority: ${priority?.problem || label}. ${priority?.consequence || ''}`);
}

function _scoutNextMoveAction(move) {
  if (move?.type === 'trade') return "mobileTab('trades')";
  if (move?.type === 'waiver') return "mobileTab('waivers')";
  if (move?.type === 'draft') return "mobileTab('draftroom')";
  return _scoutFillAction(`Explain my next move: ${move?.action || 'what should I do next?'}`);
}

function _scoutNextMoveButtonLabel(move) {
  if (move?.type === 'waiver') return 'Open Waivers';
  if (move?.type === 'draft') return 'Open Draft Room';
  if (move?.type === 'trade') return 'Build Trade';
  return 'Ask Alex';
}

function _scoutDriftCard() {
  const drift = window.GMStrategy?.getDrift ? window.GMStrategy.getDrift() : { conflicts: [] };
  const hasDrift = window.GMStrategy?.hasDrift ? window.GMStrategy.hasDrift() : false;
  if (!hasDrift) return '';
  const recent = (drift.conflicts || [])
    .filter(c => Date.now() - c.timestamp < 7 * 86400000)
    .slice(-3);
  return `<section class="scout-drift-card">
    <div>
      <span class="scout-kicker">Strategy Drift Detected</span>
      <h2>${recent.length} moves conflict with your plan</h2>
      <p>${recent.map(c => _esc(_describeConflict(c))).join(' · ')}</p>
    </div>
    <div class="scout-drift-actions">
      <button class="scout-primary-btn" onclick="openStrategyEditor()">Adjust Strategy</button>
      <button class="scout-secondary-btn" onclick="_clearDriftWithNote();renderWarRoomBrief()">Stay Course</button>
    </div>
  </section>`;
}

function _scoutTeamStateText(strategy, assessment) {
  if (strategy.mode) return _modeLabel(strategy.mode);
  if (assessment?.tier) return _scoutLabel(assessment.tier);
  return 'Strategy unset';
}

function _scoutRenderPriorities(priorities) {
  const rows = (priorities || []).slice(0, 3);
  if (!rows.length) return '';
  return `<section class="scout-brief-section">
    <div class="scout-section-head">
      <div><span class="scout-kicker">Priorities</span><h2>What needs attention</h2></div>
    </div>
    <div class="scout-priority-stack">
      ${rows.map((p, i) => `<button class="scout-priority-card" onclick="${_scoutPriorityAction(p)}">
        <span class="scout-priority-index">${i + 1}</span>
        <span>
          <strong>${_esc(p.problem || 'Priority')}</strong>
          <small>${_esc(p.consequence || 'Alex is waiting on more league data.')}</small>
        </span>
        <em>${_esc(p.actionLabel || 'Act')}</em>
      </button>`).join('')}
    </div>
  </section>`;
}

function _scoutRenderOpportunities(opportunities) {
  const rows = (opportunities || []).slice(0, 3);
  if (!rows.length) return '';
  return `<section class="scout-brief-section">
    <div class="scout-section-head">
      <div><span class="scout-kicker">Trade Matches</span><h2>Who fits your needs?</h2></div>
      <button class="scout-secondary-btn" onclick="mobileTab('league')">League</button>
    </div>
    <div class="scout-opportunity-grid">
      ${rows.map(o => `<button class="scout-opportunity-card" onclick="${_scoutFillAction(`Build a trade plan for ${o.ownerName || 'this owner'}. ${o.insight || ''}`)}">
        <span>${_esc(o.ownerName || 'Owner')}</span>
        <strong>${_esc(o.insight || 'Potential partner')}</strong>
        <small>${Number(o.exploitScore || 0)} fit score</small>
        <em>${_esc(o.suggestedAction || 'Attack')}</em>
      </button>`).join('')}
    </div>
  </section>`;
}

function _scoutRenderFieldIntel(items) {
  const rows = (items || []).slice(0, 4);
  if (!rows.length) return '';
  return `<section class="scout-brief-section">
    <div class="scout-section-head">
      <div><span class="scout-kicker">Alex's Read</span><h2>What Alex is seeing</h2></div>
      <button class="scout-secondary-btn" onclick="mobileTab('fieldlog')">GM Insights</button>
    </div>
    <div class="scout-intel-list">
      ${rows.map(row => `<div class="scout-intel-row"><i></i><span>${_esc(row)}</span></div>`).join('')}
    </div>
  </section>`;
}

// Draft War Room banner — front-and-center entry on the home brief whenever a
// rookie draft is upcoming or live. Taps straight into the draft war room
// (draftroom entry view: Big Board + Dynamic Mock). Returns '' when there is
// no draft to surface so the banner stays out of the way the rest of the year.
function _scoutDraftWarRoomBanner(phase) {
  const S = window.S || {};
  const drafts = Array.isArray(S.drafts) ? S.drafts : [];
  const live = drafts.some(d => d && d.status === 'drafting');
  const ph = phase?.phase;
  const upcoming = !live && (
    drafts.some(d => d && d.status === 'pre_draft') ||
    ph === 'pre_draft' || ph === 'draft_week'
  );
  if (!live && !upcoming) return '';

  let kicker, headline, sub, cta;
  if (live) {
    kicker = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px;vertical-align:middle;box-shadow:0 0 0 3px rgba(52,211,153,.22)"></span>Draft is live';
    headline = 'Your draft is on the clock';
    sub = 'Jump into the war room — your board, targets, and pick analysis are ready.';
    cta = 'Enter the draft war room →';
  } else {
    const wk = phase?.weeksToNext;
    if (ph === 'draft_week') {
      kicker = 'Draft week';
      sub = "Lock your big board and run a final mock before you're on the clock.";
    } else if (typeof wk === 'number' && wk > 0) {
      kicker = `Draft in ~${wk} week${wk === 1 ? '' : 's'}`;
      sub = "Build your board and simulate the room while there's still time.";
    } else {
      kicker = 'Rookie draft incoming';
      sub = 'Build your board and simulate the room before draft day.';
    }
    headline = 'Get your draft war room ready';
    cta = 'Open the draft war room →';
  }

  const accent = live ? 'var(--green)' : 'var(--accent)';
  const border = live ? 'rgba(52,211,153,.45)' : 'var(--accent)';
  const bg = live
    ? 'linear-gradient(135deg,rgba(52,211,153,.16),rgba(52,211,153,.03))'
    : 'linear-gradient(135deg,rgba(212,175,55,.16),rgba(212,175,55,.03))';

  return `
    <button class="scout-draft-warroom" onclick="mobileTab('draftroom')" style="display:block;width:100%;text-align:left;border:1px solid ${border};background:${bg};border-radius:var(--rl,14px);padding:16px 18px;margin:0 0 14px;cursor:pointer;font-family:inherit">
      <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${accent};margin-bottom:6px">${kicker}</div>
      <div style="font-size:18px;font-weight:800;color:var(--text);letter-spacing:-.02em;margin-bottom:4px">${headline}</div>
      <div style="font-size:13px;color:var(--text3);line-height:1.45;margin-bottom:12px">${sub}</div>
      <span style="display:inline-flex;align-items:center;font-size:14px;font-weight:700;color:${accent}">${cta}</span>
    </button>`;
}
window._scoutDraftWarRoomBanner = _scoutDraftWarRoomBanner;

function renderWarRoomBrief() {
  const host = document.getElementById('digest-content');
  if (!host) return;

  const S = window.S || {};
  const roster = typeof myR === 'function' ? myR() : null;
  const league = _scoutCurrentLeague();
  const strategy = _scoutStrategy();
  const assessment = roster ? _scoutAssessment(roster.roster_id) : null;
  const health = _scoutHealth(assessment, roster);
  const sync = _scoutSyncMeta(strategy);
  const engine = window.GMEngine || {};
  const diagnosis = engine.generateDiagnosis ? engine.generateDiagnosis() : { line1: 'Loading team diagnosis.', line2: '' };
  const nextMove = engine.generateNextMove ? engine.generateNextMove() : null;
  const priorities = engine.generatePriorities ? engine.generatePriorities() : [];
  const opportunities = engine.generateOpportunities ? engine.generateOpportunities() : [];
  const fieldIntel = engine.generateFieldIntel ? engine.generateFieldIntel() : [];
  const phase = window.SeasonCalendar?.describe ? window.SeasonCalendar.describe(league) : null;
  const teamName = roster ? _scoutTeamName(roster) : 'No league connected';
  const state = _scoutTeamStateText(strategy, assessment);
  const targetMeta = nextMove
    ? [nextMove.targetPlayer?.name, nextMove.targetOwner?.name].filter(Boolean).join(' · ')
    : '';
  const heroMeta = _scoutHeroMeta(league, phase, state);
  const strategyChips = _scoutStrategyChips(strategy);
  const nextRows = _scoutNextMoveRows(nextMove, phase, health);
  const nextMoveContract = _scoutBuildNextMoveContract(nextMove, league, roster, assessment, strategy, phase, health);

  if (!S.user) {
    host.innerHTML = `<div class="scout-brief-shell">
      <section class="scout-brief-hero">
        <div class="scout-alex-row">
          <div class="scout-alex-avatar">AI</div>
          <div><strong>Alex Ingram</strong><span>${_esc(_scoutAlexLabel(strategy))}</span></div>
          <button class="scout-secondary-btn" onclick="openStrategyEditor()">Strategy</button>
        </div>
        <h1>Connect your league. Alex will build the command brief.</h1>
        <p>Roster diagnosis, next move, priorities, trade matches, and Alex's read show here once Scout has league data.</p>
        <div class="scout-brief-actions">
          <button class="scout-primary-btn" onclick="document.getElementById('setup-block').style.display='block';document.getElementById('digest-content').style.display='none'">Connect League</button>
          <button class="scout-secondary-btn" onclick="${_scoutFillAction('What should I do first after I connect my league?')}">Ask Alex</button>
        </div>
      </section>
    </div>`;
    return;
  }

  host.innerHTML = `<div class="scout-brief-shell">
    ${_scoutDraftWarRoomBanner(phase)}
    <section class="scout-brief-hero">
      <div class="scout-alex-row">
        <div class="scout-alex-avatar">AI</div>
        <div>
          <strong>Alex Ingram</strong>
          <span>Intelligence Briefing · ${_esc(phase?.label || 'Season context')} · ${_esc(state)}</span>
        </div>
        <button class="scout-secondary-btn" onclick="openStrategyEditor()">GM Strategy</button>
      </div>

      <div class="scout-team-state">
        <div>
          <span class="scout-kicker">Scout Today</span>
          <h1>${_esc(teamName)}</h1>
          <div class="scout-hero-meta">
            ${heroMeta.map(item => `<span>${_esc(item)}</span>`).join('')}
          </div>
        </div>
        <div class="scout-health-badge ${_scoutHealthTone(health)}">
          <strong>${health == null ? '--' : health}</strong>
          <span>Health</span>
        </div>
      </div>

      <button class="scout-strategy-strip ${sync.stale ? 'stale' : ''}" onclick="openStrategyEditor()">
        <strong>GM Strategy</strong>
        <span class="scout-strategy-chips">
          ${strategyChips.map(item => `<i>${_esc(item)}</i>`).join('')}
        </span>
        <em>${_esc(sync.label)}</em>
      </button>

      <div class="scout-diagnosis-card">
        <span class="scout-kicker">Intelligence Briefing</span>
        <p>${_esc(diagnosis.line1 || 'Alex is reading your roster.')}</p>
        ${diagnosis.line2 ? `<p>${_esc(diagnosis.line2)}</p>` : ''}
      </div>
    </section>

    ${_scoutDriftCard()}

    <section class="scout-next-card">
      <div class="scout-next-top">
        <span class="scout-kicker">Next Move</span>
        ${_scoutAlignmentBadge(nextMove?.alignment)}
      </div>
      <h2>${_esc(nextMove?.action || 'Ask Alex what to do next')}</h2>
      ${targetMeta ? `<p class="scout-next-target">${_esc(targetMeta)}</p>` : ''}
      <div class="scout-next-brief">
        ${nextRows.map(row => `<div><span>${_esc(row.label)}</span><strong>${_esc(row.value)}</strong></div>`).join('')}
      </div>
      <div class="scout-next-meta">
        <span>${_esc(_scoutConfidenceLabel(nextMove?.confidence))}</span>
        <span>${_esc(_scoutUrgencyLabel(nextMove?.urgency))}</span>
      </div>
      ${_scoutRenderRecommendationContract(nextMoveContract)}
      <div class="scout-brief-actions">
        <button class="scout-primary-btn" onclick="${_scoutNextMoveAction(nextMove)}">${_esc(_scoutNextMoveButtonLabel(nextMove))}</button>
        <button class="scout-secondary-btn" onclick="${_scoutFillAction(`Explain this recommendation: ${nextMove?.action || 'what should I do next?'}`)}">See Why</button>
      </div>
    </section>

    ${_scoutRenderPriorities(priorities)}
    ${_scoutRenderOpportunities(opportunities)}
    ${_scoutRenderFieldIntel(fieldIntel)}
  </div>`;
}
window.renderWarRoomBrief = renderWarRoomBrief;

function _strategyOptions(options, selected) {
  return options.map(([value, label]) => `<option value="${_esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${_esc(label)}</option>`).join('');
}

function openStrategyEditor() {
  const existing = document.getElementById('strategy-editor-modal');
  if (existing) existing.remove();
  const strategy = _scoutStrategy();
  const el = document.createElement('div');
  el.id = 'strategy-editor-modal';
  el.className = 'strategy-editor-overlay';
  el.innerHTML = `<div class="strategy-editor-card">
    <div class="strategy-editor-head">
      <div>
        <span class="scout-kicker">GM Strategy</span>
        <h2>Tell Alex how to think</h2>
      </div>
      <button class="strategy-editor-close" onclick="_closeStrategyEditor()" aria-label="Close">×</button>
    </div>

    <div class="strategy-editor-grid">
      <label><span>Mode</span><select id="strategy-mode">
        ${_strategyOptions([
          ['rebuild', 'Rebuild'],
          ['balanced_rebuild', 'Balanced Rebuild'],
          ['retool', 'Retool'],
          ['win_now', 'Win Now'],
        ], strategy.mode || 'balanced_rebuild')}
      </select></label>
      <label><span>Timeline</span><select id="strategy-timeline">
        ${_strategyOptions([
          ['1yr', '1 year'],
          ['2-3yr', '2-3 years'],
          ['dynasty_long', 'Dynasty long'],
        ], strategy.timeline || '2-3yr')}
      </select></label>
      <label><span>Alex</span><select id="strategy-alex">
        ${_strategyOptions([
          ['aggressive', 'Aggressive'],
          ['value_hunter', 'Value Hunter'],
          ['balanced', 'Balanced'],
        ], strategy.alexPersonality || 'balanced')}
      </select></label>
      <label><span>Aggression</span><select id="strategy-aggression">
        ${_strategyOptions([
          ['conservative', 'Conservative'],
          ['medium', 'Medium'],
          ['aggressive', 'Aggressive'],
        ], strategy.aggression || 'medium')}
      </select></label>
      <label><span>Target positions</span><input id="strategy-targets" type="text" value="${_esc((strategy.targetPositions || []).map(_scoutPosLabel).join(', '))}" placeholder="WR, D/ST, PICKS"/></label>
      <label><span>Sell positions</span><input id="strategy-sells" type="text" value="${_esc((strategy.sellPositions || []).map(_scoutPosLabel).join(', '))}" placeholder="RB"/></label>
      <label><span>Draft style</span><select id="strategy-draft-style">
        ${_strategyOptions([
          ['accumulate', 'Accumulate'],
          ['consolidate', 'Consolidate'],
          ['positional_need', 'Positional Need'],
          ['bpa', 'Best Player Available'],
        ], strategy.draftStyle || 'bpa')}
      </select></label>
      <label><span>Market posture</span><select id="strategy-market">
        ${_strategyOptions([
          ['buy_low', 'Buy Low'],
          ['sell_high', 'Sell High'],
          ['hold', 'Hold'],
          ['exploit', 'Exploit'],
        ], strategy.marketPosture || 'hold')}
      </select></label>
    </div>

    <div class="strategy-editor-actions">
      <button class="scout-secondary-btn" onclick="_closeStrategyEditor()">Cancel</button>
      <button class="scout-primary-btn" onclick="_saveScoutStrategyEditor()">Save Strategy</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
}
window.openStrategyEditor = openStrategyEditor;

function _closeStrategyEditor() {
  const el = document.getElementById('strategy-editor-modal');
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 180);
}
window._closeStrategyEditor = _closeStrategyEditor;

function _strategyCsv(id) {
  const el = document.getElementById(id);
  return String(el?.value || '')
    .split(',')
    .map(s => window.App?.normPos?.(s) || s.trim().toUpperCase())
    .filter(Boolean);
}

function _saveScoutStrategyEditor() {
  const updates = {
    mode: document.getElementById('strategy-mode')?.value || 'balanced_rebuild',
    timeline: document.getElementById('strategy-timeline')?.value || '2-3yr',
    alexPersonality: document.getElementById('strategy-alex')?.value || 'balanced',
    aggression: document.getElementById('strategy-aggression')?.value || 'medium',
    targetPositions: _strategyCsv('strategy-targets'),
    sellPositions: _strategyCsv('strategy-sells'),
    draftStyle: document.getElementById('strategy-draft-style')?.value || 'bpa',
    marketPosture: document.getElementById('strategy-market')?.value || 'hold',
    lastSyncedFrom: 'warroom',
  };
  if (window.GMStrategy?.saveStrategy) window.GMStrategy.saveStrategy(updates);
  _closeStrategyEditor();
  renderWarRoomBrief();
  renderCtxChips(window._activeTab || 'digest');
  if (typeof _renderGMBarAlexBlock === 'function') _renderGMBarAlexBlock();
  if (typeof updateSettingsStatus === 'function') updateSettingsStatus();
  if (typeof window.showToast === 'function') window.showToast('Strategy saved.');
}
window._saveScoutStrategyEditor = _saveScoutStrategyEditor;

function renderTeamCommandPanel() {
  const host = document.getElementById('panel-team-content');
  const S = window.S || {};
  if (!host) return;
  if (!S.user) {
    host.innerHTML = _scoutEmpty('Team Command needs a league', 'Connect your league and Scout will turn your roster into an operating dashboard.', 'Connect league', "mobileTab('digest')");
    return;
  }
  const roster = typeof myR === 'function' ? myR() : null;
  if (!roster) {
    host.innerHTML = _scoutEmpty('Loading your roster', 'Scout has your account, but the active team is still being resolved.', 'Back to Today', "mobileTab('digest')");
    return;
  }

  const league = _scoutCurrentLeague();
  const teamName = _scoutTeamName(roster);
  const assessment = _scoutAssessment(roster.roster_id);
  const rank = _scoutRankFor(roster.roster_id);
  const totalValue = _scoutRosterValue(roster);
  const hasValueData = totalValue > 0;
  const picks = _scoutPicksForRoster(roster.roster_id);
  const pickValueTotal = picks.reduce((sum, pk) => sum + (pk.value || 0), 0);
  const faab = _scoutFaab(roster);
  const needs = (assessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);
  const strengths = assessment?.strengths || [];
  const rooms = _scoutRosterRooms(roster, assessment);
  const topRooms = rooms.slice().sort((a, b) => hasValueData ? ((b.value || 0) - (a.value || 0)) : ((b.count || 0) - (a.count || 0))).slice(0, 3).map(r => r.pos).join(', ') || '—';
  const weakRooms = needs.slice(0, 3).join(', ') || rooms.filter(r => r.status === 'thin' || r.status === 'deficit').slice(0, 3).map(r => r.pos).join(', ') || 'none';
  const tier = assessment?.tier ? assessment.tier.replace(/_/g, ' ') : 'Unclassified';
  const allValues = (S.rosters || []).map(r => _scoutRosterValue(r)).filter(v => v > 0);
  const maxValue = Math.max(...allValues, 0);
  const fallbackHealth = maxValue > 0 ? Math.max(10, Math.round((totalValue / maxValue) * 100)) : null;
  const rawHealth = Number(assessment?.healthScore || 0);
  const health = rawHealth > 0 ? Math.round(rawHealth) : (fallbackHealth ?? '—');

  const actionRows = [
    {
      label: weakRooms && weakRooms !== 'none' ? `Fix ${weakRooms}` : 'Stress-test roster',
      meta: 'Ask Scout to rank the moves that change your title path.',
      action: `fillGlobalChat('Audit my roster and tell me the 3 highest leverage moves. Weak rooms: ${weakRooms}.')`,
      cta: 'Ask'
    },
    {
      label: strengths.length ? `Convert ${strengths.slice(0, 2).join(', ')} surplus` : 'Find a trade partner',
      meta: 'Turn surplus into starters, picks, or future leverage.',
      action: "mobileTab('trades')",
      cta: 'Trade'
    },
    {
      label: 'Open full roster board',
      meta: 'Keep the granular player-by-player view one tap away.',
      action: "mobileTab('roster')",
      cta: 'Board'
    }
  ];

  host.innerHTML = `<div class="scout-command-shell">
    <section class="scout-hero scout-team-hero">
      <div class="scout-kicker">My Team Command</div>
      <div class="scout-hero-row">
        <div>
          <h1>${_esc(teamName)}</h1>
          <p>${_esc(league?.name || 'Active league')} · ${_esc(_scoutRecord(roster))} · ${_esc(tier)}</p>
        </div>
        <div class="scout-score-ring">
          <span>${health}</span>
          <small>Health</small>
        </div>
      </div>
      <div class="scout-mini-read">
        <strong>Scout read:</strong> ${weakRooms && weakRooms !== 'none'
          ? `Your biggest roster pressure is ${_esc(weakRooms)}. ${hasValueData ? 'Best rooms by value' : 'Deepest rooms by count'}: ${_esc(topRooms)}.`
          : `No critical room is flashing red. Use surplus and pick capital to improve your weekly ceiling.`}
      </div>
    </section>

    <section class="scout-metric-grid">
      <div class="scout-metric-card"><span>Roster DHQ</span><strong>${hasValueData ? Math.round(totalValue).toLocaleString() : 'Syncing'}</strong><small>${hasValueData && rank.rank ? `#${rank.rank}/${rank.total} ${rank.basis}` : 'DHQ cache warming up'}</small></div>
      <div class="scout-metric-card"><span>Draft Bank</span><strong>${Math.round(pickValueTotal).toLocaleString()}</strong><small>${picks.length} picks in next 3 years</small></div>
      <div class="scout-metric-card"><span>FAAB</span><strong>${faab.isFAAB ? '$' + faab.remaining : 'Priority'}</strong><small>${faab.isFAAB ? '$' + faab.budget + ' budget' : '#' + (roster.settings?.waiver_position || '?') + ' waiver claim'}</small></div>
      <div class="scout-metric-card"><span>Window</span><strong>${_esc(assessment?.window || tier)}</strong><small>${needs.length ? `Need ${needs.slice(0, 2).join(', ')}` : 'No major gaps'}</small></div>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head">
        <div><span class="scout-kicker">Roster Rooms</span><h2>Where your team is built or exposed</h2></div>
        <button class="scout-secondary-btn" onclick="mobileTab('roster')">Full Board</button>
      </div>
      <div class="scout-room-grid">
        ${rooms.map(room => {
          const tone = _scoutStatusTone(room.status);
          const top = room.top?.pid ? `${pNameShort(room.top.pid)}${hasValueData ? ' · ' + Math.round(room.top.val).toLocaleString() : ''}` : 'No usable asset';
          const pct = hasValueData ? Math.min(100, Math.round((room.value / totalValue) * 180)) : Math.min(100, Math.max(12, room.count * 18));
          return `<button class="scout-room-card ${tone.cls}" onclick="fillGlobalChat('Audit my ${room.pos} room and tell me who to keep, trade, add, and drop.')">
            <div class="scout-room-top"><strong>${room.pos}</strong><span>${tone.label}</span></div>
            <div class="scout-room-main">${hasValueData ? Math.round(room.value).toLocaleString() : room.count} <small>${hasValueData ? 'DHQ' : 'players'}</small></div>
            <div class="scout-room-player">${_esc(top)}</div>
            <div class="scout-room-bar"><i style="width:${pct}%"></i></div>
          </button>`;
        }).join('')}
      </div>
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head">
        <div><span class="scout-kicker">Next Moves</span><h2>Actions that preserve depth</h2></div>
      </div>
      <div class="scout-action-list">
        ${actionRows.map(row => `<button class="scout-action-row" onclick="${row.action}">
          <span><strong>${_esc(row.label)}</strong><small>${_esc(row.meta)}</small></span>
          <em>${_esc(row.cta)}</em>
        </button>`).join('')}
      </div>
    </section>
  </div>`;
}
window.renderTeamCommandPanel = renderTeamCommandPanel;

function renderToolsPanel() {
  const host = document.getElementById('panel-tools-content');
  const S = window.S || {};
  if (!host) return;
  const log = typeof getFieldLog === 'function' ? getFieldLog() : [];
  const roster = typeof myR === 'function' ? myR() : null;
  const league = _scoutCurrentLeague();
  const assessment = roster ? _scoutAssessment(roster.roster_id) : null;
  const needs = (assessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);
  const toolCards = [
    { key: 'trade', title: 'Trade Studio', sub: 'Build packages with players, picks, FAAB, partner fit, and acceptance odds.', metric: needs.length ? `Need ${needs[0]}` : 'Partner DNA', action: "mobileTab('trades')" },
    { key: 'waivers', title: 'Waiver Workbench', sub: 'Find add/drop upgrades, bid ranges, fresh drops, and market pressure.', metric: typeof getFAAB === 'function' ? (_scoutFaab(roster)?.isFAAB ? '$' + _scoutFaab(roster).remaining + ' FAAB' : 'Claims') : 'Adds', action: "mobileTab('waivers')" },
    { key: 'draft', title: 'Dynamic Mock Draft', sub: 'Mock by owner tendencies, history, pick values, and trade-up/down paths.', metric: 'Mock room', action: "openDynamicMockDraft()" },
    { key: 'board', title: 'Rookie Big Board', sub: 'Manage tiers, flags, needs, and rookie targets for draft day.', metric: 'Board', action: "openRookieBigBoard()" },
    { key: 'lineup', title: 'Start/Sit Lab', sub: 'Weekly lineup decisions with projection, role, and risk context.', metric: 'Coming Soon', action: '', soon: true },
    { key: 'league', title: 'League Intel', sub: 'Owner profiles, tendencies, market leverage, and team dossiers.', metric: `${(S.rosters || []).length || 0} teams`, action: "mobileTab('league')" }
  ];

  host.innerHTML = `<div class="scout-command-shell">
    <section class="scout-hero">
      <div class="scout-kicker">Scout Tools</div>
      <h1>Workspaces with AI on top and real depth underneath.</h1>
      <p>${S.user ? _esc(league?.name || 'Active league') : 'Connect a league to unlock all workspaces.'}</p>
      <div class="scout-mini-read"><strong>Saved work:</strong> ${log.length} field log item${log.length === 1 ? '' : 's'} can be referenced later in War Room.</div>
    </section>

    <section class="scout-tool-grid">
      ${toolCards.map(card => `<button class="scout-tool-card ${card.key}${card.soon ? ' coming-soon' : ''}" ${card.soon ? 'disabled aria-disabled="true"' : `onclick="${card.action}"`}>
        <div class="scout-tool-meta"><span>${_esc(card.metric)}</span></div>
        <h2>${_esc(card.title)}</h2>
        <p>${_esc(card.sub)}</p>
      </button>`).join('')}
    </section>

    <section class="scout-section-card">
      <div class="scout-section-head">
        <div><span class="scout-kicker">Saved Artifacts</span><h2>Bring mobile work back into War Room</h2></div>
        <button class="scout-secondary-btn" onclick="mobileTab('fieldlog')">Open Log</button>
      </div>
      <div class="scout-action-list">
        ${(log.slice(0, 3).length ? log.slice(0, 3) : [
          { text: 'Build a trade, run a mock, or ask Scout a roster question. The decision will appear here once saved.', category: 'note', ts: Date.now() }
        ]).map(item => `<button class="scout-action-row" onclick="mobileTab('fieldlog')">
          <span><strong>${_esc((item.category || 'artifact').replace(/_/g, ' '))}</strong><small>${_esc(item.text || item.title || 'Saved Scout artifact')}</small></span>
          <em>${item.ts ? _relativeTime(item.ts) : 'Open'}</em>
        </button>`).join('')}
      </div>
    </section>
  </div>`;
}
window.renderToolsPanel = renderToolsPanel;

function _scoutStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function _scoutRegistryKpi(leagueId) {
  return leagueId ? _scoutStorageJson('dhq_kpi_' + leagueId, null) : null;
}

function _scoutLeagueRowsForPortfolio(registry, league, roster, activeAssessment) {
  const S = window.S || {};
  const rows = registry.length ? registry : (S.currentLeagueId ? [{
    leagueId: S.currentLeagueId,
    leagueName: league?.name || 'Active League',
    teamName: roster ? _scoutTeamName(roster) : '',
    season: league?.season || S.season,
    platform: 'sleeper',
    lastSync: Date.now()
  }] : []);
  window._scoutPortfolioRegistry = registry;

  return rows.map((entry, i) => {
    const isActive = String(entry.leagueId) === String(S.currentLeagueId);
    const kpi = _scoutRegistryKpi(entry.leagueId) || {};
    const rank = isActive && roster ? _scoutRankFor(roster.roster_id) : {};
    const assessment = isActive ? activeAssessment : null;
    const needs = (assessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);
    const strengths = assessment?.strengths || [];
    const picks = isActive && roster ? _scoutPicksForRoster(roster.roster_id) : [];
    const pickValue = picks.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
    const faab = isActive && roster ? _scoutFaab(roster) : null;
    const healthRaw = Number(assessment?.healthScore || kpi.healthScore || 0);
    const health = healthRaw > 0 ? Math.round(healthRaw) : null;
    const powerRank = rank.rank || kpi.powerRank || entry.powerRank || null;
    const totalTeams = rank.total || kpi.totalTeams || entry.totalRosters || 0;
    const syncedAgo = _relativeTime(entry.lastSync || kpi.ts || Date.now());
    const staleDays = entry.lastSync ? Math.floor((Date.now() - entry.lastSync) / 86400000) : 99;
    const rankPressure = powerRank && totalTeams ? Math.max(0, powerRank - Math.ceil(totalTeams * 0.55)) : 0;
    const urgency = (health == null ? 12 : health < 45 ? 48 : health < 65 ? 32 : 14)
      + Math.min(18, needs.length * 6)
      + Math.min(12, rankPressure * 2)
      + (staleDays > 7 ? 10 : staleDays > 2 ? 4 : 0)
      + (isActive ? 6 : 0);
    const intent = needs.length
      ? `Fix ${needs.slice(0, 2).join(', ')}`
      : health != null && health < 55
        ? 'Stabilize roster'
        : powerRank && totalTeams && powerRank <= Math.max(3, Math.ceil(totalTeams * 0.2))
          ? 'Press contender edge'
          : staleDays > 7
            ? 'Refresh stale intel'
            : 'Review league';

    return {
      ...entry,
      rowIndex: i,
      isActive,
      health,
      powerRank,
      totalTeams,
      syncedAgo,
      staleDays,
      urgency,
      intent,
      needs,
      strengths,
      picks,
      pickValue,
      faab,
      tier: assessment?.tier || assessment?.window || entry.tier || '',
      action: isActive || !registry.length ? "mobileTab('team')" : `scoutPortfolioOpenLeague(${i})`
    };
  }).sort((a, b) => b.urgency - a.urgency);
}

function _scoutPortfolioArtifacts(leagueId) {
  const log = typeof getFieldLog === 'function' ? getFieldLog() : [];
  const currentLog = log.filter(e => !e.leagueId || !leagueId || String(e.leagueId) === String(leagueId));
  const trades = currentLog.filter(e => e.actionType === 'trade_option_saved' || e.actionType === 'trade_scenario' || e.category === 'trade');
  const waiverLog = currentLog.filter(e => e.actionType === 'waiver_target_saved' || e.category === 'waivers');
  const mocks = typeof window._loadMockTemplates === 'function'
    ? window._loadMockTemplates()
    : _scoutStorageJson('wr_mock_templates_' + (leagueId || ''), []);
  const tags = _scoutStorageJson('player_tags_' + (leagueId || ''), {});
  const tagVals = Object.values(tags || {}).filter(Boolean);
  const tagCounts = tagVals.reduce((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});
  const faTargetsData = _scoutStorageJson('od_fa_targets_v1_' + (leagueId || ''), {});
  const faTargets = Array.isArray(faTargetsData?.targets) ? faTargetsData.targets : [];
  const plannedFaab = faTargets.reduce((sum, t) => sum + (Number(t.cost) || 0), 0);
  const pendingSync = log.filter(e => e.syncStatus === 'pending' || e.syncStatus === 'failed').length;
  const recent = currentLog.slice(0, 5);

  return {
    log: currentLog,
    trades,
    waiverLog,
    mocks,
    tagCounts,
    tagTotal: tagVals.length,
    faTargets,
    plannedFaab,
    pendingSync,
    recent
  };
}

function _scoutArtifactCard(kind, title, value, sub, action, cta) {
  return `<button class="scout-artifact-card ${kind}" onclick="${action}">
    <span>${_esc(title)}</span>
    <strong>${_esc(value)}</strong>
    <small>${_esc(sub)}</small>
    <em>${_esc(cta || 'Open')}</em>
  </button>`;
}

const _scoutPortfolioPlayersState = { filter: 'fit', pos: '', query: '' };
let _scoutPortfolioPlayerRetry = 0;

function _scoutAttr(s) {
  return _esc(s == null ? '' : String(s)).replace(/'/g, '&#39;');
}

function _scoutPlayerCommandRows(activeNeeds, activeStrengths) {
  const S = window.S || {};
  const rows = [];
  const seen = new Set();
  const needs = new Set(activeNeeds || []);
  const strengths = new Set(activeStrengths || []);
  const myRosterId = String(S.myRosterId || '');

  (S.rosters || []).forEach(roster => {
    const rosterId = String(roster.roster_id);
    const isMe = rosterId === myRosterId;
    const assessment = _scoutAssessment(roster.roster_id);
    const rooms = _scoutRosterRooms(roster, assessment);
    const roomByPos = {};
    rooms.forEach(room => { roomByPos[room.pos] = room; });
    const ownerNeeds = (assessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);
    const ownerStrengths = assessment?.strengths || [];
    const teamName = _scoutTeamName(roster);
    const ids = []
      .concat(roster.players || [])
      .concat(roster.taxi || [])
      .concat(roster.reserve || []);

    ids.forEach(pidRaw => {
      const pid = String(pidRaw);
      if (!pid || seen.has(rosterId + ':' + pid)) return;
      seen.add(rosterId + ':' + pid);
      const pos = _scoutNormPos(typeof pPos === 'function' ? pPos(pid) : S.players?.[pid]?.position || '');
      if (!pos) return;
      const val = _scoutValue(pid);
      if (val <= 0) return;
      const room = roomByPos[pos] || {};
      const ownerSurplus = room.status === 'surplus' || ownerStrengths.includes(pos);
      const fitsNeed = !isMe && needs.has(pos);
      const blocksStrength = !isMe && strengths.has(pos) && ownerNeeds.includes(pos);
      const ppg = Number(S.playerStats?.[pid]?.seasonAvg || S.playerStats?.[pid]?.prevAvg || 0);
      const age = typeof pAge === 'function' ? pAge(pid) : S.players?.[pid]?.age || '';
      const nfl = typeof pTeam === 'function' ? pTeam(pid) : S.players?.[pid]?.team || '';
      const name = typeof pName === 'function' ? pName(pid) : S.players?.[pid]?.full_name || pid;
      const commandScore = val
        + (fitsNeed ? 1300 : 0)
        + (ownerSurplus && !isMe ? 650 : 0)
        + (blocksStrength ? 300 : 0)
        + (ppg ? Math.min(650, ppg * 20) : 0);
      rows.push({
        pid,
        name,
        pos,
        val,
        ppg,
        age,
        nfl,
        rosterId,
        teamName,
        isMe,
        fitsNeed,
        ownerSurplus,
        blocksStrength,
        roomStatus: room.status || '',
        commandScore
      });
    });
  });

  const byPos = {};
  rows.slice().sort((a, b) => b.val - a.val).forEach(row => {
    byPos[row.pos] = byPos[row.pos] || 0;
    byPos[row.pos]++;
    row.posRank = byPos[row.pos];
    row.elite = row.val >= 7000 || row.posRank <= 5;
  });

  return rows;
}

function _scoutPlayerCommandFilteredRows(allRows) {
  const state = _scoutPortfolioPlayersState;
  const q = (state.query || '').trim().toLowerCase();
  let rows = allRows.slice();
  if (state.filter === 'fit') rows = rows.filter(r => r.fitsNeed && !r.isMe);
  if (state.filter === 'elite') rows = rows.filter(r => r.elite);
  if (state.filter === 'mine') rows = rows.filter(r => r.isMe);
  if (state.pos) rows = rows.filter(r => r.pos === state.pos);
  if (q) {
    rows = rows.filter(r => {
      return r.name.toLowerCase().includes(q)
        || r.teamName.toLowerCase().includes(q)
        || r.pos.toLowerCase().includes(q)
        || String(r.nfl || '').toLowerCase().includes(q);
    });
  }
  return rows.sort((a, b) => {
    if (_scoutPortfolioPlayersState.filter === 'elite') return (a.posRank || 99) - (b.posRank || 99) || b.val - a.val;
    return b.commandScore - a.commandScore || b.val - a.val;
  });
}

function _scoutPlayerCommandLabel(row) {
  if (row.isMe) return 'My roster';
  if (row.fitsNeed && row.ownerSurplus) return 'Need + surplus';
  if (row.fitsNeed) return 'Need fit';
  if (row.ownerSurplus) return 'Owner surplus';
  if (row.elite) return 'Elite';
  return 'Monitor';
}

function _scoutPlayerCommandRow(row) {
  const safePid = _scoutAttr(row.pid);
  const safeRid = _scoutAttr(row.rosterId);
  const label = _scoutPlayerCommandLabel(row);
  const action = row.isMe
    ? `openPlayerModal('${safePid}')`
    : `openTradeBuilderForOpponentPlayer('${safePid}','${safeRid}')`;
  return `<div class="scout-player-command-row">
    <button class="scout-player-command-main" onclick="openPlayerModal('${safePid}')">
      <span class="scout-player-pos">${_esc(row.pos)}</span>
      <span class="scout-player-name">
        <strong>${_esc(row.name)}</strong>
        <small>${_esc(row.teamName)}${row.nfl ? ' · ' + _esc(row.nfl) : ''}${row.age ? ' · ' + _esc(row.age) : ''}</small>
      </span>
      <span class="scout-player-value">${Math.round(row.val).toLocaleString()}</span>
    </button>
    <div class="scout-player-command-side">
      <span class="${row.fitsNeed ? 'fit' : row.elite ? 'elite' : row.ownerSurplus ? 'surplus' : ''}">${_esc(label)}</span>
      <button onclick="event.stopPropagation();${action}">${row.isMe ? 'Card' : 'Trade'}</button>
    </div>
  </div>`;
}

function _scoutPortfolioPlayerCommand(allRows, activeNeeds) {
  const state = _scoutPortfolioPlayersState;
  if (!allRows.length) {
    if (window._activeTab === 'portfolio' && _scoutPortfolioPlayerRetry < 6) {
      _scoutPortfolioPlayerRetry++;
      setTimeout(() => {
        if (window._activeTab === 'portfolio') renderPortfolioPanel();
      }, 1200);
    }
    return `<section class="scout-section-card scout-player-command">
      <div class="scout-section-head">
        <div><span class="scout-kicker">Player Command</span><h2>Every rostered player across the league</h2></div>
      </div>
      <div class="scout-empty-card" style="margin:0">
        <div class="scout-empty-title">Loading player market</div>
        <div class="scout-empty-body">Scout is waiting for DHQ values and roster data before ranking the league-wide player board.</div>
      </div>
    </section>`;
  }
  _scoutPortfolioPlayerRetry = 0;
  const filtered = _scoutPlayerCommandFilteredRows(allRows);
  const top = filtered.slice(0, 18);
  const posOptions = ['', ...SCOUT_POS_ORDER.filter(pos => allRows.some(r => r.pos === pos))];
  const filterOptions = [
    ['fit', 'Need Fits'],
    ['elite', 'Elite'],
    ['mine', 'Mine'],
    ['all', 'All']
  ];
  const topFit = allRows.filter(r => r.fitsNeed && !r.isMe).sort((a, b) => b.commandScore - a.commandScore)[0];
  const read = topFit
    ? `Best immediate market fit: ${topFit.name} from ${topFit.teamName} (${topFit.pos}, ${Math.round(topFit.val).toLocaleString()} DHQ).`
    : activeNeeds.length
      ? `No clean rostered fit found yet for ${activeNeeds.slice(0, 3).join(', ')}. Search the board or use League Intel.`
      : 'No urgent need filter is active, so start with elite assets or all players.';

  return `<section class="scout-section-card scout-player-command">
    <div class="scout-section-head">
      <div><span class="scout-kicker">Player Command</span><h2>Every rostered player across the league</h2></div>
      <button class="scout-secondary-btn" onclick="fillGlobalChat('Scan the Player Command board and tell me the best 5 players to acquire, who owns them, and what type of offer to build.')">Scan</button>
    </div>
    <div class="scout-player-command-read">${_esc(read)}</div>
    <div class="scout-player-command-controls">
      <input value="${_scoutAttr(state.query)}" placeholder="Search player, team, owner..." oninput="scoutPortfolioPlayerSearch(this.value)">
      <div class="scout-player-filter-row">
        ${filterOptions.map(([key, label]) => `<button class="${state.filter === key ? 'active' : ''}" onclick="scoutPortfolioPlayerFilter('${key}')">${label}</button>`).join('')}
      </div>
      <div class="scout-player-pos-row">
        ${posOptions.map(pos => `<button class="${state.pos === pos ? 'active' : ''}" onclick="scoutPortfolioPlayerPos('${pos}')">${pos || 'All Pos'}</button>`).join('')}
      </div>
    </div>
    <div class="scout-player-command-meta">
      <span>${filtered.length.toLocaleString()} shown</span>
      <span>${allRows.length.toLocaleString()} rostered valued players</span>
      <span>${allRows.filter(r => r.fitsNeed && !r.isMe).length.toLocaleString()} fit your needs</span>
    </div>
    <div class="scout-player-command-list">
      ${top.length ? top.map(row => _scoutPlayerCommandRow(row)).join('') : `<div class="scout-empty-card" style="margin:0">No players match this command view.</div>`}
    </div>
  </section>`;
}

function scoutPortfolioPlayerFilter(filter) {
  _scoutPortfolioPlayersState.filter = filter || 'fit';
  renderPortfolioPanel();
}
window.scoutPortfolioPlayerFilter = scoutPortfolioPlayerFilter;

function scoutPortfolioPlayerPos(pos) {
  _scoutPortfolioPlayersState.pos = _scoutPortfolioPlayersState.pos === pos ? '' : (pos || '');
  renderPortfolioPanel();
}
window.scoutPortfolioPlayerPos = scoutPortfolioPlayerPos;

function scoutPortfolioPlayerSearch(query) {
  _scoutPortfolioPlayersState.query = query || '';
  renderPortfolioPanel();
}
window.scoutPortfolioPlayerSearch = scoutPortfolioPlayerSearch;

function _scoutPortfolioOpenLeague(idx) {
  const entry = window._scoutPortfolioRegistry?.[idx];
  if (entry && typeof window.loadRegistryLeague === 'function') window.loadRegistryLeague(entry);
  else if (typeof mobileTab === 'function') mobileTab('digest');
}
window.scoutPortfolioOpenLeague = _scoutPortfolioOpenLeague;

function renderPortfolioPanel() {
  const host = document.getElementById('panel-portfolio-content');
  const S = window.S || {};
  if (!host) return;
  const registry = typeof window.getLeagueRegistry === 'function' ? window.getLeagueRegistry() : [];
  const roster = typeof myR === 'function' ? myR() : null;
  const league = _scoutCurrentLeague();
  if (!S.user || (!roster && !S.currentLeagueId)) {
    host.innerHTML = `<div class="scout-command-shell scout-portfolio-empty-state">
      <section class="scout-portfolio-hero scout-portfolio-connect-state">
        <div class="scout-portfolio-hero-main">
          <div class="scout-kicker">League Portfolio</div>
          <h1>Connect a league before using Portfolio.</h1>
          <p>Portfolio becomes useful after Scout can compare your active leagues, saved ideas, rookie picks, and next decisions.</p>
          <div class="scout-portfolio-hero-actions">
            <button class="scout-primary-btn" onclick="mobileTab('digest')">Connect League</button>
            <button class="scout-secondary-btn" onclick="fillGlobalChat('What should I connect first in Scout?')">Ask Scout</button>
          </div>
        </div>
      </section>
      <section class="scout-section-card scout-connect-preview">
        <div class="scout-section-head">
          <div><span class="scout-kicker">After connecting</span><h2>Your portfolio will show real league priorities.</h2></div>
        </div>
        <div class="scout-action-list">
          <div class="scout-connect-preview-row"><strong>Priority queue</strong><span>Which league needs action first.</span></div>
          <div class="scout-connect-preview-row"><strong>Saved work</strong><span>Trades, waivers, mock drafts, and rookie tags.</span></div>
          <div class="scout-connect-preview-row"><strong>League stack</strong><span>Fast switching with team context intact.</span></div>
        </div>
      </section>
    </div>`;
    return;
  }
  const activeAssessment = roster ? _scoutAssessment(roster.roster_id) : null;
  const activeNeeds = (activeAssessment?.needs || []).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);
  const commandNeeds = activeNeeds.slice(0, 3);
  const activeStrengths = activeAssessment?.strengths || [];
  const activePicks = roster ? _scoutPicksForRoster(roster.roster_id) : [];
  const leagueRows = _scoutLeagueRowsForPortfolio(registry, league, roster, activeAssessment);
  const activeRow = leagueRows.find(r => r.isActive) || leagueRows[0] || null;
  const artifacts = _scoutPortfolioArtifacts(S.currentLeagueId);
  const playerCommandRows = _scoutPlayerCommandRows(commandNeeds, activeStrengths);
  const topPriority = leagueRows[0] || null;
  const tradeCount = artifacts.trades.length;
  const waiverCount = Math.max(artifacts.faTargets.length, artifacts.waiverLog.length);
  const mockCount = artifacts.mocks.length;
  const savedWorkCount = tradeCount + waiverCount + mockCount + artifacts.tagTotal;
  const activePickValue = activePicks.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
  const portfolioRead = topPriority
    ? `${topPriority.intent} in ${topPriority.leagueName || 'your active league'}${topPriority.needs?.length ? `; pressure rooms: ${topPriority.needs.slice(0, 3).join(', ')}` : ''}.`
    : 'Connect a league and Scout will turn your leagues into one operating board.';

  const actionQueue = [];
  if (S.user && roster) {
    actionQueue.push({
      title: activeNeeds.length ? `Fix ${activeNeeds.slice(0, 2).join(', ')}` : 'Review title path',
      sub: `${_scoutTeamName(roster)} · ${league?.name || 'Active league'}`,
      action: "mobileTab('team')"
    });
    actionQueue.push({
      title: 'Check trade market',
      sub: activeAssessment?.window ? `${activeAssessment.window} window · partner fit matters` : 'Partner DNA and acceptance odds',
      action: "mobileTab('trades')"
    });
    if (activePicks.length) {
      actionQueue.push({
        title: 'Map rookie draft leverage',
        sub: `${activePicks.length} picks · ${Math.round(activePicks.reduce((s, p) => s + (p.value || 0), 0)).toLocaleString()} DHQ bank`,
        action: "mobileTab('draftroom')"
      });
    }
  }
  if (!actionQueue.length) {
    actionQueue.push({ title: 'Connect a league', sub: 'Your portfolio becomes useful once Scout can see teams and leagues.', action: "mobileTab('digest')" });
  }

  host.innerHTML = `<div class="scout-command-shell">
    <section class="scout-portfolio-hero">
      <div class="scout-portfolio-hero-main">
        <div class="scout-kicker">League Portfolio</div>
        <h1>One command center for every league, saved idea, and next move.</h1>
        <p>${_esc(portfolioRead)}</p>
        <div class="scout-portfolio-hero-actions">
          <button class="scout-primary-btn" onclick="${topPriority ? topPriority.action : "mobileTab('digest')"}">${_esc(topPriority?.intent || 'Connect League')}</button>
          <button class="scout-secondary-btn" onclick="fillGlobalChat('Compare every league in my Scout portfolio. Tell me where I should spend time first, what decision matters most, and what saved work I should revisit.')">Ask Scout</button>
        </div>
      </div>
      <div class="scout-portfolio-command-tile">
        <span>Attention</span>
        <strong>${topPriority ? Math.round(topPriority.urgency) : '—'}</strong>
        <small>${topPriority ? _esc(topPriority.leagueName || 'Active league') : 'No league data'}</small>
      </div>
    </section>

    <section class="scout-portfolio-kpi-grid">
      <button onclick="mobileTab('team')">
        <span>Active Roster</span>
        <strong>${activeRow?.health != null ? activeRow.health : '—'}</strong>
        <small>${activeRow?.powerRank ? `#${activeRow.powerRank}/${activeRow.totalTeams || ''} power` : activeAssessment?.tier || 'health loading'}</small>
      </button>
      <button onclick="mobileTab('draftroom')">
        <span>Draft Bank</span>
        <strong>${Math.round(activePickValue).toLocaleString()}</strong>
        <small>${activePicks.length} picks in range</small>
      </button>
      <button onclick="mobileTab('fieldlog')">
        <span>Saved Work</span>
        <strong>${savedWorkCount}</strong>
        <small>${artifacts.pendingSync ? `${artifacts.pendingSync} pending sync` : 'ready for War Room'}</small>
      </button>
      <button onclick="mobileTab('tools')">
        <span>Workspaces</span>
        <strong>6</strong>
        <small>trade, waivers, mock, board, intel</small>
      </button>
    </section>

    <section class="scout-portfolio-grid">
      <div class="scout-section-card scout-portfolio-span">
        <div class="scout-section-head">
          <div><span class="scout-kicker">Priority Queue</span><h2>What deserves attention first</h2></div>
          <button class="scout-secondary-btn" onclick="fillGlobalChat('Build my cross-league priority queue from the Portfolio screen.')">Rank</button>
        </div>
        <div class="scout-action-list">
          ${actionQueue.concat(leagueRows.slice(0, 3).map(row => ({
            title: row.intent,
            sub: `${row.teamName || 'Team'} · ${row.leagueName || 'League'}${row.needs?.length ? ' · needs ' + row.needs.slice(0, 2).join(', ') : ''}`,
            action: row.action
          }))).slice(0, 5).map(item => `<button class="scout-action-row" onclick="${item.action}">
            <span><strong>${_esc(item.title)}</strong><small>${_esc(item.sub)}</small></span>
            <em>Open</em>
          </button>`).join('')}
        </div>
      </div>

      <div class="scout-section-card">
        <div class="scout-section-head">
          <div><span class="scout-kicker">Saved Artifacts</span><h2>Ideas worth bringing back</h2></div>
          <button class="scout-secondary-btn" onclick="mobileTab('fieldlog')">Log</button>
        </div>
        <div class="scout-artifact-grid">
          ${_scoutArtifactCard('trade', 'Trade options', String(tradeCount), tradeCount ? (artifacts.trades[0]?.text || 'saved packages') : 'save packages from Trade Studio', "mobileTab('trades')", 'Trade')}
          ${_scoutArtifactCard('waiver', 'Bid board', String(waiverCount), artifacts.faTargets.length ? `$${artifacts.plannedFaab} planned FAAB` : 'saved waiver targets', "mobileTab('waivers')", 'Waivers')}
          ${_scoutArtifactCard('mock', 'Mock drafts', String(mockCount), mockCount ? `${(artifacts.mocks[0]?.picks || []).length} picks in latest` : 'run and save draft paths', "mobileTab('draftroom')", 'Mock')}
          ${_scoutArtifactCard('rookie', 'Rookie tags', String(artifacts.tagTotal), `${artifacts.tagCounts.trade || 0} targets · ${artifacts.tagCounts.untouchable || 0} priorities`, "openRookieBigBoard()", 'Board')}
        </div>
      </div>
    </section>

    ${_scoutPortfolioPlayerCommand(playerCommandRows, commandNeeds)}

    <section class="scout-section-card">
      <div class="scout-section-head">
        <div><span class="scout-kicker">League Stack</span><h2>Switch context with the operating picture intact</h2></div>
        <button class="scout-secondary-btn" onclick="mobileTab('digest')">Add</button>
      </div>
      <div class="scout-portfolio-list">
        ${leagueRows.length ? leagueRows.map(entry => {
          const label = entry.platform ? entry.platform.toUpperCase() : 'LEAGUE';
          const healthTone = entry.health == null ? 'neutral' : entry.health >= 70 ? 'good' : entry.health >= 50 ? 'warn' : 'bad';
          const urgencyPct = Math.min(100, Math.max(8, entry.urgency));
          return `<button class="scout-portfolio-row${entry.isActive ? ' active' : ''}" onclick="${entry.action}">
            <span>
              <strong>${_esc(entry.leagueName || 'League')}</strong>
              <small>${_esc(entry.teamName || (entry.isActive && roster ? _scoutTeamName(roster) : 'Tap to sync'))} · ${_esc(entry.intent)} · synced ${_esc(entry.syncedAgo)}</small>
            </span>
            <div class="scout-portfolio-row-meta">
              <i class="${healthTone}">${entry.health != null ? entry.health : '—'}</i>
              <b>${entry.powerRank ? '#' + entry.powerRank : label}</b>
              <em>${entry.isActive ? 'Active' : label}</em>
            </div>
            <div class="scout-portfolio-urgency"><i style="width:${urgencyPct}%"></i></div>
          </button>`;
        }).join('') : `<div class="scout-empty-card" style="margin:0">No connected leagues yet.</div>`}
      </div>
    </section>

    <section class="scout-portfolio-grid">
      <div class="scout-section-card">
        <div class="scout-section-head">
          <div><span class="scout-kicker">Active League Dossier</span><h2>${_esc(activeRow?.leagueName || league?.name || 'Active league')}</h2></div>
        </div>
        <div class="scout-dossier-stack">
          <div><span>Team</span><strong>${_esc(activeRow?.teamName || (roster ? _scoutTeamName(roster) : 'Not loaded'))}</strong></div>
          <div><span>Window</span><strong>${_esc(activeAssessment?.window || activeAssessment?.tier || activeRow?.tier || 'Unknown')}</strong></div>
          <div><span>Needs</span><strong>${_esc(activeNeeds.slice(0, 4).join(', ') || 'None flashing')}</strong></div>
          <div><span>Surplus</span><strong>${_esc((activeAssessment?.strengths || []).slice(0, 4).join(', ') || 'Balanced')}</strong></div>
        </div>
      </div>

      <div class="scout-section-card">
        <div class="scout-section-head">
          <div><span class="scout-kicker">Depth Access</span><h2>Every deep module stays one tap away</h2></div>
        </div>
        <div class="scout-inline-actions scout-inline-actions-two">
          <button onclick="mobileTab('league')">League Intel</button>
          <button onclick="mobileTab('fieldlog')">Field Log</button>
          <button onclick="mobileTab('tools')">Tool Library</button>
          <button onclick="mobileTab('team')">Team Command</button>
          <button onclick="mobileTab('trades')">Trade Studio</button>
          <button onclick="mobileTab('waivers')">Waiver Bench</button>
        </div>
      </div>
    </section>
  </div>`;
}
window.renderPortfolioPanel = renderPortfolioPanel;

// ════════════════════════════════════════════════════════════════
// FIELD LOG
// ════════════════════════════════════════════════════════════════

const FL_KEY = 'scout_field_log_v1';

function getFieldLog() {
  try { return JSON.parse(localStorage.getItem(FL_KEY) || '[]'); }
  catch { return []; }
}

function _saveFieldLog(log) {
  try { localStorage.setItem(FL_KEY, JSON.stringify((log || []).slice(0, 200))); }
  catch {}
}

function mergeFieldLogEntries(remoteEntries) {
  if (!Array.isArray(remoteEntries) || !remoteEntries.length) return 0;
  const local = getFieldLog();
  const byId = new Map();
  local.forEach(e => { if (e?.id) byId.set(e.id, e); });
  let changed = 0;
  remoteEntries.forEach(entry => {
    if (!entry?.id) return;
    const prev = byId.get(entry.id);
    if (!prev) {
      byId.set(entry.id, entry);
      changed++;
      return;
    }
    const merged = { ...prev, ...entry, syncStatus: entry.syncStatus || prev.syncStatus };
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      byId.set(entry.id, merged);
      changed++;
    }
  });
  if (changed) {
    const mergedLog = [...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    _saveFieldLog(mergedLog);
  }
  return changed;
}

let _fieldLogRemoteRefreshInFlight = false;
async function refreshFieldLogFromRemote(leagueId) {
  if (_fieldLogRemoteRefreshInFlight || !window.OD?.loadFieldLog) return 0;
  _fieldLogRemoteRefreshInFlight = true;
  try {
    const remote = await window.OD.loadFieldLog(leagueId || window.S?.currentLeagueId || null, 100);
    const changed = mergeFieldLogEntries(remote);
    if (changed) {
      renderFieldLogCard();
      renderFieldLogPanel();
    }
    return changed;
  } catch {
    return 0;
  } finally {
    _fieldLogRemoteRefreshInFlight = false;
  }
}
window.refreshFieldLogFromRemote = refreshFieldLogFromRemote;

// meta = { actionType, players: [{id,name}], context, leagueId }
function addFieldLogEntry(icon, text, category, meta) {
  meta = meta || {};
  const log = getFieldLog();
  const entry = {
    id: 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    icon: icon || '📋',
    text,
    category: category || 'note',
    ts: Date.now(),
    actionType: meta.actionType || null,
    players: meta.players || [],
    context: meta.context || null,
    leagueId: meta.leagueId || window.S?.currentLeagueId || null,
    syncStatus: 'pending',
  };
  log.unshift(entry);
  localStorage.setItem(FL_KEY, JSON.stringify(log.slice(0, 50)));
  renderFieldLogCard();
  // Fire-and-forget sync to Supabase
  if (window.OD?.saveFieldLogEntry) {
    window.OD.saveFieldLogEntry(entry).then(() => renderFieldLogCard()).catch(() => {});
  }
}
window.addFieldLogEntry = addFieldLogEntry;

// Bulk sync pending entries; called on app load
async function syncFieldLog() {
  // Tier gate — Field Log sync requires paid
  if (typeof canAccess === 'function' && !canAccess(window.FEATURES?.FIELD_LOG_SYNC || 'field_log_sync')) {
    if (typeof showUpgradePrompt === 'function') showUpgradePrompt(window.FEATURES?.FIELD_LOG_SYNC || 'field_log_sync');
    return;
  }
  if (!window.OD?.syncPendingFieldLog) return;
  const btn = document.getElementById('fieldlog-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  await window.OD.syncPendingFieldLog();
  await refreshFieldLogFromRemote();
  renderFieldLogCard();
  renderFieldLogPanel();
  if (btn) { btn.disabled = false; btn.textContent = '↑ Sync to War Room'; }
}
window.syncFieldLog = syncFieldLog;

function _relativeTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000)    return 'Just now';
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

// Card on Home tab
function renderFieldLogCard() {
  const container = document.getElementById('field-log-entries-home');
  if (!container) return;
  const log = getFieldLog();

  if (!log.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:6px 0">No activity yet. Your moves will appear here.</div>';
    return;
  }

  const pendingCount = log.filter(e => e.syncStatus === 'pending' || e.syncStatus === 'failed').length;
  const syncBadge = pendingCount > 0
    ? `<span style="font-size:11px;color:var(--text3)">${pendingCount} pending sync</span>`
    : `<span class="field-log-sync-badge">Synced to War Room</span>`;

  container.innerHTML = log.slice(0, 3).map(e =>
    `<div class="field-log-entry">
      <span class="field-log-icon">${e.icon}</span>
      <span class="field-log-text">${_esc(e.text)}</span>
      <span class="field-log-time">${_relativeTime(e.ts)}</span>
    </div>`
  ).join('') + `<div style="margin-top:6px">${syncBadge}</div>`;
}
window.renderFieldLogCard = renderFieldLogCard;

const FL_CATEGORY_LABELS = {
  trade: '🔄 Trade', roster: '📋 Roster', draft: '🎯 Draft',
  waivers: '📡 Waivers', research: '🔍 Research', note: '📝 Note',
};

// ── Activity panel helpers ────────────────────────────────────

function _modeLabel(mode) {
  const labels = { rebuild: 'Rebuild', balanced_rebuild: 'Balanced Rebuild', contend: 'Contend', win_now: 'Win Now' };
  return labels[mode] || mode || 'current';
}

function _describeConflict(c) {
  if (c.reasons?.length) return c.reasons[0];
  if (c.type) return `${c.type}${c.position ? ' ' + c.position : ''} move conflicts with plan`;
  return 'Action conflicts with strategy';
}

function _getDayKey(ts) {
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const t = todayStart.getTime();
  if (ts >= t) return 'Today';
  if (ts >= t - 86400000) return 'Yesterday';
  if (ts >= t - 6 * 86400000) return 'This Week';
  return new Date(ts).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}

function _getEntryAlignment(entry) {
  if (!window.GMStrategy?.checkAlignment) return null;
  if (!entry.actionType || entry.actionType === 'note' || entry.actionType === 'scout') return null;
  const player = entry.players?.[0];
  if (!player) return null;
  const isAcquire = /waiver|acquire/.test(entry.actionType || '');
  const action = {
    type: entry.category || entry.actionType,
    playerId: player.id,
    position: player.pos || null,
    direction: isAcquire ? 'acquire' : 'sell',
  };
  const result = window.GMStrategy.checkAlignment(action);
  if (result.alignment === 'aligned')   return { type: 'aligned',   label: '✓ Aligned' };
  if (result.alignment === 'partial')   return { type: 'partial',   label: '~ Partial' };
  if (result.alignment === 'conflicts') return { type: 'conflicts', label: '✗ Conflicts' };
  return null;
}

function _getTradeFrequency(log) {
  const cutoff = Date.now() - 14 * 86400000;
  const n = log.filter(e => (e.actionType === 'trade' || e.category === 'trade') && e.ts >= cutoff).length;
  if (n >= 4) return 'Active';
  if (n >= 2) return 'Moderate';
  return 'Conservative';
}

function _getFaabStyle(log) {
  const cutoff = Date.now() - 14 * 86400000;
  const n = log.filter(e => (e.actionType === 'waiver' || e.category === 'waivers') && e.ts >= cutoff).length;
  if (n >= 4) return 'Aggressive';
  if (n >= 2) return 'Moderate';
  return 'Conservative';
}

function _getPositionBias(log) {
  const cutoff = Date.now() - 14 * 86400000;
  const posCounts = {};
  log.filter(e => e.ts >= cutoff).forEach(e => {
    (e.players || []).forEach(p => { if (p.pos) posCounts[p.pos] = (posCounts[p.pos] || 0) + 1; });
  });
  const top = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'Balanced';
}

function _getLastSyncTime(log) {
  const s = log.filter(e => e.syncStatus === 'synced').sort((a, b) => b.ts - a.ts)[0];
  return s ? _relativeTime(s.ts) : 'Never';
}

function _clearDriftWithNote() {
  if (window.GMStrategy?.clearDrift) window.GMStrategy.clearDrift();
  addFieldLogEntry('🎯', 'Staying the course — acknowledged drift, chose to continue.', 'note', {});
  renderFieldLogPanel();
}
window._clearDriftWithNote = _clearDriftWithNote;

// ── Override reason modal ────────────────────────────────────

function showOverrideReasonModal(entryId, actionDesc) {
  const existing = document.getElementById('override-reason-modal');
  if (existing) existing.remove();

  const options = [
    'Short-term win',
    'Injury reaction',
    'Changed my mind',
    'Testing the market',
    'Just a gut feel',
  ];

  const el = document.createElement('div');
  el.id = 'override-reason-modal';
  el.className = 'override-modal-overlay';
  el.innerHTML = `<div class="override-modal-card">
    <div class="override-modal-header">
      <div class="override-modal-title">⚠️ This move conflicts with your strategy.</div>
      <div class="override-modal-sub">Quick note — why this move?</div>
    </div>
    <div class="override-modal-options">
      ${options.map(o => `<button class="override-modal-option" onclick="_selectOverrideReason('${entryId}',${JSON.stringify(o)})">${_esc(o)}</button>`).join('')}
    </div>
    <button class="override-modal-skip" onclick="_closeOverrideModal()">Skip</button>
  </div>`;

  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('override-modal-visible'));
}
window.showOverrideReasonModal = showOverrideReasonModal;

function _selectOverrideReason(entryId, label) {
  const log = getFieldLog();
  const entry = log.find(e => e.id === entryId);
  if (entry) {
    entry.overrideReason = label;
    localStorage.setItem(FL_KEY, JSON.stringify(log));
  }
  _closeOverrideModal();
  renderFieldLogPanel();
  if (typeof window.showToast === 'function') window.showToast('Reason noted — Alex will learn from this.');
}
window._selectOverrideReason = _selectOverrideReason;

function _closeOverrideModal() {
  const el = document.getElementById('override-reason-modal');
  if (!el) return;
  el.classList.remove('override-modal-visible');
  setTimeout(() => el.remove(), 220);
}
window._closeOverrideModal = _closeOverrideModal;

// Phase 7: the log displays only these four action types. Older entries
// (e.g. 'scout', strategy drift acknowledgements) are kept in storage but
// hidden from this view unless explicitly requested.
const FIELD_LOG_VISIBLE_ACTIONS = new Set(['tag','note','mock_saved','trade_option_saved','trade_scenario']);

// Full Activity panel
function renderFieldLogPanel() {
  const container = document.getElementById('panel-fieldlog-content');
  if (!container) return;
  const rawLog = getFieldLog();
  // Filter to the 4 visible action types; fall back to the category field
  // when actionType is missing (for older entries still in localStorage).
  const log = (rawLog || []).filter(e => {
    if (e.actionType && FIELD_LOG_VISIBLE_ACTIONS.has(e.actionType)) return true;
    return false;
  });
  const strategy = window.GMStrategy?.getStrategy ? window.GMStrategy.getStrategy() : {};
  const drift = window.GMStrategy?.getDrift ? window.GMStrategy.getDrift() : { conflicts: [] };
  const hasDrift = window.GMStrategy?.hasDrift ? window.GMStrategy.hasDrift() : false;

  let html = '';

  // ── SECTION 1: STRATEGY DRIFT ──────────────────────────────
  if (hasDrift) {
    const recentConflicts = (drift.conflicts || [])
      .filter(c => Date.now() - c.timestamp < 7 * 86400000);
    const modeLabel = _modeLabel(strategy.mode);
    html += `<div class="activity-drift-card">
      <div class="activity-drift-header">
        <span class="activity-drift-icon">⚠️</span>
        <div>
          <div class="activity-drift-title">STRATEGY DRIFT DETECTED</div>
          <div class="activity-drift-sub">You've made ${recentConflicts.length} move${recentConflicts.length !== 1 ? 's' : ''} that conflict with your ${_esc(modeLabel)} plan.</div>
        </div>
      </div>
      <div class="activity-drift-conflicts">
        ${recentConflicts.map(c => `<div class="activity-drift-item">• ${_esc(_describeConflict(c))}</div>`).join('')}
      </div>
      <div class="activity-drift-actions">
        <button class="activity-drift-btn-primary" onclick="typeof openStrategyEditor==='function'&&openStrategyEditor()">Adjust Strategy</button>
        <button class="activity-drift-btn-secondary" onclick="_clearDriftWithNote()">Stay Course</button>
      </div>
    </div>`;
  }

  // ── SECTION 2: GM INSIGHTS ──────────────────────────────
  const intel = window.GMEngine?.generateFieldIntel ? window.GMEngine.generateFieldIntel() : [];
  const tradeFreq = _getTradeFrequency(log);
  const faabStyle = _getFaabStyle(log);
  const posBias   = _getPositionBias(log);
  const snap = typeof window.buildRosterSnapshot === 'function' ? window.buildRosterSnapshot() : null;
  const rankStr = snap?.leagueRank && snap?.leagueSize ? `#${snap.leagueRank}/${snap.leagueSize}` : '—';
  const dhqStr = snap?.totalDHQ ? snap.totalDHQ.toLocaleString() : '—';

  html += `<div class="activity-learning-section">
    <div class="activity-section-header">
      <span style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em">GM Insights</span>
      <span style="height:1px;flex:1;background:rgba(212,175,55,.15);display:inline-block"></span>
    </div>
    <div class="activity-intel-list">
      ${intel.length
        ? intel.map(obs => `<div class="activity-intel-item">
            <span class="activity-intel-icon">🧠</span>
            <span class="activity-intel-text">${_esc(obs)}</span>
          </div>`).join('')
        : `<div style="font-size:13px;color:var(--text3);padding:8px 0">Make some moves and GM Insights will start mapping your patterns.</div>`
      }
    </div>
    <div class="activity-behavior-profile">
      <div class="activity-profile-title">Behavior Profile</div>
      <div class="activity-profile-grid">
        <div class="activity-profile-stat">
          <div class="activity-profile-label">Trading</div>
          <div class="activity-profile-value">${_esc(tradeFreq)}</div>
        </div>
        <div class="activity-profile-stat">
          <div class="activity-profile-label">FAAB</div>
          <div class="activity-profile-value">${_esc(faabStyle)}</div>
        </div>
        <div class="activity-profile-stat">
          <div class="activity-profile-label">Pos Bias</div>
          <div class="activity-profile-value">${_esc(posBias)}</div>
        </div>
        <div class="activity-profile-stat">
          <div class="activity-profile-label">Rank</div>
          <div class="activity-profile-value">${_esc(rankStr)}</div>
        </div>
        <div class="activity-profile-stat">
          <div class="activity-profile-label">Total DHQ</div>
          <div class="activity-profile-value">${_esc(dhqStr)}</div>
        </div>
      </div>
    </div>
  </div>`;

  // ── SECTION 3: ACTIVITY LOG ───────────────────────────────
  const pendingCount = log.filter(e => e.syncStatus === 'pending' || e.syncStatus === 'failed').length;
  const _syncGated = typeof canAccess === 'function'
    && !canAccess(window.FEATURES?.FIELD_LOG_SYNC || 'field_log_sync');
  const _syncFeat = window.FEATURES?.FIELD_LOG_SYNC || 'field_log_sync';

  html += `<div class="activity-log-section">
    <div class="activity-section-header">
      <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">Activity Log</span>
      <span style="height:1px;flex:1;background:var(--border);display:inline-block"></span>
    </div>`;

  if (!log.length) {
    html += `<div class="fieldlog-empty">
      <div class="fieldlog-empty-icon">📋</div>
      <div class="fieldlog-empty-text">No activity yet.<br>Trade scenarios, waiver bids, and draft targets appear here automatically.</div>
    </div>`;
  } else {
    // Group by smart day label
    const groupOrder = [];
    const groupMap = {};
    log.forEach(e => {
      const key = _getDayKey(e.ts);
      if (!groupMap[key]) { groupMap[key] = []; groupOrder.push(key); }
      groupMap[key].push(e);
    });

    html += groupOrder.map(dayKey => {
      const entries = groupMap[dayKey];
      return `<div style="margin-bottom:16px">
        <div class="activity-date-header">${_esc(dayKey)}</div>
        ${entries.map(e => {
          const timeStr = new Date(e.ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
          const syncDot = e.syncStatus === 'synced'
            ? `<span title="Synced" style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;flex-shrink:0"></span>`
            : e.syncStatus === 'failed'
            ? `<span title="Sync failed" style="width:6px;height:6px;border-radius:50%;background:#E74C3C;display:inline-block;flex-shrink:0"></span>`
            : `<span title="Pending sync" style="width:6px;height:6px;border-radius:50%;background:var(--text3);display:inline-block;flex-shrink:0"></span>`;
          const catLabel = FL_CATEGORY_LABELS[e.category] || e.category;
          const alignment = _getEntryAlignment(e);
          const alignBadge = alignment
            ? `<span class="activity-align-badge activity-align-${alignment.type}">${alignment.label}</span>`
            : '';
          const playersHtml = e.players?.length
            ? `<div style="font-size:11px;color:var(--accent);margin-top:2px">${e.players.map(p => _esc(p.name || p)).join(', ')}</div>`
            : '';
          const overrideHtml = e.overrideReason
            ? `<div class="activity-override-reason">"${_esc(e.overrideReason)}"</div>`
            : '';
          return `<div class="fieldlog-entry">
            <div class="fieldlog-entry-icon">${e.icon}</div>
            <div class="fieldlog-entry-body">
              <div class="fieldlog-entry-title">${_esc(e.text)}</div>
              ${playersHtml}${overrideHtml}
              <div class="fieldlog-entry-meta" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span>${catLabel}</span>
                <span>·</span>
                <span>${timeStr}</span>
                ${alignBadge}
                ${syncDot}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  }

  // Sync footer
  const lastSyncTime = _getLastSyncTime(log);
  html += `<div class="activity-sync-footer">
    ${_syncGated
      ? `<span style="font-size:12px;color:var(--text3)">Local only — sync requires a Scout account</span>
         <button onclick="showUpgradePrompt('${_syncFeat}')" style="padding:5px 12px;background:linear-gradient(135deg,#D4AF37,#e8cc6c);color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">🔒 Unlock</button>`
      : `<span style="font-size:12px;color:var(--text3)">${pendingCount > 0 ? `${pendingCount} pending` : `Synced to War Room · ${lastSyncTime}`}</span>
         <button id="fieldlog-sync-btn" onclick="syncFieldLog()" style="padding:5px 12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;opacity:${pendingCount > 0 ? '1' : '0.5'}">↑ Sync</button>`
    }
  </div>
  </div>`; // close activity-log-section

  container.innerHTML = html;
}
window.renderFieldLogPanel = renderFieldLogPanel;

// ════════════════════════════════════════════════════════════════
// LEAGUE PANEL
// ════════════════════════════════════════════════════════════════

// ── Exploit Targets section (GMEngine-powered) ────────────────
function _renderExploitTargets() {
  const eng = window.GMEngine;
  if (!eng) return '';
  const oppsRaw = eng.generateOpportunities();
  if (!oppsRaw.length || !oppsRaw[0].rosterId) return '';
  const ownerProfiles = window.App?.LI?.ownerProfiles || {};
  const S = window.S;

  // Re-rank by current user's top positional need so the highest-priority
  // match bubbles to the top, then slice to 2 teams.
  const assessFn = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal : null;
  const myAssess = assessFn ? assessFn(S?.myRosterId) : null;
  const myTopNeedRaw = myAssess?.needs?.[0];
  const myTopNeed = typeof myTopNeedRaw === 'string' ? myTopNeedRaw : myTopNeedRaw?.pos;

  const opps = [...oppsRaw].sort((a, b) => {
    if (!myTopNeed) return (b.exploitScore || 0) - (a.exploitScore || 0);
    const aAs = assessFn ? assessFn(a.rosterId) : null;
    const bAs = assessFn ? assessFn(b.rosterId) : null;
    const aHas = (aAs?.strengths || []).some(s => (typeof s === 'string' ? s : s?.pos) === myTopNeed) ? 1 : 0;
    const bHas = (bAs?.strengths || []).some(s => (typeof s === 'string' ? s : s?.pos) === myTopNeed) ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return (b.exploitScore || 0) - (a.exploitScore || 0);
  }).slice(0, 2);

  const teamCards = opps.map((o, i) => {
    const isTop = i === 0;
    const dna = ownerProfiles[o.rosterId]?.dna || '';
    const border = isTop ? 'rgba(212,175,55,.5)' : 'var(--border)';
    const glow = isTop ? ';box-shadow:0 0 14px rgba(212,175,55,.08)' : '';
    const roster = (S?.rosters || []).find(r => r.roster_id === o.rosterId);
    const owner = (S?.leagueUsers || []).find(u => u.user_id === roster?.owner_id);
    const avatarId = owner?.avatar;
    const initials = (o.ownerName || '?').slice(0, 2).toUpperCase();
    const avatarHtml = avatarId
      ? `<img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>`
      : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--text3);flex-shrink:0">${initials}</div>`;
    return `<div style="padding:11px 14px;background:var(--bg2);border:1px solid ${border};border-radius:var(--r);margin-bottom:6px;display:flex;align-items:center;gap:10px${glow}">
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          ${isTop ? '<span style="font-size:11px;font-weight:700;color:var(--accent);padding:1px 5px;border:1px solid rgba(212,175,55,.4);border-radius:8px;text-transform:uppercase;letter-spacing:.04em">BEST TARGET</span>' : ''}
          <span style="font-size:14px;font-weight:700;color:var(--text)">${_esc(o.ownerName)}</span>
          ${dna ? `<span style="font-size:11px;padding:1px 5px;border-radius:8px;background:var(--accentL);color:var(--accent);font-weight:600">${_esc(dna)}</span>` : ''}
        </div>
        <div style="font-size:13px;color:var(--text2);line-height:1.4;font-weight:500">${_esc(o.insight)}</div>
        ${o.exploitScore >= 75 ? '<div style="font-size:11px;color:var(--accent);margin-top:3px;font-weight:700">Move now</div>' : o.exploitScore >= 50 ? '<div style="font-size:11px;color:var(--amber);margin-top:3px;font-weight:600">Good window</div>' : ''}
      </div>
      <button onclick="event.stopPropagation();typeof openTradeBuilder==='function'?openTradeBuilder(${o.rosterId},[],[]):fillGlobalChat(${JSON.stringify('Build me the best trade I can make with ' + o.ownerName)})" style="padding:8px 14px;font-size:12px;font-weight:700;background:var(--accentL);color:var(--accent);border:1px solid rgba(212,175,55,.3);border-radius:7px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Build Trade</button>
    </div>`;
  }).join('');

  // Waiver recommendation card (reuses _getHomeWaiverRec from js/ui.js)
  let waiverCard = '';
  if (typeof window._getHomeWaiverRec === 'function') {
    const rec = window._getHomeWaiverRec();
    if (rec) {
      const wvName = typeof window.pName === 'function' ? window.pName(rec.id) : rec.id;
      const safeName = (wvName || '').replace(/'/g, "\\'");
      waiverCard = `<div style="padding:11px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(52,211,153,.12);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#2ECC71;flex-shrink:0">FA</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:#2ECC71;padding:1px 5px;border:1px solid rgba(52,211,153,.4);border-radius:8px;text-transform:uppercase;letter-spacing:.04em">WAIVER</span>
            <span style="font-size:14px;font-weight:700;color:var(--text)">${_esc(wvName)}</span>
          </div>
          <div style="font-size:13px;color:var(--text2);line-height:1.4">${rec.pos} · ${(rec.val||0).toLocaleString()} DHQ — fits your ${rec.pos} need</div>
        </div>
        <button onclick="event.stopPropagation();fillGlobalChat('Help me claim ${safeName}')" style="padding:8px 14px;font-size:12px;font-weight:700;background:var(--accentL);color:var(--accent);border:1px solid rgba(212,175,55,.3);border-radius:7px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Add</button>
      </div>`;
    }
  }

  return `<div style="margin-bottom:16px">
    <div style="font-size:11px;font-weight:700;color:#F0A500;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
      OPPORTUNITIES <span style="height:1px;flex:1;background:rgba(240,165,0,.2);display:inline-block;margin-left:4px"></span>
    </div>
    ${teamCards}${waiverCard}
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// PHASE 5 v2 — LEAGUE COMMAND CENTER
//
// The League tab is reorganized into a "room switcher" pattern. A slim
// hero strip sits at the top of the tab (with a back chevron when deep
// inside a room). Below it, a three-card command menu (Trades / Waivers
// / All Teams) gives the user live previews and a single clear entry
// point. Tapping a card slides the menu away and slides in one of three
// rooms. Everything under the League tab lives in exactly one room.
// ════════════════════════════════════════════════════════════════

let _leagueRoom = null; // null | 'trades' | 'waivers' | 'teams'

function renderLeaguePanelLegacy() {
  const container = document.getElementById('panel-league-content');
  if (!container) return;
  const S = window.S;

  if (!S || !S.user || !S.rosters?.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3)">
      <div style="font-size:32px;margin-bottom:10px">🏈</div>
      <div style="font-size:14px">Connect your league to see owner intelligence.</div>
    </div>`;
    return;
  }

  // Compose the full command-center shell. Individual rooms are lazy-rendered
  // on first entry so we don't pay the cost upfront.
  const heroHtml = _renderLeagueHero();
  const menuHtml = _renderLeagueCommandMenu();

  container.innerHTML = `
    ${heroHtml}
    <div class="league-rooms-menu" id="league-rooms-menu">
      ${menuHtml}
    </div>
    <div class="league-room" id="league-room-trades" data-room="trades" style="display:none"></div>
    <div class="league-room" id="league-room-waivers" data-room="waivers" style="display:none"></div>
    <div class="league-room" id="league-room-teams" data-room="teams" style="display:none"></div>
  `;

  // Restore last room if persisted
  const restore = sessionStorage.getItem('scout_league_room');
  if (restore === 'trades' || restore === 'waivers' || restore === 'teams') {
    _leagueEnterRoom(restore);
  }
}
window.renderLeaguePanelLegacy = renderLeaguePanelLegacy;

// ── Hero strip — team name, DNA, phase, back chevron ──────────
function _renderLeagueHero() {
  const S = window.S;
  const myR_ = (S.rosters || []).find(r => r.roster_id === S.myRosterId);
  const owner = (S.leagueUsers || []).find(u => u.user_id === myR_?.owner_id);
  const league = (S.leagues || [])[0] || {};
  const leagueName = league.name || 'League';
  const season = league.season || '';
  const teamName = owner?.metadata?.team_name || owner?.display_name || 'Your Team';
  const avatarId = owner?.avatar;
  const avatarHtml = avatarId
    ? `<img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" class="league-hero-avatar" onerror="this.style.display='none'"/>`
    : `<div class="league-hero-avatar" style="display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--text3);background:var(--bg4)">${_esc((teamName[0] || '?').toUpperCase())}</div>`;

  const w = myR_?.settings?.wins || 0;
  const l = myR_?.settings?.losses || 0;
  const t = myR_?.settings?.ties || 0;
  const recordStr = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;

  const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(S.myRosterId) : null;
  const health = assess?.healthScore ? 'Health ' + Math.round(assess.healthScore) : '';
  const dna = (window.App?.LI?.ownerProfiles || {})[S.myRosterId]?.dna || '';
  const phaseInfo = window.SeasonCalendar?.describe ? window.SeasonCalendar.describe() : null;
  const phaseLabel = phaseInfo?.label || '';

  const metaParts = [dna, health, phaseLabel].filter(Boolean);

  return `
    <div class="league-hero">
      <button class="league-hero-back" id="league-hero-back" style="display:none" onclick="_leagueExitRoom()" aria-label="Back">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      ${avatarHtml}
      <div class="league-hero-body">
        <div class="league-hero-title">${_esc(teamName)} · ${_esc(leagueName)}${season ? ' · ' + _esc(season) : ''}</div>
        <div class="league-hero-meta">${metaParts.length ? _esc(metaParts.join(' · ')) : 'Connect to see details'}</div>
      </div>
      <div class="league-hero-record">${_esc(recordStr)}</div>
    </div>
  `;
}

// ── Three-card command menu ──────────────────────────────────
function _renderLeagueCommandMenu() {
  const S = window.S;
  const cards = [];

  // Card 1 — Trades
  const tradesPreview = _leagueTradesPreview();
  cards.push(`
    <button class="league-command-card" onclick="_leagueEnterRoom('trades')">
      <div class="lcc-icon">🤝</div>
      <div class="lcc-body">
        <div class="lcc-title">Trades</div>
        <div class="lcc-preview">${_esc(tradesPreview.preview)}</div>
        <div class="lcc-detail">${_esc(tradesPreview.detail)}</div>
      </div>
      <div class="lcc-chev">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </button>
  `);

  // Card 2 — Waivers
  const waiversPreview = _leagueWaiversPreview();
  cards.push(`
    <button class="league-command-card" onclick="_leagueEnterRoom('waivers')">
      <div class="lcc-icon">💰</div>
      <div class="lcc-body">
        <div class="lcc-title">Waivers</div>
        <div class="lcc-preview">${_esc(waiversPreview.preview)}</div>
        <div class="lcc-detail">${_esc(waiversPreview.detail)}</div>
      </div>
      <div class="lcc-chev">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </button>
  `);

  // Card 3 — All Teams
  const teamsPreview = _leagueTeamsPreview();
  cards.push(`
    <button class="league-command-card" onclick="_leagueEnterRoom('teams')">
      <div class="lcc-icon">🏈</div>
      <div class="lcc-body">
        <div class="lcc-title">All Teams</div>
        <div class="lcc-preview">${_esc(teamsPreview.preview)}</div>
        <div class="lcc-detail">${_esc(teamsPreview.detail)}</div>
      </div>
      <div class="lcc-chev">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </button>
  `);

  return cards.join('');
}

// ── Command-card preview helpers (compute short live stats) ──
function _leagueTradesPreview() {
  const S = window.S;
  const partners = _leagueGetPartners();
  if (!partners.length) return { preview: 'Connect a league to see trade partners', detail: '' };
  const top = partners[0];
  const ownerName = top.assessment?.ownerName || 'Team';
  const compat = Math.round(top.compatibility || 0);
  return {
    preview: `${partners.length} partner${partners.length === 1 ? '' : 's'} matched for your needs`,
    detail: `Best fit: ${ownerName} · ${compat}% compat`,
  };
}

function _leagueWaiversPreview() {
  const S = window.S;
  const faab = (typeof window.getFAAB === 'function') ? window.getFAAB() : null;
  const slots = (typeof window.getRosterSlots === 'function') ? window.getRosterSlots() : null;
  const budgetStr = faab?.budget > 0 ? `$${faab.remaining} FAAB` : 'Priority #' + (S.rosters?.find(r => r.roster_id === S.myRosterId)?.settings?.waiver_position || '?');
  const slotsStr = slots?.openBench != null ? `${slots.openBench} open spot${slots.openBench === 1 ? '' : 's'}` : '';
  return {
    preview: [budgetStr, slotsStr].filter(Boolean).join(' · '),
    detail: 'Top 5 targets ranked by fit + value',
  };
}

function _leagueTeamsPreview() {
  const S = window.S;
  const n = S.rosters?.length || 0;
  const assessFn = typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal : null;
  if (!assessFn) return { preview: `${n} teams`, detail: 'Connect for tier breakdown' };
  const all = assessFn() || [];
  const contenders = all.filter(a => (a.tier || '').toUpperCase() === 'CONTENDER' || (a.tier || '').toUpperCase() === 'ELITE').length;
  const rebuilding = all.filter(a => (a.tier || '').toUpperCase() === 'REBUILDING').length;
  // Most active trader from LI.tradeHistory
  const history = window.App?.LI?.tradeHistory || [];
  const tradeCounts = {};
  history.forEach(t => (t.roster_ids || []).forEach(rid => { tradeCounts[rid] = (tradeCounts[rid] || 0) + 1; }));
  const topTraderRid = Object.entries(tradeCounts).sort((a, b) => b[1] - a[1])[0];
  let activeDetail = '';
  if (topTraderRid) {
    const r = (S.rosters || []).find(x => String(x.roster_id) === String(topTraderRid[0]));
    const owner = r ? (S.leagueUsers || []).find(u => u.user_id === r.owner_id) : null;
    const name = owner?.metadata?.team_name || owner?.display_name || 'Unknown';
    activeDetail = `Most active trader: ${name} · ${topTraderRid[1]} trade${topTraderRid[1] === 1 ? '' : 's'}`;
  }
  return {
    preview: `${n} teams · ${contenders} contender${contenders === 1 ? '' : 's'} · ${rebuilding} rebuilding`,
    detail: activeDetail || 'Tap to scout any team',
  };
}

// Shared helper — computes top 3 partners, cached per render
function _leagueGetPartners() {
  const S = window.S;
  if (!S?.rosters?.length || !S?.myRosterId) return [];
  let myAssess = window._tcMyAssessment;
  let allAssess = window._tcAssessments;
  if ((!myAssess || !allAssess || !allAssess.length) && typeof window.assessAllTeamsFromGlobal === 'function') {
    allAssess = window.assessAllTeamsFromGlobal();
    myAssess = (allAssess || []).find(a => a.rosterId === S.myRosterId);
    window._tcAssessments = allAssess;
    window._tcMyAssessment = myAssess;
  }
  if (!myAssess || !allAssess?.length) return [];
  return typeof window.findBestPartners === 'function'
    ? window.findBestPartners(myAssess, allAssess).slice(0, 3)
    : [];
}

// ── Room switching ────────────────────────────────────────────
function _leagueEnterRoom(room) {
  _leagueRoom = room;
  try { sessionStorage.setItem('scout_league_room', room); } catch (e) {}
  const menu = document.getElementById('league-rooms-menu');
  const target = document.getElementById('league-room-' + room);
  const back = document.getElementById('league-hero-back');
  if (!menu || !target) return;

  // Render the room body on every entry (fast — these are just DOM inserts)
  if (room === 'trades')  _renderLeagueRoomTrades(target);
  if (room === 'waivers') _renderLeagueRoomWaivers(target);
  if (room === 'teams')   _renderLeagueRoomTeams(target);

  menu.classList.add('hiding');
  setTimeout(() => { menu.style.display = 'none'; }, 180);
  target.style.display = '';
  // Force layout, then add .active for the slide-in animation
  requestAnimationFrame(() => target.classList.add('active'));
  if (back) back.style.display = '';
}
window._leagueEnterRoom = _leagueEnterRoom;

function _leagueExitRoom() {
  const current = _leagueRoom;
  _leagueRoom = null;
  try { sessionStorage.removeItem('scout_league_room'); } catch (e) {}
  if (current) {
    const target = document.getElementById('league-room-' + current);
    if (target) {
      target.classList.remove('active');
      setTimeout(() => { target.style.display = 'none'; }, 200);
    }
  }
  const menu = document.getElementById('league-rooms-menu');
  if (menu) {
    menu.classList.remove('hiding');
    menu.style.display = '';
  }
  const back = document.getElementById('league-hero-back');
  if (back) back.style.display = 'none';
}
window._leagueExitRoom = _leagueExitRoom;

// ── Trades room ────────────────────────────────────────────────
function _renderLeagueRoomTrades(host) {
  const S = window.S;
  if (!host || !S?.rosters?.length) { if (host) host.innerHTML = ''; return; }
  const partners = _leagueGetPartners();
  const ownerProfiles = window.App?.LI?.ownerProfiles || {};

  let html = `<div class="league-room-header">
    <div class="league-room-title">Trades · ${partners.length} partner${partners.length === 1 ? '' : 's'}</div>
    <button class="league-room-action" onclick="event.stopPropagation();typeof openTradeBuilder==='function'?openTradeBuilder(null,[],[]):fillGlobalChat('Help me build a trade')">+ Build from scratch</button>
  </div>`;

  if (!partners.length) {
    html += '<div style="padding:20px;color:var(--text3);font-size:13px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);text-align:center">No partners identified yet. Give the engine a moment to analyze rosters.</div>';
    host.innerHTML = html;
    return;
  }

  // Hero partner card (big, gold-accented)
  const top = partners[0];
  const topA = top.assessment;
  const topRid = topA.rosterId;
  const topOwner = (S.leagueUsers || []).find(u => u.user_id === S.rosters.find(r => r.roster_id === topRid)?.owner_id);
  const topAvatarId = topOwner?.avatar;
  const topAvatar = topAvatarId
    ? `<img src="https://sleepercdn.com/avatars/thumbs/${topAvatarId}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>`
    : `<div style="width:52px;height:52px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:var(--text3);flex-shrink:0">${_esc((topA.ownerName || '?').slice(0, 2).toUpperCase())}</div>`;
  const topDna = ownerProfiles[topRid]?.dna || '';
  const topCompat = Math.round(top.compatibility || 0);
  const topTheyProvide = (top.theyProvide || []).join(', ');
  const topIProvide = (top.iProvide || []).join(', ');
  const topWhy = topTheyProvide && topIProvide
    ? `They have ${topTheyProvide}, need your ${topIProvide}`
    : topTheyProvide
    ? `Has ${topTheyProvide} depth you need`
    : topIProvide
    ? `Needs ${topIProvide} — you have the supply`
    : 'Roster fit for a 2-for-2 swap';

  html += `<div style="padding:16px;background:rgba(212,175,55,.06);border:2px solid rgba(212,175,55,.5);border-radius:var(--rl);margin-bottom:12px;box-shadow:0 4px 20px rgba(212,175,55,.12)">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      ${topAvatar}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-size:11px;font-weight:700;color:var(--accent);padding:2px 6px;border:1px solid rgba(212,175,55,.4);border-radius:8px;text-transform:uppercase;letter-spacing:.04em">BEST FIT</span>
          ${topDna ? `<span style="font-size:11px;padding:2px 6px;border-radius:8px;background:var(--accentL);color:var(--accent);font-weight:600">${_esc(topDna)}</span>` : ''}
          <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${topCompat}% compat</span>
        </div>
        <div style="font-size:16px;font-weight:800;color:var(--text);letter-spacing:-.02em">${_esc(topA.ownerName || 'Team ' + topRid)}</div>
      </div>
    </div>
    <div style="font-size:14px;color:var(--text2);line-height:1.5;margin-bottom:12px">${_esc(topWhy)}</div>
    <button onclick="typeof openTradeBuilder==='function'?openTradeBuilder(${topRid},[],[]):fillGlobalChat('Build a trade with ${_esc(topA.ownerName || '').replace(/'/g, "\\'")}')" style="width:100%;padding:12px;font-size:14px;font-weight:800;background:linear-gradient(135deg,var(--accent),#e8cc6c);color:var(--bg1);border:none;border-radius:10px;cursor:pointer;font-family:inherit;box-shadow:0 2px 10px rgba(212,175,55,.3)">Build Trade with ${_esc(topA.ownerName || 'Them')}</button>
  </div>`;

  // Secondary partners (compact)
  partners.slice(1).forEach(part => {
    const a = part.assessment;
    const rid = a.rosterId;
    const owner = (S.leagueUsers || []).find(u => u.user_id === S.rosters.find(r => r.roster_id === rid)?.owner_id);
    const avatarId = owner?.avatar;
    const avatarHtml = avatarId
      ? `<img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>`
      : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--text3);flex-shrink:0">${_esc((a.ownerName || '?').slice(0, 2).toUpperCase())}</div>`;
    const dna = ownerProfiles[rid]?.dna || '';
    const compatPct = Math.round(part.compatibility || 0);
    const theyProvide = (part.theyProvide || []).join(', ');
    const iProvide = (part.iProvide || []).join(', ');
    const why = theyProvide && iProvide
      ? `They have ${theyProvide}, need your ${iProvide}`
      : theyProvide
      ? `Has ${theyProvide} depth you need`
      : iProvide
      ? `Needs ${iProvide} — you have the supply`
      : 'Roster fit for a swap';
    html += `<div style="padding:11px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;display:flex;align-items:center;gap:10px">
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700;color:var(--text)">${_esc(a.ownerName || 'Team ' + rid)}</span>
          ${dna ? `<span style="font-size:11px;padding:1px 5px;border-radius:8px;background:var(--accentL);color:var(--accent);font-weight:600">${_esc(dna)}</span>` : ''}
          <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${compatPct}%</span>
        </div>
        <div style="font-size:12px;color:var(--text2);line-height:1.4">${_esc(why)}</div>
      </div>
      <button onclick="typeof openTradeBuilder==='function'?openTradeBuilder(${rid},[],[]):fillGlobalChat('Build a trade with ${_esc(a.ownerName || '').replace(/'/g, "\\'")}')" style="padding:8px 14px;font-size:12px;font-weight:700;background:var(--accentL);color:var(--accent);border:1px solid rgba(212,175,55,.3);border-radius:7px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Build</button>
    </div>`;
  });

  // Trade Finder inline expand
  html += `<div style="margin-top:16px">
    <button onclick="_openTradeFinder()" style="width:100%;padding:12px;font-size:13px;font-weight:700;background:var(--bg2);color:var(--accent);border:1px dashed rgba(212,175,55,.4);border-radius:10px;cursor:pointer;font-family:inherit">🔍 Launch Trade Finder</button>
    <div id="league-trade-finder-host" style="margin-top:12px"></div>
  </div>`;

  host.innerHTML = html;
}

// Trade Finder inline expand (reuses renderTradeFinder from trade-calc.js)
function _openTradeFinder() {
  const finderHost = document.getElementById('league-trade-finder-host');
  if (!finderHost) return;
  if (finderHost.innerHTML.trim()) { finderHost.innerHTML = ''; return; }
  if (!window._tcAssessments?.length && typeof window.assessAllTeamsFromGlobal === 'function') {
    window._tcAssessments = window.assessAllTeamsFromGlobal();
    window._tcMyAssessment = (window._tcAssessments || []).find(a => a.rosterId === window.S?.myRosterId);
  }
  if (typeof window.renderTradeFinder === 'function') {
    try { window.renderTradeFinder(finderHost); } catch (e) { console.warn('[scout] renderTradeFinder failed:', e); }
  }
}
window._openTradeFinder = _openTradeFinder;

// ── Waivers room ───────────────────────────────────────────────
function _renderLeagueRoomWaivers(host) {
  if (!host) return;
  const S = window.S;
  const faab = typeof window.getFAAB === 'function' ? window.getFAAB() : null;
  const budgetStr = faab?.budget > 0 ? `$${faab.remaining} FAAB` : 'Priority #' + (S.rosters?.find(r => r.roster_id === S.myRosterId)?.settings?.waiver_position || '?');

  // Inject the waivers host. The existing #panel-waivers in the DOM is moved
  // here on first render so renderWaivers can keep finding its mount points.
  host.innerHTML = `<div class="league-room-header">
    <div class="league-room-title">Waivers · ${_esc(budgetStr)}</div>
  </div>
  <div id="league-waivers-mount"></div>`;

  const mount = document.getElementById('league-waivers-mount');
  const waiversPanel = document.getElementById('panel-waivers');
  if (mount && waiversPanel && waiversPanel.children.length) {
    while (waiversPanel.firstChild) mount.appendChild(waiversPanel.firstChild);
  }
  // Ensure FAAB bar + Workbench mount exist (may be lost on re-render)
  if (mount && !document.getElementById('waiver-workbench')) {
    if (!document.getElementById('faab-bar')) {
      const fb = document.createElement('div'); fb.id = 'faab-bar'; fb.style.marginBottom = '12px';
      mount.appendChild(fb);
    }
    const wb = document.createElement('div'); wb.id = 'waiver-workbench';
    mount.appendChild(wb);
    const at = document.createElement('div'); at.id = 'waiver-alex-top5'; at.style.display = 'none';
    mount.appendChild(at);
  }
  if (typeof window.renderWaivers === 'function') {
    try { window.renderWaivers(); } catch (e) { console.warn('[scout] renderWaivers failed:', e); }
  }
}

// ── All Teams room ─────────────────────────────────────────────
function _renderLeagueRoomTeams(host) {
  if (!host) return;
  const S = window.S;
  const myId = S.myRosterId;
  const assessFn = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal : null;
  const ownerProfiles = window.App?.LI?.ownerProfiles || {};

  const enriched = (S.rosters || []).map(roster => {
    const owner = (S.leagueUsers || []).find(u => u.user_id === roster.owner_id);
    const assess = assessFn ? assessFn(roster.roster_id) : null;
    const dna = ownerProfiles[roster.roster_id];
    return { roster, owner, assess, dna };
  });

  // Sort: me last, then by health score desc
  enriched.sort((a, b) => {
    if (a.roster.roster_id === myId) return 1;
    if (b.roster.roster_id === myId) return -1;
    const ha = a.assess?.healthScore || 0;
    const hb = b.assess?.healthScore || 0;
    if (hb !== ha) return hb - ha;
    return (b.roster.settings?.wins || 0) - (a.roster.settings?.wins || 0);
  });

  const hasDivisions = enriched.some(t => t.roster?.settings?.division > 0);
  const isLarge = enriched.length > 24;

  let html = `<div class="league-room-header">
    <div class="league-room-title">All Teams · ${enriched.length}</div>
    ${isLarge ? '<button class="league-room-action" onclick="_leagueToggleTeamsSearch()">🔍 Search</button>' : ''}
  </div>
  ${isLarge ? '<div id="league-teams-search" style="display:none;margin-bottom:10px"><input type="text" placeholder="Search teams..." oninput="_leagueTeamsFilter(this.value)" style="width:100%;padding:10px 14px;font-size:13px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:inherit;outline:none"></div>' : ''}`;

  if (hasDivisions) {
    const divGroups = {};
    enriched.forEach(item => {
      const divNum = item.roster?.settings?.division || 0;
      if (!divGroups[divNum]) divGroups[divNum] = [];
      divGroups[divNum].push(item);
    });
    const divKeys = Object.keys(divGroups).sort((a, b) => Number(a) - Number(b));
    const leagueMeta = (S.leagues && S.leagues[0]?.metadata) || {};
    divKeys.forEach(divNum => {
      const divName = leagueMeta['division_' + divNum] || leagueMeta['division_' + divNum + '_name'] || ('Division ' + divNum);
      html += `<div style="font-size:11px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:14px 0 6px;border-bottom:1px solid rgba(212,175,55,0.15);margin-top:8px">${_esc(divName)}</div>`;
      html += '<div class="league-teams-grid">';
      divGroups[divNum].forEach((item, idx) => {
        html += _buildLeagueTeamCardMini(item, idx, myId);
      });
      html += '</div>';
    });
  } else {
    html += '<div class="league-teams-grid">';
    enriched.forEach((item, idx) => {
      html += _buildLeagueTeamCardMini(item, idx, myId);
    });
    html += '</div>';
  }

  // Team dossier slot — populated when a mini card is tapped
  html += '<div id="league-team-dossier" style="margin-top:14px"></div>';

  host.innerHTML = html;
}

// ── Mini team card for the All Teams grid ─────────────────────
function _buildLeagueTeamCardMini({ roster, owner, assess, dna }, idx, myId) {
  const teamName = owner?.metadata?.team_name || owner?.display_name || `Team ${idx + 1}`;
  const w = roster.settings?.wins || 0;
  const l = roster.settings?.losses || 0;
  const t = roster.settings?.ties || 0;
  const isMe = roster.roster_id === myId;
  const recordStr = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;

  const tier = (assess?.tier || '').toUpperCase();
  const hs = assess?.healthScore || 0;
  const tierCol = tier === 'ELITE' ? 'var(--green)'
    : tier === 'CONTENDER' ? 'var(--accent)'
    : tier === 'CROSSROADS' ? 'var(--amber)'
    : tier === 'REBUILDING' ? 'var(--red)'
    : 'var(--text3)';
  const needs = (assess?.needs || []).slice(0, 2).map(n => typeof n === 'string' ? n : n.pos).filter(Boolean);

  const avatarId = owner?.avatar;
  const avatarHtml = avatarId
    ? `<img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>`
    : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--text3);flex-shrink:0">${_esc((teamName[0] || '?').toUpperCase())}</div>`;

  const rid = roster.roster_id;
  return `<button class="league-team-card-mini${isMe ? ' league-team-card-me' : ''}" data-team-name="${_esc(teamName)}" onclick="_leagueOpenTeamDossier(${rid})">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(teamName)}${isMe ? ' <span style="color:var(--accent);font-size:11px">YOU</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text3)">${recordStr}${hs ? ' · <span style="color:' + tierCol + ';font-weight:700">' + hs + '</span>' : ''}</div>
      </div>
    </div>
    ${needs.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${needs.map(p => `<span style="font-size:11px;font-weight:700;padding:2px 6px;border-radius:8px;background:var(--bg4);color:var(--text3)">${_esc(p)}</span>`).join('')}</div>` : ''}
  </button>`;
}

// Open a full dossier view for a team (uses the existing _buildLeagueCard body)
function _leagueOpenTeamDossier(rosterId) {
  const S = window.S;
  const roster = (S.rosters || []).find(r => r.roster_id === rosterId);
  if (!roster) return;
  const owner = (S.leagueUsers || []).find(u => u.user_id === roster.owner_id);
  const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(rosterId) : null;
  const dna = (window.App?.LI?.ownerProfiles || {})[rosterId];
  const host = document.getElementById('league-team-dossier');
  if (!host) return;
  // Scroll the dossier into view after render
  const wrapper = _buildLeagueCard({ roster, owner, assess, dna }, 0, S.myRosterId);
  host.innerHTML = `<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(212,175,55,.2)">
    <div style="font-size:11px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Team dossier</div>
    ${wrapper}
  </div>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Auto-expand the dossier
  setTimeout(() => {
    if (typeof window.toggleLeagueDossier === 'function') window.toggleLeagueDossier(rosterId);
  }, 200);
}
window._leagueOpenTeamDossier = _leagueOpenTeamDossier;

// Toggle search input in the teams room
function _leagueToggleTeamsSearch() {
  const el = document.getElementById('league-teams-search');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
  if (el.style.display === '') {
    const inp = el.querySelector('input');
    if (inp) inp.focus();
  }
}
window._leagueToggleTeamsSearch = _leagueToggleTeamsSearch;

function _leagueTeamsFilter(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('.league-team-card-mini').forEach(card => {
    const name = (card.dataset.teamName || '').toLowerCase();
    card.style.display = !q || name.includes(q) ? '' : 'none';
  });
}
window._leagueTeamsFilter = _leagueTeamsFilter;

function _buildLeagueCard({ roster, owner, assess, dna }, idx, myId) {
    const teamName = owner?.metadata?.team_name || owner?.display_name || `Team ${idx + 1}`;
    const w = roster.settings?.wins || 0;
    const l = roster.settings?.losses || 0;
    const t = roster.settings?.ties || 0;
    const isMe = roster.roster_id === myId;

    // Tier + health
    const tier = (assess?.tier || '').toUpperCase();
    const hs = assess?.healthScore || 0;
    const tierCol = tier === 'ELITE' ? 'var(--green)' : tier === 'CONTENDER' ? 'var(--accent)' : tier === 'CROSSROADS' ? 'var(--amber)' : tier === 'REBUILDING' ? 'var(--red)' : 'var(--text3)';

    // Owner DNA
    const dnaLabel = dna?.dna || '';
    const needs = (assess?.needs || []).slice(0, 2).map(n => typeof n === 'string' ? n : n.pos).join(', ');

    // Build top players for this roster — show up to 8, sorted by DHQ (show all if no DHQ data)
    // Strategy target positions for alignment highlights
    const _strat = window.GMStrategy?.getStrategy ? window.GMStrategy.getStrategy() : {};
    const _stratTargetPos = _strat.targetPositions || [];

    const rosterPlayers = (roster.players || [])
      .map(pid => ({ pid, name: window.pName?.(pid) || pid, val: window.App?.LI?.playerScores?.[pid] || 0, pos: window.pPos?.(pid) || '?' }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 8);
    const strengthList = (assess?.strengths || []).slice(0, 2).map(s => typeof s === 'string' ? s : s.pos).join(', ');

    // Portfolio value (total DHQ)
    const portfolioVal = (roster.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);

    // Trade compatibility — does this team need what I have / have what I need?
    const _assessFn = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal : null;
    const myAssess = myId ? (_assessFn ? _assessFn(myId) : null) : null;
    const myNeeds = (myAssess?.needs || []).slice(0, 3).map(n => typeof n === 'string' ? n : n.pos);
    const myStrengths = (myAssess?.strengths || []).slice(0, 3).map(s => typeof s === 'string' ? s : s.pos);
    const theirStrengths = (assess?.strengths || []).slice(0, 3).map(s => typeof s === 'string' ? s : s.pos);
    const theirNeeds = (assess?.needs || []).slice(0, 3).map(n => typeof n === 'string' ? n : n.pos);
    const iCanGet = myNeeds.filter(pos => theirStrengths.includes(pos));
    const theyWant = theirNeeds.filter(pos => myStrengths.includes(pos));
    const tradeMatch = !isMe && (iCanGet.length > 0 || theyWant.length > 0);

    // Owner avatar
    const avatarId = owner?.avatar;
    const avatarHtml = avatarId
      ? `<img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>`
      : `<div style="width:28px;height:28px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--text3);flex-shrink:0">${_esc((teamName[0] || '?').toUpperCase())}</div>`;

    const prompt = `Give me a full scouting report on ${teamName}. Include their roster strengths, weaknesses, trade tendencies, and how I can exploit them.`;
    const rid = roster.roster_id;
    return `<div class="league-card-wrap" id="lc-${rid}">
    <div class="league-card${isMe ? ' league-card-me' : ''}" onclick="toggleLeagueDossier('${rid}')">
      ${avatarHtml}
      <div class="league-card-body">
        <div class="league-card-name">${_esc(teamName)}${isMe ? ' <span style="color:var(--accent);font-size:11px;font-weight:700">YOU</span>' : ''}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
          <span class="league-card-meta">${w}-${l}${t > 0 ? '-' + t : ''}</span>
          ${hs ? `<span style="font-size:11px;font-weight:700;color:${tierCol};font-family:'JetBrains Mono',monospace">${hs}</span>` : ''}
          ${tier ? `<span style="font-size:11px;font-weight:700;color:${tierCol};text-transform:uppercase;letter-spacing:.04em">${tier}</span>` : ''}
          ${portfolioVal > 0 ? `<span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace">${Math.round(portfolioVal/1000)}k</span>` : ''}
          ${tradeMatch ? `<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:rgba(212,175,55,.15);color:var(--accent);font-weight:700">Trade Match</span>` : ''}
        </div>
        ${dnaLabel || needs ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          ${dnaLabel ? `<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:var(--accentL);color:var(--accent);font-weight:600">${_esc(dnaLabel)}</span>` : ''}
          ${needs ? `<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:var(--bg4);color:var(--text3)">Needs: ${_esc(needs)}</span>` : ''}
        </div>` : ''}
        ${(() => {
          const badges = [];
          // Window badge (CONTENDING/REBUILDING/TRANSITIONING)
          const window_ = (assess?.window || '').toUpperCase();
          if (window_ && window_ !== tier) {
            const winCol = window_ === 'CONTENDING' ? 'var(--green)' : window_ === 'REBUILDING' ? 'var(--red)' : 'var(--amber)';
            badges.push('<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:' + winCol + ';color:#fff;font-weight:700;letter-spacing:.03em;opacity:.85">' + window_ + '</span>');
          }
          // Active Trader badge
          const tradeCount = (window.App?.LI?.tradeHistory || []).filter(t => (t.roster_ids || []).includes(roster.roster_id)).length;
          if (tradeCount >= 3) {
            badges.push('<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:rgba(212,175,55,.15);color:#d4af37;font-weight:700">Active Trader</span>');
          }
          // Panic/Desperate badge
          if ((assess?.panic || 0) >= 3) {
            badges.push('<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:rgba(231,76,60,.15);color:var(--red);font-weight:700">Selling</span>');
          }
          // Top 2 strengths badges
          const strengths = (assess?.strengths || []).slice(0, 2);
          strengths.forEach(s => {
            const posLabel = typeof s === 'string' ? s : s.pos;
            if (posLabel) badges.push('<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:rgba(52,211,153,.15);color:var(--green);font-weight:600">' + _esc(posLabel) + '</span>');
          });
          return badges.length ? '<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">' + badges.join('') + '</div>' : '';
        })()}
      </div>
      ${!isMe ? `<button onclick="event.stopPropagation();openTradeBuilder(${rid})" style="font-size:11px;font-weight:700;color:var(--accent);background:var(--accentL);border:1px solid rgba(212,175,55,.25);border-radius:8px;padding:4px 10px;cursor:pointer;font-family:inherit;flex-shrink:0;white-space:nowrap">Build Trade</button>` : ''}
      <div class="league-card-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
    </div>
    <div class="league-dossier" id="dossier-${rid}" style="display:none;padding:10px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:0 0 var(--r) var(--r);margin-top:-7px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">SCOUTING REPORT</div>
      ${rosterPlayers.length ? `<div style="margin-bottom:8px">${rosterPlayers.map(p => {
        const isTarget = !isMe && _stratTargetPos.includes(p.pos);
        return `<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:12px;border-radius:6px;transition:background .15s${isTarget ? ';background:rgba(212,175,55,.06)' : ''}" onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background='${isTarget ? 'rgba(212,175,55,.06)' : 'transparent'}'">
          <span onclick="event.stopPropagation();openPlayerModal('${p.pid}')" style="color:var(--text);font-weight:600;flex:1;cursor:pointer">${_esc(p.name)}</span>
          <span style="color:var(--accent);font-size:11px;font-weight:700">${p.pos}</span>
          ${isTarget ? '<span style="font-size:11px;font-weight:700;color:var(--accent);padding:1px 4px;border:1px solid rgba(212,175,55,.4);border-radius:6px;letter-spacing:.03em">TARGET</span>' : ''}
          <span style="color:var(--text3);font-family:'JetBrains Mono',monospace;font-size:11px">${p.val > 0 ? p.val.toLocaleString() : '—'}</span>
          ${!isMe ? `<button onclick="event.stopPropagation();openTradeBuilderForOpponentPlayer('${p.pid}','${rid}')" style="font-size:11px;font-weight:700;color:var(--accent);background:var(--accentL);border:none;border-radius:5px;padding:2px 6px;cursor:pointer;font-family:inherit;flex-shrink:0">Trade</button>` : ''}
        </div>`;
      }).join('')}</div>` : ''}
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
        ${strengthList ? `<span style="font-size:11px;padding:2px 6px;border-radius:8px;background:rgba(52,211,153,.1);color:var(--green)">Strong: ${_esc(strengthList)}</span>` : ''}
        ${needs ? `<span style="font-size:11px;padding:2px 6px;border-radius:8px;background:rgba(248,113,113,.1);color:var(--red)">Weak: ${_esc(needs)}</span>` : ''}
        ${portfolioVal > 0 ? `<span style="font-size:11px;padding:2px 6px;border-radius:8px;background:var(--bg4);color:var(--text3)">Portfolio: ${portfolioVal.toLocaleString()} DHQ</span>` : ''}
      </div>
      ${tradeMatch ? `<div style="padding:6px 8px;background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.15);border-radius:8px;margin-bottom:8px;font-size:12px;line-height:1.5">
        ${iCanGet.length ? `<div style="color:var(--green)">They have <strong>${iCanGet.join(', ')}</strong> you need</div>` : ''}
        ${theyWant.length ? `<div style="color:var(--accent)">They need <strong>${theyWant.join(', ')}</strong> you can trade</div>` : ''}
      </div>` : ''}
      <button onclick="event.stopPropagation();fillGlobalChat(${JSON.stringify(prompt).replace(/'/g, "\\'")})" style="width:100%;padding:8px;font-size:12px;font-weight:600;background:var(--accentL);color:var(--accent);border:1px solid rgba(212,175,55,.2);border-radius:8px;cursor:pointer;font-family:inherit">Ask Scout about ${_esc(teamName)}</button>
    </div>
    </div>`;
}
window.renderLeaguePanelLegacy = renderLeaguePanelLegacy;

function toggleLeagueDossier(rid) {
  const el = document.getElementById('dossier-' + rid);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  // Close all others
  document.querySelectorAll('.league-dossier').forEach(d => d.style.display = 'none');
  if (!isOpen) el.style.display = '';
}
window.toggleLeagueDossier = toggleLeagueDossier;

function filterLeagueCards(query) {
  const wraps = document.querySelectorAll('.league-card-wrap');
  const q = (query || '').toLowerCase();
  wraps.forEach(wrap => {
    const name = (wrap.querySelector('.league-card-name')?.textContent || '').toLowerCase();
    wrap.style.display = !q || name.includes(q) ? '' : 'none';
  });
}
window.filterLeagueCards = filterLeagueCards;

// ════════════════════════════════════════════════════════════════
// SCOUT LEAGUE INTEL HQ
//
// A mobile-first intelligence workspace. This intentionally does not replace
// Trade Studio or Waiver Workbench; it answers the layer above them: who is
// movable, who has leverage, what each owner needs, and where Scout should dig.
// ════════════════════════════════════════════════════════════════

const _leagueIntelState = { filter: 'all', query: '', dossier: null };

function renderLeagueIntelPanel() {
  const host = document.getElementById('panel-league-content');
  if (!host) return;
  const S = window.S || {};

  if (!S.user || !(S.rosters || []).length) {
    host.innerHTML = _scoutEmpty(
      'Connect a league',
      'Scout needs rosters, owner profiles, trade history, picks, and FAAB before League Intel becomes useful.',
      'Back to Today',
      "mobileTab('digest')"
    );
    return;
  }

  try { sessionStorage.removeItem('scout_league_room'); } catch {}

  const rows = _leagueIntelRows();
  const me = rows.find(r => r.isMe) || null;
  const opponents = rows.filter(r => !r.isMe);
  const best = opponents.slice().sort((a, b) => (b.fit || 0) - (a.fit || 0) || (b.health || 0) - (a.health || 0))[0] || null;
  const topTrader = opponents.slice().sort((a, b) => (b.tradeCount || 0) - (a.tradeCount || 0) || (b.fit || 0) - (a.fit || 0))[0] || null;
  const pickLeader = rows.slice().sort((a, b) => (b.pickValue || 0) - (a.pickValue || 0))[0] || null;
  const faabLeader = rows.slice().sort((a, b) => (b.faab.remaining || 0) - (a.faab.remaining || 0))[0] || null;
  const contenders = rows.filter(r => ['ELITE', 'CONTENDER'].includes(r.tier)).length;
  const rebuilders = rows.filter(r => r.tier === 'REBUILDING' || r.postureKey === 'SELLER').length;
  const marketRead = _leagueIntelMarketRead(rows, me, best);

  host.innerHTML = `<div class="league-intel-hq">
    <section class="league-intel-hero">
      <div>
        <div class="scout-kicker">League Intel</div>
        <h1>Read the room before you make the move.</h1>
        <p>${_esc(marketRead.body)}</p>
      </div>
      <div class="league-intel-hero-actions">
        ${best ? `<button class="scout-primary-btn" onclick="leagueIntelBuildTrade('${_leagueIntelRid(best.rosterId)}')">Build with ${_esc(best.shortName)}</button>` : ''}
        <button class="scout-secondary-btn" onclick="leagueIntelAsk('league')">Ask Scout</button>
      </div>
    </section>

    <section class="league-intel-kpis">
      ${_leagueIntelKpi('Best partner', best ? best.shortName : 'None yet', best ? `${Math.round(best.fit)}% fit, ${best.postureLabel}` : 'Waiting on roster analysis', 'accent')}
      ${_leagueIntelKpi('League shape', `${contenders}/${rows.length}`, `${contenders} contenders, ${rebuilders} sellers`, contenders >= Math.ceil(rows.length / 2) ? 'warn' : 'neutral')}
      ${_leagueIntelKpi('Trade pulse', topTrader ? `${topTrader.tradeCount}` : '0', topTrader ? `${topTrader.shortName} on file` : 'No completed trades found', topTrader?.tradeCount ? 'good' : 'neutral')}
      ${_leagueIntelKpi('Pick leverage', pickLeader ? pickLeader.shortName : 'None', pickLeader ? `${Math.round(pickLeader.pickValue).toLocaleString()} pick DHQ` : 'No future picks found', pickLeader?.isMe ? 'good' : 'accent')}
    </section>

    <section class="league-intel-grid">
      <div class="league-intel-card">
        <div class="league-intel-card-head"><span>Market Map</span><em>${opponents.length} owners</em></div>
        <div class="league-intel-market-list">
          ${opponents.slice().sort((a, b) => (b.fit || 0) - (a.fit || 0)).slice(0, 4).map(row => _leagueIntelMarketRow(row)).join('') || _leagueIntelEmpty('No trade fits yet.')}
        </div>
      </div>
      <div class="league-intel-card">
        <div class="league-intel-card-head"><span>Leverage</span><em>${me ? me.shortName : 'You'}</em></div>
        ${_leagueIntelLeverage(me, pickLeader, faabLeader)}
      </div>
      <div class="league-intel-card">
        <div class="league-intel-card-head"><span>Position Pressure</span><em>Needs vs supply</em></div>
        ${_leagueIntelPressure(rows, me)}
      </div>
    </section>

    <section class="league-intel-board">
      <div class="league-intel-board-head">
        <div>
          <span class="scout-kicker">Owner Board</span>
          <h2>Every team, every angle, one tap to a dossier.</h2>
        </div>
        <button class="scout-secondary-btn" onclick="mobileTab('trades')">Trade Studio</button>
      </div>
      <div class="league-intel-controls">
        <input id="league-intel-search" type="search" value="${_leagueIntelAttr(_leagueIntelState.query)}" placeholder="Search owner, team, need, DNA..." oninput="leagueIntelSearch(this.value)">
        <div class="league-intel-filter-row">
          ${[
            ['all', 'All'],
            ['fit', 'Trade fits'],
            ['active', 'Active'],
            ['contender', 'Contenders'],
            ['seller', 'Sellers'],
          ].map(([key, label]) => `<button data-filter-key="${key}" class="${_leagueIntelState.filter === key ? 'active' : ''}" onclick="leagueIntelSetFilter('${key}')">${label}</button>`).join('')}
        </div>
      </div>
      <div class="league-owner-list" id="league-owner-list">
        ${rows.map(row => _leagueIntelOwnerCard(row, me)).join('')}
      </div>
      <div class="league-intel-no-results" id="league-intel-no-results" style="display:none">No owner matches this view.</div>
    </section>
  </div>`;

  setTimeout(_leagueIntelApplyFilters, 0);
}
window.renderLeaguePanel = renderLeagueIntelPanel;

function _leagueIntelRows() {
  const S = window.S || {};
  const myId = String(S.myRosterId || '');
  const profiles = window.App?.LI?.ownerProfiles || window.LI?.ownerProfiles || {};
  const allAssessments = _scoutAllAssessments();
  const assessById = {};
  (allAssessments || []).forEach(a => { assessById[String(a.rosterId)] = a; });
  const myAssessment = assessById[myId] || _scoutAssessment(S.myRosterId);
  const partnerMap = {};
  if (myAssessment) {
    let partners = [];
    if (typeof window.findBestPartners === 'function') {
      partners = window.findBestPartners(myAssessment, allAssessments.length ? allAssessments : (S.rosters || []).map(r => assessById[String(r.roster_id)] || _scoutAssessment(r.roster_id)).filter(Boolean)) || [];
    }
    partners.forEach(p => { if (p?.assessment?.rosterId != null) partnerMap[String(p.assessment.rosterId)] = p; });
  }

  const rows = (S.rosters || []).map((roster, idx) => {
    const rosterId = roster.roster_id;
    const owner = _scoutOwnerForRoster(roster);
    const assess = assessById[String(rosterId)] || _scoutAssessment(rosterId) || {};
    const profile = profiles[rosterId] || profiles[String(rosterId)] || {};
    const dnaKey = _leagueIntelDnaKey(profile);
    const dna = _leagueIntelDnaLabel(profile, dnaKey);
    const posture = _leagueIntelPosture(assess, dnaKey);
    const tier = String(assess.tier || assess.window || '').toUpperCase() || 'UNKNOWN';
    const teamName = _scoutTeamName(roster);
    const value = _scoutRosterValue(roster);
    const rank = _scoutRankFor(rosterId);
    const faab = _scoutFaab(roster);
    const picks = _scoutPicksForRoster(rosterId);
    const pickValue = picks.reduce((sum, pk) => sum + Number(pk.value || 0), 0);
    const rooms = _scoutRosterRooms(roster, assess);
    const needs = _leagueIntelList(assess.needs, 4);
    const strengths = _leagueIntelList(assess.strengths, 4);
    const partner = partnerMap[String(rosterId)] || null;
    let fit = partner ? Number(partner.compatibility || 0) : 0;
    if (!fit && String(rosterId) !== myId && typeof window.calcComplementarity === 'function') {
      try { fit = window.calcComplementarity(myAssessment, assess) || 0; } catch {}
    }
    if (String(rosterId) === myId) fit = 0;
    const tradeHistory = _leagueIntelTradeHistory(rosterId);
    const players = (roster.players || [])
      .map(pid => ({
        pid: String(pid),
        name: (window.pNameShort?.(pid) || window.pName?.(pid) || String(pid)),
        pos: _scoutNormPos(window.pPos?.(pid) || ''),
        team: window.pTeam?.(pid) || '',
        age: window.pAge?.(pid) || '',
        val: _scoutValue(pid),
      }))
      .filter(p => p.pos)
      .sort((a, b) => (b.val || 0) - (a.val || 0));
    const avgAge = _leagueIntelAverage(players.slice(0, 12).map(p => Number(p.age || 0)).filter(Boolean));
    const tradeCount = tradeHistory.length || Number(profile.tradeCount || profile.trades || 0);
    return {
      roster,
      rosterId,
      owner,
      ownerName: owner?.display_name || owner?.username || `Owner ${idx + 1}`,
      teamName,
      shortName: _leagueIntelShortName(teamName, owner),
      avatar: owner?.avatar || '',
      isMe: String(rosterId) === myId,
      record: _scoutRecord(roster),
      assess,
      rank,
      health: Math.round(Number(assess.healthScore || 0)),
      tier,
      tierLabel: _leagueIntelTierLabel(tier),
      window: String(assess.window || '').toUpperCase(),
      value,
      faab,
      picks,
      pickValue,
      rooms,
      needs,
      strengths,
      players,
      avgAge,
      dnaKey,
      dna,
      posture,
      postureKey: posture?.key || 'NEUTRAL',
      postureLabel: posture?.label || 'Neutral',
      tradeCount,
      tradeHistory,
      fit,
      theyProvide: partner?.theyProvide || needs.filter(pos => strengths.includes(pos)),
      iProvide: partner?.iProvide || [],
    };
  });

  return rows.sort((a, b) => {
    if (a.isMe) return 1;
    if (b.isMe) return -1;
    if ((b.fit || 0) !== (a.fit || 0)) return (b.fit || 0) - (a.fit || 0);
    if ((b.health || 0) !== (a.health || 0)) return (b.health || 0) - (a.health || 0);
    return (b.value || 0) - (a.value || 0);
  });
}

function _leagueIntelKpi(label, value, sub, tone) {
  return `<div class="league-intel-kpi ${tone || 'neutral'}">
    <span>${_esc(label)}</span>
    <strong>${_esc(value)}</strong>
    <small>${_esc(sub || '')}</small>
  </div>`;
}

function _leagueIntelMarketRead(rows, me, best) {
  const myNeeds = me?.needs || [];
  const sellers = rows.filter(r => !r.isMe && (r.postureKey === 'SELLER' || r.tier === 'REBUILDING'));
  const active = rows.filter(r => !r.isMe && r.tradeCount >= 3);
  if (best && best.fit >= 55) {
    const needText = myNeeds.length ? ` Your biggest buying lanes are ${myNeeds.slice(0, 2).join(', ')}.` : '';
    return { body: `${best.shortName} is the cleanest current partner: ${Math.round(best.fit)}% fit, ${best.postureLabel.toLowerCase()} posture, and ${best.tradeCount || 0} trades on file.${needText}` };
  }
  if (sellers.length) {
    return { body: `${sellers.length} team${sellers.length === 1 ? '' : 's'} look sell-side or rebuilding. Start by checking who has surplus at your needs, then build from Trade Studio.` };
  }
  if (active.length) {
    return { body: `${active.length} active trader${active.length === 1 ? '' : 's'} can create liquidity even when the roster fit is imperfect. Scout the owner before valuing the package.` };
  }
  return { body: 'No obvious soft spot yet. Use this board to compare owner posture, roster pressure, pick capital, FAAB, and trade history before opening a deal.' };
}

function _leagueIntelMarketRow(row) {
  const meter = Math.max(4, Math.min(100, Math.round(row.fit || 0)));
  return `<button class="league-intel-market-row" onclick="leagueIntelOpenDossierFromMap('${_leagueIntelRid(row.rosterId)}')">
    <span>
      <strong>${_esc(row.shortName)}</strong>
      <small>${_esc(row.postureLabel)} &middot; ${_esc(row.needs.slice(0, 2).join(', ') || 'no clear needs')}</small>
    </span>
    <em>${Math.round(row.fit || 0)}%</em>
    <i><b style="width:${meter}%"></b></i>
  </button>`;
}

function _leagueIntelLeverage(me, pickLeader, faabLeader) {
  if (!me) return _leagueIntelEmpty('Connect your roster to compare leverage.');
  const pickRank = _leagueIntelOrdinal(_leagueIntelRankBy(_leagueIntelRows(), me.rosterId, 'pickValue'));
  const faabRank = _leagueIntelOrdinal(_leagueIntelRankBy(_leagueIntelRows(), me.rosterId, row => row.faab.remaining));
  const topPick = me.picks[0] ? `${me.picks[0].year} R${me.picks[0].round}` : 'No picks';
  return `<div class="league-intel-leverage">
    <div><span>Your pick bank</span><strong>${Math.round(me.pickValue).toLocaleString()}</strong><small>${pickRank} in league &middot; top ${_esc(topPick)}</small></div>
    <div><span>Your FAAB</span><strong>${me.faab.isFAAB ? '$' + me.faab.remaining : 'Priority'}</strong><small>${faabRank} in league${me.faab.isFAAB ? ' &middot; $' + me.faab.budget + ' budget' : ''}</small></div>
    <div><span>Room pressure</span><strong>${_esc(me.needs.slice(0, 2).join(', ') || 'Stable')}</strong><small>${pickLeader?.isMe ? 'You lead pick leverage' : `Pick leader: ${pickLeader ? _esc(pickLeader.shortName) : 'n/a'}`}</small></div>
    <div><span>Outbid threat</span><strong>${faabLeader?.isMe ? 'You' : _esc(faabLeader?.shortName || 'None')}</strong><small>${faabLeader?.faab?.isFAAB ? '$' + faabLeader.faab.remaining + ' remaining' : 'waiver priority league'}</small></div>
  </div>`;
}

function _leagueIntelPressure(rows, me) {
  const myNeeds = new Set(me?.needs || []);
  const pressure = SCOUT_POS_ORDER.map(pos => {
    const demand = rows.filter(r => !r.isMe && r.needs.includes(pos)).length;
    const supply = rows.filter(r => !r.isMe && r.strengths.includes(pos)).length;
    const mine = myNeeds.has(pos);
    return { pos, demand, supply, mine, score: demand + supply + (mine ? 5 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, 6);
  return `<div class="league-pressure-list">
    ${pressure.map(p => {
      const label = p.mine ? 'Your need' : p.supply > p.demand ? 'Supply' : 'Demand';
      const cls = p.mine ? 'bad' : p.supply > p.demand ? 'good' : 'warn';
      return `<button class="league-pressure-row ${cls}" onclick="leagueIntelSetSearch('${p.pos}')">
        <strong>${p.pos}</strong>
        <span>${p.supply} supply / ${p.demand} demand</span>
        <em>${label}</em>
      </button>`;
    }).join('')}
  </div>`;
}

function _leagueIntelOwnerCard(row, me) {
  const safeRid = _leagueIntelRid(row.rosterId);
  const isOpen = String(_leagueIntelState.dossier) === String(row.rosterId);
  const tierCls = _leagueIntelToneFor(row);
  const needs = row.needs.slice(0, 3);
  const strengths = row.strengths.slice(0, 3);
  const data = [
    row.teamName,
    row.ownerName,
    row.dna,
    row.postureLabel,
    row.tierLabel,
    needs.join(' '),
    strengths.join(' '),
  ].join(' ').toLowerCase();
  return `<div class="league-owner-card-wrap" data-rid="${safeRid}" data-search="${_leagueIntelAttr(data)}" data-filter-fit="${row.fit >= 45 ? '1' : '0'}" data-filter-active="${row.tradeCount >= 3 ? '1' : '0'}" data-filter-contender="${['ELITE', 'CONTENDER'].includes(row.tier) ? '1' : '0'}" data-filter-seller="${row.postureKey === 'SELLER' || row.postureKey === 'DESPERATE' || row.tier === 'REBUILDING' ? '1' : '0'}">
    <button class="league-owner-card ${tierCls}${row.isMe ? ' me' : ''}${isOpen ? ' open' : ''}" onclick="leagueIntelOpenDossier('${safeRid}')">
      ${_leagueIntelAvatar(row)}
      <span class="league-owner-main">
        <strong>${_esc(row.shortName)}${row.isMe ? ' <em>YOU</em>' : ''}</strong>
        <small>${_esc(row.record)} &middot; ${_esc(row.tierLabel)} &middot; ${Math.round(row.value || 0).toLocaleString()} DHQ</small>
        <span class="league-owner-chipline">
          <i>${_esc(row.postureLabel)}</i>
          ${row.dna ? `<i>${_esc(row.dna)}</i>` : ''}
          ${row.tradeCount ? `<i>${row.tradeCount} trades</i>` : ''}
        </span>
      </span>
      <span class="league-owner-score">
        <strong>${row.isMe ? (row.rank?.rank ? '#' + row.rank.rank : '-') : Math.round(row.fit || 0) + '%'}</strong>
        <small>${row.isMe ? _esc(row.rank?.basis || 'rank') : 'fit'}</small>
      </span>
    </button>
    <div class="league-owner-detail-row">
      <span><b>Needs</b>${needs.length ? needs.map(p => `<em class="bad">${_esc(p)}</em>`).join('') : '<em>Stable</em>'}</span>
      <span><b>Has</b>${strengths.length ? strengths.map(p => `<em class="good">${_esc(p)}</em>`).join('') : '<em>Flat</em>'}</span>
      <span><b>Capital</b><em>${row.picks.length} picks</em><em>${row.faab.isFAAB ? '$' + row.faab.remaining : 'Priority'}</em></span>
    </div>
    ${isOpen ? _leagueIntelDossier(row, me) : ''}
  </div>`;
}

function _leagueIntelDossier(row, me) {
  const safeRid = _leagueIntelRid(row.rosterId);
  const myNeeds = new Set(me?.needs || []);
  const targetPlayers = row.players.filter(p => myNeeds.has(p.pos)).slice(0, 4);
  const topPlayers = (targetPlayers.length ? targetPlayers : row.players.slice(0, 4));
  const rooms = row.rooms.slice().sort((a, b) => {
    const at = _scoutStatusTone(a.status);
    const bt = _scoutStatusTone(b.status);
    const score = tone => tone.cls === 'bad' ? 4 : tone.cls === 'warn' ? 3 : tone.cls === 'good' ? 2 : 1;
    return score(bt) - score(at) || (b.value || 0) - (a.value || 0);
  }).slice(0, 6);
  const history = row.tradeHistory.slice(0, 3);
  const fitWhy = _leagueIntelFitWhy(row, me);
  return `<div class="league-owner-dossier">
    <div class="league-dossier-read">
      <div>
        <span>Scout Read</span>
        <p>${_esc(fitWhy)}</p>
      </div>
      <button onclick="event.stopPropagation();leagueIntelAsk('owner','${safeRid}')">Ask</button>
    </div>

    <div class="league-dossier-grid">
      <div class="league-dossier-card">
        <div class="league-dossier-card-head"><span>Assets to study</span><em>${row.players.length} players</em></div>
        ${topPlayers.length ? topPlayers.map(p => `<button class="league-player-target" onclick="event.stopPropagation();openPlayerModal('${_leagueIntelAttr(p.pid)}')">
          <span><strong>${_esc(p.name)}</strong><small>${_esc(p.pos)} ${p.team ? '&middot; ' + _esc(p.team) : ''}${p.age ? ' &middot; age ' + _esc(p.age) : ''}</small></span>
          <em>${p.val ? Math.round(p.val).toLocaleString() : '-'}</em>
        </button>`).join('') : _leagueIntelEmpty('No player data loaded.')}
      </div>
      <div class="league-dossier-card">
        <div class="league-dossier-card-head"><span>Roster rooms</span><em>${row.tierLabel}</em></div>
        <div class="league-room-mini-grid">
          ${rooms.map(room => {
            const tone = _scoutStatusTone(room.status);
            const pct = Math.max(6, Math.min(100, Math.round((room.value || room.count * 500) / Math.max(1, row.value || 1) * 280)));
            return `<div class="league-room-mini ${tone.cls}">
              <strong>${room.pos}</strong>
              <span>${tone.label}</span>
              <i><b style="width:${pct}%"></b></i>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="league-dossier-card">
        <div class="league-dossier-card-head"><span>Picks and FAAB</span><em>${Math.round(row.pickValue).toLocaleString()} DHQ</em></div>
        <div class="league-capital-list">
          <div><span>Future picks</span><strong>${row.picks.length}</strong><small>${row.picks.slice(0, 3).map(_leagueIntelPickLabel).join(', ') || 'none'}</small></div>
          <div><span>FAAB</span><strong>${row.faab.isFAAB ? '$' + row.faab.remaining : 'Priority'}</strong><small>${row.faab.isFAAB ? '$' + row.faab.budget + ' budget' : 'claim order league'}</small></div>
          <div><span>Average core age</span><strong>${row.avgAge ? row.avgAge.toFixed(1) : '-'}</strong><small>top 12 roster assets</small></div>
        </div>
      </div>
      <div class="league-dossier-card">
        <div class="league-dossier-card-head"><span>Trade history</span><em>${row.tradeCount || 0} on file</em></div>
        ${history.length ? history.map(t => `<div class="league-history-row">
          <span><strong>${_esc(t.label)}</strong><small>${_esc(t.other || 'League trade')}</small></span>
          <em class="${t.delta >= 0 ? 'good' : 'bad'}">${t.delta ? (t.delta > 0 ? '+' : '') + Math.round(t.delta).toLocaleString() : 'filed'}</em>
        </div>`).join('') : _leagueIntelEmpty('No completed trade history found.')}
      </div>
    </div>

    <div class="league-dossier-actions">
      ${!row.isMe ? `<button class="scout-primary-btn" onclick="event.stopPropagation();leagueIntelBuildTrade('${safeRid}')">Build Trade</button>` : ''}
      <button class="scout-secondary-btn" onclick="event.stopPropagation();leagueIntelAsk('target','${safeRid}')">Trade Plan</button>
      <button class="scout-secondary-btn" onclick="event.stopPropagation();leagueIntelSetSearch('${_leagueIntelAttr((row.needs[0] || row.strengths[0] || '').replace(/'/g, ''))}')">Find Similar</button>
    </div>
  </div>`;
}

function _leagueIntelFitWhy(row, me) {
  if (row.isMe) {
    return `This is your current team context: ${row.tierLabel}, ${row.record}, ${row.picks.length} future picks, and ${row.faab.isFAAB ? '$' + row.faab.remaining + ' FAAB' : 'waiver priority context'}.`;
  }
  const myNeeds = new Set(me?.needs || []);
  const theirNeeds = new Set(row.needs || []);
  const theyHave = row.strengths.filter(pos => myNeeds.has(pos));
  const theyWant = (me?.strengths || []).filter(pos => theirNeeds.has(pos));
  const parts = [];
  if (theyHave.length) parts.push(`They can solve your ${theyHave.slice(0, 2).join(', ')} pressure.`);
  if (theyWant.length) parts.push(`Your ${theyWant.slice(0, 2).join(', ')} surplus matches their board.`);
  parts.push(`${row.postureLabel} posture with ${row.dna || 'unknown DNA'} means ${_leagueIntelPostureAdvice(row)}.`);
  if (row.picks.length) parts.push(`${row.picks.length} picks give them package flexibility.`);
  return parts.join(' ');
}

function _leagueIntelPostureAdvice(row) {
  if (row.postureKey === 'LOCKED') return 'you should expect a premium and lead with a clear overpay or unique fit';
  if (row.postureKey === 'SELLER') return 'future value, youth, and picks should carry the pitch';
  if (row.postureKey === 'DESPERATE') return 'immediate starters and weekly points can matter more than perfect value';
  if (row.postureKey === 'BUYER') return 'starter upgrades should be framed around title odds';
  if (row.dnaKey === 'FLEECER' || row.dnaKey === 'DOMINATOR') return 'the offer has to let them feel like they won';
  return 'fairness and clear roster logic matter most';
}

function _leagueIntelTradeHistory(rosterId) {
  const S = window.S || {};
  const history = window.App?.LI?.tradeHistory || window.LI?.tradeHistory || [];
  return (history || []).filter(t => _leagueIntelParticipants(t).includes(String(rosterId))).map(t => {
    const participants = _leagueIntelParticipants(t);
    const otherRid = participants.find(id => id !== String(rosterId));
    const otherRoster = (S.rosters || []).find(r => String(r.roster_id) === String(otherRid));
    const other = otherRoster ? _scoutTeamName(otherRoster) : '';
    const week = t.week || t.leg || '';
    const season = t.season || t.year || '';
    const label = [season, week ? 'W' + week : ''].filter(Boolean).join(' ') || (t.status || 'Trade');
    const delta = Number(t.delta || t.valueDelta || t.dhq_delta || t.dhqDelta || t.net || 0);
    return { label, other, delta };
  }).reverse();
}

function _leagueIntelParticipants(trade) {
  const direct = trade?.roster_ids || trade?.rosterIds || trade?.participants || trade?.rosters || [];
  const ids = Array.isArray(direct) ? direct.map(String) : [];
  const adds = trade?.adds && typeof trade.adds === 'object' ? Object.values(trade.adds).map(String) : [];
  const drops = trade?.drops && typeof trade.drops === 'object' ? Object.values(trade.drops).map(String) : [];
  return [...new Set([...ids, ...adds, ...drops])];
}

function _leagueIntelDnaKey(profile) {
  const raw = String(profile?.dnaKey || profile?.key || profile?.type || profile?.dna || 'NONE').toUpperCase().replace(/[^A-Z]/g, '');
  const types = window.DNA_TYPES || window.App?.DNA_TYPES || {};
  if (types[raw]) return raw;
  const match = Object.entries(types).find(([key, val]) => raw.includes(key) || raw.includes(String(val?.label || '').toUpperCase().replace(/[^A-Z]/g, '')));
  return match ? match[0] : 'NONE';
}

function _leagueIntelDnaLabel(profile, key) {
  const raw = String(profile?.dna || profile?.label || '').trim();
  if (raw && raw !== 'NONE' && raw !== '-- Not Set --') return raw;
  const types = window.DNA_TYPES || window.App?.DNA_TYPES || {};
  return key && key !== 'NONE' ? (types[key]?.label || key) : '';
}

function _leagueIntelPosture(assess, dnaKey) {
  if (typeof window.calcOwnerPosture === 'function') {
    try { return window.calcOwnerPosture(assess, dnaKey) || window.App?.POSTURES?.NEUTRAL || { key: 'NEUTRAL', label: 'Neutral' }; } catch {}
  }
  const tier = String(assess?.tier || '').toUpperCase();
  if (tier === 'REBUILDING') return { key: 'SELLER', label: 'Active Seller' };
  if (tier === 'ELITE') return { key: 'LOCKED', label: 'Locked In' };
  if (tier === 'CONTENDER') return { key: 'BUYER', label: 'Active Buyer' };
  return { key: 'NEUTRAL', label: 'Neutral' };
}

function _leagueIntelList(list, limit) {
  return (list || [])
    .map(item => typeof item === 'string' ? item : item?.pos)
    .filter(Boolean)
    .map(_scoutNormPos)
    .filter(Boolean)
    .filter((pos, idx, arr) => arr.indexOf(pos) === idx)
    .slice(0, limit || 4);
}

function _leagueIntelAvatar(row) {
  if (row.avatar) {
    return `<img class="league-owner-avatar" src="https://sleepercdn.com/avatars/thumbs/${_leagueIntelAttr(row.avatar)}" onerror="this.outerHTML='<span class=&quot;league-owner-avatar fallback&quot;>${_leagueIntelAttr((row.shortName || '?').slice(0, 1).toUpperCase())}</span>'">`;
  }
  return `<span class="league-owner-avatar fallback">${_esc((row.shortName || '?').slice(0, 1).toUpperCase())}</span>`;
}

function _leagueIntelToneFor(row) {
  if (row.tier === 'ELITE' || row.tier === 'CONTENDER') return 'good';
  if (row.tier === 'REBUILDING' || row.postureKey === 'SELLER') return 'bad';
  if (row.postureKey === 'DESPERATE' || row.tier === 'CROSSROADS') return 'warn';
  return 'neutral';
}

function _leagueIntelTierLabel(tier) {
  if (!tier || tier === 'UNKNOWN') return 'Unclassified';
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

function _leagueIntelShortName(teamName, owner) {
  const raw = teamName || owner?.display_name || owner?.username || 'Team';
  return raw.length > 22 ? raw.slice(0, 20).trim() + '...' : raw;
}

function _leagueIntelPickLabel(pk) {
  if (!pk) return '';
  return `${pk.year} R${pk.round}${pk.own ? '' : ' acq'}`;
}

function _leagueIntelAverage(vals) {
  if (!vals.length) return 0;
  return vals.reduce((sum, n) => sum + n, 0) / vals.length;
}

function _leagueIntelRankBy(rows, rosterId, keyOrFn) {
  const sorted = rows.slice().sort((a, b) => {
    const av = typeof keyOrFn === 'function' ? keyOrFn(a) : a[keyOrFn];
    const bv = typeof keyOrFn === 'function' ? keyOrFn(b) : b[keyOrFn];
    return Number(bv || 0) - Number(av || 0);
  });
  const idx = sorted.findIndex(r => String(r.rosterId) === String(rosterId));
  return idx >= 0 ? idx + 1 : sorted.length || 0;
}

function _leagueIntelOrdinal(n) {
  if (!n) return '-';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function _leagueIntelRid(rid) {
  return String(rid || '').replace(/[^0-9A-Za-z_-]/g, '');
}

function _leagueIntelAttr(s) {
  return _esc(s == null ? '' : s).replace(/'/g, '&#39;');
}

function _leagueIntelEmpty(text) {
  return `<div class="league-intel-empty">${_esc(text)}</div>`;
}

function leagueIntelSetFilter(filter) {
  _leagueIntelState.filter = filter || 'all';
  document.querySelectorAll('.league-intel-filter-row button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterKey === _leagueIntelState.filter);
  });
  _leagueIntelApplyFilters();
}
window.leagueIntelSetFilter = leagueIntelSetFilter;

function leagueIntelSearch(query) {
  _leagueIntelState.query = query || '';
  _leagueIntelApplyFilters();
}
window.leagueIntelSearch = leagueIntelSearch;

function leagueIntelSetSearch(query) {
  _leagueIntelState.query = query || '';
  const input = document.getElementById('league-intel-search');
  if (input) input.value = _leagueIntelState.query;
  _leagueIntelApplyFilters();
}
window.leagueIntelSetSearch = leagueIntelSetSearch;

function leagueIntelOpenDossier(rosterId) {
  const id = String(rosterId);
  _leagueIntelState.dossier = String(_leagueIntelState.dossier) === id ? null : id;
  renderLeagueIntelPanel();
  setTimeout(() => {
    const esc = window.CSS?.escape ? window.CSS.escape(id) : id.replace(/"/g, '\\"');
    const el = document.querySelector(`.league-owner-card-wrap[data-rid="${esc}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 0);
}
window.leagueIntelOpenDossier = leagueIntelOpenDossier;

function leagueIntelOpenDossierFromMap(rosterId) {
  _leagueIntelState.filter = 'all';
  _leagueIntelState.query = '';
  _leagueIntelState.dossier = String(rosterId);
  renderLeagueIntelPanel();
  setTimeout(() => {
    const id = String(rosterId);
    const esc = window.CSS?.escape ? window.CSS.escape(id) : id.replace(/"/g, '\\"');
    const el = document.querySelector(`.league-owner-card-wrap[data-rid="${esc}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 0);
}
window.leagueIntelOpenDossierFromMap = leagueIntelOpenDossierFromMap;

function leagueIntelBuildTrade(rosterId) {
  const rid = Number(rosterId) || rosterId;
  if (typeof window.openTradeBuilder === 'function') {
    window.openTradeBuilder(rid, [], []);
  } else if (typeof window.mobileTab === 'function') {
    window.mobileTab('trades');
  }
}
window.leagueIntelBuildTrade = leagueIntelBuildTrade;

function leagueIntelAsk(kind, rosterId) {
  const rows = _leagueIntelRows();
  const me = rows.find(r => r.isMe);
  const row = rows.find(r => String(r.rosterId) === String(rosterId));
  let prompt = 'Give me the full League Intel read. Identify the best trade partners, active sellers, teams with pick or FAAB leverage, and the owners I should avoid.';
  if (kind === 'owner' && row) {
    prompt = `Scout ${row.teamName}. Include roster strengths (${row.strengths.join(', ') || 'none'}), needs (${row.needs.join(', ') || 'none'}), owner DNA (${row.dna || 'unknown'}), posture (${row.postureLabel}), trade history (${row.tradeCount || 0} trades), picks (${row.picks.length}), FAAB (${row.faab.isFAAB ? '$' + row.faab.remaining : 'priority league'}), and how I should approach them.`;
  } else if (kind === 'target' && row) {
    prompt = `Build a trade strategy with ${row.teamName}. My needs are ${me?.needs.join(', ') || 'unclear'} and my surplus is ${me?.strengths.join(', ') || 'unclear'}. Their needs are ${row.needs.join(', ') || 'unclear'} and strengths are ${row.strengths.join(', ') || 'unclear'}. Include a realistic opening package, a fair counter, and what not to offer.`;
  }
  if (typeof fillGlobalChat === 'function') fillGlobalChat(prompt);
}
window.leagueIntelAsk = leagueIntelAsk;

function _leagueIntelApplyFilters() {
  const list = document.getElementById('league-owner-list');
  if (!list) return;
  const q = (_leagueIntelState.query || '').toLowerCase().trim();
  const filter = _leagueIntelState.filter || 'all';
  let shown = 0;
  list.querySelectorAll('.league-owner-card-wrap').forEach(card => {
    const hay = (card.dataset.search || '').toLowerCase();
    const matchQuery = !q || hay.includes(q);
    const matchFilter = filter === 'all' || card.dataset['filter' + filter.charAt(0).toUpperCase() + filter.slice(1)] === '1';
    const show = matchQuery && matchFilter;
    card.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  const empty = document.getElementById('league-intel-no-results');
  if (empty) empty.style.display = shown ? 'none' : '';
}

// ════════════════════════════════════════════════════════════════
// MOBILELAB OVERRIDE — handle new tabs
// ════════════════════════════════════════════════════════════════

// Wait for ui.js to define mobileTab, then wrap it
function _patchMobileTab() {
  const original = window.mobileTab;
  if (!original) {
    setTimeout(_patchMobileTab, 50);
    return;
  }

  window.mobileTab = function(tab, btn) {
    window._activeTab = tab;
    renderCtxChips(tab);

    if (tab === 'league' || tab === 'fieldlog') {
      // Handle new tabs directly
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      if (btn) {
        btn.classList.add('active');
      } else {
        const idMap = { league: 'mnav-portfolio', fieldlog: 'mnav-portfolio' };
        const el = document.getElementById(idMap[tab]);
        if (el) el.classList.add('active');
      }
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + tab);
      if (panel) panel.classList.add('active');

      if (tab === 'league')    window.renderLeaguePanel();
      if (tab === 'fieldlog')  renderFieldLogPanel();
    } else {
      // Call the original pre-patch mobileTab (which calls switchTab for panel activation)
      original(tab, btn);
      if (tab === 'digest') renderWarRoomBrief();
      // Always sync v4 nav active state (original uses old nav IDs that no longer exist)
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      if (btn) {
        btn.classList.add('active');
      } else {
        const newMap = { digest:'mnav-home', team:'mnav-team', tools:'mnav-tools', portfolio:'mnav-portfolio', draftroom:'mnav-tools', waivers:'mnav-tools', trades:'mnav-tools', roster:'mnav-team', startsit:'mnav-tools', settings:null };
        const navId = newMap[tab];
        if (navId) { const el = document.getElementById(navId); if (el) el.classList.add('active'); }
      }
    }
  };
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && window.navigator.standalone) {
    document.body.classList.add('ios-standalone');
  }

  // Initial chip render
  renderCtxChips('digest');
  renderFieldLogCard();

  // Patch mobileTab after other scripts have loaded
  _patchMobileTab();

  // Initialize chat placeholder with daily limit hint for free users
  if (typeof _updateChatPlaceholder === 'function') _updateChatPlaceholder();

  // Hook: refresh team bar + briefing after league loads
  // Poll for S.user being set (league connection)
  let _teamBarInterval = null;
  function _onLeagueReady() {
    renderTeamBar();
    renderScoutBriefing();
    renderFieldLogCard();
    if (window._activeTab === 'digest') renderWarRoomBrief();
    if (window._activeTab === 'team') renderTeamCommandPanel();
    if (window._activeTab === 'tools') renderToolsPanel();
    if (window._activeTab === 'portfolio') renderPortfolioPanel();
    if (typeof renderTrialBanner === 'function') renderTrialBanner();
    if (typeof _updateChatPlaceholder === 'function') _updateChatPlaceholder();
    clearInterval(_teamBarInterval);
    // Re-check every 15 seconds in case data updates
    setInterval(() => {
      if (window.S?.user) {
        renderTeamBar();
        renderScoutBriefing();
        if (window._activeTab === 'digest') renderWarRoomBrief();
        if (window._activeTab === 'team') renderTeamCommandPanel();
      }
    }, 15000);
  }

  _teamBarInterval = setInterval(() => {
    // Wait for BOTH S.user and a resolved roster before downgrading to the
    // slow 15s retry. S.user can be set several seconds before S.myRosterId
    // populates; calling _onLeagueReady too early leaves the team bar stuck
    // on "Loading your team…" until the 15s tick.
    if (window.S?.user && typeof myR === 'function' && myR()) _onLeagueReady();
  }, 500);
  // Safety cutoff after 60s
  setTimeout(() => clearInterval(_teamBarInterval), 60000);

  if (window.DhqEvents?.on) {
    window.DhqEvents.on('strategy:changed', () => {
      if (window._activeTab === 'digest') renderWarRoomBrief();
      renderCtxChips(window._activeTab || 'digest');
      if (typeof _renderGMBarAlexBlock === 'function') _renderGMBarAlexBlock();
    });
  }
});

// ── Module global exports (Vite migration) ───────────────────────
window.renderTeamBarRoster       = renderTeamBarRoster;
window.getFieldLog               = getFieldLog;
window._generateBriefingItems    = _generateBriefingItems;
window._relativeTime             = _relativeTime;
window._modeLabel                = _modeLabel;
window._describeConflict         = _describeConflict;
window._getDayKey                = _getDayKey;
window._getEntryAlignment        = _getEntryAlignment;
window._getTradeFrequency        = _getTradeFrequency;
window._getFaabStyle             = _getFaabStyle;
window._getPositionBias          = _getPositionBias;
window._getLastSyncTime          = _getLastSyncTime;
window._renderExploitTargets     = _renderExploitTargets;
window._renderLeagueHero         = _renderLeagueHero;
window._renderLeagueCommandMenu  = _renderLeagueCommandMenu;
window._leagueTradesPreview      = _leagueTradesPreview;
window._leagueWaiversPreview     = _leagueWaiversPreview;
window._leagueTeamsPreview       = _leagueTeamsPreview;
window._leagueGetPartners        = _leagueGetPartners;
window._renderLeagueRoomTrades   = _renderLeagueRoomTrades;
window._renderLeagueRoomWaivers  = _renderLeagueRoomWaivers;
window._renderLeagueRoomTeams    = _renderLeagueRoomTeams;
window._buildLeagueTeamCardMini  = _buildLeagueTeamCardMini;
window._buildLeagueCard          = _buildLeagueCard;
window._patchMobileTab           = _patchMobileTab;
