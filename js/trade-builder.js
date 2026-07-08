// ═══════════════════════════════════════════════════════════════
// js/trade-builder.js — ChatGPT-style Trade Builder for Scout
//
// Globals expected: S, pName, pPos, dynastyValue, myR,
//   goAsk, fillGlobalChat, escHtml
// ═══════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Pick value fallback ──────────────────────────────────────
const _TB_PICK_BASE = { 1: 7500, 2: 3000, 3: 1000, 4: 300, 5: 80 };

function _tbPickDHQ(round) {
  if (window.App?.LI?.dhqPickValues) {
    const teams = window.S?.rosters?.length || 12;
    const midPick = (round - 1) * teams + Math.ceil(teams / 2);
    const v = window.App.LI.dhqPickValues[midPick]?.value;
    if (v) return v;
  }
  if (typeof getIndustryPickValue === 'function') {
    const t = window.S?.rosters?.length || 12;
    return getIndustryPickValue((round - 1) * t + Math.ceil(t / 2), t, 7);
  }
  return _TB_PICK_BASE[round] || 50;
}

// ── HTML escaper ─────────────────────────────────────────────
function _tbEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Position badge style (matches player-modal) ───────────────
function _tbPosStyle(pos) {
  const m = {
    QB: 'background:rgba(96,165,250,.2);color:#60a5fa',
    RB: 'background:rgba(52,211,153,.2);color:#34d399',
    WR: 'background:rgba(108,99,245,.2);color:#a78bfa',
    TE: 'background:rgba(251,191,36,.2);color:#fbbf24',
    DL: 'background:rgba(251,146,60,.2);color:#fb923c',
    LB: 'background:rgba(167,139,250,.2);color:#a78bfa',
    DB: 'background:rgba(244,114,182,.2);color:#f472b6',
    K:  'background:rgba(139,143,154,.15);color:var(--text3)',
  };
  return m[pos] || 'background:rgba(74,78,90,.2);color:var(--text3)';
}

// ═══════════════════════════════════════════════════════════════
// SECTION 1: Grade + Probability + Counter-offer
// ═══════════════════════════════════════════════════════════════

function getTradeGrade(myTotal, theirTotal) {
  if (!myTotal && !theirTotal) return { grade: '—', col: 'var(--text3)', desc: 'No value yet' };
  if (!myTotal) return { grade: 'A+', col: 'var(--green)', desc: 'Big win' };
  if (!theirTotal) return { grade: 'F',  col: 'var(--red)',   desc: 'Giving away assets' };
  const r = theirTotal / myTotal;
  if (r >= 1.20) return { grade: 'A+', col: 'var(--green)', desc: 'Big win' };
  if (r >= 1.10) return { grade: 'A',  col: 'var(--green)', desc: 'Win' };
  if (r >= 1.03) return { grade: 'B+', col: 'var(--green)', desc: 'Slight win' };
  if (r >= 0.97) return { grade: 'B',  col: 'var(--accent)', desc: 'Even' };
  if (r >= 0.90) return { grade: 'C+', col: 'var(--amber)', desc: 'Slight loss' };
  if (r >= 0.80) return { grade: 'C',  col: 'var(--amber)', desc: 'Loss' };
  if (r >= 0.65) return { grade: 'D',  col: 'var(--red)',   desc: 'Bad deal' };
  return { grade: 'F', col: 'var(--red)', desc: 'Robbery' };
}
window.getTradeGrade = getTradeGrade;

function getAcceptanceProbability(myTotal, theirTotal, ownerDna) {
  // "my side" = what I'm offering them; "their side" = what I want
  if (!myTotal && !theirTotal) return 50;
  if (!theirTotal) return 95;
  if (!myTotal) return 5;
  const calc = window.App?.TradeEngine?.calcAcceptanceLikelihood || window.calcAcceptanceLikelihood;
  if (typeof calc === 'function') return calc(myTotal, theirTotal, ownerDna, []);
  const maxSide = Math.max(myTotal, theirTotal, 1);
  const normalizedSurplus = (myTotal - theirTotal) / maxSide;
  return Math.min(95, Math.max(5, 50 + Math.round(normalizedSurplus * 200)));
}
window.getAcceptanceProbability = getAcceptanceProbability;

