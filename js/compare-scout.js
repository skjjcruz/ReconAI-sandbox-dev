// ══════════════════════════════════════════════════════════════════
// js/compare-scout.js — 2-4 way player compare (War Room parity).
// A bottom-sheet overlay with an N-column head-to-head matrix (DHQ, ROS,
// age, PPG, peak window, verdict) + per-row winner highlight. Entered from
// the player modal / roster cards via CompareScout.add(pid). Stack capped
// at 4, persisted per league. All engine calls guarded → fall back to "—".
// ══════════════════════════════════════════════════════════════════

const _CMP_MAX = 4;
let _cmpStack = [];

function _cmpEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _cmpKey() { return 'compare_players_' + ((window.S && window.S.currentLeagueId) || ''); }
function _cmpLoad() { try { _cmpStack = JSON.parse(localStorage.getItem(_cmpKey()) || '[]') || []; } catch { _cmpStack = []; } }
function _cmpSave() { try { localStorage.setItem(_cmpKey(), JSON.stringify(_cmpStack.slice(0, _CMP_MAX))); } catch { /* ignore */ } }

function _cmpPlayer(pid) {
  const S = window.S || {};
  const p = (S.players || {})[pid] || {};
  const normPos = window.App?.normPos || (x => x);
  const pos = normPos((window.pPos ? window.pPos(pid) : p.position) || p.position || '?');
  const age = Number(p.age) || null;
  const dhqRaw = (window.dynastyValue || window.App?.dynastyValue || (() => 0))(pid) || 0;
  const dhq = dhqRaw > 0 ? dhqRaw : null; // null (not 0) so cold/IDP players don't false-win the DHQ row
  let ros = null;
  try { const PV = window.App?.PlayerValue; if (PV && PV.getValue) { const v = PV.getValue(pid, 'ros'); if (Number.isFinite(+v) && +v > 0) ros = +v; } } catch { /* ignore */ }
  const ps = S.playerStats?.[pid] || {};
  const ppgRaw = (ps.seasonAvg ?? ps.prevAvg);
  const ppg = (ppgRaw != null && Number.isFinite(+ppgRaw)) ? +ppgRaw : null;
  // Peak years left from the age curve (decline end), like ui.js peakYears.
  let peakLeft = null;
  if (age) {
    const end = window.App?.ageCurveWindows?.[pos]?.decline?.[1] || window.App?.peakWindows?.[pos]?.[1] || null;
    if (end) peakLeft = Math.max(0, end - age);
  }
  let verdict = '—', verdictCol = 'var(--text2)';
  try { const ga = window.App?.getPlayerAction || window.getPlayerAction; if (ga) { const v = ga(pid); if (v && v.label && !(v.action === 'HOLD' && v.reason === 'Not enough data')) { verdict = v.label; verdictCol = v.col || verdictCol; } } } catch { /* ignore */ }
  return {
    pid, pos, age, dhq, ros, ppg, peakLeft, verdict, verdictCol,
    name: (window.pName ? window.pName(pid) : (p.full_name || pid)),
    team: p.team || 'FA',
  };
}

