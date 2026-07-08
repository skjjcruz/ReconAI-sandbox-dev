/* global normalizeTradedPicks */
// ── Sleeper API layer ───────────────────────────────────────────
// Extracted from index.html.bak — all Sleeper fetch helpers and stat loaders.
// Plan B: functions defined at module level; S, LI, etc. live on window
// (set by app.js before any of these are called).

window.App = window.App || {};

const SLEEPER='https://api.sleeper.app/v1';

const sf=path=>fetch(SLEEPER+path).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});

// Thin wrapper: delegates to shared API, stores result in War Room Scout state S.trending.
// shared/sleeper-api.js owns the raw fetch; this owns the state assignment.
async function fetchTrending(){
  // Trending is a 24h-lookback list — it barely moves intraday, yet this ran 2
  // fresh network calls on every loadAllData. Reuse the last result for 30min
  // (the fetchedAt stamp was recorded but never consulted).
  if(S.trending&&S.trending.fetchedAt&&Date.now()-S.trending.fetchedAt<30*60*1000
     &&((S.trending.adds&&S.trending.adds.length)||(S.trending.drops&&S.trending.drops.length))){
    return;
  }
  try{
    const [adds,drops]=await Promise.all([
      window.Sleeper.fetchTrending('add',24,20).catch(()=>[]),
      window.Sleeper.fetchTrending('drop',24,20).catch(()=>[]),
    ]);
    S.trending={adds:adds||[],drops:drops||[],fetchedAt:Date.now()};
    console.log('Trending loaded: '+adds.length+' adds, '+drops.length+' drops');
  }catch(e){S.trending={adds:[],drops:[],fetchedAt:0};}
}

async function loadLeague(leagueId,userId){
  // Non-Sleeper platforms: data already populated by their connector — skip Sleeper API calls
  if(S.platform&&S.platform!=='sleeper'){
    const uid=userId||S.myRosterId;
    if(!S.myRosterId&&uid){
      S.myRosterId=S.rosters.find(r=>r.owner_id===uid)?.roster_id||S.rosters[0]?.roster_id;
    }
    try{renderRoster();}catch(e){}
    try{renderWaivers();}catch(e){}
    try{renderTrades();}catch(e){}
    try{renderPicks();}catch(e){}
    return;
  }
  const week=S.currentWeek||1;
  const[rosters,users,tradedPicks,drafts,bracketW,bracketL,matchups,txns]=await Promise.all([
    sf(`/league/${leagueId}/rosters`),
    sf(`/league/${leagueId}/users`),
    sf(`/league/${leagueId}/traded_picks`),
    sf(`/league/${leagueId}/drafts`),
    sf(`/league/${leagueId}/winners_bracket`),
    sf(`/league/${leagueId}/losers_bracket`).catch(()=>[]),
    sf(`/league/${leagueId}/matchups/${week}`).catch(()=>[]),
    sf(`/league/${leagueId}/transactions/${week}`).catch(()=>[]),
  ]);
  // Clear league-scoped data from previous league (prevents stale stats bleeding)
  S.playerStats={};S.posRanks={};S.matchups={};S.transactions={};
  S.rosters=rosters||[];S.leagueUsers=users||[];
  S.tradedPicks=(typeof normalizeTradedPicks==='function')?normalizeTradedPicks(rosters,tradedPicks):tradedPicks||[];
  S.drafts=drafts||[];S.bracket={w:bracketW||[],l:bracketL||[]};
  S.matchups['w'+week]=matchups||[];
  S.transactions['w'+week]=txns||[];
  const uid=userId||S.user?.user_id;
  S.myRosterId=S.rosters.find(r=>r.owner_id===uid||(r.co_owners||[]).includes(uid))?.roster_id;
  renderRoster();renderWaivers();renderTrades();renderPicks();
}

async function loadOwnership(){
  // /players/nfl/research/regular/{season}/{week} returns ownership% and rostering%
  // keyed by player_id: {owned_by: N, rostered_by: N, started_by: N, ...}
  try{
    const data=await fetch(`https://api.sleeper.com/players/nfl/research/regular/${S.season}/${S.currentWeek}`)
      .then(r=>r.ok?r.json():{}).catch(()=>({}));
    S.ownership=data;
  }catch(e){S.ownership={};}
}

