/* global renderWaivers, renderWaiverWorkbench */
// ══════════════════════════════════════════════════════════════════
// warroom-scout/js/app.js — State, utilities, connect flow, boot
// Loaded FIRST — sets up window.App namespace for all modules
// ══════════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Dev Mode ────────────────────────────────────────────────────
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const LANDING_PREVIEW = new URLSearchParams(window.location.search).has('landingPreview');
const DEV_MODE = !LANDING_PREVIEW && (new URLSearchParams(window.location.search).has('dev') || window.location.hostname.includes('sandbox') || IS_LOCAL);
const PLATFORM_BETA_ACCESS = new URLSearchParams(window.location.search).get('platform_beta') === '1';
const PLATFORM_SANDBOX_ACCESS = PLATFORM_BETA_ACCESS;
const MFL_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
window.App.DEV_MODE = DEV_MODE;
window.App.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
window.App.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
window.DEV_MODE = DEV_MODE;
window.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
window.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
if(DEV_MODE){
  console.log('%c[DEV MODE] All features unlocked, auth bypassed','color:#fbbf24;font-weight:bold;font-size:14px');
  // Inject dev banner
  document.addEventListener('DOMContentLoaded',()=>{
    const b=document.createElement('div');
    b.className='dev-mode-banner';
    b.style.cssText='position:sticky;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#000;font-size:13px;font-weight:700;text-align:center;padding:3px;letter-spacing:.05em;font-family:"JetBrains Mono",monospace';
    b.textContent = IS_LOCAL ? '⚡ LOCAL DEV — bigloco auto-logged in, all features unlocked' : '⚡ SANDBOX — changes here do not affect production';
    document.body.classList.add('dev-banner-active');
    document.body.prepend(b);
  });
}

const PLATFORM_LABELS={sleeper:'Sleeper',espn:'ESPN',mfl:'MFL',yahoo:'Yahoo'};
function platformAccessAllowed(platform){
  platform=platform||'sleeper';
  return platform==='sleeper'||!!PLATFORM_SANDBOX_ACCESS;
}
function mflAccessAllowed(){return platformAccessAllowed('mfl');}
function platformBetaMessage(platform){
  const label=PLATFORM_LABELS[platform]||'This platform';
  return label+' is not approved for Scout yet. Sleeper is the supported platform right now.';
}
function normalizePlatformAccess(platform){
  platform=platform||'sleeper';
  return platformAccessAllowed(platform)?platform:'sleeper';
}
window.platformAccessAllowed=platformAccessAllowed;
window.App.platformAccessAllowed=platformAccessAllowed;

// ── Global State ────────────────────────────────────────────────
let S={
  user:null,leagues:[],leagueUsers:[],rosters:[],matchups:{},
  transactions:{},tradedPicks:[],players:{},
  ownership:{},nflState:null,bracket:{w:[],l:[]},
  currentLeagueId:null,myRosterId:null,apiKey:'',aiProvider:'anthropic',aiModel:'',chatHistory:[],
  currentWeek:1,season:String(new Date().getFullYear()),
  tradeCalc:{a:[],b:[]},agentLog:[],lastDigest:null,
  playerStats:{},playerProj:{},depthCharts:{},posRanks:{}
};
window.App.S = S;
window.S = S; // global access for inline handlers

// ── State Registry ──────────────────────────────────────────────
// All global state containers — canonical access is always window.App.*
// Never add new state containers without registering them here.
//
//  window.App.S / window.S             Primary app state: players, rosters, leagues, stats, etc.
//  window.App.LI / window.LI           League Intel: DHQ player scores, owner profiles, peak windows.
//                                      Set by shared/dhq-engine.js; loads asynchronously.
//  window.LI_LOADED                    Boolean: LI has finished loading (dhq-engine.js)
//  window._liLoading                   Boolean: LI load in progress (dhq-engine.js)
//  window._playerTags                  { [pid]: tag } — player tag overrides (ui.js / player-modal.js)
//
// Chat state — in ai-chat.js, added to window.App after that module loads:
//  window.App.homeChatHistory          Home tab chat messages array
//  window.App.tradeChatHistory         Trade tab chat messages array
//  window.App.draftChatHistory         Draft tab chat messages array
//  window.App.tradeBuilderAssets       { mine:[], theirs:[] } trade builder working state

// ── Utilities ──────────────────────────────────────────────────
const escHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const $=id=>document.getElementById(id);
const ss=(id,msg,err)=>{const e=$(id);if(e){e.textContent=msg;e.className='status-txt'+(err?' err':'')}};
const basePosLabel=window.App?.posLabel||((pos)=>pos||'');
const posLabel=(slot,pid)=>{if(pid===undefined)return basePosLabel(slot);const mapped=window.App.posMap?.[slot];if(mapped&&mapped!=='BN'&&mapped!=='FLEX')return basePosLabel(mapped);return basePosLabel(pPos(pid)||slot||'?');};
function removeLoading(id){const e=$('ld-'+id);if(e)e.remove();}
const pName=id=>{if(!id)return'—';const p=S.players[id];if(!p)return id;if(p.position==='DEF')return(p.full_name||id)+' D/ST';return p.full_name||`${p.first_name||''} ${p.last_name||''}`.trim()||id};
const pNameShort=id=>{if(!id)return'—';const p=S.players[id];if(!p)return id;const f=p.first_name||'';const l=p.last_name||'';if(!f||!l)return pName(id);return f[0]+'. '+l;};
const pM=p=>{if(!p)return'';if(['DB','CB','S','SS','FS'].includes(p))return'DB';if(['DL','DE','DT','NT','IDL','EDGE'].includes(p))return'DL';if(['LB','OLB','ILB','MLB'].includes(p))return'LB';return p;};
const pTeam=id=>S.players[id]?.team||'';
const pPos=id=>S.players[id]?.position||'';
const pAge=id=>{
  const p=S.players[id]; if(!p) return '';
  if(p.age&&p.age>0) return p.age;
  if(p.birth_date){
    const birth=new Date(p.birth_date);
    const age=Math.floor((Date.now()-birth.getTime())/(365.25*24*60*60*1000));
    if(age>0&&age<50) return age;
  }
  if(p.years_exp===0) return 22;
  return '';
};
const pExp=id=>S.players[id]?.years_exp??'';
const getUser=oid=>{const u=S.leagueUsers.find(u=>u.user_id===oid);return u?(u.metadata?.team_name||u.display_name||u.username||'Team'):'Team'};
const myR=()=>S.rosters?.find(r=>r.roster_id===S.myRosterId||(r.co_owners||[]).includes(S.myUserId));
const prog=pct=>{const el=$('prog-bar');if(el)el.style.width=pct+'%';const dp=$('dhq-progress');const df=$('dhq-progress-fill');if(dp){dp.style.display=pct>0&&pct<100?'block':'none';if(df)df.style.width=pct+'%';}};
const setAgentStatus=(txt,active)=>{const t=$('agent-txt');const d=$('agent-dot');if(t)t.textContent=txt;if(d)d.className='status-dot'+(active?' thinking':active===false?' active':'')};

// Expose utilities globally (for inline onclick handlers and other modules)
Object.assign(window, {escHtml,$,ss,posLabel,removeLoading,pName,pNameShort,pM,pTeam,pPos,pAge,pExp,getUser,myR,prog,setAgentStatus});
Object.assign(window.App, {escHtml,$,ss,posLabel,removeLoading,pName,pNameShort,pM,pTeam,pPos,pAge,pExp,getUser,myR,prog,setAgentStatus});

// ── Season detection & Lineup tab visibility ──────────────────
function isNFLInSeason() {
  const st = S.nflState?.season_type;
  if (st === 'regular' || st === 'post') return true;
  if (st === 'pre' || st === 'off') return false;
  const m = new Date().getMonth();
  return m >= 8 || m <= 1;
}

function updateLineupTabVisibility() {
  const inSeason = isNFLInSeason();
  const lineupNav = document.getElementById('mnav-startsit');
  if (lineupNav) lineupNav.style.display = inSeason ? '' : 'none';

  const existingPromo = document.getElementById('lineup-promo-card');
  if (existingPromo) existingPromo.remove();
}
window.isNFLInSeason = isNFLInSeason;
window.updateLineupTabVisibility = updateLineupTabVisibility;
document.addEventListener('DOMContentLoaded', updateLineupTabVisibility);

// Bulk sync any pending field log entries on app load
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to let Supabase client initialize
  setTimeout(() => {
    if (window.OD?.syncPendingFieldLog) {
      window.OD.syncPendingFieldLog().then(count => {
        if (count > 0 && typeof renderFieldLogCard === 'function') {
          renderFieldLogCard();
          renderFieldLogPanel();
        }
        if (typeof window.refreshFieldLogFromRemote === 'function') {
          window.refreshFieldLogFromRemote();
        }
      }).catch(() => {});
    } else if (typeof window.refreshFieldLogFromRemote === 'function') {
      window.refreshFieldLogFromRemote();
    }
  }, 1500);
});

// ── Tab switching ──────────────────────────────────────────────
function switchTab(tab,btn){
  // Guard: redirect to home if not connected (except settings and shell tabs that can explain next steps)
  const publicTabs = new Set(['digest','settings','league','fieldlog','portfolio','tools','trades','ai','calendar','history','analytics']);
  if(!S.user && !publicTabs.has(tab)){
    tab='digest';btn=null;
    showToast('Connect your Sleeper account first');
    // Focus the username input
    setTimeout(()=>{const inp=$('u-input');if(inp)inp.focus();},200);
  }
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  if(btn)btn.classList.add('active');
  else if(tab==='digest'){const homeBtn=document.querySelector('.tab[onclick*="digest"],.mobile-nav-item[onclick*="digest"]');if(homeBtn)homeBtn.classList.add('active');}
  const panel=$('panel-'+tab);
	  if(panel){
	    panel.classList.add('active');
	    if(typeof window._animatePanel==='function')window._animatePanel(panel);
	  }
	  window.OD?.track?.('module_viewed', { platform: 'reconai', module: tab });
	  if(tab==='waivers'){
	    if(typeof loadMentality==='function')loadMentality();
	    if(typeof renderWaivers==='function')renderWaivers();
	    else if(typeof renderWaiverWorkbench==='function')renderWaiverWorkbench();
	  }
  if(tab==='draftroom'){
    // Show entry cards by default (not a half-rendered board or mid-mock)
    if(typeof window.exitDraftRoom==='function')window.exitDraftRoom();
    if(typeof window._refreshDraftEntrySubtitles==='function')window._refreshDraftEntrySubtitles();
    if(typeof window.renderDraftEntryPicks==='function')window.renderDraftEntryPicks();
    if(typeof window.renderDraftGameplan==='function')window.renderDraftGameplan();
    const draftDirectMode = window._draftDirectMode;
    window._draftDirectMode = null;
    if(draftDirectMode&&typeof window.enterDraftRoom==='function'){
      setTimeout(()=>window.enterDraftRoom(draftDirectMode),0);
    }
  }
  if(tab==='digest'){
    if(typeof renderMobileHome==='function')renderMobileHome();
    else if(typeof renderHomeSnapshot==='function')renderHomeSnapshot();
  }
  if(tab==='team'&&typeof window.renderTeamCommandPanel==='function')window.renderTeamCommandPanel();
  if(tab==='tools'&&typeof window.renderToolsPanel==='function')window.renderToolsPanel();
  if(tab==='ai'&&typeof window.renderAIPanel==='function')window.renderAIPanel();
  if(tab==='calendar'&&typeof window.renderCalendarPanel==='function')window.renderCalendarPanel();
  if(tab==='history'&&typeof window.renderHistoryPanel==='function')window.renderHistoryPanel();
  if(tab==='analytics'&&typeof window.renderAnalyticsPanel==='function')window.renderAnalyticsPanel();
  if(tab==='portfolio'&&typeof window.renderPortfolioPanel==='function')window.renderPortfolioPanel();
  if(tab==='settings'&&typeof updateSettingsStatus==='function')updateSettingsStatus();
  if(tab==='settings'&&typeof updateTrialSettingsSection==='function')updateTrialSettingsSection();
  if(tab==='roster'&&typeof buildRosterTable==='function')buildRosterTable();
  if(tab==='startsit'&&typeof renderStartSit==='function')renderStartSit();
  if(tab==='trades'){
    if(typeof window.renderTradeStudio==='function')window.renderTradeStudio();
    else {
      if(typeof renderTradeIntel==='function')renderTradeIntel();
      if(typeof initTradeCalc==='function')initTradeCalc();
    }
  }
}
window.switchTab = switchTab;
window.App.switchTab = switchTab;

function showToast(msg='Copied!'){
  const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2000);
}
window.showToast = showToast;
window.App.showToast = showToast;

function copyText(text,btn){
  navigator.clipboard.writeText(text).then(()=>{
    showToast(); if(btn){btn.textContent='Copied ✓';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},2000);}
  });
}
window.copyText = copyText;
window.App.copyText = copyText;

// ── Connect ────────────────────────────────────────────────────
async function connect(usernameOverride){
  const uIn=$('u-input');
  const username=(usernameOverride||uIn?.value||DhqStorage.getStr(STORAGE_KEYS.USERNAME)||'').trim();
  if(!username)return;
  S.platform='sleeper';
  S.myUserId=null;
  if(uIn&&!uIn.value)uIn.value=username;
  const btn=$('conn-btn');if(btn){btn.disabled=true;btn.textContent='Connecting...';}
  const progEl=$('prog');if(progEl)progEl.style.display='block';prog(5);
  ss('conn-status','Looking up user...');
  try{
    const sf=window.App.sf;
    const user=await sf(`/user/${username}`);
    if(!user?.user_id){ss('conn-status','User not found.',true);if(btn){btn.disabled=false;btn.textContent='Connect my league';}return;}
    S.user=user;const sUser=$('s-user');if(sUser)sUser.textContent=user.display_name||username;
    DhqStorage.setStr(STORAGE_KEYS.USERNAME, username);
    // Acquire Supabase JWT for RLS (non-blocking — don't fail connect if this fails)
    prog(10);ss('conn-status','Authenticating...');
    try{
      if(window.OD?.acquireSessionToken){
        const session=await window.OD.acquireSessionToken(username);
        if(session?.token){
          console.log('[Scout] Supabase session acquired');
          if(window.OD.ensureUser)await window.OD.ensureUser(username);
        }else{
          console.log('[Scout] No Supabase session — localStorage fallback');
        }
      }
    }catch(e){console.warn('[Scout] Auth error (non-fatal):',e);}
    prog(12);ss('conn-status','Loading NFL state...');
    S.nflState=await sf('/state/nfl');
    S.currentWeek=S.nflState?.display_week||S.nflState?.week||1;
    const defaultSeason=String(new Date().getFullYear());
    S.season=S.nflState?.league_create_season||S.nflState?.season||defaultSeason;
    const wpEl=$('week-pill');if(wpEl)wpEl.textContent='Wk '+S.currentWeek+' · '+S.season;
    prog(20);ss('conn-status','Loading leagues for '+S.season+'...');
    const leagues=await sf(`/user/${user.user_id}/leagues/nfl/${S.season}`);
    if(!leagues?.length){ss('conn-status','No leagues found for '+S.season+'.',true);if(btn){btn.disabled=false;btn.textContent='Connect my league';}return;}
    S.leagues=leagues;
    if(typeof saveDiscoveredSleeperLeagues==='function')saveDiscoveredSleeperLeagues(leagues,username);
    prog(30);ss('conn-status','Loading player database (refreshing team assignments)...');
    S.players=await (window.fetchPlayers ? window.fetchPlayers() : sf('/players/nfl'));
    prog(50);
    showLeaguePicker(leagues,user.user_id);
    if(btn)btn.textContent='Connected ✓';ss('conn-status','');prog(60);
  }catch(e){
    ss('conn-status','Error: '+e.message,true);
    if(btn){btn.disabled=false;btn.textContent='Connect my league';}
  }
}
window.connect = connect;
window.App.connect = connect;