function _cmpRender() {
  const host = document.getElementById('compare-scout-panel');
  if (!host) return;
  const cols = _cmpStack.map(_cmpPlayer);
  // Row defs: {label, get, better} — better: 'max'|'min'|null (no winner).
  const ROWS = [
    { label: 'Pos', get: c => c.pos, better: null },
    { label: 'Age', get: c => c.age, better: 'min', fmt: c => c.age || '—' },
    { label: 'DHQ', get: c => c.dhq, better: 'max', fmt: c => c.dhq > 0 ? c.dhq.toLocaleString() : '—' },
    { label: 'ROS', get: c => c.ros, better: 'max', fmt: c => c.ros != null ? Math.round(c.ros).toLocaleString() : '—' },
    { label: 'PPG', get: c => c.ppg, better: 'max', fmt: c => c.ppg != null ? c.ppg.toFixed(1) : '—' },
    { label: 'Peak yrs', get: c => c.peakLeft, better: 'max', fmt: c => c.peakLeft != null ? c.peakLeft : '—' },
    { label: 'Verdict', get: c => c.verdict, better: null, fmt: c => `<span style="color:${c.verdictCol}">${_cmpEsc(c.verdict)}</span>` },
  ];
  // Drop the ROS row entirely if no column has a distinct ROS value (dynasty default).
  const showRos = cols.some(c => c.ros != null && c.ros !== c.dhq);
  // The Verdict row is a buy/sell/hold recommendation → Scout Pro. Free compares raw values.
  const _cmpPro = typeof window.isScoutPro !== 'function' || window.isScoutPro();
  const rows = ROWS.filter(r => (r.label !== 'ROS' || showRos) && (r.label !== 'Verdict' || _cmpPro));

  const head = `<th class="cmp-rlabel"></th>` + cols.map(c => `<th>
      <div class="cmp-col-head">
        <img src="https://sleepercdn.com/content/nfl/players/${c.pid}.jpg" onerror="this.style.display='none'" loading="lazy"/>
        <div class="cmp-col-name">${_cmpEsc(c.name)}</div>
        <div class="cmp-col-sub">${_cmpEsc(c.pos)} · ${_cmpEsc(c.team)}</div>
        <button class="cmp-rm" onclick="window.CompareScout.remove('${c.pid}')" title="Remove">×</button>
      </div></th>`).join('');

  const body = rows.map(r => {
    const vals = cols.map(r.get);
    const nums = vals.filter(v => typeof v === 'number' && Number.isFinite(v));
    let best = null;
    if (r.better === 'max' && nums.length) best = Math.max(...nums);
    if (r.better === 'min' && nums.length) best = Math.min(...nums);
    const cells = cols.map((c, i) => {
      const raw = vals[i];
      const isWin = best != null && nums.length > 1 && typeof raw === 'number' && raw === best;
      const txt = r.fmt ? r.fmt(c) : _cmpEsc(raw == null ? '—' : raw);
      return `<td class="${isWin ? 'cmp-win' : ''}">${txt}</td>`;
    }).join('');
    return `<tr><td class="cmp-rlabel">${_cmpEsc(r.label)}</td>${cells}</tr>`;
  }).join('');

  const canAdd = _cmpStack.length < _CMP_MAX;
  host.innerHTML = `<div class="pm-card cmp-sheet">
    <div class="cmp-head">
      <strong>Compare <small>${_cmpStack.length}/${_CMP_MAX}</small></strong>
      <div class="cmp-head-btns">
        <button onclick="window.CompareScout.clear()">Clear</button>
        <button class="cmp-close" onclick="window.CompareScout.hide()" aria-label="Close">×</button>
      </div>
    </div>
    ${canAdd ? `<div class="cmp-add">
      <input id="cmp-search" type="text" placeholder="Add a player to compare…" oninput="window.CompareScout._search(this.value)" autocomplete="off">
      <div id="cmp-results" class="cmp-results"></div>
    </div>` : ''}
    ${cols.length ? `<div class="cmp-scroll"><table class="cmp-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : `<div class="cmp-empty">Add players to compare them head-to-head.</div>`}
  </div>`;
}

function _cmpShow() {
  const host = document.getElementById('compare-scout-panel');
  if (!host) return;
  // Scout doesn't compute rest-of-season values by default; prime them once so
  // the ROS row is meaningful in redraft leagues (no-op for dynasty/offseason).
  try { if (window.App?.PlayerValue?.ensureRos) window.App.PlayerValue.ensureRos(); } catch { /* ignore */ }
  host.onclick = e => { if (e.target === host) CompareScout.hide(); }; // backdrop tap closes
  document.body.style.overflow = 'hidden'; // lock scroll behind the sheet (mirror player modal)
  host.setAttribute('aria-hidden', 'false');
  _cmpRender();
  requestAnimationFrame(() => host.classList.add('open'));
}

const CompareScout = {
  open(pids) { _cmpLoad(); if (Array.isArray(pids)) { pids.forEach(pid => { const s = String(pid); if (s && !_cmpStack.includes(s) && _cmpStack.length < _CMP_MAX) _cmpStack.push(s); }); _cmpSave(); } _cmpShow(); },
  add(pid) { _cmpLoad(); const s = String(pid); if (s && !_cmpStack.includes(s)) { if (_cmpStack.length >= _CMP_MAX) { if (typeof showToast === 'function') showToast('Compare holds 4 — remove one first'); } else { _cmpStack.push(s); _cmpSave(); } } _cmpShow(); },
  remove(pid) { _cmpStack = _cmpStack.filter(p => p !== String(pid)); _cmpSave(); _cmpRender(); },
  clear() { _cmpStack = []; _cmpSave(); _cmpRender(); },
  hide() { const host = document.getElementById('compare-scout-panel'); if (host) { host.classList.remove('open'); host.setAttribute('aria-hidden', 'true'); } document.body.style.overflow = ''; },
  _search(q) {
    const out = document.getElementById('cmp-results'); if (!out) return;
    const term = (q || '').trim().toLowerCase();
    if (term.length < 2) { out.innerHTML = ''; return; }
    const S = window.S || {}; const normPos = window.App?.normPos || (x => x);
    const dv = window.dynastyValue || window.App?.dynastyValue || (() => 0);
    const matches = Object.entries(S.players || {})
      .filter(([pid, p]) => { if (_cmpStack.includes(pid)) return false; const nm = (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || ''))).toLowerCase(); return nm.includes(term) && (p.position || p.fantasy_positions); })
      .map(([pid, p]) => ({ pid, name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || (window.pName ? window.pName(pid) : pid), pos: normPos(p.position || ''), team: p.team || 'FA', dhq: dv(pid) || 0 }))
      .sort((a, b) => b.dhq - a.dhq).slice(0, 8);
    out.innerHTML = matches.map(m => `<button class="cmp-result" onclick="window.CompareScout.add('${m.pid}')">${_cmpEsc(m.name)} <span>${_cmpEsc(m.pos)} · ${_cmpEsc(m.team)}${m.dhq > 0 ? ' · ' + m.dhq.toLocaleString() : ''}</span></button>`).join('') || '<div class="cmp-noresult">No matches</div>';
  },
};
window.CompareScout = CompareScout;
// Back-compat alias mirroring War Room's global entry point.
window.comparePlayers = pid => CompareScout.add(pid);
