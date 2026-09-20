// Scout's legacy state consumer for the canonical, account-bound Yahoo feed.
(function (window) {
  'use strict';
  const App = window.App = window.App || {};
  const mounts = new Map();
  let pending = null;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = () => window.S || App.S;
  const isYahoo = () => state()?.platform === 'yahoo';
  const button = (action, label, attrs = '') => `<button type="button" data-yahoo-action="${action}" ${attrs} style="min-height:44px;min-width:44px;padding:8px 12px;font:inherit;cursor:pointer">${esc(label)}</button>`;
  function current(s) {
    return s === state() && s?.platform === 'yahoo' && window.Yahoo?.isStateCurrent?.(s) === true;
  }
  function view() {
    const s = state();
    const unavailable = (blocked = false) => ({s, rows: [], status: 'unavailable', blocked, season: String(s?.yahooYear || ''), excluded: 0});
    if (!current(s)) return unavailable(true);
    const status = s.transactionStatus;
    if (!status || status.provider !== 'yahoo' || status.leagueId !== s.currentLeagueId ||
        status.season !== String(s.yahooYear) || status.season !== String(s.season) || status.scope !== 'executed_trades' ||
        !['ready','stale','unavailable'].includes(status.status) || !Number.isInteger(status.excludedTradeCount) || status.excludedTradeCount < 0) return unavailable();
    if (status.status === 'unavailable') return unavailable();
    if (!Number.isFinite(status.lastSuccessAt) || status.lastSuccessAt <= 0 || !s.transactions || Array.isArray(s.transactions)) return unavailable();
    const groups = Object.values(s.transactions);
    if (groups.some(group => !Array.isArray(group))) return unavailable();
    const rows = groups.flat(), seen = new Set();
    if (rows.some(row => {
      if (!row || row._source !== 'yahoo' || row.type !== 'trade' || row.status !== 'complete' ||
          typeof row.transaction_id !== 'string' || !row.transaction_id.startsWith(s.yahooLeagueKey + '.tr.') || seen.has(row.transaction_id) ||
          !Number.isFinite(row.timestamp) || row.timestamp <= 0 || !Array.isArray(row.roster_ids) || row.roster_ids.length < 2 ||
          !row.sides || row.roster_ids.some(id => !Array.isArray(row.sides[id]?.players) || !Array.isArray(row.sides[id]?.picks))) return true;
      seen.add(row.transaction_id); return false;
    })) return unavailable();
    return {s, rows: rows.slice().sort((a,b) => b.timestamp - a.timestamp), status: status.status, blocked: false,
      season: status.season, checkedAt: status.lastSuccessAt, excluded: status.excludedTradeCount};
  }
  function owner(s, id) {
    const roster = (s.rosters || []).find(row => String(row.roster_id) === String(id));
    const user = (s.leagueUsers || []).find(row => String(row.user_id) === String(roster?.owner_id));
    return user?.display_name || user?.metadata?.team_name || 'Team ' + id;
  }
  function player(s, id) {
    const p = s.players?.[id];
    return p?.full_name || [p?.first_name,p?.last_name].filter(Boolean).join(' ') || 'Player ' + id;
  }
  function statusHTML(v) {
    const busy = pending?.s === v.s && pending.guard.isCurrent();
    const message = v.blocked ? 'Your account or Yahoo connection changed. Reload Scout and reopen this league.'
      : v.status === 'ready' ? `Confirmed completed Yahoo trades for ${v.season}.`
      : v.status === 'stale' ? `Yahoo could not refresh. Showing trades last confirmed ${new Date(v.checkedAt).toLocaleString()}.`
      : 'Yahoo trades are unavailable. This does not mean there were no trades.';
    return `<div role="status" aria-live="polite"><p>${esc(message)}</p></div>
      <p style="font-size:13px">This feed excludes add/drop and waiver history.${v.excluded ? ' '+v.excluded+' record(s) without confirmed successful completion excluded.' : ''}</p>
      ${v.blocked ? button('reload','Reload Scout') : button('retry',busy ? 'Refreshing…' : 'Retry Yahoo trades',busy ? 'disabled aria-busy="true"' : '')}`;
  }
  function cards(v, rows) {
    return rows.map(row => `<details style="border-top:1px solid var(--border,#888);padding:8px 0">
      <summary style="min-height:44px;cursor:pointer;padding:8px 0"><strong>${esc(row.roster_ids.map(id=>owner(v.s,id)).join(' ↔ '))}</strong><br>${esc(new Date(row.timestamp).toLocaleDateString())}</summary>
      ${row.roster_ids.map(id => {
        const got = row.sides[id].players.map(pid => player(v.s,pid));
        const sent = Object.keys(row.drops || {}).filter(pid => String(row.drops[pid]) === String(id)).map(pid => player(v.s,pid));
        return `<p><strong>${esc(owner(v.s,id))}</strong><br>Received: ${esc(got.join(', ') || 'No players received')}<br>Sent: ${esc(sent.join(', ') || 'No players sent')}</p>`;
      }).join('')}
      <p style="font-size:13px">Draft-pick details and historical trade values are unavailable in this feed.</p></details>`).join('');
  }
  function render(element, options = {}) {
    if (!element || !isYahoo()) return false;
    const v = view();
    const record = {options};
    mounts.set(element, record);
    let html = statusHTML(v);
    if (v.status !== 'unavailable') {
      if (!v.rows.length) html += '<p>No completed trades were returned by Yahoo for this season.</p>';
      if (options.history && v.rows.length) {
        const owners = [...new Set(v.rows.flatMap(row=>row.roster_ids.map(String)))];
        const active = options.owner && owners.includes(options.owner) ? options.owner : null;
        html += '<h3>Trade activity</h3><p>Filter the confirmed season by team.</p><div style="display:flex;flex-wrap:wrap;gap:8px">' +
          button('filter','All teams','data-owner="" aria-pressed="'+!active+'"') + owners.map(id => {
            const count = v.rows.filter(row=>row.roster_ids.map(String).includes(id)).length;
            return button('filter',owner(v.s,id)+' · '+count,'data-owner="'+esc(id)+'" aria-pressed="'+(active===id)+'"');
          }).join('') + '</div><h3>Trade network</h3>';
        const pairs = new Map();
        v.rows.forEach(row => {if(row.roster_ids.length !== 2)return;const ids=row.roster_ids.map(String).sort(),key=ids.join(':');const pair=pairs.get(key)||{ids,count:0};pair.count++;pairs.set(key,pair);});
        html += [...pairs.values()].sort((a,b)=>b.count-a.count).map(pair=>`<p>${esc(pair.ids.map(id=>owner(v.s,id)).join(' ↔ '))}: ${pair.count} completed trade(s)</p>`).join('') || '<p>No two-team trades returned.</p>';
        html += '<h3>Trade leaderboard</h3><p>Historical values, winner records and trade grades are unavailable for this Yahoo feed.</p><h3>Completed trades</h3>';
        html += cards(v, active ? v.rows.filter(row=>row.roster_ids.map(String).includes(active)) : v.rows);
      } else html += cards(v, v.rows.slice(0, options.limit || 3));
    }
    element.innerHTML = `<section data-yahoo-feed style="font-size:14px;line-height:1.5;overflow-wrap:anywhere;min-width:0">${html}</section>`;
    element.onclick = event => {
      if (mounts.get(element) !== record || !element.querySelector('[data-yahoo-feed]')) return;
      if (!v.blocked && !current(v.s)) { event.preventDefault(); render(element, options); return; }
      const control = event.target.closest?.('[data-yahoo-action]');
      if (!control || !element.contains(control)) return;
      if (control.dataset.yahooAction === 'reload') { window.location.reload(); return; }
      if (control.dataset.yahooAction === 'retry') { void retry(); return; }
      if (control.dataset.yahooAction === 'filter') render(element,{...options,owner:control.dataset.owner || null});
    };
    return true;
  }
  function redraw() {
    for (const [element,record] of mounts) {
      if (!element.isConnected || !element.querySelector('[data-yahoo-feed]') || !isYahoo()) { mounts.delete(element); continue; }
      render(element,record.options);
    }
  }
  function retry() {
    const s = state();
    if (!current(s)) { redraw(); return Promise.resolve(false); }
    if (pending?.guard.isCurrent()) return pending.promise;
    const guard = window.Yahoo.captureStateContext(s);
    const key = s.yahooLeagueKey, id = s.currentLeagueId, year = String(s.yahooYear);
    const isCurrent = () => guard.isCurrent() && current(s) && s.yahooLeagueKey === key && s.currentLeagueId === id && String(s.yahooYear) === year;
    const request = {s, guard, promise: null};
    pending = request;
    request.promise = (async () => {
      try {
        const out = await window.Yahoo.provider.hydrate({id,_yahoo:true,_yahooLeagueKey:key,season:year}, {sleeperPlayers:s.players || {},currentWeek:s.currentWeek,isCurrent});
        if (!isCurrent()) return false;
        Object.assign(s.players, out.players || {});
        s.transactions = out.transactions;
        s.transactionStatus = out.transactionStatus;
        return out.transactionStatus?.status === 'ready';
      } catch (_) {
        // A core identity/shape failure must not leave a prior ready label.
        if (isCurrent()) {
          const old = view();
          s.transactionStatus = {provider:'yahoo',leagueId:id,season:year,scope:'executed_trades',
            status:old.status==='unavailable'?'unavailable':'stale',lastSuccessAt:old.checkedAt || null,excludedTradeCount:old.excluded};
        }
        return false;
      } finally {
        if (pending === request) pending = null;
        redraw();
      }
    })();
    redraw();
    return request.promise;
  }
  window.addEventListener('storage', redraw);
  App.ScoutYahooTransactions = {isYahoo,view,render,retry};
})(window);