// ── Two-step connect flow ──────────────────────────────────────

function showAuthStep() {
  const as = $('auth-step');
  const sb = $('setup-block');
  if (as) as.style.display = '';
  if (sb) sb.style.display = 'none';
}
window.showAuthStep = showAuthStep;

function showConnectStep() {
  const as = $('auth-step');
  const cs = $('connect-step');
  const sb = $('setup-block');
  if (as) as.style.display = 'none';
  if (sb) sb.style.display = 'block';
  if (cs) cs.style.display = '';
  // Focus first input after a short delay
  setTimeout(() => { const inp = $('u-input'); if (inp) inp.focus(); }, 200);
}
window.showConnectStep = showConnectStep;

function continueAsGuest() {
  showConnectStep();
}
window.continueAsGuest = continueAsGuest;

// Check Supabase session; show auth-step or connect-step accordingly
async function _checkAuthAndShowStep() {
  if (DEV_MODE) { showConnectStep(); return; }
  try {
    const res = await window.OD?.supabase?.auth?.getSession?.();
    if (res?.data?.session) {
      if (getVisibleLeagueRegistry().length > 0) {
        renderLeagueHub();
      } else {
        showConnectStep();
      }
    } else {
      showAuthStep();
    }
  } catch(e) {
    showAuthStep();
  }
}

// After Google/Apple OAuth completes, Supabase fires onAuthStateChange.
// Transition from auth-step → connect-step (or league hub if leagues exist).
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    try {
      window.OD?.supabase?.auth?.onAuthStateChange?.((event, session) => {
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
          const as = $('auth-step');
          // Only act if auth-step is currently visible (setup-block is hidden when auth-step shows)
          if (as && as.style.display !== 'none') {
            if (getVisibleLeagueRegistry().length > 0) {
              renderLeagueHub();
            } else {
              showConnectStep();
            }
          }
        }
      });
    } catch(e) {}
  }, 600);
});

// ── Platform tab toggle ────────────────────────────────────────
function showPlatformTab(platform){
  platform=normalizePlatformAccess(platform);
  const forms={sleeper:'form-sleeper'};
  const tabs={sleeper:'tab-sleeper'};
  ['espn','mfl','yahoo'].forEach(p=>{if(platformAccessAllowed(p)){forms[p]='form-'+p;tabs[p]='tab-'+p;}});
  Object.values(forms).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
  Object.values(tabs).forEach(id=>{const el=$(id);if(el){el.style.background='transparent';el.style.color='var(--text3)';}});
  const formEl=$(forms[platform]||forms.sleeper);
  const tabEl=$(tabs[platform]||tabs.sleeper);
  if(formEl)formEl.style.display='block';
  if(tabEl){tabEl.style.background='var(--bg)';tabEl.style.color='var(--text)';}
  // Platform-specific init
  if(platform==='mfl'){const yrEl=$('mfl-year');if(yrEl&&!yrEl.value)yrEl.value=String(new Date().getFullYear());}
}
window.showPlatformTab = showPlatformTab;

// ── ESPN Connect ───────────────────────────────────────────────
async function connectESPN(){
  if(!platformAccessAllowed('espn')){ss('conn-status',platformBetaMessage('espn'),true);return;}
  const leagueIdRaw=($('espn-league-id')?.value||'').trim();
  if(!leagueIdRaw){ss('conn-status','Enter your ESPN League ID',true);return;}
  // ESPN league IDs are numeric
  const leagueId=leagueIdRaw.replace(/\D/g,'');
  if(!leagueId){ss('conn-status','League ID must be a number (from your ESPN URL)',true);return;}

  const espnS2=($('espn-s2')?.value||'').trim();
  const swid=($('espn-swid')?.value||'').trim();

  const btn=$('espn-conn-btn');
  if(btn){btn.disabled=true;btn.textContent='Connecting...';}
  const progEl=$('prog');if(progEl)progEl.style.display='block';
  prog(5);ss('conn-status','Connecting to ESPN...');

  try{
    if(!window.ESPN){throw new Error('ESPN connector not loaded — refresh and try again.');}

    const year=parseInt(S.nflState?.league_create_season||S.nflState?.season||S.season||String(new Date().getFullYear()));

    // Load Sleeper player DB for crosswalk (if not already loaded)
    prog(15);ss('conn-status','Loading player database...');
    if(!S.players||Object.keys(S.players).length<100){
      try{
        S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl'));
      }catch(e){
        console.warn('[ESPN] Could not load Sleeper player DB — crosswalk will be limited:',e);
        S.players=S.players||{};
      }
    }

    prog(35);ss('conn-status','Fetching ESPN league data...');
    const result=await window.ESPN.connectLeague(leagueId,year,espnS2,swid);

    prog(70);ss('conn-status','Mapping rosters...');

    // Show team picker — user must identify their own team
    if(btn){btn.disabled=false;btn.textContent='Connect ESPN League';}
    prog(80);
    showESPNTeamPicker(result,leagueId,year,espnS2,swid);

  }catch(e){
    ss('conn-status','Error: '+e.message,true);
    if(btn){btn.disabled=false;btn.textContent='Connect ESPN League';}
    if(progEl)progEl.style.display='none';
  }
}
window.connectESPN = connectESPN;

function showESPNTeamPicker(result,leagueId,year,espnS2,swid){
  if(!platformAccessAllowed('espn'))return;
  const{rosters,league}=result;
  const setupEl=$('setup-block');
  if(!setupEl)return;

  const teamRows=rosters.map(r=>`
    <div onclick="selectESPNTeam('${r.roster_id}','${leagueId}','${year}','${escHtml(espnS2||'')}','${escHtml(swid||'')}')"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s"
      onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
      <div style="width:36px;height:36px;border-radius:9px;background:#e03e2d;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${r.roster_id}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r._team_name||'Team '+r.roster_id)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${r.players.length} players · ${r.settings.wins}-${r.settings.losses}</div>
      </div>
    </div>`).join('');

  setupEl.innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;background:#e03e2d;color:#fff;border-radius:6px;padding:3px 10px;margin-bottom:10px;letter-spacing:.06em">ESPN</div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:6px">${escHtml(league.name)}</h3>
      <p style="font-size:13px;color:var(--text3)">${league.total_rosters} teams · ${year} · Select your team below</p>
    </div>
    <div id="espn-team-list" style="max-width:440px;margin:0 auto">${teamRows}</div>`;
}
window.showESPNTeamPicker = showESPNTeamPicker;

async function selectESPNTeam(rosterId,leagueId,year,espnS2,swid){
  if(!platformAccessAllowed('espn'))return;
  const S_ref=window.S||window.App?.S;
  if(!S_ref)return;

  // Set my roster
  S_ref.myRosterId=String(rosterId);

  // Show scanning spinner
  const setupEl=$('setup-block');
  if(setupEl)setupEl.innerHTML=`<div style="text-align:center;padding:30px 0">
    <span style="display:inline-block;width:24px;height:24px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#e03e2d;border-radius:50%;animation:spin .7s linear infinite"></span>
    <div style="font-size:16px;font-weight:700;margin:14px 0 6px">Loading your league...</div>
    <div style="font-size:13px;color:var(--text3)">Mapping ESPN data to Scout</div>
  </div>`;

  try{
    // Persist ESPN credentials
    try{
      localStorage.setItem('espn_league_id',leagueId);
      localStorage.setItem('espn_year',String(year));
      if(espnS2){sessionStorage.setItem('espn_s2',espnS2);localStorage.removeItem('espn_s2');}
      if(swid){sessionStorage.setItem('espn_swid',swid);localStorage.removeItem('espn_swid');}
      localStorage.setItem('espn_my_team',String(rosterId));
    }catch(e){}

    // Update league pill with ESPN badge
    _updateLeaguePillESPN(S_ref.leagues[0]?.name||'ESPN League');

    // Show the main dashboard
    const hubElE=$('league-hub');if(hubElE)hubElE.style.display='none';
    const sb=$('setup-block');if(sb)sb.style.display='none';
    const dc=$('digest-content');if(dc)dc.style.display='block';
    switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
    prog(100);

    try{if(typeof renderHomeSnapshot==='function')renderHomeSnapshot();}catch(e){}
    try{if(typeof checkApiKeyCallout==='function')checkApiKeyCallout();}catch(e){}
    try{if(typeof updateSettingsStatus==='function')updateSettingsStatus();}catch(e){}

    // Load DHQ intel + stats (uses Sleeper IDs from crosswalk, works for matched players)
    Promise.resolve().then(()=>loadAllData());

  }catch(e){
    console.error('[ESPN] selectESPNTeam error:',e);
    if(setupEl)setupEl.innerHTML=`<div style="color:var(--red);font-size:14px;text-align:center">Error: ${escHtml(e.message)}</div><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="connectESPN()">Try again</button>`;
  }
}
window.selectESPNTeam = selectESPNTeam;

function _updateLeaguePillESPN(leagueName){
  const lp=$('league-pill');
  if(lp)lp.innerHTML=`<span style="white-space:nowrap">${escHtml(leagueName)}</span><span id="platform-badge" style="font-size:11px;font-weight:700;background:#e03e2d;color:#fff;border-radius:4px;padding:1px 5px;flex-shrink:0;letter-spacing:.04em">ESPN</span><span style="opacity:.5;font-size:13px;flex-shrink:0">⇄</span>`;
}

// ── MFL Connect ───────────────────────────────────────────────
async function connectMFL(){
  if(!mflAccessAllowed()){ss('conn-status',platformBetaMessage('mfl'),true);return;}
  const leagueIdRaw=($('mfl-league-id')?.value||'').trim();
  if(!leagueIdRaw){ss('conn-status','Enter your MFL League ID',true);return;}
  const leagueId=leagueIdRaw.replace(/\D/g,'');
  if(!leagueId){ss('conn-status','League ID must be a number (from your MFL URL)',true);return;}

  const yearRaw=($('mfl-year')?.value||String(new Date().getFullYear())).trim();
  const year=parseInt(yearRaw)||new Date().getFullYear();
  const apiKey=($('mfl-api-key')?.value||'').trim();

  const btn=$('mfl-conn-btn');
  if(btn){btn.disabled=true;btn.textContent='Connecting...';}
  const progEl=$('prog');if(progEl)progEl.style.display='block';
  prog(5);ss('conn-status','Connecting to MFL...');

  try{
    if(!window.MFL){throw new Error('MFL connector not loaded — refresh and try again.');}

    prog(15);ss('conn-status','Loading player database...');
    if(!S.players||Object.keys(S.players).length<100){
      try{
        S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl'));
      }catch(e){
        console.warn('[MFL] Could not load Sleeper player DB — crosswalk will be limited:',e);
        S.players=S.players||{};
      }
    }

    prog(35);ss('conn-status','Fetching MFL league data...');
    const result=await window.MFL.connectLeague(leagueId,year,apiKey);

    prog(70);ss('conn-status','Mapping rosters...');
    if(btn){btn.disabled=false;btn.textContent='Connect MFL League';}
    prog(80);
    showMFLTeamPicker(result,leagueId,year,apiKey);

  }catch(e){
    ss('conn-status','Error: '+e.message,true);
    if(btn){btn.disabled=false;btn.textContent='Connect MFL League';}
    if(progEl)progEl.style.display='none';
  }
}
window.connectMFL = connectMFL;

function showMFLTeamPicker(result,leagueId,year,apiKey){
  if(!mflAccessAllowed())return;
  const{rosters,league}=result;
  const setupEl=$('setup-block');
  if(!setupEl)return;

  const teamRows=rosters.map(r=>`
    <div onclick="selectMFLTeam('${r.roster_id}','${leagueId}','${year}','${escHtml(apiKey||'')}')"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s"
      onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
      <div style="width:36px;height:36px;border-radius:9px;background:#0057b8;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${r.roster_id}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r._team_name||'Team '+r.roster_id)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${escHtml(r._owner_name||'')} · ${r.players.length} players</div>
      </div>
    </div>`).join('');

  setupEl.innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;background:#0057b8;color:#fff;border-radius:6px;padding:3px 10px;margin-bottom:10px;letter-spacing:.06em">MFL</div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:6px">${escHtml(league.name)}</h3>
      <p style="font-size:13px;color:var(--text3)">${league.total_rosters} teams · ${year} · Select your team below</p>
    </div>
    <div id="mfl-team-list" style="max-width:440px;margin:0 auto">${teamRows}</div>`;
}
window.showMFLTeamPicker = showMFLTeamPicker;

async function selectMFLTeam(rosterId,leagueId,year,apiKey){
  if(!mflAccessAllowed())return;
  const S_ref=window.S||window.App?.S;
  if(!S_ref)return;

  S_ref.myRosterId=String(rosterId);

  const setupEl=$('setup-block');
  if(setupEl)setupEl.innerHTML=`<div style="text-align:center;padding:30px 0">
    <span style="display:inline-block;width:24px;height:24px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#0057b8;border-radius:50%;animation:spin .7s linear infinite"></span>
    <div style="font-size:16px;font-weight:700;margin:14px 0 6px">Loading your league...</div>
    <div style="font-size:13px;color:var(--text3)">Mapping MFL data to Scout</div>
  </div>`;

  try{
    try{
      localStorage.setItem('mfl_league_id',leagueId);
      localStorage.setItem('mfl_year',String(year));
      if(apiKey){sessionStorage.setItem('mfl_api_key',apiKey);localStorage.removeItem('mfl_api_key');}
      localStorage.setItem('mfl_my_franchise',String(rosterId));
    }catch(e){}

    _updateLeaguePillMFL(S_ref.leagues[0]?.name||'MFL League');

    const hubElM=$('league-hub');if(hubElM)hubElM.style.display='none';
    const sb=$('setup-block');if(sb)sb.style.display='none';
    const dc=$('digest-content');if(dc)dc.style.display='block';
    switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
    prog(100);

    try{if(typeof renderHomeSnapshot==='function')renderHomeSnapshot();}catch(e){}
    try{if(typeof checkApiKeyCallout==='function')checkApiKeyCallout();}catch(e){}
    try{if(typeof updateSettingsStatus==='function')updateSettingsStatus();}catch(e){}

    Promise.resolve().then(()=>loadAllData());

  }catch(e){
    console.error('[MFL] selectMFLTeam error:',e);
    if(setupEl)setupEl.innerHTML=`<div style="color:var(--red);font-size:14px;text-align:center">Error: ${escHtml(e.message)}</div><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="connectMFL()">Try again</button>`;
  }
}
window.selectMFLTeam = selectMFLTeam;

