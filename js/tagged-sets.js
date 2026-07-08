// ══════════════════════════════════════════════════════════════════
// js/tagged-sets.js — Tagged-player list views (Trade Block / Cut /
// Watch / Untouchables). Surfaces window._playerTags (set via the player
// modal's tagPlayer + the roster row's _rosterTag) as a collapsible strip
// inside My Team. Mobile-native, calm (gold structure, one decision color
// per set). War Room shows these as dashboard widgets; Scout mounts them
// next to the roster where the tags are set.
// ══════════════════════════════════════════════════════════════════

const _TS_SETS = [
  { key: 'trade', label: 'Trade Block', color: 'var(--amber)' },
  { key: 'cut', label: 'Cut Candidates', color: 'var(--red)' },
  { key: 'watch', label: 'Watch', color: 'var(--blue)' },
  { key: 'untouchable', label: 'Untouchables', color: 'var(--green)' },
];

function _tsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getPlayersByTag(tag) {
  const S = window.S || {};
  const tags = window._playerTags || {};
  const my = (typeof window.myR === 'function') ? window.myR() : ((S.rosters || []).find(r => r.roster_id === S.myRosterId) || null);
  // Union of roster + every tagged pid — tags can be set on FAs/rookies/opponents
  // from the modal, so a roster-only pool would silently drop them.
  const pool = Array.from(new Set([...((my && my.players) || []), ...Object.keys(tags)]));
  const dv = window.dynastyValue || window.App?.dynastyValue || (() => 0);
  const normPos = window.App?.normPos || (x => x);
  return pool
    .filter(pid => tags[pid] === tag)
    .map(pid => {
      const p = (S.players || {})[pid] || {};
      const pos = normPos((window.pPos ? window.pPos(pid) : p.position) || p.position || '?');
      const ps = S.playerStats?.[pid] || {};
      const ppg = (ps.seasonAvg ?? ps.prevAvg);
      return {
        pid,
        name: (window.pName ? window.pName(pid) : (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid)),
        pos, team: p.team || 'FA', age: p.age || '',
        dhq: dv(pid) || 0,
        ppg: (ppg != null && Number.isFinite(+ppg)) ? +ppg : null,
      };
    })
    .sort((a, b) => b.dhq - a.dhq);
}

function renderTaggedSets(hostId) {
  const host = document.getElementById(hostId || 'scout-tagged-sets-host');
  if (!host) return;
  const sets = _TS_SETS.map(s => ({ ...s, players: getPlayersByTag(s.key) }));
  const total = sets.reduce((n, s) => n + s.players.length, 0);
  if (!total) { host.innerHTML = ''; return; } // nothing tagged → hide the strip entirely
  const dhqCol = v => v >= 7000 ? 'var(--green)' : v >= 4000 ? 'var(--blue)' : v >= 2000 ? 'var(--text2)' : 'var(--text3)';
  const sectionHtml = s => {
    if (!s.players.length) return '';
    const rows = s.players.slice(0, 8).map(p => `<div class="ts-row" onclick="openPlayerModal('${p.pid}')">
        <span class="ts-pos">${_tsEsc(p.pos)}</span>
        <span class="ts-name">${_tsEsc(p.name)}</span>
        <span class="ts-meta">${_tsEsc(p.team)}${p.age ? ' · ' + p.age : ''}${p.ppg != null ? ' · ' + p.ppg.toFixed(1) : ''}</span>
        <span class="ts-dhq" style="color:${dhqCol(p.dhq)}">${p.dhq > 0 ? p.dhq.toLocaleString() : '—'}</span>
        <button class="ts-untag" title="Remove tag" onclick="event.stopPropagation();window._rosterTag&&window._rosterTag('${p.pid}','${s.key}')">×</button>
      </div>`).join('');
    const more = s.players.length > 8 ? `<div class="ts-more">+${s.players.length - 8} more</div>` : '';
    return `<div class="ts-section"><div class="ts-section-hdr" style="color:${s.color}">${_tsEsc(s.label)} <b>${s.players.length}</b></div>${rows}${more}</div>`;
  };
  const summary = sets.filter(s => s.players.length).map(s => `<b style="color:${s.color}">${s.players.length}</b> ${_tsEsc(s.label)}`).join(' · ');
  host.innerHTML = `<details class="scout-section-card scout-tags-card">
    <summary class="scout-tags-summary">
      <div class="scout-tags-head"><span class="scout-kicker">Tagged Players</span><span class="scout-tags-line">${summary}</span></div>
      <span class="scout-rooms-caret" aria-hidden="true">▾</span>
    </summary>
    <div class="scout-tags-body">${sets.map(sectionHtml).join('')}</div>
  </details>`;
}

// Re-render the strip in place after a tag changes (from the roster row or the
// player modal). Must NOT call buildRosterTable (avoids a render loop).
function refreshTaggedSetsDisplay() {
  if (document.getElementById('scout-tagged-sets-host')) renderTaggedSets('scout-tagged-sets-host');
}

window.getPlayersByTag = getPlayersByTag;
window.renderTaggedSets = renderTaggedSets;
window.refreshTaggedSetsDisplay = refreshTaggedSetsDisplay;