function suggestCounterOffer(myTotal, theirTotal) {
  const gap = myTotal - theirTotal; // >0 = I'm overpaying; <0 = I'm getting the better end
  if (gap <= 0) return null; // trade already in my favor — no counter needed
  const suggestions = [];
  // Find opponent player worth ~gap
  const S = window.S;
  const candidates = [];
  (S?.rosters || []).forEach(r => {
    if (r.roster_id === S?.myRosterId) return;
    (r.players || []).forEach(pid => {
      const v = typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
      if (v > 0) candidates.push({ pid, val: v });
    });
  });
  candidates.sort((a, b) => Math.abs(a.val - gap) - Math.abs(b.val - gap));
  const top = candidates[0];
  if (top && Math.abs(top.val - gap) < gap * 0.45) {
    const n = typeof pName === 'function' ? pName(top.pid) : top.pid;
    suggestions.push(`Ask them to include ${n} (~${top.val.toLocaleString()} DHQ)`);
  }
  if (gap >= 700) {
    const r = gap >= 6000 ? 1 : gap >= 2200 ? 2 : gap >= 700 ? 3 : 4;
    const ord = r === 1 ? 'st' : r === 2 ? 'nd' : 'rd';
    suggestions.push(`Request a ${r}${ord}-round pick (~${_tbPickDHQ(r).toLocaleString()} DHQ)`);
  }
  return suggestions.length ? suggestions : [`Close the ~${gap.toLocaleString()} DHQ gap before accepting`];
}
window.suggestCounterOffer = suggestCounterOffer;

// ═══════════════════════════════════════════════════════════════
// SECTION 2: Parse trade intent from chat
// ═══════════════════════════════════════════════════════════════

function parseTradeIntent(message) {
  const S = window.S;
  if (!S?.players) return null;

  // Must look like a trade message
  const isTradeMsg = /\btrade\b|\bswap\b|\bfor\b|\bsend\b/i.test(message)
    && !/\btrade (value|rumor|news|market|history|analysis|calculator)\b/i.test(message);
  if (!isTradeMsg) return null;

  // Build lookup: last name and full name → pid (exclude coaches/staff)
  const idx = {};
  Object.entries(S.players).forEach(([pid, p]) => {
    if (!p.position || ['HC', 'OC', 'DC', 'GM', 'DEF'].includes(p.position)) return;
    const last = (p.last_name || '').toLowerCase().trim();
    const full = ((p.first_name || '') + ' ' + (p.last_name || '')).toLowerCase().trim();
    if (last.length >= 3) { if (!idx[last]) idx[last] = []; idx[last].push(pid); }
    if (full.length >= 4) { if (!idx[full]) idx[full] = []; idx[full].push(pid); }
  });

  const lower = message.toLowerCase();
  const words = lower.split(/[\s,]+/);
  const found = new Set();

  for (let i = 0; i < words.length; i++) {
    const tri = words.slice(i, i + 3).join(' ');
    const bi  = words.slice(i, i + 2).join(' ');
    const uni = words[i];
    // Prefer unambiguous matches
    if (idx[tri]?.length === 1) { found.add(idx[tri][0]); continue; }
    if (idx[bi]?.length === 1)  { found.add(idx[bi][0]);  continue; }
    if (idx[uni]?.length === 1 && uni.length >= 4) found.add(idx[uni][0]);
  }

  if (!found.size) return null;

  // Split on "for" keyword into my-side vs their-side
  const forMatch = lower.match(/\bfor\b/);
  const pids = [...found];
  let myPids = [], theirPids = [];

  if (forMatch) {
    const forIdx = lower.indexOf(' for ');
    const beforeFor = forIdx >= 0 ? lower.slice(0, forIdx) : '';
    pids.forEach(pid => {
      const p = S.players[pid];
      const last = (p?.last_name || '').toLowerCase();
      const full = ((p?.first_name || '') + ' ' + (p?.last_name || '')).toLowerCase().trim();
      if (beforeFor.includes(full) || beforeFor.includes(last)) myPids.push(pid);
      else theirPids.push(pid);
    });
  } else {
    theirPids = pids;
  }

  return { myPids, theirPids };
}
window.parseTradeIntent = parseTradeIntent;

// ═══════════════════════════════════════════════════════════════
// SECTION 3: Inline trade card (rendered into chat)
// ═══════════════════════════════════════════════════════════════