function _updateLeaguePillMFL(leagueName){
  const lp=$('league-pill');
  if(lp)lp.innerHTML=`<span style="white-space:nowrap">${escHtml(leagueName)}</span><span id="platform-badge" style="font-size:11px;font-weight:700;background:#0057b8;color:#fff;border-radius:4px;padding:1px 5px;flex-shrink:0;letter-spacing:.04em">MFL</span><span style="opacity:.5;font-size:13px;flex-shrink:0">⇄</span>`;
}

// ── Yahoo Connect ──────────────────────────────────────────────
// OAuth flow: "Connect with Yahoo" → redirects to Yahoo → Yahoo redirects to
// yahoo-proxy Edge Function → Edge Function stores tokens → redirects back to
// app with ?yahoo_session=UUID → boot section detects param, shows league picker.
async function connectYahoo(){
  if(!platformAccessAllowed('yahoo')){ss('conn-status',platformBetaMessage('yahoo'),true);return;}
  if(!window.Yahoo){ss('conn-status','Yahoo connector not loaded — refresh and try again.',true);return;}

  const btn=$('yahoo-conn-btn');
  if(btn){btn.disabled=true;btn.textContent='Connecting...';}
  const progEl=$('prog');if(progEl)progEl.style.display='block';
  prog(5);ss('conn-status','Opening Yahoo sign-in...');

  try{
    // startAuth() redirects the page — no return value.
    await window.Yahoo.startAuth();
    // Execution stops here; Yahoo will redirect back to this page.
  }catch(e){
    ss('conn-status','Error: '+e.message,true);
    if(btn){btn.disabled=false;btn.textContent='Connect with Yahoo';}
    if(progEl)progEl.style.display='none';
  }
}
window.connectYahoo = connectYahoo;