async function loadRosterStats(){
  if(!S.myRosterId)return;
  const my=myR();if(!my||!(my.players||[]).length)return;
  if(!S.playerStats)S.playerStats={};
  if(!S.playerProj)S.playerProj={};

  const sc=S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings||{};
  const curSeason=S.season||String(new Date().getFullYear());
  const prevSeason=String(parseInt(curSeason)-1);
  const isOffseason=!S.nflState?.season_has_scores||S.currentWeek<=1;

  // All players across all rosters — needed for league-wide elite ranks
  const allLeaguePlayers=[...new Set(S.rosters.flatMap(r=>r.players||[]))];

  try{
    // ── TWO API CALLS replace 36 ────────────────────────────────────────────
    // Sleeper aggregate endpoint: full season totals per player, one call each.
    // Route through the shared IndexedDB-backed, in-flight-deduped season cache
    // so we DON'T re-download the same multi-MB season blobs loadLeagueIntel just
    // fetched in the same load (they ran concurrently and each pulled cur+prev).
    const sfStats = window.Sleeper?.fetchSeasonStats || (yr => sf(`/stats/nfl/regular/${yr}`));
    const [curAgg, prevAgg] = await Promise.all([
      isOffseason ? Promise.resolve({}) :
        sfStats(curSeason).catch(()=>({})),
      sfStats(prevSeason).catch(()=>({})),
    ]);

    // If prev season is empty, try one more year back (e.g. 2025 may not be finalized yet, fallback to 2024)
    let effectivePrev=prevAgg;
    let effectivePrevSeason=prevSeason;
    if(!Object.keys(prevAgg).length){
      const fallbackSeason=String(parseInt(prevSeason)-1);
      console.log('Previous season stats empty for '+prevSeason+', trying '+fallbackSeason);
      effectivePrev=await sfStats(fallbackSeason).catch(()=>({}));
      effectivePrevSeason=fallbackSeason;
    }

    // Process ALL players from the aggregate response (not just rostered)
    // This ensures free agent IDP players also get stats for waiver recommendations
    const allStatPids=new Set([...allLeaguePlayers,...Object.keys(effectivePrev),...Object.keys(curAgg||{})]);
    allStatPids.forEach(pid=>{
      if(!S.players[pid])return;
      const pos=S.players[pid]?.position;
      if(!pos||['K','DEF','P'].includes(pos))return;
      if(!S.playerStats[pid])S.playerStats[pid]={};

      // Previous season — always available
      const prev=effectivePrev[pid];
      if(prev){
        const pts=calcFantasyPts(prev,sc);
        const gp=prev.gp||prev.games_played||17;
        S.playerStats[pid].prevTotal=+pts.toFixed(1);
        S.playerStats[pid].prevAvg=gp>0?+(pts/gp).toFixed(1):+(pts/17).toFixed(1);
        S.playerStats[pid].prevSeason=effectivePrevSeason;
        S.playerStats[pid].prevRawStats=prev;
      }

      // Current season (if in-season)
      const cur=curAgg[pid];
      if(cur){
        const pts=calcFantasyPts(cur,sc);
        const gp=cur.gp||cur.games_played||17;
        S.playerStats[pid].seasonTotal=+pts.toFixed(1);
        S.playerStats[pid].seasonAvg=+(pts/gp).toFixed(1);
        S.playerStats[pid].curRawStats=cur;
      }

      // In offseason: promote prev season avg as primary
      if(isOffseason&&S.playerStats[pid].prevAvg){
        S.playerStats[pid].seasonAvg=S.playerStats[pid].prevAvg;
      }
    });

    // Update column header with prev season year
    const thPrev=$('th-prev');const thPrevTot=$('th-prevtot');
    if(thPrev)thPrev.textContent=`'${effectivePrevSeason.slice(2)}avg`;
    if(thPrevTot)thPrevTot.textContent=`'${effectivePrevSeason.slice(2)}tot`;

    // Positional ranks — all rostered players sorted by pts
    const posPts={};
    allLeaguePlayers.forEach(pid=>{
      const pos=pPos(pid);if(!pos)return;
      const pts=S.playerStats[pid]?.seasonTotal||0;
      if(!posPts[pos])posPts[pos]=[];
      posPts[pos].push({pid,pts});
    });
    Object.entries(posPts).forEach(([pos,arr])=>{
      arr.sort((a,b)=>b.pts-a.pts).forEach(({pid},i)=>{S.posRanks[pid]=i+1;});
    });

    buildRosterTable();
    renderDraftNeeds();
    updateSyncStatus();
  }catch(e){console.warn('Stats load error:',e);updateSyncStatus();}
}


// calcFantasyPts lives in shared/sleeper-api.js (window.calcFantasyPts / window.Sleeper.calcFantasyPts).
// Calls in loadRosterStats and ui.js resolve via the window global set there.

// ── Expose on window.App ────────────────────────────────────────
// NOTE: sf and SLEEPER are intentionally NOT re-exported here.
// shared/sleeper-api.js owns window.App.sf (cached sleeperFetch) and
// window.App.SLEEPER. Re-exporting them here would silently overwrite
// the shared cached version with the local bare fetch wrapper.
Object.assign(window.App, {
  fetchTrending,
  loadLeague,
  loadOwnership,
  loadRosterStats,
});

// ── Module global exports (Vite migration) ───────────────────────────────────
window.fetchTrending = fetchTrending;
window.loadLeague = loadLeague;
window.loadOwnership = loadOwnership;
window.loadRosterStats = loadRosterStats;