function renderTradeCard(myPlayers, theirPlayers, myPicks, theirPicks, targetDna) {
  const S = window.S;
  const getVal  = pid => typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
  const getName = pid => {
    const p = S?.players?.[pid];
    if (!p) return String(pid);
    return p.first_name ? p.first_name[0] + '. ' + p.last_name : (p.last_name || pid);
  };
  const getPos_ = pid => typeof pPos === 'function' ? pPos(pid) : (S?.players?.[pid]?.position || '?');

  const myTotal    = myPlayers.reduce((s, p)  => s + getVal(p), 0)
                   + (myPicks || []).reduce((s, r) => s + _tbPickDHQ(r), 0);
  const theirTotal = theirPlayers.reduce((s, p) => s + getVal(p), 0)
                   + (theirPicks || []).reduce((s, r) => s + _tbPickDHQ(r), 0);

  const grade   = getTradeGrade(myTotal, theirTotal);
  const prob    = getAcceptanceProbability(myTotal, theirTotal, targetDna);
  const counter = suggestCounterOffer(myTotal, theirTotal);
  const diff    = theirTotal - myTotal;
  const diffStr = diff > 0 ? `+${diff.toLocaleString()}` : diff < 0 ? diff.toLocaleString() : 'Even';
  const diffCol = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--accent)';
  const probCol = prob >= 60 ? 'var(--green)' : prob >= 35 ? 'var(--amber)' : 'var(--red)';
  const dnaLabel = targetDna && targetDna !== 'NONE' ? ` vs ${targetDna}` : '';

  const renderRow = (pid) => {
    const val = getVal(pid); const pos = getPos_(pid);
    return `<div style="display:flex;align-items:center;gap:5px;padding:3px 0;font-size:12px">
      <span style="font-size:11px;padding:1px 4px;border-radius:5px;font-weight:700;${_tbPosStyle(pos)}">${pos}</span>
      <span style="flex:1;font-weight:600;color:var(--text)">${_tbEsc(getName(pid))}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3)">${val > 0 ? val.toLocaleString() : '—'}</span>
    </div>`;
  };
  const renderPickRow = (r) => `<div style="display:flex;align-items:center;gap:5px;padding:3px 0;font-size:12px">
    <span style="font-size:11px;padding:1px 4px;border-radius:5px;font-weight:700;background:rgba(139,143,154,.15);color:var(--text3)">PK</span>
    <span style="flex:1;font-weight:600;color:var(--text)">Rd ${r} pick</span>
    <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3)">${_tbPickDHQ(r).toLocaleString()}</span>
  </div>`;

  const renderSide = (pids, picks, label) => {
    const rows = pids.map(renderRow).concat((picks || []).map(renderPickRow));
    if (!rows.length) rows.push('<div style="font-size:12px;color:var(--text3);padding:3px 0">—</div>');
    return `<div style="flex:1;min-width:0">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${label}</div>
      ${rows.join('')}
    </div>`;
  };

  // Store for builder/field-log buttons
  window._tbLastCard = { myPlayers: [...myPlayers], theirPlayers: [...theirPlayers], myPicks: [...(myPicks||[])], theirPicks: [...(theirPicks||[])], targetDna };

  const counterHtml = counter ? `
    <div style="margin-top:8px;padding:7px 9px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.15);border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">💡 Counter Suggestion</div>
      ${counter.map(s => `<div style="font-size:12px;color:var(--text2)">${_tbEsc(s)}</div>`).join('')}
    </div>` : '';

  return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:12px;margin:2px 0">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Trade Analysis</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:22px;font-weight:900;color:${grade.col}">${grade.grade}</span>
        <span style="font-size:11px;color:${grade.col};font-weight:600">${grade.desc}</span>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:8px">
      ${renderSide(myPlayers, myPicks, 'You Give')}
      <div style="width:1px;background:var(--border);flex-shrink:0;margin:0 2px"></div>
      ${renderSide(theirPlayers, theirPicks, 'You Get')}
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border);margin-bottom:6px;font-size:11px">
      <span style="font-family:'JetBrains Mono',monospace;color:var(--text3)">${myTotal.toLocaleString()}</span>
      <span style="font-weight:700;color:${diffCol}">${diffStr} DHQ</span>
      <span style="font-family:'JetBrains Mono',monospace;color:var(--text3)">${theirTotal.toLocaleString()}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
      <div style="flex:1;height:5px;background:var(--bg4);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${prob}%;background:${probCol};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:${probCol};white-space:nowrap">🎯 ${prob}%${dnaLabel}</span>
    </div>
    ${counterHtml}
    <div style="display:flex;gap:6px;margin-top:8px">
      <button onclick="openTradeBuilder(null,window._tbLastCard.myPlayers,window._tbLastCard.theirPlayers)" style="flex:1;padding:7px;font-size:12px;font-weight:700;background:var(--accentL);color:var(--accent);border:1px solid rgba(212,175,55,.2);border-radius:8px;cursor:pointer;font-family:inherit">Edit Trade</button>
      <button onclick="logTradeFromLastCard()" style="padding:7px 10px;font-size:12px;font-weight:600;background:var(--bg4);color:var(--text2);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit">→ Field Log</button>
    </div>
  </div>`;
}
window.renderTradeCard = renderTradeCard;

// ── Inject trade card into home chat (called by sendHomeChat) ─
function tryInjectTradeCard(text, msgsEl) {
  if (!msgsEl) return false;
  const intent = parseTradeIntent(text);
  if (!intent) return false;
  const { myPids, theirPids } = intent;
  if (!myPids.length && !theirPids.length) return false;

  // Resolve target DNA
  const S = window.S;
  let targetDna = null;
  if (theirPids.length) {
    const ownerRoster = S?.rosters?.find(r => (r.players || []).includes(String(theirPids[0])));
    if (ownerRoster) targetDna = window.App?.LI?.ownerProfiles?.[ownerRoster.roster_id]?.dna || null;
  }

  const el = document.createElement('div');
  el.className = 'hc-msg-a';
  el.innerHTML = renderTradeCard(myPids, theirPids, [], [], targetDna);
  msgsEl.appendChild(el);
  msgsEl.scrollTop = 99999;
  return true;
}
window.tryInjectTradeCard = tryInjectTradeCard;

// ═══════════════════════════════════════════════════════════════
// SECTION 4: Trade Builder mini-panel
// ═══════════════════════════════════════════════════════════════

let _tbState = {
  myPlayers: [], theirPlayers: [],
  myPicks: [],   theirPicks: [],
  targetRosterId: null, targetDna: null,
};

function openTradeBuilder(targetRosterId, initMy, initTheirs) {
  _tbState = {
    myPlayers:    (initMy     || []).map(String),
    theirPlayers: (initTheirs || []).map(String),
    myPicks: [], theirPicks: [],
    targetRosterId: targetRosterId || null,
    targetDna: null,
  };
  if (targetRosterId) {
    _tbState.targetDna = window.App?.LI?.ownerProfiles?.[targetRosterId]?.dna || null;
  }
  _tbEnsureOverlay();
  _tbRenderPanel();
  document.getElementById('trade-builder-overlay').style.display = 'flex';
}
window.openTradeBuilder = openTradeBuilder;

// Called from player modal "Trade" button
function openTradeBuilderForPlayer(pid) {
  const pidStr = String(pid);
  const myRoster_ = typeof myR === 'function' ? myR() : null;
  const onMine = (myRoster_?.players || []).includes(pidStr);
  if (onMine) {
    openTradeBuilder(null, [pidStr], []);
  } else {
    const ownerRoster = window.S?.rosters?.find(r => (r.players || []).includes(pidStr));
    openTradeBuilder(ownerRoster?.roster_id || null, [], [pidStr]);
  }
}
window.openTradeBuilderForPlayer = openTradeBuilderForPlayer;

// Called from League tab "Trade" button on opponent player rows
function openTradeBuilderForOpponentPlayer(pid, rosterId) {
  openTradeBuilder(rosterId ? parseInt(rosterId) : null, [], [String(pid)]);
}
window.openTradeBuilderForOpponentPlayer = openTradeBuilderForOpponentPlayer;

function closeTradeBuilder() {
  const el = document.getElementById('trade-builder-overlay');
  if (el) el.style.display = 'none';
}
window.closeTradeBuilder = closeTradeBuilder;

function tbAddPlayer(side, pid) {
  const s = String(pid);
  if (side === 'mine'   && !_tbState.myPlayers.includes(s))    _tbState.myPlayers.push(s);
  if (side === 'theirs' && !_tbState.theirPlayers.includes(s)) _tbState.theirPlayers.push(s);
  _tbRenderPanel();
}
window.tbAddPlayer = tbAddPlayer;

function tbRemovePlayer(side, idx) {
  if (side === 'mine')   _tbState.myPlayers.splice(idx, 1);
  if (side === 'theirs') _tbState.theirPlayers.splice(idx, 1);
  _tbRenderPanel();
}
window.tbRemovePlayer = tbRemovePlayer;

function tbAddPick(side, round) {
  const r = parseInt(round);
  if (isNaN(r) || r < 1 || r > 7) return;
  if (side === 'mine')   _tbState.myPicks.push(r);
  if (side === 'theirs') _tbState.theirPicks.push(r);
  _tbRenderPanel();
}
window.tbAddPick = tbAddPick;

function tbRemovePick(side, idx) {
  if (side === 'mine')   _tbState.myPicks.splice(idx, 1);
  if (side === 'theirs') _tbState.theirPicks.splice(idx, 1);
  _tbRenderPanel();
}
window.tbRemovePick = tbRemovePick;

function tbAnalyze() {
  const { myPlayers, theirPlayers, myPicks, theirPicks, targetDna } = _tbState;
  const getVal  = pid => typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
  const getName = pid => typeof pName === 'function' ? pName(pid) : pid;
  const getPos_ = pid => typeof pPos  === 'function' ? pPos(pid)  : '?';

  const myTotal    = myPlayers.reduce((s, p) => s + getVal(p), 0) + myPicks.reduce((s, r) => s + _tbPickDHQ(r), 0);
  const theirTotal = theirPlayers.reduce((s, p) => s + getVal(p), 0) + theirPicks.reduce((s, r) => s + _tbPickDHQ(r), 0);
  const grade = getTradeGrade(myTotal, theirTotal);
  const prob  = getAcceptanceProbability(myTotal, theirTotal, targetDna);

  const fmt = (pids, picks) =>
    pids.map(p => `${getName(p)}(${getPos_(p)},DHQ:${getVal(p)})`).join(', ')
    + picks.map(r => `, R${r} pick(~${_tbPickDHQ(r)})`).join('');

  const prompt = `TRADE ANALYSIS REQUEST:
I Give: ${fmt(myPlayers, myPicks) || '(nothing)'}
I Get: ${fmt(theirPlayers, theirPicks) || '(nothing)'}
Value: ${myTotal.toLocaleString()} DHQ → ${theirTotal.toLocaleString()} DHQ | Grade: ${grade.grade} (${grade.desc})
Acceptance probability (owner DNA: "${targetDna || 'unknown'}"): ${prob}%

Should I pull the trigger? Consider age, positional value, my team needs, and dynasty timeline. Be direct.`;

  closeTradeBuilder();
  if (typeof goAsk === 'function') goAsk(prompt);
  else if (typeof window.fillGlobalChat === 'function') window.fillGlobalChat(prompt);
}
window.tbAnalyze = tbAnalyze;

// ── Ensure overlay DOM exists ─────────────────────────────────
function _tbEnsureOverlay() {
  if (document.getElementById('trade-builder-overlay')) return;
  const div = document.createElement('div');
  div.id = 'trade-builder-overlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.75);align-items:flex-end;justify-content:center;font-family:"DM Sans",sans-serif';
  div.onclick = e => { if (e.target === div) closeTradeBuilder(); };
  div.innerHTML = `<div id="trade-builder-panel" style="width:100%;max-width:560px;max-height:90vh;background:var(--bg2);border-radius:16px 16px 0 0;overflow-y:auto;padding:16px 16px 28px;-webkit-overflow-scrolling:touch"></div>`;
  document.body.appendChild(div);
}

// ── Partner Insight Card ─────────────────────────────────────
function _tbPartnerInsight(targetRosterId, targetName) {
  if (!targetRosterId) return '';
  // Owner behavioral intel (DNA/tendency/tactical tips) is Scout Pro — same OWNER_DNA
  // gate League Intel uses. Free builds trades with raw values only.
  if (typeof canAccess === 'function' && !canAccess(window.FEATURES?.OWNER_DNA || 'owner_dna')) return '';
  const profile = window.App?.LI?.ownerProfiles?.[targetRosterId];
  if (!profile || profile.trades < 1) return '';

  const dna = profile.dna || 'Unknown';
  const record = `${profile.tradesWon || 0}W-${profile.tradesLost || 0}L-${profile.tradesFair || 0}F`;
  const totalTrades = profile.trades || 0;

  // What positions they historically acquire (= what they want)
  const topNeeds = Object.entries(profile.posAcquired || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pos]) => pos);

  // Tendency line from avgValueDiff
  const avg = profile.avgValueDiff || 0;
  let tendency;
  if (avg > 300) tendency = 'Historically overpays in trades';
  else if (avg > 0) tendency = 'Tends to give slightly more than they get';
  else if (avg > -300) tendency = 'Trades close to fair value';
  else tendency = 'Shrewd negotiator — rarely overpays';

  // Tactical tip based on DNA + needs
  let tip = '';
  if (topNeeds.length && profile.picksAcquired > profile.picksSold)
    tip = `Rebuilding — values picks. Offer players at positions they need (${topNeeds.join(', ')}) to extract picks.`;
  else if (topNeeds.length)
    tip = `Targets ${topNeeds.join(', ')} in trades. Bundle depth at those positions for leverage.`;
  else if (dna.includes('Active'))
    tip = 'High-volume trader — likely to engage. Start with a fair offer.';
  else
    tip = 'Limited trade history — lead with a balanced offer to build trust.';

  return `<div style="background:rgba(212,175,55,0.05);border:1px solid rgba(212,175,55,0.15);border-radius:10px;padding:10px 12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.05em">Partner Intel</div>
      <div style="font-size:11px;color:var(--text3)">${totalTrades} trade${totalTrades !== 1 ? 's' : ''} · ${_tbEsc(record)}</div>
    </div>
    <div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:4px">${_tbEsc(tendency)}</div>
    ${topNeeds.length ? `<div style="font-size:11px;color:var(--text3);margin-bottom:4px">Targets: ${topNeeds.map(p => `<span style="color:var(--accent);font-weight:600">${p}</span>`).join(', ')}</div>` : ''}
    <div style="font-size:11px;color:var(--green);line-height:1.4">💡 ${tip}</div>
  </div>`;
}

// ── Render panel ──────────────────────────────────────────────
function _tbRenderPanel() {
  const panel = document.getElementById('trade-builder-panel');
  if (!panel) return;

  const { myPlayers, theirPlayers, myPicks, theirPicks, targetRosterId, targetDna } = _tbState;
  const S = window.S;
  const getVal  = pid => typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
  const getName = pid => typeof pName === 'function' ? pName(pid) : String(pid);
  const getPos_ = pid => typeof pPos  === 'function' ? pPos(pid)  : '?';

  const myTotal    = myPlayers.reduce((s, p) => s + getVal(p), 0) + myPicks.reduce((s, r) => s + _tbPickDHQ(r), 0);
  const theirTotal = theirPlayers.reduce((s, p) => s + getVal(p), 0) + theirPicks.reduce((s, r) => s + _tbPickDHQ(r), 0);
  const grade   = getTradeGrade(myTotal, theirTotal);
  const prob    = getAcceptanceProbability(myTotal, theirTotal, targetDna);
  const counter = myTotal > theirTotal ? suggestCounterOffer(myTotal, theirTotal) : null;
  const diff    = theirTotal - myTotal;
  const diffStr = diff > 0 ? `+${diff.toLocaleString()}` : diff < 0 ? diff.toLocaleString() : 'Even';
  const diffCol = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--accent)';

  // Resolve opponent name
  let targetName = 'Opponent';
  if (targetRosterId) {
    const ownerUser = (S?.leagueUsers || []).find(u => {
      const r = (S?.rosters || []).find(r2 => r2.roster_id === targetRosterId);
      return r && u.user_id === r.owner_id;
    });
    targetName = ownerUser?.metadata?.team_name || ownerUser?.display_name || 'Opponent';
  }

  // Available players for each dropdown
  const myRoster_ = typeof myR === 'function' ? myR() : null;
  const myAvail = (myRoster_?.players || [])
    .filter(p => !myPlayers.includes(String(p)))
    .sort((a, b) => getVal(b) - getVal(a))
    .slice(0, 50);

  const theirRoster = targetRosterId ? (S?.rosters || []).find(r => r.roster_id === targetRosterId) : null;
  const theirAvail = theirRoster
    ? (theirRoster.players || []).filter(p => !theirPlayers.includes(String(p))).sort((a, b) => getVal(b) - getVal(a)).slice(0, 50)
    : (S?.rosters || []).filter(r => r.roster_id !== S?.myRosterId).flatMap(r => r.players || [])
        .filter(p => !theirPlayers.includes(String(p))).sort((a, b) => getVal(b) - getVal(a)).slice(0, 50);

  const chip = (pid, side, idx) => {
    const val = getVal(pid); const pos = getPos_(pid);
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
      <span style="font-size:11px;padding:1px 4px;border-radius:5px;font-weight:700;${_tbPosStyle(pos)}">${pos}</span>
      <span style="flex:1;font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_tbEsc(getName(pid))}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3);flex-shrink:0">${val > 0 ? val.toLocaleString() : '—'}</span>
      <button onclick="tbRemovePlayer('${side}',${idx})" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0;font-size:18px;line-height:1;flex-shrink:0">×</button>
    </div>`;
  };
  const pickChip = (r, side, idx) => {
    const val = _tbPickDHQ(r);
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
      <span style="font-size:11px;padding:1px 4px;border-radius:5px;font-weight:700;background:rgba(139,143,154,.15);color:var(--text3)">PK</span>
      <span style="flex:1;font-size:13px;font-weight:600;color:var(--text)">Rd ${r} pick</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3)">${val.toLocaleString()}</span>
      <button onclick="tbRemovePick('${side}',${idx})" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0;font-size:18px;line-height:1">×</button>
    </div>`;
  };
  const sel = (opts, onchange, placeholder) =>
    `<select onchange="${onchange}" style="width:100%;margin-top:4px;padding:6px 8px;font-size:12px;background:var(--bg4);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-family:'DM Sans',sans-serif;outline:none">
      <option value="">${placeholder}</option>${opts}
    </select>`;

  const myPidsSorted    = [...myPlayers].sort((a, b) => getVal(b) - getVal(a));
  const theirPidsSorted = [...theirPlayers].sort((a, b) => getVal(b) - getVal(a));

  // Build owned picks for each side from S.tradedPicks
  const league = S?.leagues?.find(l => l.league_id === S.currentLeagueId);
  const draftRounds = league?.settings?.draft_rounds || 5;
  const nextSeason = String((league?.season ? parseInt(league.season) + 1 : new Date().getFullYear() + 1));
  const allTP = S?.tradedPicks || [];

  function _tbOwnedPicks(rosterId, alreadyAdded) {
    const picks = [];
    for (let rd = 1; rd <= Math.min(draftRounds, 5); rd++) {
      // A pick originally belonging to rosterId is traded away if someone else now owns it
      const tradedAway = allTP.find(p => String(p.season) === nextSeason && p.round === rd && p.roster_id === rosterId && p.owner_id !== rosterId);
      // Picks acquired: originally someone else's but now owned by rosterId
      const acquired = allTP.filter(p => String(p.season) === nextSeason && p.round === rd && p.owner_id === rosterId && p.roster_id !== rosterId);
      // Own pick still held
      if (!tradedAway) picks.push({ round: rd, from: null });
      // Acquired picks
      acquired.forEach(p => {
        const fromRoster = (S?.rosters || []).find(r => r.roster_id === p.roster_id);
        const fromUser = (S?.leagueUsers || []).find(u => u.user_id === fromRoster?.owner_id);
        const fromName = fromUser?.display_name || fromUser?.metadata?.team_name || 'unknown';
        picks.push({ round: rd, from: fromName });
      });
    }
    // Filter out rounds already added to the trade
    const addedCounts = {};
    alreadyAdded.forEach(r => addedCounts[r] = (addedCounts[r] || 0) + 1);
    const result = [];
    const usedCounts = {};
    picks.forEach(pk => {
      usedCounts[pk.round] = (usedCounts[pk.round] || 0) + 1;
      if ((addedCounts[pk.round] || 0) < usedCounts[pk.round]) result.push(pk);
    });
    return result;
  }
  const myOwnedPicks = _tbOwnedPicks(S.myRosterId, myPicks);
  const theirOwnedPicks = targetRosterId ? _tbOwnedPicks(targetRosterId, theirPicks) : [];
  const myPickOpts = myOwnedPicks.map(pk => `<option value="${pk.round}">Rd ${pk.round}${pk.from ? ' (from ' + _tbEsc(pk.from) + ')' : ''} (~${_tbPickDHQ(pk.round).toLocaleString()})</option>`).join('');
  const theirPickOpts = theirOwnedPicks.map(pk => `<option value="${pk.round}">Rd ${pk.round}${pk.from ? ' (from ' + _tbEsc(pk.from) + ')' : ''} (~${_tbPickDHQ(pk.round).toLocaleString()})</option>`).join('');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--text);letter-spacing:-.02em">Trade Builder</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px">
          ${targetDna
            ? `${_tbEsc(targetName)} · <span style="color:var(--accent);font-weight:600">${_tbEsc(targetDna)}</span> DNA`
            : 'Build and analyze your trade'}
        </div>
      </div>
      <button onclick="closeTradeBuilder()" style="background:var(--bg4);border:1px solid var(--border);cursor:pointer;color:var(--text2);width:30px;height:30px;border-radius:50%;font-size:18px;display:flex;align-items:center;justify-content:center;line-height:1">×</button>
    </div>

    ${_tbPartnerInsight(targetRosterId, targetName)}

    ${(myTotal > 0 || theirTotal > 0) ? `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:12px;color:var(--text3)">You Give<br><strong style="font-family:'JetBrains Mono',monospace;color:var(--text);font-size:13px">${myTotal.toLocaleString()}</strong></span>
        <div style="text-align:center">
          <div style="font-size:26px;font-weight:900;color:${grade.col};line-height:1">${grade.grade}</div>
          <div style="font-size:11px;color:${grade.col}">${grade.desc}</div>
        </div>
        <span style="font-size:12px;color:var(--text3);text-align:right">You Get<br><strong style="font-family:'JetBrains Mono',monospace;color:var(--text);font-size:13px">${theirTotal.toLocaleString()}</strong></span>
      </div>
      ${(typeof canAccess === 'function' && !canAccess(window.FEATURES?.OWNER_DNA || 'owner_dna')) ? '' : `<div style="height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;margin-bottom:5px">
        <div style="height:100%;width:${prob}%;background:${prob >= 60 ? 'var(--green)' : prob >= 35 ? 'var(--amber)' : 'var(--red)'};border-radius:3px;transition:width .3s"></div>
      </div>`}
      <div style="display:flex;justify-content:space-between;font-size:11px">
        <span style="color:${diffCol};font-weight:700">${diffStr} DHQ</span>
        ${(typeof canAccess === 'function' && !canAccess(window.FEATURES?.OWNER_DNA || 'owner_dna')) ? '' : `<span style="color:var(--text3)">${prob}% acceptance probability</span>`}
      </div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">You Give</div>
        ${myPidsSorted.map((pid) => chip(pid, 'mine', myPlayers.indexOf(pid))).join('')}
        ${myPicks.map((r, i) => pickChip(r, 'mine', i)).join('')}
        ${!myPidsSorted.length && !myPicks.length ? '<div style="font-size:12px;color:var(--text3);padding:3px 0">Nothing yet</div>' : ''}
        ${sel(myAvail.map(pid => `<option value="${pid}">${_tbEsc(getName(pid))} · ${getVal(pid) > 0 ? getVal(pid).toLocaleString() : '—'}</option>`).join(''), "if(this.value){tbAddPlayer('mine',this.value);this.value=''}", '+ My player')}
        ${sel(myPickOpts, "if(this.value){tbAddPick('mine',this.value);this.value=''}", '+ My pick')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${_tbEsc(targetName)} Gives</div>
        ${theirPidsSorted.map((pid) => chip(pid, 'theirs', theirPlayers.indexOf(pid))).join('')}
        ${theirPicks.map((r, i) => pickChip(r, 'theirs', i)).join('')}
        ${!theirPidsSorted.length && !theirPicks.length ? '<div style="font-size:12px;color:var(--text3);padding:3px 0">Nothing yet</div>' : ''}
        ${sel(theirAvail.map(pid => `<option value="${pid}">${_tbEsc(getName(pid))} · ${getVal(pid) > 0 ? getVal(pid).toLocaleString() : '—'}</option>`).join(''), "if(this.value){tbAddPlayer('theirs',this.value);this.value=''}", '+ Their player')}
        ${sel(theirPickOpts, "if(this.value){tbAddPick('theirs',this.value);this.value=''}", '+ Their pick')}
      </div>
    </div>

    ${counter ? `<div style="padding:8px 10px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.15);border-radius:8px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Counter Suggestion</div>
      ${counter.map(s => `<div style="font-size:13px;color:var(--text2)">${_tbEsc(s)}</div>`).join('')}
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:0">
      <button onclick="tbAnalyze()" style="width:100%;padding:13px;font-size:14px;font-weight:700;background:var(--accent);color:#08090b;border:none;border-radius:10px;cursor:pointer;font-family:'DM Sans',sans-serif;letter-spacing:-.01em">
        Ask Scout to Analyze →
      </button>
      <button onclick="tbLogToFieldLog()" style="padding:13px 12px;font-size:12px;font-weight:600;background:var(--bg3);color:var(--text2);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap">→ Log</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: Field Log integration
// ═══════════════════════════════════════════════════════════════

function _logTradeScenario(myPids, theirPids, myPicks, theirPicks, grade) {
  const getName = pid => typeof pName === 'function' ? pName(pid) : String(pid);
  const myNames = [
    ...(myPids || []).map(getName),
    ...(myPicks || []).map(r => `Rd ${r} pick`),
  ].join(' + ') || '—';
  const theirNames = [
    ...(theirPids || []).map(getName),
    ...(theirPicks || []).map(r => `Rd ${r} pick`),
  ].join(' + ') || 'TBD';
  const gradeStr = grade?.grade || '?';
  const text = `Trade option saved: ${myNames} for ${theirNames} — Grade: ${gradeStr}`;
  const allPlayers = [
    ...(myPids || []).map(pid => ({ id: pid, name: getName(pid) })),
    ...(theirPids || []).map(pid => ({ id: pid, name: getName(pid) })),
  ];
  if (typeof window.addFieldLogEntry === 'function') {
    window.addFieldLogEntry('🔄', text, 'trade', { actionType: 'trade_option_saved', players: allPlayers });
    if (typeof window.showToast === 'function') window.showToast('Trade option saved');
  }

  // Check strategy alignment — show override modal if conflict detected
  if (window.GMStrategy?.recordAction && (myPids || []).length > 0) {
    const action = { type: 'trade', direction: 'sell', playerId: myPids[0] };
    const result = window.GMStrategy.recordAction(action);
    if (result.alignment === 'conflicts' && typeof window.showOverrideReasonModal === 'function') {
      try {
        const log = JSON.parse(localStorage.getItem('scout_field_log_v1') || '[]');
        const lastEntry = log[0];
        if (lastEntry) {
          setTimeout(() => window.showOverrideReasonModal(lastEntry.id, lastEntry.text), 350);
        }
      } catch (e) { /* ignore */ }
    }
  }
}

// Called from inline trade card "→ Field Log" button
function logTradeFromLastCard() {
  const c = window._tbLastCard;
  if (!c) return;
  const getVal = pid => typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
  const myTotal    = (c.myPlayers || []).reduce((s, p) => s + getVal(p), 0) + (c.myPicks || []).reduce((s, r) => s + _tbPickDHQ(r), 0);
  const theirTotal = (c.theirPlayers || []).reduce((s, p) => s + getVal(p), 0) + (c.theirPicks || []).reduce((s, r) => s + _tbPickDHQ(r), 0);
  _logTradeScenario(c.myPlayers, c.theirPlayers, c.myPicks, c.theirPicks, getTradeGrade(myTotal, theirTotal));
}
window.logTradeFromLastCard = logTradeFromLastCard;

// Called from Trade Builder panel "→ Log" button
function tbLogToFieldLog() {
  const { myPlayers, theirPlayers, myPicks, theirPicks } = _tbState;
  const getVal = pid => typeof dynastyValue === 'function' ? dynastyValue(pid) : 0;
  const myTotal    = myPlayers.reduce((s, p) => s + getVal(p), 0) + myPicks.reduce((s, r) => s + _tbPickDHQ(r), 0);
  const theirTotal = theirPlayers.reduce((s, p) => s + getVal(p), 0) + theirPicks.reduce((s, r) => s + _tbPickDHQ(r), 0);
  _logTradeScenario(myPlayers, theirPlayers, myPicks, theirPicks, getTradeGrade(myTotal, theirTotal));
}
window.tbLogToFieldLog = tbLogToFieldLog;

// ── Module global exports (Vite migration) ───────────────────────
window._tbPickDHQ        = _tbPickDHQ;
window._tbEsc            = _tbEsc;
window._tbPosStyle       = _tbPosStyle;
window._tbEnsureOverlay  = _tbEnsureOverlay;
window._tbPartnerInsight = _tbPartnerInsight;
window._tbRenderPanel    = _tbRenderPanel;
window._logTradeScenario = _logTradeScenario;