// Manual league key entry — requires Yahoo session already established via OAuth.
async function connectYahooManual(){
  if(!platformAccessAllowed('yahoo')){ss('conn-status',platformBetaMessage('yahoo'),true);return;}
  const keyRaw=($('yahoo-league-key')?.value||'').trim();
  if(!keyRaw){ss('conn-status','Enter your Yahoo league key (e.g. 423.l.12345)',true);return;}
  if(!window.Yahoo){ss('conn-status','Yahoo connector not loaded — refresh and try again.',true);return;}
  if(!(sessionStorage.getItem('yahoo_session_id') || localStorage.getItem('yahoo_session_id'))){
    ss('conn-status','Authenticate with Yahoo first by clicking "Connect with Yahoo".',true);return;
  }

  const progEl=$('prog');if(progEl)progEl.style.display='block';
  prog(20);ss('conn-status','Fetching Yahoo league...');

  try{
    if(!S.players||Object.keys(S.players).length<100){
      try{S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl'));}catch(e){S.players=S.players||{};}
    }
    await _connectYahooLeague(keyRaw,null);
  }catch(e){
    ss('conn-status','Error: '+e.message,true);
    if(progEl)progEl.style.display='none';
  }
}
window.connectYahooManual = connectYahooManual;

function showYahooLeaguePicker(leagues){
  if(!platformAccessAllowed('yahoo'))return;
  const setupEl=$('setup-block');
  if(!setupEl)return;

  const rows=leagues.map(l=>`
    <div onclick="selectYahooLeague('${escHtml(l.leagueKey)}')"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s"
      onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
      <div style="width:36px;height:36px;border-radius:9px;background:#6001d2;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${(l.season||'').slice(-2)||'NFL'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(l.name)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${l.numTeams} teams · ${l.season} · ${escHtml(l.leagueKey)}</div>
      </div>
    </div>`).join('');

  setupEl.innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;background:#6001d2;color:#fff;border-radius:6px;padding:3px 10px;margin-bottom:10px;letter-spacing:.06em">YAHOO</div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:6px">Your Yahoo Leagues</h3>
      <p style="font-size:13px;color:var(--text3)">Select the league you want to manage</p>
    </div>
    <div style="max-width:440px;margin:0 auto">${rows}</div>`;
}
window.showYahooLeaguePicker = showYahooLeaguePicker;

async function selectYahooLeague(leagueKey){
  if(!platformAccessAllowed('yahoo'))return;
  const setupEl=$('setup-block');
  if(setupEl)setupEl.innerHTML=`<div style="text-align:center;padding:30px 0">
    <span style="display:inline-block;width:24px;height:24px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#6001d2;border-radius:50%;animation:spin .7s linear infinite"></span>
    <div style="font-size:16px;font-weight:700;margin:14px 0 6px">Loading league...</div>
    <div style="font-size:13px;color:var(--text3)">Fetching rosters from Yahoo</div>
  </div>`;
  try{
    prog(40);ss('conn-status','Fetching league rosters...');
    const result=await window.Yahoo.connectLeague(leagueKey,null);
    prog(80);
    showYahooTeamPicker(result,leagueKey);
  }catch(e){
    if(setupEl)setupEl.innerHTML=`<div style="color:var(--red);font-size:14px;text-align:center">Error: ${escHtml(e.message)}</div><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="connectYahoo()">Try again</button>`;
  }
}
window.selectYahooLeague = selectYahooLeague;

async function _connectYahooLeague(leagueKey,myTeamId){
  if(!platformAccessAllowed('yahoo'))return;
  prog(50);ss('conn-status','Fetching league rosters...');
  const teamKey=myTeamId?leagueKey+'.t.'+myTeamId:null;
  const result=await window.Yahoo.connectLeague(leagueKey,teamKey);
  prog(80);
  showYahooTeamPicker(result,leagueKey);
}

function showYahooTeamPicker(result,leagueKey){
  if(!platformAccessAllowed('yahoo'))return;
  const{rosters,league}=result;
  const setupEl=$('setup-block');
  if(!setupEl)return;

  const teamRows=rosters.map(r=>`
    <div onclick="selectYahooTeam('${r.roster_id}','${escHtml(leagueKey)}')"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s"
      onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
      <div style="width:36px;height:36px;border-radius:9px;background:#6001d2;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${r.roster_id}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r._team_name||'Team '+r.roster_id)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${escHtml(r._owner_name||'')} · ${r.players.length} players · ${r.settings.wins}-${r.settings.losses}</div>
      </div>
    </div>`).join('');

  setupEl.innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;background:#6001d2;color:#fff;border-radius:6px;padding:3px 10px;margin-bottom:10px;letter-spacing:.06em">YAHOO</div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:6px">${escHtml(league.name)}</h3>
      <p style="font-size:13px;color:var(--text3)">${league.total_rosters} teams · ${league.season} · Select your team below</p>
    </div>
    <div id="yahoo-team-list" style="max-width:440px;margin:0 auto">${teamRows}</div>`;
}
window.showYahooTeamPicker = showYahooTeamPicker;

async function selectYahooTeam(teamId,leagueKey){
  if(!platformAccessAllowed('yahoo'))return;
  const S_ref=window.S||window.App?.S;
  if(!S_ref)return;
  S_ref.myRosterId=String(teamId);

  const setupEl=$('setup-block');
  if(setupEl)setupEl.innerHTML=`<div style="text-align:center;padding:30px 0">
    <span style="display:inline-block;width:24px;height:24px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#6001d2;border-radius:50%;animation:spin .7s linear infinite"></span>
    <div style="font-size:16px;font-weight:700;margin:14px 0 6px">Loading your league...</div>
    <div style="font-size:13px;color:var(--text3)">Mapping Yahoo data to Scout</div>
  </div>`;

  try{
    try{
      localStorage.setItem('yahoo_league_key',leagueKey);
      localStorage.setItem('yahoo_my_team',String(teamId));
    }catch(e){}

    _updateLeaguePillYahoo(S_ref.leagues[0]?.name||'Yahoo League');

    const hubElY=$('league-hub');if(hubElY)hubElY.style.display='none';
    const sb=$('setup-block');if(sb)sb.style.display='none';
    const dc=$('digest-content');if(dc)dc.style.display='block';
    switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
    prog(100);

    try{if(typeof renderHomeSnapshot==='function')renderHomeSnapshot();}catch(e){}
    try{if(typeof checkApiKeyCallout==='function')checkApiKeyCallout();}catch(e){}
    try{if(typeof updateSettingsStatus==='function')updateSettingsStatus();}catch(e){}

    Promise.resolve().then(()=>loadAllData());

  }catch(e){
    console.error('[Yahoo] selectYahooTeam error:',e);
    if(setupEl)setupEl.innerHTML=`<div style="color:var(--red);font-size:14px;text-align:center">Error: ${escHtml(e.message)}</div><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="connectYahoo()">Try again</button>`;
  }
}
window.selectYahooTeam = selectYahooTeam;

function _updateLeaguePillYahoo(leagueName){
  const lp=$('league-pill');
  if(lp)lp.innerHTML=`<span style="white-space:nowrap">${escHtml(leagueName)}</span><span id="platform-badge" style="font-size:11px;font-weight:700;background:#6001d2;color:#fff;border-radius:4px;padding:1px 5px;flex-shrink:0;letter-spacing:.04em">YAHOO</span><span style="opacity:.5;font-size:13px;flex-shrink:0">⇄</span>`;
}

// Auto-restore ESPN session on page load
function _tryRestoreESPN(){
  try{
    if(!platformAccessAllowed('espn'))return false;
    const leagueId=localStorage.getItem('espn_league_id');
    const year=localStorage.getItem('espn_year');
    const myTeam=localStorage.getItem('espn_my_team');
    if(!leagueId||!year||!myTeam)return false;
    // Check if we have the data already
    if(S.platform==='espn'&&S.currentLeagueId)return true;
    return false; // Needs fresh fetch — caller handles
  }catch(e){return false;}
}


function showAddPlatform(platform){
  platform=normalizePlatformAccess(platform);
  const sb=$('setup-block');if(!sb)return;
  const ts=p=>`background:${p===platform?'var(--bg)':'transparent'};color:${p===platform?'var(--text)':'var(--text3)'}`;
  const hasReg=getVisibleLeagueRegistry().length>0;
  sb.innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      ${hasReg?`<button onclick="renderLeagueHub()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0;display:flex;align-items:center;gap:4px">← Back</button>`:''}
      <div style="font-size:16px;font-weight:700;letter-spacing:-.02em;flex:1">Add a League</div>
    </div>
    <div style="max-width:380px;margin:0 auto 12px;display:flex;gap:6px;background:var(--bg3);border-radius:10px;padding:4px">
      <button id="tab-sleeper" onclick="showPlatformTab('sleeper')" style="flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;${ts('sleeper')}">Sleeper</button>
      <button id="tab-espn"    onclick="showPlatformTab('espn')"    style="${platformAccessAllowed('espn')?'':'display:none;'}flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;${ts('espn')}">ESPN</button>
      ${platformAccessAllowed('mfl')?`<button id="tab-mfl" onclick="showPlatformTab('mfl')" style="flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;${ts('mfl')}">MFL</button>`:''}
      <button id="tab-yahoo"   onclick="showPlatformTab('yahoo')"   style="${platformAccessAllowed('yahoo')?'':'display:none;'}flex:1;padding:8px 12px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;${ts('yahoo')}">Yahoo</button>
    </div>
    <div id="form-sleeper" style="${platform==='sleeper'?'':'display:none;'}max-width:380px;margin:0 auto 14px">
      <input type="text" id="u-input" placeholder="Sleeper username" style="width:100%;font-size:16px;padding:14px 16px;border-radius:12px;margin-bottom:8px;box-sizing:border-box" onkeydown="if(event.key==='Enter')connect()"/>
      <button class="btn" id="conn-btn" onclick="connect()" style="width:100%;padding:14px;font-size:15px;font-weight:700;border-radius:12px;box-sizing:border-box">Connect Sleeper</button>
    </div>
    <div id="form-espn" style="${platformAccessAllowed('espn')?(platform==='espn'?'':'display:none;'):'display:none;'}max-width:380px;margin:0 auto 14px">
      <input type="text" id="espn-league-id" placeholder="ESPN League ID" style="width:100%;font-size:16px;padding:14px 16px;border-radius:12px;margin-bottom:8px;box-sizing:border-box" onkeydown="if(event.key==='Enter')connectESPN()"/>
      <details style="margin-bottom:8px"><summary style="font-size:13px;color:var(--text3);cursor:pointer;padding:6px 0;list-style:none;display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--text3)">&#9654;</span> Private league? Add cookies</summary>
        <div style="padding:10px 0 4px">
          <div style="font-size:12px;color:var(--text3);line-height:1.6;margin-bottom:8px">Find these in your browser: open ESPN Fantasy, press F12 → Application → Cookies → fantasy.espn.com</div>
          <input type="password" id="espn-s2" placeholder="espn_s2 cookie value" style="width:100%;font-size:13px;padding:10px 12px;border-radius:8px;margin-bottom:6px;box-sizing:border-box;font-family:'JetBrains Mono',monospace"/>
          <input type="text" id="espn-swid" placeholder="SWID cookie value  {XXXXXXXX-...}" style="width:100%;font-size:13px;padding:10px 12px;border-radius:8px;box-sizing:border-box;font-family:'JetBrains Mono',monospace"/>
        </div>
      </details>
      <button class="btn" id="espn-conn-btn" onclick="connectESPN()" style="width:100%;padding:14px;font-size:15px;font-weight:700;border-radius:12px;box-sizing:border-box;background:linear-gradient(135deg,#e03e2d,#c0392b)">Connect ESPN League</button>
    </div>
    ${platformAccessAllowed('mfl')?`<div id="form-mfl" style="${platform==='mfl'?'':'display:none;'}max-width:380px;margin:0 auto 14px">
      <input type="text" id="mfl-league-id" placeholder="MFL League ID" style="width:100%;font-size:16px;padding:14px 16px;border-radius:12px;margin-bottom:8px;box-sizing:border-box" onkeydown="if(event.key==='Enter')connectMFL()"/>
      <input type="text" id="mfl-year" placeholder="Season year (e.g. 2024)" style="width:100%;font-size:16px;padding:14px 16px;border-radius:12px;margin-bottom:8px;box-sizing:border-box" onkeydown="if(event.key==='Enter')connectMFL()"/>
      <details style="margin-bottom:8px"><summary style="font-size:13px;color:var(--text3);cursor:pointer;padding:6px 0;list-style:none;display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--text3)">&#9654;</span> Private league? Add API key</summary>
        <div style="padding:10px 0 4px">
          <input type="password" id="mfl-api-key" placeholder="MFL API key" style="width:100%;font-size:13px;padding:10px 12px;border-radius:8px;box-sizing:border-box;font-family:'JetBrains Mono',monospace"/>
        </div>
      </details>
      <button class="btn" id="mfl-conn-btn" onclick="connectMFL()" style="width:100%;padding:14px;font-size:15px;font-weight:700;border-radius:12px;box-sizing:border-box;background:linear-gradient(135deg,#0057b8,#003d8a)">Connect MFL League</button>
    </div>`:''}
    <div id="form-yahoo" style="${platformAccessAllowed('yahoo')?(platform==='yahoo'?'':'display:none;'):'display:none;'}max-width:380px;margin:0 auto 14px">
      <div style="text-align:center;padding:10px 0 16px">
        <div style="display:inline-block;background:linear-gradient(135deg,#6001d2,#430099);border-radius:12px;padding:10px 16px;margin-bottom:12px">
          <svg viewBox="0 0 60 20" width="60" height="20" fill="white"><text x="0" y="16" font-family="Arial Black,sans-serif" font-weight="900" font-size="18">Yahoo!</text></svg>
        </div>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;margin:0">Connect your Yahoo account via OAuth to pull your fantasy leagues.</p>
      </div>
      <button class="btn" id="yahoo-conn-btn" onclick="connectYahoo()" style="width:100%;padding:14px;font-size:15px;font-weight:700;border-radius:12px;box-sizing:border-box;background:linear-gradient(135deg,#6001d2,#430099)">Connect with Yahoo</button>
      <div id="yahoo-league-key-section" style="display:none;margin-top:10px">
        <div style="font-size:12px;color:var(--text3);text-align:center;margin-bottom:8px">Or enter your league key directly (e.g. 423.l.12345)</div>
        <input type="text" id="yahoo-league-key" placeholder="423.l.12345" style="width:100%;font-size:15px;padding:12px 14px;border-radius:10px;margin-bottom:8px;box-sizing:border-box;font-family:'JetBrains Mono',monospace" onkeydown="if(event.key==='Enter')connectYahooManual()"/>
        <button class="btn btn-ghost" onclick="connectYahooManual()" style="width:100%;padding:12px;font-size:14px;font-weight:700;border-radius:10px;box-sizing:border-box">Connect with League Key</button>
      </div>
      <button onclick="document.getElementById('yahoo-league-key-section').style.display=document.getElementById('yahoo-league-key-section').style.display==='none'?'block':'none'" style="display:block;width:100%;margin-top:8px;background:none;border:none;cursor:pointer;font-size:12px;color:var(--text3);text-align:center;padding:4px">Have a league key instead?</button>
    </div>
    <div id="conn-status" class="status-txt" style="text-align:center;margin-bottom:4px"></div>
    <div class="prog" id="prog" style="display:none;max-width:380px;margin:0 auto"><div class="prog-bar" id="prog-bar" style="width:0%"></div></div>
    <div style="text-align:center;font-size:13px;color:var(--text3);margin-top:12px">Read-only access · Nothing posted to your league · No data stored externally</div>`;
  setTimeout(()=>{
    if(platform==='sleeper'){const u=$('u-input');if(u)u.focus();}
    else if(platform==='espn'){const e=$('espn-league-id');if(e)e.focus();}
  },100);
}
window.showAddPlatform=showAddPlatform;
window.App.showAddPlatform=showAddPlatform;

async function loadLeagueFromRegistry(leagueId){
  const reg=getVisibleLeagueRegistry();
  const entry=reg.find(e=>e.leagueId===leagueId);
  if(!entry){renderLeagueHub();return;}
  const sb=$('setup-block');
  if(sb)sb.innerHTML=`<div style="text-align:center;padding:20px 0">
    <div style="margin:0 auto 16px;width:52px;height:52px;background:linear-gradient(135deg,#d4af37,#b8941f);border-radius:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(212,175,55,0.3)">
      <span style="display:inline-block;width:24px;height:24px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#d4af37;border-radius:50%;animation:spin .7s linear infinite"></span>
    </div>
    <div style="font-size:16px;font-weight:700;margin-bottom:6px">${escHtml(entry.leagueName||'Loading...')}</div>
    <div style="font-size:13px;color:var(--text3)" id="scan-step">Reconnecting...</div>
    <div class="prog" id="prog" style="margin:12px auto 0;max-width:200px"><div class="prog-bar" id="prog-bar" style="width:10%"></div></div>
    <div id="conn-status" class="status-txt" style="text-align:center;margin-top:8px"></div>
  </div>`;
  // Pre-select this league so showLeaguePicker auto-picks it
  DhqStorage.setStr(STORAGE_KEYS.LEAGUE,leagueId);
  try{
    const plat=entry.platform||'sleeper';
    if(!platformAccessAllowed(plat)){
      renderLeagueHub();
      setTimeout(()=>{const st=$('conn-status');if(st){st.textContent=platformBetaMessage(plat);st.classList.add('err');}},100);
      return;
    }
    if(plat==='sleeper'){
      const sleeperUsername=entry.username||DhqStorage.getStr(STORAGE_KEYS.USERNAME)||S.user?.username||S.user?.display_name||'';
      if(!sleeperUsername){renderLeagueHub();setTimeout(()=>{const st=$('conn-status');if(st){st.textContent='Reconnect Sleeper to load this league';st.classList.add('err');}},100);return;}
      DhqStorage.setStr(STORAGE_KEYS.USERNAME,sleeperUsername);
      if(!S.players||Object.keys(S.players).length<100){
        try{S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl'));}catch(e2){S.players=S.players||{};}
      }
      const step=$('scan-step');if(step)step.textContent='Loading Sleeper data...';
      prog(20);
      await connect(sleeperUsername);
    }else if(plat==='espn'){
      if(entry.espnLeagueId)localStorage.setItem('espn_league_id',entry.espnLeagueId);
      if(entry.espnYear)localStorage.setItem('espn_year',entry.espnYear);
      if(entry.espnMyTeam)localStorage.setItem('espn_my_team',entry.espnMyTeam);
      if(entry.espnS2){sessionStorage.setItem('espn_s2',entry.espnS2);localStorage.removeItem('espn_s2');}
      if(entry.espnSwid){sessionStorage.setItem('espn_swid',entry.espnSwid);localStorage.removeItem('espn_swid');}
      await connectESPN();
    }else if(plat==='yahoo'){
      if(entry.yahooLeagueKey)localStorage.setItem('yahoo_league_key',entry.yahooLeagueKey);
      if(entry.yahooMyTeam)localStorage.setItem('yahoo_my_team',String(entry.yahooMyTeam));
      if(sessionStorage.getItem('yahoo_session_id') || localStorage.getItem('yahoo_session_id')){
        const step=$('scan-step');if(step)step.textContent='Reconnecting to Yahoo...';
        prog(20);
        const _teamKey=entry.yahooLeagueKey+'.t.'+entry.yahooMyTeam;
        const _res=await window.Yahoo.connectLeague(entry.yahooLeagueKey,_teamKey);
        S.myRosterId=String(entry.yahooMyTeam);
        if(!S.user)S.user={user_id:'yahoo_user',display_name:_res.league.name,username:'yahoo_user'};
        _updateLeaguePillYahoo(_res.league.name);
        const sbEl=$('setup-block');if(sbEl)sbEl.style.display='none';
        const dcEl=$('digest-content');if(dcEl)dcEl.style.display='block';
        switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
        prog(100);try{renderHomeSnapshot();}catch(e2){}
        Promise.resolve().then(()=>loadAllData());
      }else{
        showAddPlatform('yahoo');
        setTimeout(()=>{const st=$('conn-status');if(st){st.textContent='Yahoo session expired — reconnect below';}},100);
      }
    }else if(plat==='mfl'){
      if(!mflAccessAllowed()){
        renderLeagueHub();
        setTimeout(()=>{const st=$('conn-status');if(st){st.textContent=platformBetaMessage('mfl');st.classList.add('err');}},100);
        return;
      }
      showAddPlatform('mfl');
      setTimeout(()=>{
        const mflId=$('mfl-league-id');if(mflId&&entry.mflLeagueId)mflId.value=entry.mflLeagueId;
        const mflYr=$('mfl-year');if(mflYr&&entry.mflYear)mflYr.value=entry.mflYear;
        const mflKey=$('mfl-api-key');if(mflKey&&entry.mflApiKey)mflKey.value=entry.mflApiKey;
        connectMFL();
      },100);
    }
  }catch(e){
    console.warn('[Hub] loadLeagueFromRegistry failed:',e);
    renderLeagueHub();
    setTimeout(()=>{const st=$('conn-status');if(st){st.textContent='Connection failed — try again';st.classList.add('err');}},100);
  }
}
window.loadLeagueFromRegistry=loadLeagueFromRegistry;
window.App.loadLeagueFromRegistry=loadLeagueFromRegistry;

function showLeagueUpgradeFromHub(leagueId,leagueName){
  const reg=getVisibleLeagueRegistry();
  const current=reg.find(e=>e.leagueId===(S.currentLeagueId||DhqStorage.getStr(STORAGE_KEYS.LEAGUE)));
  showLeagueUpgradePrompt(
    {league_id:leagueId,name:leagueName||leagueId},
    {league_id:current?.leagueId,name:current?.leagueName||'your league'},
    leagueId,S.user?.user_id||''
  );
}
window.showLeagueUpgradeFromHub=showLeagueUpgradeFromHub;
window.App.showLeagueUpgradeFromHub=showLeagueUpgradeFromHub;

// Dynasty leagues hide redraft-era features (owner directive 2026-07-05,
// fail-open: keeper/unknown keep everything). One accessor over the shared
// predicate so every Scout gate agrees with warroom's LeagueSkin flags.
// Game Day surfaces (Start/Sit Lab, lineup check, bye planner) are EXEMPT
// per ruling E1 — do not wire this into those.
function currentLeagueAllowsRedraftFeatures(){
  const l=S.leagues?.find(x=>x.league_id===S.currentLeagueId);
  return window.App?.Intelligence?.allowRedraftFeatures
    ? window.App.Intelligence.allowRedraftFeatures(l)
    : !(l?.settings?.type===2); // fallback = today's behavior
}
window.currentLeagueAllowsRedraftFeatures=currentLeagueAllowsRedraftFeatures;
window.App.currentLeagueAllowsRedraftFeatures=currentLeagueAllowsRedraftFeatures;

function clearLeagueLoadingState(){
  if(!S.currentLeagueId||!S.myRosterId)return false;
  const hub=$('league-hub');if(hub)hub.style.display='none';
  const sb=$('setup-block');if(sb)sb.style.display='none';
  const dc=$('digest-content');if(dc)dc.style.display='block';
  return true;
}
window.clearLeagueLoadingState=clearLeagueLoadingState;
window.App.clearLeagueLoadingState=clearLeagueLoadingState;

function withPreviewTimeout(promise, timeoutMs, message){
  let timer=null;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(message||'Scout timed out while loading this league.')),timeoutMs);
  });
  return Promise.race([Promise.resolve(promise),timeout]).finally(()=>{if(timer)clearTimeout(timer);});
}
window.App.withPreviewTimeout=withPreviewTimeout;

function waitForLeagueReadyState(timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  return new Promise(resolve=>{
    const check=()=>{
      if(clearLeagueLoadingState()){resolve(true);return;}
      if(Date.now()>=deadline){resolve(false);return;}
      setTimeout(check,250);
    };
    check();
  });
}
window.App.waitForLeagueReadyState=waitForLeagueReadyState;

function getUrlLeagueId(){
  try{
    const searchLeague=new URLSearchParams(window.location.search).get('league');
    if(searchLeague)return searchLeague;
    const rawHash=(window.location.hash||'').replace(/^#/,'');
    const hashQuery=rawHash.includes('?')?rawHash.slice(rawHash.indexOf('?')+1):rawHash;
    return new URLSearchParams(hashQuery).get('league')||'';
  }catch(e){return '';}
}
window.getUrlLeagueId=getUrlLeagueId;
window.App.getUrlLeagueId=getUrlLeagueId;

function showLeaguePicker(leagues,userId){
  try{
    // URL param from War Room takes priority
    const urlLeague=getUrlLeagueId();
    if(urlLeague&&leagues.find(l=>l.league_id===urlLeague)){
      selectLeague(urlLeague,userId);
      return;
    }
    const savedLeague=DhqStorage.getStr(STORAGE_KEYS.LEAGUE);
    if(savedLeague&&leagues.find(l=>l.league_id===savedLeague)){
      selectLeague(savedLeague,userId);
      return;
    }
  }catch(e){}
  if(leagues.length===1){
    selectLeague(leagues[0].league_id,userId);
    return;
  }
  const typeLabel=t=>(['Redraft','Keeper','Dynasty'][t]||'Unknown');
  const statusLabel=s=>({pre_draft:'Pre-draft',drafting:'Drafting',in_season:'In Season',complete:'Complete'}[s]||s||'');
  // Determine which league is "unlocked" for free users:
  // the currently active/saved league, or the first in the list if none yet.
  const isFree=typeof getTier==='function'?getTier()==='free':false;
  const savedLeagueId=DhqStorage.getStr(STORAGE_KEYS.LEAGUE)||S.currentLeagueId||'';
  const unlockedId=isFree?(savedLeagueId&&leagues.find(l=>l.league_id===savedLeagueId)?savedLeagueId:leagues[0]?.league_id):null;
  $('setup-block').innerHTML=`
    <h3 style="font-size:18px;text-align:center">Choose your league</h3>
    <p style="font-size:14px;color:var(--text2);margin-bottom:18px;line-height:1.6;text-align:center">Found ${leagues.length} league${leagues.length>1?'s':''} for ${S.season}. Select the one you want to manage.</p>
    ${isFree?`<div style="max-width:440px;margin:0 auto 14px;padding:10px 14px;background:var(--accentL);border:1px solid var(--accent);border-radius:var(--rl);display:flex;align-items:center;gap:10px;font-size:13px;color:var(--accent)"><span style="font-size:16px">🔒</span><span>Free plan — 1 league. <strong>Upgrade</strong> to access all your leagues.</span></div>`:''}
    <div id="league-pick-list" style="max-width:440px;margin:0 auto">
      ${leagues.map((l,i)=>{
        const locked=isFree&&l.league_id!==unlockedId;
        return `
        <div onclick="trySelectLeague('${l.league_id}','${userId}')" style="position:relative;display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--rl);margin-bottom:8px;cursor:pointer;transition:all .2s;animation:cardIn .3s ease both;animation-delay:${i*0.05}s;${locked?'opacity:.65;':''}${locked?'filter:grayscale(.3);':''}" onmouseover="this.style.borderColor='${locked?'var(--border2)':'var(--accent)'}';${locked?'':'this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 16px rgba(212,175,55,.15)\'}'}" onmouseout="this.style.borderColor='var(--border2)';this.style.transform='none';this.style.boxShadow='none'">
          ${l.avatar?`<div style="position:relative;width:40px;height:40px;flex-shrink:0"><img src="https://sleepercdn.com/avatars/thumbs/${l.avatar}" style="width:40px;height:40px;border-radius:10px;object-fit:cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div style="display:none;width:40px;height:40px;border-radius:10px;background:var(--accentL);align-items:center;justify-content:center;font-size:16px">\u{1F3C8}</div></div>`:`<div style="width:40px;height:40px;border-radius:10px;background:var(--accentL);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">\u{1F3C8}</div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em">${l.name||'Unnamed League'}</div>
            <div style="font-size:13px;color:var(--text3);margin-top:3px">${locked?`<span style="color:var(--accent);font-weight:600">🔒 Upgrade to unlock</span>`:`${l.total_rosters} teams · ${typeLabel(l.settings?.type)} · ${statusLabel(l.status)}`}</div>
          </div>
          <div style="font-size:13px;color:var(--text3);text-align:right;flex-shrink:0">
            <div style="color:var(--accent);font-weight:600">${l.season}</div>
            <div style="margin-top:2px;font-weight:500">${l.settings?.type===2?'Dynasty':'Redraft'}</div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}
window.showLeaguePicker = showLeaguePicker;

// ── League limit enforcement ───────────────────────────────────
// trySelectLeague — gate for free users. Paid users proceed directly.
// Free users: if clicking a league that isn't their current one, show
// the upgrade prompt (with option to switch). Otherwise proceed.
function trySelectLeague(leagueId,userId){
  const isFree=typeof getTier==='function'?getTier()==='free':false;
  if(!isFree){selectLeague(leagueId,userId);return;}
  const currentId=S.currentLeagueId||DhqStorage.getStr(STORAGE_KEYS.LEAGUE)||'';
  // No current league yet (first-time picker) — just pick it freely
  if(!currentId){selectLeague(leagueId,userId);return;}
  // Same league as currently active — allow (re-selecting same league is fine)
  if(leagueId===currentId){selectLeague(leagueId,userId);return;}
  // Free user trying a different league — show upgrade prompt
  const target=S.leagues.find(l=>l.league_id===leagueId);
  const current=S.leagues.find(l=>l.league_id===currentId);
  showLeagueUpgradePrompt(target,current,leagueId,userId);
}
window.trySelectLeague = trySelectLeague;
window.App.trySelectLeague = trySelectLeague;

// showLeagueUpgradePrompt — modal shown when a free user taps a locked league.
// Lists other available leagues as a teaser and offers upgrade + switch paths.
function showLeagueUpgradePrompt(targetLeague,currentLeague,leagueId,userId){
  const existing=document.getElementById('league-limit-modal');
  if(existing)existing.remove();
  const connectedName=escHtml(currentLeague?.name||'your league');
  const otherLeagues=(S.leagues||[]).filter(l=>l.league_id!==(currentLeague?.league_id));
  const avatarHtml=l=>l.avatar
    ?`<img src="https://sleepercdn.com/avatars/thumbs/${l.avatar}" style="width:28px;height:28px;border-radius:7px;object-fit:cover" onerror="this.style.display='none'"/>`
    :`<div style="width:28px;height:28px;border-radius:7px;background:var(--accentL);display:flex;align-items:center;justify-content:center;font-size:11px">\u{1F3C8}</div>`;
  const teaserHtml=otherLeagues.slice(0,4).map(l=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--rl)">
      ${avatarHtml(l)}
      <span style="font-size:13px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${escHtml(l.name||'League')}</span>
      <span style="font-size:12px;color:var(--text3)">🔒</span>
    </div>`).join('');
  const modal=document.createElement('div');
  modal.id='league-limit-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
  modal.innerHTML=`
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:18px;padding:28px 24px;max-width:400px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.5)">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:32px;margin-bottom:12px">🔒</div>
        <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px;letter-spacing:-.02em">You're connected to ${connectedName}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">Upgrade to add all your leagues and switch between them instantly.</div>
      </div>
      ${otherLeagues.length>0?`
      <div style="margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Your other leagues</div>
        <div style="display:flex;flex-direction:column;gap:6px">${teaserHtml}</div>
      </div>`:''}
      <div style="display:flex;flex-direction:column;gap:10px">
        <button onclick="document.getElementById('league-limit-modal').remove();if(window.showProLaunchPage)showProLaunchPage();" style="padding:13px 20px;background:linear-gradient(135deg,#d4af37,#b8941f);color:#1a1000;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:-.01em">Upgrade to War Room — unlock all leagues →</button>
        <button onclick="document.getElementById('league-limit-modal').remove();selectLeague('${leagueId}','${userId}')" style="padding:10px 20px;background:transparent;color:var(--text2);border:1px solid var(--border2);border-radius:12px;font-size:13px;font-weight:500;cursor:pointer">Switch to this league instead</button>
        <button onclick="document.getElementById('league-limit-modal').remove()" style="padding:8px;background:transparent;color:var(--text3);border:none;font-size:13px;cursor:pointer">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}
window.showLeagueUpgradePrompt = showLeagueUpgradePrompt;
window.App.showLeagueUpgradePrompt = showLeagueUpgradePrompt;

function switchLeagueMode(){
  const dc=$('digest-content');if(dc)dc.style.display='none';
  if(getVisibleLeagueRegistry().length>0){
    // Show hub if we have a registry; renderLeagueHub hides setup-block itself
    $('setup-block').style.display='none';
    renderLeagueHub();
  }else{
    $('setup-block').style.display='block';
    showLeaguePicker(S.leagues,S.user?.user_id||'');
  }
  switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
}
window.switchLeagueMode = switchLeagueMode;

async function selectLeague(leagueId,userId){
  S.currentLeagueId=leagueId;
  DhqStorage.setStr(STORAGE_KEYS.LEAGUE, leagueId);
  const league=S.leagues.find(l=>l.league_id===leagueId);
  const leagueName=league?.name||'League';
  const isDynasty=league?.settings?.type===2;
  const lpEl=$('league-pill');if(lpEl)lpEl.innerHTML='<span style="white-space:nowrap">'+escHtml(leagueName)+(isDynasty?'':' (Redraft)')+'</span><span style="opacity:.5;font-size:13px;flex-shrink:0">\u21C4</span>';
  const sbEl=$('setup-block');if(sbEl)sbEl.innerHTML=`<div style="text-align:center;padding:20px 0">
    <div style="margin:0 auto 16px;width:52px;height:52px;background:linear-gradient(135deg,#d4af37,#b8941f);border-radius:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(212,175,55,0.3)">
      <span style="display:inline-block;width:24px;height:24px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#d4af37;border-radius:50%;animation:spin .7s linear infinite"></span>
    </div>
    <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:6px">Scanning your league...</div>
    <div style="font-size:13px;color:var(--text3);line-height:1.5" id="scan-step">Fetching rosters and player data</div>
  </div>`;
  try{
    await loadLeague(leagueId,userId);
    clearLeagueLoadingState();
    switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
    prog(100);
    try{renderHomeSnapshot();}catch(e){dhqLog('selectLeague.renderHomeSnapshot',e);}
    checkApiKeyCallout();
    if(typeof updateSettingsStatus==='function')updateSettingsStatus();
    Promise.resolve().then(()=>{
      console.log('loadAllData: triggered via microtask');
      loadAllData();
    });
  }catch(e){
    const sb=$('setup-block');
    if(sb)sb.innerHTML=`<div style="color:var(--red);font-size:14px">Error: ${escHtml(e.message)}</div><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="connect()">Try again</button>`;
  }
}
window.selectLeague = selectLeague;

async function loadAllData(){
  if(!S.currentLeagueId||!S.myRosterId)return;
  clearLeagueLoadingState();
  console.log('loadAllData: starting...');
  const t0=Date.now();
  const loadBanner=$('dhq-loading-banner');
  if(loadBanner)loadBanner.style.display='none';
  prog(5);
  // ── Registry upsert with fresh metadata ───────────────────────
  try{
    const _plat=S.platform==='mfl'?'mfl':S.user?.user_id==='espn_user'?'espn':S.user?.user_id==='yahoo_user'?'yahoo':'sleeper';
    const _myR=S.rosters?.find(r=>String(r.roster_id)===String(S.myRosterId));
    const _lObj=S.leagues?.find(l=>l.league_id===S.currentLeagueId);
    if(typeof saveLeagueToRegistry==='function')saveLeagueToRegistry({
      leagueId:S.currentLeagueId,leagueName:_lObj?.name||'',platform:_plat,
      teamName:_myR?.owner?.display_name||_myR?.owner?.username||'',
      season:S.season,myRosterId:S.myRosterId,totalRosters:S.rosters?.length,
      isDynasty:_lObj?.settings?.type===2,
      username:_plat==='sleeper'?DhqStorage.getStr(STORAGE_KEYS.USERNAME):null,
      espnLeagueId:_plat==='espn'?localStorage.getItem('espn_league_id'):null,
      espnYear:_plat==='espn'?localStorage.getItem('espn_year'):null,
      espnMyTeam:_plat==='espn'?localStorage.getItem('espn_my_team'):null,
      espnS2:_plat==='espn'?(sessionStorage.getItem('espn_s2')||localStorage.getItem('espn_s2')):null,
      espnSwid:_plat==='espn'?(sessionStorage.getItem('espn_swid')||localStorage.getItem('espn_swid')):null,
      yahooLeagueKey:_plat==='yahoo'?localStorage.getItem('yahoo_league_key'):null,
      yahooMyTeam:_plat==='yahoo'?localStorage.getItem('yahoo_my_team'):null,
      mflLeagueId:_plat==='mfl'?localStorage.getItem('mfl_league_id'):null,
      mflYear:_plat==='mfl'?localStorage.getItem('mfl_year'):null,
      mflApiKey:_plat==='mfl'?(sessionStorage.getItem('mfl_api_key')||localStorage.getItem('mfl_api_key')):null,
    });
  }catch(e){}
  try{
    if(typeof updateSyncStatus==='function')updateSyncStatus();
    await Promise.all([
      loadRosterStats().catch(e=>{console.warn('Stats error:',e);return null;}),
      loadLeagueIntel().catch(e=>{console.warn('DHQ error:',e);return null;}),
      fetchTrending().catch(e=>{console.warn('Trending error:',e);return null;}),
      typeof window.loadRookieProspects==='function'?window.loadRookieProspects().catch(()=>null):null,
    ]);
    console.log('loadAllData: complete in '+((Date.now()-t0)/1000).toFixed(1)+'s | stats:'+Object.keys(S.playerStats||{}).length+' | DHQ:'+Object.keys((window.App.LI||{}).playerScores||{}).length);
    // Load commissioner league docs for AI context (non-blocking)
    if(window.OD?.getLeagueDocsContext&&S.currentLeagueId){
      window.OD.getLeagueDocsContext(S.currentLeagueId).then(ctx=>{if(ctx)window._leagueDocsContext=ctx;}).catch(()=>{});
    }
    // Validate core functions loaded
    const coreDeps = ['dynastyValue','assessTeamFromGlobal','getPlayerAction','buildRosterTable','renderMobileHome'];
    const missing = coreDeps.filter(fn => typeof window[fn] !== 'function');
    if (missing.length) console.warn('[Scout] Missing functions:', missing.join(', '));
    if(loadBanner)loadBanner.style.display='none';
    prog(100);
    if(typeof updateDataFreshness==='function')updateDataFreshness();
    if(typeof updateSyncStatus==='function')updateSyncStatus();
    if(typeof buildRosterTable==='function')buildRosterTable();
    try{if(typeof renderAvailable==='function')renderAvailable();}catch(e){console.warn('renderAvailable:',e);}
    try{if(typeof renderDraftNeeds==='function')renderDraftNeeds();}catch(e){console.warn('renderDraftNeeds:',e);}
    try{if(typeof renderHomeSnapshot==='function')renderHomeSnapshot();}catch(e){dhqLog('loadAllData.renderHomeSnapshot',e);}
    try{if(typeof renderDailyBriefing==='function')renderDailyBriefing();}catch(e){console.warn('renderDailyBriefing:',e);}
    try{if(typeof renderStartSit==='function')renderStartSit();}catch(e){console.warn('renderStartSit:',e);}
    try{if(typeof renderInsightCards==='function')renderInsightCards();}catch(e){console.warn('renderInsightCards:',e);}
    try{if(typeof renderTeamOverview==='function')renderTeamOverview();}catch(e){console.warn('renderTeamOverview:',e);}
    try{if(typeof renderHealthTimeline==='function')renderHealthTimeline();}catch(e){console.warn('renderHealthTimeline:',e);}
    try{if(typeof renderLeaguePulse==='function')renderLeaguePulse();}catch(e){console.warn('renderLeaguePulse:',e);}
    try{if(typeof renderMobileHome==='function')renderMobileHome();}catch(e){console.warn('renderMobileHome:',e);}
    updateLineupTabVisibility(); // re-check with Sleeper nflState data
    try{if(typeof renderTradeIntel==='function')renderTradeIntel();}catch(e){console.warn('renderTradeIntel:',e);}
    try{checkForAlerts();}catch(e){console.warn('checkForAlerts:',e);}
    if(typeof checkApiKeyCallout==='function')checkApiKeyCallout();
    if(!DhqStorage.getStr(STORAGE_KEYS.STRATEGY_DONE)&&(S.apiKey||(typeof hasAnyAI==='function'&&hasAnyAI()))){
      const maybeStartStrategyWalkthrough=()=>{if(window.App?.AssistantTutorial?.isActive?.())return;if(typeof startStrategyWalkthrough==='function')startStrategyWalkthrough();};
      window.addEventListener('dhq:tutorial-complete',maybeStartStrategyWalkthrough,{once:true});
      setTimeout(maybeStartStrategyWalkthrough,1600);
    }
    try{if(typeof runMemoryCapture==='function')runMemoryCapture(S.currentLeagueId);}catch(e){dhqLog('loadAllData.runMemoryCapture',e);}
    // Show tutorial for first-time users (after all data is rendered)
    try{if(typeof window.startTutorial==='function')setTimeout(window.startTutorial,800);}catch(_e){}
    try{if(typeof updateRegistryKPIs==='function')updateRegistryKPIs(S.currentLeagueId);}catch(e){}
    // Load player tags (syncs with War Room)
    if(window.OD?.loadPlayerTags){
      window.OD.loadPlayerTags(S.currentLeagueId).then(tags=>{
        window._playerTags=tags||{};
        // Re-render roster to show tags
        if(typeof buildRosterTable==='function')buildRosterTable();
      }).catch(()=>{});
    }
  }catch(e){
    console.warn('loadAllData error:',e);
    if(loadBanner)loadBanner.style.display='none';
  }
}
window.loadAllData = loadAllData;
window.App.loadAllData = loadAllData;

// ── Settings ───────────────────────────────────────────────────
function saveKey(){
  const k = ($('api-key-in')?.value||'').trim();
  const provider = $('ai-provider-sel')?.value || 'anthropic';
  const model = ($('ai-model-in')?.value||'').trim();
  const PROVIDERS = window.App.PROVIDERS || {};
  const p = PROVIDERS[provider];
  if(!k){ss('key-status','Enter an API key',true);return;}
  if(p?.validate && !p.validate(k)){ss('key-status','Key format looks wrong — double-check it',true);return;}
  S.apiKey = k;
  S.aiProvider = provider;
  S.aiModel = model || '';
  DhqStorage.setStr(STORAGE_KEYS.API_KEY, k);
  DhqStorage.setStr(STORAGE_KEYS.API_PROVIDER, provider);
  DhqStorage.setStr(STORAGE_KEYS.API_MODEL, model);
  const label = p?.name || provider;
  ss('key-status', label + ' key saved ✓');
  if(typeof updateSettingsStatus==='function')updateSettingsStatus();
  if(typeof checkApiKeyCallout==='function')checkApiKeyCallout();
}
window.saveKey = saveKey;

function clearKey(){
  S.apiKey=''; S.aiProvider='anthropic'; S.aiModel='';
  DhqStorage.remove(STORAGE_KEYS.API_KEY);
  DhqStorage.remove(STORAGE_KEYS.API_PROVIDER);
  DhqStorage.remove(STORAGE_KEYS.API_MODEL);
  const inp=$('api-key-in');if(inp)inp.value='';
  ss('key-status','Key cleared');
  if(typeof updateSettingsStatus==='function')updateSettingsStatus();
}
window.clearKey = clearKey;

function reconnect(){
  const u=$('s-user-in')?.value?.trim();
  if(!u){showToast('Enter a username first');return;}
  S.user=null;S.leagues=[];S.rosters=[];S.myRosterId=null;
  S.playerStats={};S.posRanks={};
  const LI_ref = window.App;
  if(LI_ref){LI_ref.LI_LOADED=false;LI_ref.LI={};window._liLoading=false;}
  DhqStorage.remove('dhq_leagueintel_v10'); // old v10 key — clear on reconnect
  DhqStorage.removeByPrefix(STORAGE_KEYS.HIST_PREFIX);
  const hubEl=$('league-hub');if(hubEl)hubEl.style.display='none';
  const sb=$('setup-block');
  if(sb){
    sb.style.display='block';
    sb.innerHTML=`<div style="text-align:center;margin-bottom:16px">
      <div style="font-size:28px;margin-bottom:8px">🔄</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">Switching account</div>
      <div style="font-size:13px;color:var(--text3)">Connecting as <strong style="color:var(--accent)">${escHtml(u)}</strong></div>
    </div>
    <div class="row" style="max-width:380px;margin:0 auto">
      <input type="text" id="u-input" value="${escHtml(u)}" placeholder="Sleeper username" style="font-size:15px;padding:12px 16px;border-radius:12px" onkeydown="if(event.key==='Enter')connect()"/>
      <button class="btn" id="conn-btn" onclick="connect()" style="padding:12px 24px;font-size:14px;font-weight:700;border-radius:12px">Connect</button>
    </div>
    <div id="conn-status" class="status-txt" style="text-align:center;margin-top:8px"></div>
    <div class="prog" id="prog" style="display:none;max-width:380px;margin:0 auto"><div class="prog-bar" id="prog-bar" style="width:0%"></div></div>`;
  }
  const dc=$('digest-content');if(dc)dc.style.display='none';
  DhqStorage.setStr(STORAGE_KEYS.USERNAME, u);
  switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
  setTimeout(()=>connect(),100);
}
window.reconnect = reconnect;

function reloadSeason(){
  S.season=S.nflState?.league_create_season||S.nflState?.season||String(new Date().getFullYear());
  S.leagues=[];S.matchups={};S.transactions={};S.rosters=[];
  if(S.user){
    const sb=$('setup-block');if(sb){sb.style.display='block';sb.innerHTML=`<div style="font-size:14px;color:var(--text2)">Reloading for ${S.season}...</div>`;}
    const dc=$('digest-content');if(dc)dc.style.display='none';
    connect();
  }
}
window.reloadSeason = reloadSeason;

function clearHistory(){S.chatHistory=[];if(typeof tradeChatHistory!=='undefined')tradeChatHistory=[];if(typeof draftChatHistory!=='undefined')draftChatHistory=[];}
window.clearHistory = clearHistory;

// ── IDP helpers ────────────────────────────────────────────────
function calcIDPScore(stats, sc){
  if(!stats)return 0;
  let pts=0;
  const add=(stat,mult)=>{pts+=(stats[stat]||0)*(mult||0);};
  add('idp_tkl_solo', sc.idp_tkl_solo??0.5);
  add('idp_tkl_ast', sc.idp_tkl_ast??0.25);
  add('idp_tkl_loss', sc.idp_tkl_loss??2);
  add('idp_sack', sc.idp_sack??4);
  add('idp_ff', sc.idp_ff??3);
  add('idp_int', sc.idp_int??5);
  add('idp_pass_def', sc.idp_pass_def??3);
  add('idp_qb_hit', sc.idp_qb_hit??1.25);
  add('idp_safe', sc.idp_safe??2);
  add('idp_blk_kick', sc.idp_blk_kick??3);
  add('idp_def_td', sc.idp_def_td??6);
  add('idp_pass_def_3p', sc.idp_pass_def_3p??1);
  return +pts.toFixed(1);
}
window.calcIDPScore = calcIDPScore;
window.App.calcIDPScore = calcIDPScore;

function idpTier(pos, sc){
  const eliteDL={idp_sack:10,idp_tkl_solo:40,idp_tkl_ast:20,idp_tkl_loss:8,idp_qb_hit:25,idp_ff:3};
  const eliteLB={idp_tkl_solo:80,idp_tkl_ast:30,idp_sack:5,idp_tkl_loss:10,idp_ff:3,idp_int:2,idp_pass_def:5};
  const eliteDB={idp_int:5,idp_pass_def:15,idp_tkl_solo:60,idp_tkl_ast:20,idp_def_td:1,idp_ff:2,idp_pass_def_3p:2};
  const scores={DL:calcIDPScore(eliteDL,sc),LB:calcIDPScore(eliteLB,sc),DB:calcIDPScore(eliteDB,sc)};
  return scores[pos]||0;
}
window.idpTier = idpTier;
window.App.idpTier = idpTier;

// ── Memory / localStorage ──────────────────────────────────────
function loadMemory(){return DhqStorage.get(STORAGE_KEYS.MEMORY, {});}
function saveMemory(data){DhqStorage.set(STORAGE_KEYS.MEMORY, data);}
function getMemory(key,def=[]){return loadMemory()[key]??def;}
function setMemory(key,val){const d=loadMemory();d[key]=val;saveMemory(d);}
Object.assign(window, {loadMemory,saveMemory,getMemory,setMemory});
Object.assign(window.App, {loadMemory,saveMemory,getMemory,setMemory});

// ── Notifications ───────────────────────────────────────────
function enableNotifications(){
  if (typeof canAccess === 'function' && !canAccess('notifications')) {
    showUpgradePrompt('notifications', document.getElementById('notif-status')?.parentElement || document.body);
    return;
  }
  if(!('Notification' in window)){ss('notif-status','Notifications not supported in this browser',true);return;}
  Notification.requestPermission().then(perm=>{
    DhqStorage.setStr(STORAGE_KEYS.NOTIF_PERM, perm);
    const btn=$('notif-btn');
    if(perm==='granted'){ss('notif-status','Notifications enabled ✓');if(btn)btn.textContent='Enabled ✓';}
    else if(perm==='denied'){ss('notif-status','Notifications blocked — check browser settings',true);if(btn)btn.textContent='Blocked';}
    else{ss('notif-status','Permission dismissed');}
  });
}
window.enableNotifications = enableNotifications;

function checkForAlerts(){
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const roster=myR();if(!roster?.players?.length)return;
  const prev=DhqStorage.get(STORAGE_KEYS.LAST_ALERTS, {});
  const now={};const alerts=[];
  // 1. Injury alerts for rostered players
  roster.players.forEach(pid=>{
    const p=S.players[pid];if(!p)return;
    const status=p.injury_status||'';
    if(status==='Out'||status==='IR'){
      const key='inj_'+pid+'_'+status;
      now[key]=1;
      if(!prev[key])alerts.push({title:'\u{1F6A8} Injury Alert',body:pName(pid)+' has been ruled '+status});
    }
  });
  // 2. Trending pickups matching roster needs
  const trendingPlayers=window.App.trendingAdds||[];
  const rosterPositions=new Set(roster.players.map(pid=>pPos(pid)));
  trendingPlayers.slice(0,10).forEach(tp=>{
    const pid=tp.player_id||tp.id;const p=S.players[pid];if(!p)return;
    if(rosterPositions.has(p.position)){
      const key='trend_'+pid;
      now[key]=1;
      if(!prev[key])alerts.push({title:'\u{1F4C8} Trending Pickup',body:pName(pid)+' is trending on waivers \u2014 matches your roster needs'});
    }
  });
  // 3. Trade intel
  if(window.App.LI?.tradeTargets?.length){
    const key='trade_v'+Date.now().toString(36).slice(0,5);
    if(!prev.trade_seen){now.trade_seen=1;alerts.push({title:'\u{1F504} Trade Intel',body:'New trade intel available for your league'});}
    else{now.trade_seen=prev.trade_seen;}
  }
  // Fire notifications via SW if available, else fallback to Notification API
  const reg=navigator.serviceWorker?.controller?navigator.serviceWorker.ready:null;
  alerts.forEach(a=>{
    if(reg)reg.then(r=>r.showNotification(a.title,{body:a.body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png'}));
    else try{new Notification(a.title,{body:a.body,icon:'./icons/icon-192.png'});}catch(e){}
  });
  DhqStorage.set(STORAGE_KEYS.LAST_ALERTS, now);
}
window.checkForAlerts = checkForAlerts;

// ══════════════════════════════════════════════════════════════
// LEAGUE HUB — "save slot" style league selector
// Registry stores all connected leagues with credentials for
// 1-tap reconnection. Populated by loadAllData() after connect.
// ══════════════════════════════════════════════════════════════

const _REGISTRY_KEY = 'dhq_league_registry';
const _REGISTRY_KPI_PREFIX = 'dhq_kpi_';

const _HUB_PLATFORM_CFG = {
  sleeper:{ label:'Sleeper', badgeClass:'hub-badge-sleeper' },
  espn:   { label:'ESPN',    badgeClass:'hub-badge-espn' },
  mfl:    { label:'MFL',     badgeClass:'hub-badge-mfl' },
  yahoo:  { label:'Yahoo',   badgeClass:'hub-badge-yahoo' }
};

// Capture the original setup-block HTML on first load so showAddPlatformForm
// can always restore the connect forms even after they've been replaced by
// a spinner or league picker.
let _originalSetupHTML = '';
document.addEventListener('DOMContentLoaded', () => {
  ['espn','mfl','yahoo'].forEach(platform => {
    const tab = document.getElementById('tab-' + platform);
    const form = document.getElementById('form-' + platform);
    if (platformAccessAllowed(platform)) {
      if (tab) tab.style.display = '';
    } else {
      if (tab) tab.remove();
      if (form) form.remove();
    }
  });
  const _sb = document.getElementById('setup-block');
  if (_sb) _originalSetupHTML = _sb.innerHTML;
}, { once: true });

// ── Registry API ──────────────────────────────────────────────

function getLeagueRegistry() {
  try {
    const raw = localStorage.getItem(_REGISTRY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}
window.getLeagueRegistry = getLeagueRegistry;
window.App.getLeagueRegistry = getLeagueRegistry;

function getVisibleLeagueRegistry() {
  return getLeagueRegistry().filter(entry => platformAccessAllowed(entry.platform || 'sleeper'));
}
window.getVisibleLeagueRegistry = getVisibleLeagueRegistry;
window.App.getVisibleLeagueRegistry = getVisibleLeagueRegistry;

function saveLeagueToRegistry(entry) {
  if (!entry?.leagueId) return;
  if (!platformAccessAllowed(entry.platform || 'sleeper')) return;
  try {
    const registry = getLeagueRegistry();
    const idx = registry.findIndex(r => r.leagueId === entry.leagueId && r.platform === entry.platform);
    if (idx >= 0) registry[idx] = { ...registry[idx], ...entry, lastSync: Date.now() };
    else registry.push({ ...entry, lastSync: Date.now() });
    localStorage.setItem(_REGISTRY_KEY, JSON.stringify(registry));
  } catch(e) {}
}
window.saveLeagueToRegistry = saveLeagueToRegistry;
window.App.saveLeagueToRegistry = saveLeagueToRegistry;

function saveDiscoveredSleeperLeagues(leagues, username) {
  if (!Array.isArray(leagues) || !leagues.length) return;
  if (!platformAccessAllowed('sleeper')) return;
  try {
    const now = Date.now();
    const registry = getLeagueRegistry();
    leagues.forEach(l => {
      if (!l?.league_id) return;
      const entry = {
        leagueId: l.league_id,
        leagueName: l.name || '',
        platform: 'sleeper',
        season: l.season || S.season,
        totalRosters: l.total_rosters,
        isDynasty: l.settings?.type === 2,
        username: username || DhqStorage.getStr(STORAGE_KEYS.USERNAME),
        lastSeen: now,
      };
      const idx = registry.findIndex(r => r.leagueId === entry.leagueId && (r.platform || 'sleeper') === 'sleeper');
      if (idx >= 0) registry[idx] = { ...registry[idx], ...entry };
      else registry.push(entry);
    });
    localStorage.setItem(_REGISTRY_KEY, JSON.stringify(registry));
  } catch(e) {}
}
window.saveDiscoveredSleeperLeagues = saveDiscoveredSleeperLeagues;
window.App.saveDiscoveredSleeperLeagues = saveDiscoveredSleeperLeagues;

// Update cached KPI values for a league (called after loadAllData completes)
function updateRegistryKPIs(leagueId) {
  if (!leagueId) return;
  try {
    const LI = window.App.LI || {};
    const ownerProfiles = LI.ownerProfiles || LI.profiles || {};
    const powerRankings = LI.powerRankings || LI.rankings || [];
    const myRoster = myR();
    const myOwnerId = myRoster?.owner_id || S.myUserId;

    // Health score from owner profile
    const myProfile = ownerProfiles[myRoster?.roster_id] || ownerProfiles[myOwnerId] || null;
    const healthScore = myProfile?.healthScore ?? myProfile?.health_score ?? null;

    // Power rank — find my team in rankings
    let powerRank = null, totalTeams = S.rosters?.length || 12;
    if (Array.isArray(powerRankings) && powerRankings.length) {
      const myEntry = powerRankings.find(r =>
        String(r.roster_id) === String(S.myRosterId) ||
        String(r.owner_id) === String(myOwnerId)
      );
      if (myEntry) {
        powerRank = myEntry.rank ?? (powerRankings.indexOf(myEntry) + 1);
        totalTeams = powerRankings.length;
      }
    }

    const kpiObj = {
      healthScore: healthScore !== null ? Math.round(healthScore) : null,
      powerRank,
      totalTeams,
      ts: Date.now()
    };
    localStorage.setItem(_REGISTRY_KPI_PREFIX + leagueId, JSON.stringify(kpiObj));

    // Also update lastSync in registry entry
    const registry = getLeagueRegistry();
    const idx = registry.findIndex(r => r.leagueId === leagueId);
    if (idx >= 0) { registry[idx].lastSync = Date.now(); localStorage.setItem(_REGISTRY_KEY, JSON.stringify(registry)); }
  } catch(e) {}
}
window.updateRegistryKPIs = updateRegistryKPIs;
window.App.updateRegistryKPIs = updateRegistryKPIs;

function _regGetKPI(leagueId) {
  try { return JSON.parse(localStorage.getItem(_REGISTRY_KPI_PREFIX + leagueId) || 'null'); } catch(e) { return null; }
}

function _regTimeAgo(ts) {
  if (!ts) return null;
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// ── Hub render ────────────────────────────────────────────────

function renderLeagueHub() {
  const hub = $('league-hub');
  if (!hub) return;

  const registry = getVisibleLeagueRegistry();
  window._hubRegistry = registry; // referenced in onclick handlers

  if (!registry.length) {
    // Empty state — no connected leagues
    hub.innerHTML = `
      <div class="hub-wrap">
        <div class="hub-section-title">Scout</div>
        <div class="hub-empty">
          <div class="hub-empty-icon">🏈</div>
          <div class="hub-empty-title">Connect your first league</div>
          <div class="hub-empty-sub">Your leagues appear here as cards — tap one to jump straight into your dashboard.</div>
          <div class="hub-platform-btns">
            <button class="hub-platform-btn hub-btn-sleeper" onclick="showAddPlatformForm('sleeper')">Sleeper</button>
            ${platformAccessAllowed('espn')?'<button class="hub-platform-btn hub-btn-espn" onclick="showAddPlatformForm(\'espn\')">ESPN</button>':''}
            ${platformAccessAllowed('mfl')?'<button class="hub-platform-btn hub-btn-mfl" onclick="showAddPlatformForm(\'mfl\')">MFL</button>':''}
            ${platformAccessAllowed('yahoo')?'<button class="hub-platform-btn hub-btn-yahoo" onclick="showAddPlatformForm(\'yahoo\')">Yahoo</button>':''}
          </div>
        </div>
      </div>`;
    hub.style.display = 'block';
    const sb = $('setup-block'); if (sb) sb.style.display = 'none';
    const dc = $('digest-content'); if (dc) dc.style.display = 'none';
    return;
  }

  // Connected platforms badge row
  const connectedPlatforms = [...new Set(registry.map(r => r.platform))];
  const platformBadges = connectedPlatforms.map(p => {
    const cfg = _HUB_PLATFORM_CFG[p] || { label: p.toUpperCase(), badgeClass: '' };
    return `<span class="hub-platform-badge ${cfg.badgeClass}">${cfg.label}</span>`;
  }).join('');
  const sleeperUser = DhqStorage.getStr(STORAGE_KEYS.USERNAME);

  // Free-tier: only first league (or currently active one) is unlocked
  const isFree = typeof getTier === 'function' ? getTier() === 'free' : false;
  const savedId = DhqStorage.getStr(STORAGE_KEYS.LEAGUE) || S.currentLeagueId || '';
  const unlockedId = isFree ? (savedId && registry.find(e => e.leagueId === savedId) ? savedId : registry[0]?.leagueId) : null;

  // League cards
  const cards = registry.map((entry, i) => {
    const cfg = _HUB_PLATFORM_CFG[entry.platform] || { label: entry.platform?.toUpperCase() || '?', badgeClass: '' };
    const locked = isFree && entry.leagueId !== unlockedId;
    const kpi = locked ? null : _regGetKPI(entry.leagueId);
    const syncStr = _regTimeAgo(entry.lastSync);
    const hs = kpi?.healthScore ?? null;
    const pr = kpi?.powerRank ?? (entry.powerRank ?? null);
    const tt = kpi?.totalTeams ?? entry.totalRosters ?? 12;
    const healthColor = hs !== null ? (hs >= 70 ? 'var(--green)' : hs >= 40 ? 'var(--amber)' : 'var(--red)') : 'var(--text3)';
    const rankColor  = pr !== null ? (pr <= 3 ? 'var(--accent)' : pr >= tt - 2 ? 'var(--red)' : 'var(--text2)') : 'var(--text3)';
    const safeId = (entry.leagueId || '').replace(/'/g, "\\'");
    const safeName = (entry.leagueName || '').replace(/'/g, "\\'");
    const action = locked
      ? `showLeagueUpgradeFromHub('${safeId}','${safeName}')`
      : `loadRegistryLeague(window._hubRegistry[${i}])`;

    return `
      <div class="hub-card${locked ? ' locked' : ''}" onclick="${action}" style="animation-delay:${i*0.07}s${locked ? ';opacity:.65' : ''}"
           ${!locked ? `onmouseover="this.style.borderColor='var(--accent)';this.style.boxShadow='0 6px 24px rgba(212,175,55,.18)';this.style.transform='translateY(-2px)'"
           onmouseout="this.style.borderColor='rgba(212,175,55,.18)';this.style.boxShadow='none';this.style.transform='none'"` : ''}>
        <div class="hub-card-top">
          <div class="hub-card-name">${escHtml(entry.leagueName || 'League')}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <span class="hub-platform-badge ${cfg.badgeClass}">${cfg.label}</span>
            ${locked ? '<span style="font-size:15px">🔒</span>' : ''}
          </div>
        </div>
        <div class="hub-card-mid">
          ${entry.teamName ? `<span class="hub-card-team">${escHtml(entry.teamName)}</span>` : ''}
          <span class="hub-card-season">${escHtml(entry.season || String(new Date().getFullYear()))}</span>
          ${entry.isDynasty ? '<span class="hub-card-season" style="background:var(--accentL);color:var(--accent)">Dynasty</span>' : ''}
        </div>
        <div class="hub-card-bot">
          ${locked ? `<div style="font-size:12px;color:var(--accent)">Upgrade to sync more leagues</div>` : `
          <div class="hub-kpi-group">
            <div class="hub-kpi-badge" style="color:${healthColor}">
              <span class="hub-kpi-lbl">Health</span>
              <span class="hub-kpi-num">${hs !== null ? hs : '—'}</span>
            </div>
            <div class="hub-kpi-badge" style="color:${rankColor}">
              <span class="hub-kpi-lbl">Power</span>
              <span class="hub-kpi-num">${pr !== null ? '#' + pr : '—'}</span>
            </div>
          </div>
          <div class="hub-sync-str ${syncStr ? '' : 'hub-sync-never'}">${syncStr ? 'Synced ' + syncStr : 'Tap to sync'}</div>`}
        </div>
      </div>`;
  }).join('');

  // Launch War Room card removed from the league hub per Phase 1 v2 —
  // the desktop pivot doesn't belong at league-selection time. Upgrade
  // prompts still live in the Pro launch page for other entry points.

  hub.innerHTML = `
    <div class="hub-wrap">
      <div class="hub-top-bar">
        <div>
          <div class="hub-section-title">Your Leagues</div>
          <div class="hub-platforms-row">
            ${platformBadges}
            ${sleeperUser ? `<span class="hub-username">@${escHtml(sleeperUser)}</span>` : ''}
          </div>
        </div>
        <button class="hub-add-btn" onclick="showAddPlatformForm()">+ Add League</button>
      </div>
      <div class="hub-cards">${cards}</div>
    </div>`;

  hub.style.display = 'block';
  const sb = $('setup-block'); if (sb) sb.style.display = 'none';
  const dc = $('digest-content'); if (dc) dc.style.display = 'none';
}
window.renderLeagueHub = renderLeagueHub;
window.App.renderLeagueHub = renderLeagueHub;

// Show original platform connect forms
function showAddPlatformForm(platform) {
  platform=normalizePlatformAccess(platform);
  const hub = $('league-hub'); if (hub) hub.style.display = 'none';
  const sb = $('setup-block');
  if (sb) {
    // Restore original form HTML if setup-block was replaced by a spinner/picker
    if (!sb.querySelector('#connect-step') && _originalSetupHTML) sb.innerHTML = _originalSetupHTML;
  }
  showConnectStep(); // always skip auth-step when adding a platform
  if (platform) showPlatformTab(platform);
}
window.showAddPlatformForm = showAddPlatformForm;

// Show hub loading state while connecting
function _hubShowLoading(msg) {
  const hub = $('league-hub');
  if (!hub) return;
  hub.style.display = 'block';
  const sb = $('setup-block'); if (sb) sb.style.display = 'none';
  const dc = $('digest-content'); if (dc) dc.style.display = 'none';
  hub.innerHTML = `
    <div class="hub-wrap" style="display:flex;align-items:center;justify-content:center;min-height:220px;flex-direction:column;gap:14px">
      <span class="hub-spinner"></span>
      <div style="font-size:14px;color:var(--text2)">${escHtml(msg || 'Loading league...')}</div>
      <div id="conn-status" class="status-txt" style="text-align:center"></div>
      <button class="btn btn-ghost btn-sm" onclick="renderLeagueHub()">← Back</button>
    </div>`;
}

// 1-tap connect from a registry entry
async function loadRegistryLeague(entry) {
  if (!entry) return;
  const { platform, leagueId, leagueName, username, myRosterId: savedRosterId,
          espnLeagueId, espnYear, espnMyTeam, espnS2, espnSwid,
          yahooLeagueKey, yahooMyTeam, mflLeagueId, mflYear, mflApiKey,
          season } = entry;

  const _finish = (leagueName) => {
    const hub = $('league-hub'); if (hub) hub.style.display = 'none';
    const sb  = $('setup-block'); if (sb) sb.style.display = 'none';
    const dc  = $('digest-content'); if (dc) dc.style.display = 'block';
    switchTab('digest', document.querySelector('.tab[onclick*="digest"]'));
    prog(100);
    try { renderHomeSnapshot(); } catch(e) {}
    try { checkApiKeyCallout(); } catch(e) {}
    if (typeof updateSettingsStatus === 'function') updateSettingsStatus();
    Promise.resolve().then(() => loadAllData());
  };

  const _error = (msg) => {
    const hub = $('league-hub');
    if (hub) hub.innerHTML = `<div class="hub-wrap" style="text-align:center;padding:40px 20px"><div style="color:var(--red);margin-bottom:16px">${escHtml(msg)}</div><button class="btn btn-ghost btn-sm" onclick="renderLeagueHub()">← Back</button></div>`;
  };

  if (!platformAccessAllowed(platform || 'sleeper')) {
    _error(platformBetaMessage(platform));
    return;
  }

  switch (platform) {

    case 'sleeper': {
      _hubShowLoading('Loading ' + escHtml(leagueName || 'league') + '...');
      S.platform='sleeper';
      // Pre-set saved league so showLeaguePicker auto-selects it without showing picker UI
      if (leagueId) DhqStorage.setStr(STORAGE_KEYS.LEAGUE, leagueId);
      const sleeperUsername=username||DhqStorage.getStr(STORAGE_KEYS.USERNAME)||S.user?.username||S.user?.display_name||'';
      if(!sleeperUsername){_error('Reconnect Sleeper to load this league.');return;}
      DhqStorage.setStr(STORAGE_KEYS.USERNAME,sleeperUsername);
      if (!S.players || Object.keys(S.players).length < 100) {
        try { S.players = await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl')); } catch(e) { S.players = S.players || {}; }
      }
      const uInput = $('u-input');
      if (uInput) uInput.value = sleeperUsername;
      try{
        await withPreviewTimeout(
          connect(sleeperUsername),
          25000,
          'Scout timed out while reconnecting to Sleeper. Use Back and try again.'
        );
        if(!S.user||!S.leagues?.length){
          _error('Scout could not find Sleeper leagues for ' + sleeperUsername + '. Use Back and reconnect Sleeper.');
          return;
        }
        const ready=await waitForLeagueReadyState(15000);
        if(!ready){
          _error('Scout could not finish loading this Sleeper league. Use Back and try again.');
          return;
        }
        _finish(leagueName);
      }catch(e){
        _error(e?.message||'Scout could not load this Sleeper league.');
      }
      break;
    }

    case 'espn': {
      _hubShowLoading('Loading ESPN league...');
      if (!window.ESPN) { showToast('ESPN connector not loaded — refresh page.'); renderLeagueHub(); return; }
      try {
        const yr  = parseInt(espnYear || String(new Date().getFullYear()));
        const s2  = espnS2   || sessionStorage.getItem('espn_s2')   || localStorage.getItem('espn_s2')   || '';
        const sw  = espnSwid || sessionStorage.getItem('espn_swid') || localStorage.getItem('espn_swid') || '';
        if (!S.players || Object.keys(S.players).length < 100) {
          try { S.players = await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl')); } catch(e) { S.players = S.players || {}; }
        }
        const res = await window.ESPN.connectLeague(espnLeagueId || leagueId, yr, s2 || null, sw || null);
        S.myRosterId = String(espnMyTeam || savedRosterId);
        S.myUserId = 'espn_user';
        if (!S.user) S.user = { user_id: 'espn_user', display_name: res.league.name, username: 'espn_user' };
        _updateLeaguePillESPN(res.league.name);
        _finish(res.league.name);
      } catch(e) {
        _error(e.message);
      }
      break;
    }

    case 'mfl': {
      if (!mflAccessAllowed()) {
        _error(platformBetaMessage('mfl'));
        return;
      }
      _hubShowLoading('Loading MFL league...');
      if (!window.MFL) { showToast('MFL connector not loaded — refresh page.'); renderLeagueHub(); return; }
      try {
        const yr = parseInt(mflYear || String(new Date().getFullYear()));
        const ak = mflApiKey || sessionStorage.getItem('mfl_api_key') || localStorage.getItem('mfl_api_key') || '';
        if (!S.players || Object.keys(S.players).length < 100) {
          try { S.players = await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl')); } catch(e) { S.players = S.players || {}; }
        }
        const res = await window.MFL.connectLeague(mflLeagueId || leagueId, yr, ak);
        S.myRosterId = String(entry.myRosterId || savedRosterId);
        if (!S.user) S.user = { user_id: 'mfl_user', display_name: res.league.name, username: 'mfl_user' };
        _updateLeaguePillMFL(res.league.name);
        _finish(res.league.name);
      } catch(e) {
        _error(e.message);
      }
      break;
    }

    case 'yahoo': {
      const ySession = sessionStorage.getItem('yahoo_session_id') || localStorage.getItem('yahoo_session_id');
      if (!ySession) { showToast('Yahoo session expired — reconnect via Add Platform.'); showAddPlatformForm('yahoo'); return; }
      _hubShowLoading('Loading Yahoo league...');
      if (!window.Yahoo) { showToast('Yahoo connector not loaded — refresh page.'); renderLeagueHub(); return; }
      try {
        if (!S.players || Object.keys(S.players).length < 100) {
          try { S.players = await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl')); } catch(e) { S.players = S.players || {}; }
        }
        const lKey = yahooLeagueKey || leagueId;
        const tKey = yahooMyTeam ? lKey + '.t.' + yahooMyTeam : null;
        const res = await window.Yahoo.connectLeague(lKey, tKey);
        S.myRosterId = String(yahooMyTeam || savedRosterId);
        if (!S.user) S.user = { user_id: 'yahoo_user', display_name: res.league.name, username: 'yahoo_user' };
        _updateLeaguePillYahoo(res.league.name);
        _finish(res.league.name);
      } catch(e) {
        sessionStorage.removeItem('yahoo_session_id');localStorage.removeItem('yahoo_session_id');
        _error(e.message + ' — Yahoo session may have expired.');
      }
      break;
    }

    default:
      renderLeagueHub();
  }
}
window.loadRegistryLeague = loadRegistryLeague;

// ── Boot: Restore API key + auto-connect ───────────────────────
(function restoreApiKey(){
  try{
    if (LANDING_PREVIEW) {
      showAuthStep();
      return;
    }
    // ── Localhost auto-login: always seed 'bigloco' so auto-connect fires ──
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      localStorage.setItem('dynastyhq_username', 'bigloco');
    }
    // Check for Dynasty HQ email session or profile for Sleeper username
    try {
      if (!DhqStorage.getStr(STORAGE_KEYS.USERNAME)) {
        let fwUsername = null;
        // Try fw_session_v1 first
        const fw = DhqStorage.get(STORAGE_KEYS.FW_SESSION);
        if (fw) fwUsername = fw?.user?.sleeperUsername;
        // Fallback: od_profile_v1 (set during War Room onboarding)
        if (!fwUsername) {
          const prof = DhqStorage.get(STORAGE_KEYS.OD_PROFILE);
          if (prof) fwUsername = prof?.sleeperUsername;
        }
        // Fallback: od_auth_v1 (legacy War Room login)
        if (!fwUsername) {
          const auth = DhqStorage.get(STORAGE_KEYS.OD_AUTH);
          if (auth) fwUsername = auth?.sleeperUsername || auth?.username;
        }
        if (fwUsername) {
          DhqStorage.setStr(STORAGE_KEYS.USERNAME, fwUsername);
          console.log('[Scout] Auto-connected from Dynasty HQ session:', fwUsername);
        }
      }
    } catch(e) {}

    const k = DhqStorage.getStr(STORAGE_KEYS.API_KEY);
    const prov = DhqStorage.getStr(STORAGE_KEYS.API_PROVIDER) || 'anthropic';
    const model = DhqStorage.getStr(STORAGE_KEYS.API_MODEL);
    if(k){
      S.apiKey = k;
      S.aiProvider = prov;
      S.aiModel = model;
      const inp = $('api-key-in');
      if(inp) inp.value = k;
      const sel = $('ai-provider-sel');
      if(sel) sel.value = prov;
      const mIn = $('ai-model-in');
      if(mIn) mIn.value = model;
      if(typeof updateProviderHint==='function')updateProviderHint();
    }
    const xk=DhqStorage.getStr(STORAGE_KEYS.XAI_KEY);
    if(xk){const xIn=$('xai-key-in');if(xIn)xIn.value=xk;}
    // Restore notification button state
    if('Notification' in window&&Notification.permission==='granted'){const nb=$('notif-btn');if(nb)nb.textContent='Enabled \u2713';}
    const savedUser = DhqStorage.getStr(STORAGE_KEYS.USERNAME);

    // ── League Hub: show game-save style picker if registry has leagues ──
    if(getVisibleLeagueRegistry().length>0&&!new URLSearchParams(window.location.search).get('yahoo_session')){
      const registry=getVisibleLeagueRegistry();
      const urlLeagueId=getUrlLeagueId();
      const urlLeagueEntry=urlLeagueId?registry.find(e=>String(e.leagueId)===String(urlLeagueId)):null;
      renderLeagueHub();
      if(typeof loadUserTier==='function')loadUserTier().catch(()=>{});
      if(urlLeagueEntry)setTimeout(()=>loadRegistryLeague(urlLeagueEntry),0);
      return;
    }

    // ── Yahoo OAuth callback detection ────────────────────────────
    // After Yahoo OAuth, the edge function redirects back with ?yahoo_session=UUID.
    const _yahooSessionParam = new URLSearchParams(window.location.search).get('yahoo_session');
    if (_yahooSessionParam && !platformAccessAllowed('yahoo')) {
      try{ window.history.replaceState({},document.title,window.location.pathname); }catch(e){}
    }
    if (_yahooSessionParam && platformAccessAllowed('yahoo')) {
      // Store session ID and clean URL without reloading
      try{ if(window.Yahoo) window.Yahoo.handleCallback(_yahooSessionParam); else { sessionStorage.setItem('yahoo_session_id',_yahooSessionParam); localStorage.removeItem('yahoo_session_id'); } }catch(e){}
      try{ window.history.replaceState({},document.title,window.location.pathname); }catch(e){}
      // Load player DB and show Yahoo league picker
      setTimeout(async()=>{
        if(S.user)return;
        try{
          ss('conn-status','Loading your Yahoo leagues...');
          const _pEl=$('prog');if(_pEl)_pEl.style.display='block'; prog(20);
          if(!S.players||Object.keys(S.players).length<100){
            try{S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl'));}catch(e){S.players=S.players||{};}
          }
          prog(50);
          const _raw=await window.Yahoo.fetchUserLeagues();
          const _leagues=window.Yahoo.parseUserLeagues(_raw);
          prog(75);ss('conn-status','');
          if(!_leagues.length){ss('conn-status','No Yahoo NFL leagues found. Check your account.',true);return;}
          const _sb=$('setup-block');if(_sb)_sb.style.display='block';
          if(_leagues.length===1){
            await _connectYahooLeague(_leagues[0].leagueKey,null);
          } else {
            showYahooLeaguePicker(_leagues);
          }
        }catch(e){
          console.warn('[Yahoo] Post-OAuth flow failed:',e.message);
          ss('conn-status','Yahoo connect failed: '+e.message,true);
          const _pF=$('prog');if(_pF)_pF.style.display='none';
        }
      },500);
    // ── Yahoo session auto-restore ────────────────────────────────
    } else {
      const _yahooLeagueKey = localStorage.getItem('yahoo_league_key');
      const _yahooMyTeam    = localStorage.getItem('yahoo_my_team');
      const _yahooSessionId = sessionStorage.getItem('yahoo_session_id') || localStorage.getItem('yahoo_session_id');
      if (platformAccessAllowed('yahoo') && _yahooLeagueKey && _yahooMyTeam && _yahooSessionId) {
        setTimeout(async()=>{
          if(S.user)return;
          showConnectStep();
          try{
            if(!window.Yahoo){
              console.warn('[Yahoo] window.Yahoo not loaded — falling back to Sleeper');
              if(savedUser){const ui=$('u-input');if(ui)ui.value=savedUser;connect();}
              return;
            }
            ss('conn-status','Reconnecting to Yahoo...');
            const _pEl=$('prog');if(_pEl)_pEl.style.display='block'; prog(5);
            if(!S.players||Object.keys(S.players).length<100){
              try{S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl'));}catch(e){S.players=S.players||{};}
            }
            prog(30);
            const _teamKey=_yahooLeagueKey+'.t.'+_yahooMyTeam;
            const _res=await window.Yahoo.connectLeague(_yahooLeagueKey,_teamKey);
            S.myRosterId=String(_yahooMyTeam);
            if(!S.user)S.user={user_id:'yahoo_user',display_name:_res.league.name,username:'yahoo_user'};
            _updateLeaguePillYahoo(_res.league.name);
            const _sb=$('setup-block');if(_sb)_sb.style.display='none';
            const _dc=$('digest-content');if(_dc)_dc.style.display='block';
            switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
            prog(100);ss('conn-status','');
            try{renderHomeSnapshot();}catch(e){}
            try{checkApiKeyCallout();}catch(e){}
            if(typeof updateSettingsStatus==='function')try{updateSettingsStatus();}catch(e){}
            Promise.resolve().then(()=>loadAllData());
          }catch(e){
            console.warn('[Yahoo] Auto-restore failed:',e.message);
            ss('conn-status',''); prog(0);
            const _pF=$('prog');if(_pF)_pF.style.display='none';
            localStorage.removeItem('yahoo_league_key');
            localStorage.removeItem('yahoo_my_team');
            sessionStorage.removeItem('yahoo_session_id');localStorage.removeItem('yahoo_session_id');
            if(savedUser){const ui=$('u-input');if(ui)ui.value=savedUser;connect();}
          }
        },500);
    // ── ESPN session restore ───────────────────────────────────────
    // If a previous ESPN session exists, reconnect it instead of Sleeper.
    // Uses a 500ms delay so all modules (including window.ESPN) are loaded.
      } else {
    const _espnSavedId   = localStorage.getItem('espn_league_id');
    const _espnSavedTeam = localStorage.getItem('espn_my_team');
    if (platformAccessAllowed('espn') && _espnSavedId && _espnSavedTeam) {
      setTimeout(async () => {
        if (S.user) return; // Already connected via another path
        showConnectStep();
        try {
          const _yr   = parseInt(localStorage.getItem('espn_year') || String(new Date().getFullYear()));
          const _s2   = sessionStorage.getItem('espn_s2')   || localStorage.getItem('espn_s2')   || '';
          const _sw   = sessionStorage.getItem('espn_swid') || localStorage.getItem('espn_swid') || '';
          if (!window.ESPN) {
            console.warn('[ESPN] window.ESPN not loaded — falling back to Sleeper');
            if (savedUser) { const ui=$('u-input');if(ui)ui.value=savedUser; connect(); }
            return;
          }
          ss('conn-status','Reconnecting to ESPN...');
          const _pEl=$('prog');if(_pEl)_pEl.style.display='block'; prog(5);
          // Load Sleeper player DB for crosswalk (best-effort)
          if(!S.players||Object.keys(S.players).length<100){
            try{ S.players=await (window.fetchPlayers ? window.fetchPlayers() : window.App.sf('/players/nfl')); }catch(e){ S.players=S.players||{}; }
          }
          prog(30);
          const _res=await window.ESPN.connectLeague(_espnSavedId,_yr,_s2||null,_sw||null);
          S.myRosterId=String(_espnSavedTeam);
          if(!S.user) S.user={user_id:'espn_user',display_name:_res.league.name,username:'espn_user'};
          S.myUserId='espn_user';
          _updateLeaguePillESPN(_res.league.name);
          const _sb=$('setup-block');if(_sb)_sb.style.display='none';
          const _dc=$('digest-content');if(_dc)_dc.style.display='block';
          switchTab('digest',document.querySelector('.tab[onclick*="digest"]'));
          prog(100);ss('conn-status','');
          try{renderHomeSnapshot();}catch(e){}
          try{checkApiKeyCallout();}catch(e){}
          if(typeof updateSettingsStatus==='function')try{updateSettingsStatus();}catch(e){}
          Promise.resolve().then(()=>loadAllData());
        } catch(e) {
          console.warn('[ESPN] Auto-restore failed:',e.message);
          ss('conn-status',''); prog(0);
          const _pF=$('prog');if(_pF)_pF.style.display='none';
          // Clear bad session so Sleeper connect shows next time
          localStorage.removeItem('espn_league_id');
          localStorage.removeItem('espn_my_team');
          if(savedUser){const ui=$('u-input');if(ui)ui.value=savedUser;connect();}
        }
      }, 500);
    } else if(savedUser){
      showConnectStep(); // returning user — skip auth step
      const uInput = $('u-input');
      if(uInput) uInput.value = savedUser;
      setTimeout(()=>{if(!S.user)connect();},500);
    } else {
      // Fresh first-time user — check Supabase session to decide which step
      _checkAuthAndShowStep();
    }
      } // end no-Yahoo else block
    } // end Yahoo/ESPN/Sleeper dispatch
    // Load user tier for paywall
    if (typeof loadUserTier === 'function') loadUserTier().catch(() => {});

    setTimeout(()=>{
      if(S.myRosterId&&!window.App.LI_LOADED&&!window._liLoading){
        console.log('FAILSAFE: data not loaded after 8s, forcing loadAllData');
        loadAllData();
      }
    },8000);
  }catch(e){dhqLog('restoreApiKey',e);}
})();

// ── Page unload memory save ────────────────────────────────────
window.addEventListener('beforeunload',function(){
  try{
    if(typeof homeChatHistory!=='undefined'&&homeChatHistory&&homeChatHistory.length>=4&&typeof autoSaveMemory==='function')autoSaveMemory(homeChatHistory,'Home');
    if(typeof tradeChatHistory!=='undefined'&&tradeChatHistory&&tradeChatHistory.length>=4&&typeof autoSaveMemory==='function')autoSaveMemory(tradeChatHistory,'Trades');
  }catch(e){dhqLog('beforeunload.autoSaveMemory',e);}
});

// ── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();}
  if(e.key==='Escape');
});

// ── Tooltip helper ──────────────────────────────────────────
function toggleTip(id){
  const el=document.getElementById(id);
  if(el)el.classList.toggle('show');
}
window.toggleTip=toggleTip;
window.escHtml=escHtml;
window.pNameShort=pNameShort;

// Click outside search results to close
document.addEventListener('click',e=>{
  const wrap=$('player-search-wrap');
  if(wrap&&!wrap.contains(e.target)){
    const res=$('player-search-results');
    if(res)res.style.display='none';
  }
});
