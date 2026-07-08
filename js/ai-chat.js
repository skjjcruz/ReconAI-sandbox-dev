/*  ai-chat.js  — AI chat functions extracted from index.html.bak
 *  Exposes everything on window.App.
 *  Globals expected on window: S, LI, LI_LOADED, $, pName, pPos, pAge,
 *    pNameShort, pM, myR, dynastyValue, switchTab, closePlayerModal,
 *    getAvailablePlayers, getFAAB, getRosterSlots, calcIDPScore, idpTier,
 *    fullTeam, loadMentality, loadStrategy
 */
window.App = window.App || {};

// ── HTML sanitizer (XSS protection for AI responses) ──────────
function _sanitizeAIResponse(text){
  if(!text)return'';
  // Escape HTML entities first
  const div=document.createElement('div');
  div.textContent=text;
  let safe=div.innerHTML;
  // Re-add safe formatting: bold and line breaks
  safe=safe.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  safe=safe.replace(/\n/g,'<br>');
  return safe;
}

// ── Chat history state ─────────────────────────────────────────
let homeChatHistory=[];
let tradeChatHistory=[];
let tradeBuilderAssets={mine:[],theirs:[]};
let draftChatHistory=[];

// ── Persistent Conversation Memory ──────────────────────────────
// Phase 7B: conversation summaries are now rolled up into Supabase so War
// Room and Scout share context. localStorage remains the primary path
// (instant) and the remote sync is a fire-and-forget merge on load.
let _chatMemoryRemoteMerged = false;
function loadConvMemory(){
  const local = DhqStorage.get(STORAGE_KEYS.CONV_SESSIONS, []);
  // First load per session: merge any remote summaries asynchronously.
  if (!_chatMemoryRemoteMerged && window.OD?.loadChatMemory) {
    _chatMemoryRemoteMerged = true;
    try {
      const leagueId = window.S?.currentLeagueId || null;
      window.OD.loadChatMemory(leagueId, 6).then(remote => {
        if (!Array.isArray(remote) || !remote.length) return;
        const merged = [...local];
        const seen = new Set(merged.map(m => m.ts));
        remote.forEach(r => {
          if (!seen.has(r.ts)) {
            merged.push({
              ts: r.ts,
              date: new Date(r.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              text: r.summary,
            });
            seen.add(r.ts);
          }
        });
        merged.sort((a, b) => a.ts - b.ts);
        DhqStorage.set(STORAGE_KEYS.CONV_SESSIONS, merged.slice(-6));
      }).catch(() => {});
    } catch (e) {}
  }
  return local;
}
function saveConvMemory(arr){
  DhqStorage.set(STORAGE_KEYS.CONV_SESSIONS, arr.slice(-6));
}
function addConvMemory(summary){
  if(!summary||summary.length<10)return;
  const arr=loadConvMemory();
  const entry = {ts:Date.now(),date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}),text:summary};
  arr.push(entry);
  saveConvMemory(arr);
  // Fire-and-forget remote sync — if it fails, localStorage is still authoritative
  if (window.OD?.saveChatMemory) {
    try {
      window.OD.saveChatMemory({
        leagueId: window.S?.currentLeagueId || null,
        ts: entry.ts,
        sessionLabel: null,
        summary,
        source: 'scout',
      });
    } catch (e) {}
  }
}
function buildMemoryCtx(){
  const arr=loadConvMemory();
  if(!arr.length)return'';
  return'PAST SESSIONS (most recent first):\n'+[...arr].reverse().slice(0,4).map(m=>`[${m.date}] ${m.text}`).join('\n');
}

function buildSyncedStrategyCtx(){
  const lines=[];
  let synced=null;
  try{synced=window.GMStrategy?.getStrategy?.()||null;}catch{synced=null;}
  if(synced){
    const mode=synced.mode||'balanced';
    const parts=[
      'mode:'+mode,
      synced.timeline?'timeline:'+synced.timeline:'',
      synced.aggression?'aggression:'+synced.aggression:'',
      synced.draftStyle?'draft:'+synced.draftStyle:'',
      synced.marketPosture?'market:'+synced.marketPosture:'',
    ].filter(Boolean);
    if(parts.length)lines.push('SYNCED_GM_STRATEGY:'+parts.join(','));
    if(synced.targetPositions?.length)lines.push('TARGET_POSITIONS:'+synced.targetPositions.join(','));
    if(synced.sellPositions?.length)lines.push('SELL_POSITIONS:'+synced.sellPositions.join(','));
    if(synced.targetList?.length)lines.push('TARGET_PLAYERS:'+synced.targetList.join(','));
    if(synced.blockList?.length)lines.push('AVOID_PLAYERS:'+synced.blockList.join(','));
    const untouchables=synced.untouchable||synced.untouchables||[];
    if(untouchables.length)lines.push('UNTOUCHABLE:'+untouchables.map(pid=>typeof pName==='function'?(pName(pid)||pid):pid).join(','));
  }
  return lines.join('\n');
}

async function autoSaveMemory(history,label){
  if(!hasAnyAI()||!history||history.length<2)return;
  try{
    const recent=history.slice(-4).map(m=>m.role.toUpperCase()+': '+String(m.content).slice(0,150)).join('\n');
    const reply=await dhqAI('memory-summary', recent);
    if(reply&&reply.length>5)addConvMemory((label?label+': ':'')+reply.trim().replace(/^["']/,'').replace(/["']$/,''));
  }catch(e){dhqLog('autoSaveMemory',e);}
}
function buildMentalityCtx(){
  const m=loadMentality();
  const s={winnow:'WIN NOW',rebuild:'REBUILD',balanced:'BALANCED',prime:'2-3YR WINDOW'};
  const w={now:'competing now','1yr':'1yr out','2yr':'2-3yr out',far:'full rebuild'};
  const t={aggressive:'aggressive',selective:'selective',conservative:'conservative',pick_seller:'sells picks',pick_hoarder:'hoards picks'};
  const a={youth:'youth<25',balanced_age:'age neutral',vets:'vet friendly',agnostic:'age agnostic'};
  const r={high_risk:'high risk',moderate_risk:'moderate risk',low_risk:'low risk',no_risk:'zero risk'};
  const parts=[
    s[m.mentality]||m.mentality||'balanced',
    w[m.window]||'',
    t[m.tradeStyle]||'',
    a[m.agePreference]||'',
    r[m.riskTolerance]||'',
  ].filter(Boolean);
  const lines=['GM:'+parts.join(',')];
  if(m.upgradePositions)lines.push('UPGRADING:'+m.upgradePositions);
  if(m.targetPlayers)lines.push('TARGETS:'+m.targetPlayers);
  if(m.shoppingPlayers)lines.push('SELLING:'+m.shoppingPlayers);
  if(m.tradePrefs)lines.push('TRADE STYLE:'+m.tradePrefs.substring(0,150));
  if(m.neverDrop)lines.push('UNTOUCHABLE:'+m.neverDrop);
  if(m.notes)lines.push('NOTES:'+m.notes.substring(0,150));
  const syncedStrategy=buildSyncedStrategyCtx();
  if(syncedStrategy)lines.push(syncedStrategy);
  // Inject legacy strategy walkthrough answers if available
  const strat=typeof loadStrategy==='function'?loadStrategy():null;
  if(strat){
    lines.push('STRATEGY:'+strat.mode+',trades:'+strat.tradeStyle+',IDP:'+strat.idpApproach+',draft:'+strat.draftApproach+',vets:'+strat.veteranApproach);
  }
  return lines.join('\n');
}

// ── Context builders ───────────────────────────────────────────
function buildCtx(){
  if(!S.user)return 'No account connected.';
  const my=myR();const s=my?.settings||{};
  const league=S.leagues.find(l=>l.league_id===S.currentLeagueId);
  const sc=league?.scoring_settings||{};
  const sorted=[...S.rosters].sort((a,b)=>(b.settings?.wins||0)-(a.settings?.wins||0));
  const rank=sorted.findIndex(r=>r.roster_id===S.myRosterId)+1;

  // Compact player string: "Name(WR,24,DHQ8200)"
  const pStr=(pid)=>{
    const val=dynastyValue(pid);const age=pAge(pid);
    return pName(pid)+'('+pPos(pid)+(age?','+age:'')+(val>0?',DHQ'+val:'')+')';
  };

  // Starters
  const starters=(my?.starters||[]).filter(p=>p&&p!=='0').map(pStr);

  // Top bench by DHQ value — keep it tight
  const benchPids=(my?.players||[]).filter(p=>!(my?.starters||[]).includes(p)&&!(my?.reserve||[]).includes(p)&&!(my?.taxi||[]).includes(p));
  const bench=benchPids.map(p=>({pid:p,val:dynastyValue(p)})).filter(x=>x.val>0).sort((a,b)=>b.val-a.val).slice(0,8).map(x=>pStr(x.pid));

  const totalVal=(my?.players||[]).reduce((sum,p)=>sum+dynastyValue(p),0);

  // Positional gaps
  const rp=league?.roster_positions||[];
  const slots={QB:0,RB:0,WR:0,TE:0,DL:0,LB:0,DB:0};
  rp.forEach(slot=>{
    if(slot in slots)slots[slot]++;
    else if(slot==='FLEX'){slots.RB+=0.4;slots.WR+=0.4;slots.TE+=0.2;}
    else if(slot==='SUPER_FLEX'){slots.QB+=0.5;slots.WR+=0.25;slots.RB+=0.25;}
    else if(slot==='IDP_FLEX'){slots.DL+=0.35;slots.LB+=0.35;slots.DB+=0.3;}
  });
  Object.keys(slots).forEach(p=>slots[p]=Math.round(slots[p]));

  const idpThresh={DL:Math.round(idpTier('DL',sc)*0.4),LB:Math.round(idpTier('LB',sc)*0.4),DB:Math.round(idpTier('DB',sc)*0.4)};
  const offThresh={QB:18,RB:10,WR:10,TE:8};
  const gaps=[];const surpluses=[];
  const players=my?.players||[];
  ['QB','RB','WR','TE','DEF','DL','LB','DB'].forEach(pos=>{
    const need=slots[pos]||0;if(!need)return;
    const thresh=idpThresh[pos]||offThresh[pos]||10;
    const mine=players.filter(p=>pPos(p)===pos);
    const startable=mine.filter(p=>(S.playerStats?.[p]?.seasonAvg||0)>=thresh).length;
    if(startable<need)gaps.push(pos+':'+(need-startable)+' short');
    else if(startable>need+1)surpluses.push(pos+':+'+(startable-need));
  });

  const picks=S.tradedPicks.filter(p=>p.owner_id===S.myRosterId).map(p=>p.season+'R'+p.round).join(',');
  const memCtx=buildMemoryCtx();

  // Trending data from Sleeper (real-time signal)
  let trendingCtx='';
  if(S.trending?.adds?.length){
    const topAdds=S.trending.adds.slice(0,5).map(t=>{const p=S.players[t.player_id];return p?(p.first_name+' '+p.last_name+' '+p.position):t.player_id;}).join(', ');
    const topDrops=(S.trending.drops||[]).slice(0,5).map(t=>{const p=S.players[t.player_id];return p?(p.first_name+' '+p.last_name+' '+p.position):t.player_id;}).join(', ');
    trendingCtx='TRENDING(24h): Most added: '+topAdds+'. Most dropped: '+topDrops+'.';
  }

  return [
    S.user.display_name+'|#'+rank+'/'+S.rosters.length+'|'+(s.wins||0)+'-'+(s.losses||0)+'|DHQ total:'+totalVal.toLocaleString(),
    'STARTERS:'+starters.join(';'),
    bench.length?'BENCH(top8):'+bench.join(';'):'',
    gaps.length?'NEEDS:'+gaps.join(','):'',
    surpluses.length?'SURPLUS:'+surpluses.join(','):'',
    picks?'PICKS:'+picks:'',
    'IDP:sack='+((sc.idp_sack)||4)+',INT='+((sc.idp_int)||5)+',PD='+((sc.idp_pass_def)||3)+',TKL='+((sc.idp_tkl_solo)||0.5),
    'Trade values=DHQ(0-10000 scale, league-derived, NOT dollars). Higher=better. Elite=7000+ DHQ or top 5 at position, 4000+=starter, 2000+=depth.',
    trendingCtx,
    memCtx||'',
  ].filter(Boolean).join('\n');
}

// Compact context for chat — keeps under ~1500 chars to avoid token limits
function buildCtxCompact(){
  if(!S.user)return'';
  const my=myR();if(!my)return'';
  const s=my.settings||{};
  const league=S.leagues.find(l=>l.league_id===S.currentLeagueId);
  const sorted=[...S.rosters].sort((a,b)=>(b.settings?.wins||0)-(a.settings?.wins||0));
  const rank=sorted.findIndex(r=>r.roster_id===S.myRosterId)+1;
  // Top 5 starters only
  const starterPids=(my.starters||[]).filter(p=>p&&p!=='0');
  const topStarters=starterPids.map(pid=>({pid,val:dynastyValue(pid)})).sort((a,b)=>b.val-a.val).slice(0,5)
    .map(x=>pName(x.pid)+'('+pPos(x.pid)+','+dynastyValue(x.pid)+')').join('; ');
  const totalVal=(my.players||[]).reduce((sum,p)=>sum+dynastyValue(p),0);
  // Gaps only
  const gaps=[];
  const rp=league?.roster_positions||[];
  const sc=league?.scoring_settings||{};
  const mentalityStr=buildMentalityCtx();
  const picks=S.tradedPicks.filter(p=>p.owner_id===S.myRosterId&&parseInt(p.season)===parseInt(S.season)).map(p=>'R'+p.round).join(',');
  return[
    S.user.display_name+'|#'+rank+'/'+S.rosters.length+'|'+(s.wins||0)+'-'+(s.losses||0)+'|DHQ:'+totalVal.toLocaleString(),
    'TOP5:'+topStarters,
    picks?'PICKS:'+picks:'',
    mentalityStr||'',
    'DHQ scale 0-10000. Elite=7000+ DHQ or top 5 at position, 4000+=starter. ALWAYS refer to values as "DHQ" not "FC" or "FantasyCalc".'
  ].filter(Boolean).join('\n');
}

// ── AI Provider layer ─────────────────────────────────────────
// PROVIDERS, updateProviderHint, hasServerAI, hasAnyAI, callClaude,
// callGrokNews, and _newsCache are now in shared/ai-dispatch.js
// They are available via window.App.* and window.* globals.
// PROVIDERS already declared in shared/ai-dispatch.js — reference via window
const _aiProviders = window.App.PROVIDERS || {};
// hasServerAI, hasAnyAI, callClaude, callGrokNews, _newsCache are all globals from ai-dispatch.js

// ── Chat UI helpers ────────────────────────────────────────────
function expandChat(el){
  if(!el)return;
  el.style.maxHeight='300px';
  el.style.overflow='auto';
  el.style.padding='14px';
  // Show collapse button for draft chat
  if(el.id==='draft-msgs'){
    const btn=$('draft-chat-collapse');
    if(btn)btn.style.display='block';
  }
}

function collapseDraftChat(){
  const el=$('draft-msgs');
  if(!el)return;
  el.style.maxHeight='0';
  el.style.overflow='hidden';
  el.style.padding='0 16px';
  const btn=$('draft-chat-collapse');
  if(btn)btn.style.display='none';
}

function homeAsk(text,opts){
  if(!hasAnyAI(false)){
    if(typeof showToast==='function')showToast('Sign in or subscribe to enable AI chat');
    return;
  }
  sendHomeChat(text,opts);
}
// opts (optional): { callType, context, useWebSearch } — when callType is set
// (e.g. 'player-scout'), the message routes through dhqAI with the structured
// context injected, instead of the generic home-chat tier.
function goAsk(text,opts){
  // Close player modal if open
  const modal=$('player-modal');
  if(modal&&modal.style.display!=='none')closePlayerModal();
  // Switch to home tab
  switchTab('digest',null);
  // Send the message and scroll to chat
  setTimeout(()=>{
    homeAsk(text,opts);
    // Scroll to the chat area so user sees the response
    const chatEl=$('home-chat-msgs');
    if(chatEl)chatEl.scrollIntoView({behavior:'smooth',block:'start'});
  },200);
}

// ── Home Chat ─────────────────────────────────────────────────
// Update the home chat input placeholder based on daily limit (free users only)
function _updateChatPlaceholder() {
  const inp = $('home-chat-in');
  if (!inp) return;
  const S = window.S;
  // Only show limit hint if user has no BYOK key, no server AI, and is on free tier
  if (S?.apiKey) return;
  if (typeof hasServerAI === 'function' && hasServerAI()) return;
  if (typeof getTier === 'function' && getTier() === 'free') {
    const remaining = typeof getDailyChatRemaining === 'function' ? getDailyChatRemaining() : 0;
    const lim = window.FREE_CHAT_DAILY_LIMIT || 3;
    inp.placeholder = remaining > 0
      ? `Ask your advisor... (${remaining}/${lim} today)`
      : 'Daily limit reached — upgrade for unlimited';
  }
}
window._updateChatPlaceholder = _updateChatPlaceholder;

async function sendHomeChat(passedText,opts){
  // Use GM bar messages panel for chat (stays in the bar)
  const msgsEl=$('gm-bar-msgs');
  if(!msgsEl) return;

  // Show messages area, hide Alex block + chips to make room
  msgsEl.style.display='flex';
  const body=document.querySelector('.gm-bar-body');
  if(body)body.style.display='none';

  // Keep the GM bar expanded
  if(typeof window._gmBarExpand==='function')window._gmBarExpand();

  if(!hasAnyAI(false)){
    const m=document.createElement('div');m.className='hc-msg-a';m.style.fontSize='13px';m.innerHTML='AI chat requires a subscription. <a onclick="switchTab(\'settings\')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Sign in or subscribe in Settings</a>.';msgsEl.appendChild(m);msgsEl.scrollTop=99999;
    return;
  }

  // Daily chat limit for free (post-trial) users without BYOK key or server AI
  const _S = window.S;
  if (!_S?.apiKey && !(typeof hasServerAI === 'function' && hasServerAI()) && typeof getTier === 'function' && getTier() === 'free') {
    const lim = window.FREE_CHAT_DAILY_LIMIT || 3;
    const remaining = typeof getDailyChatRemaining === 'function' ? getDailyChatRemaining() : lim;
    if (remaining <= 0) {
      const m = document.createElement('div');
      m.className = 'hc-msg-a';
      m.style.fontSize = '13px';
      m.innerHTML = `You've used your ${lim} free messages today. <a onclick="showUpgradePrompt('${FEATURES?.UNLIMITED_CHAT || 'unlimited_chat'}')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Upgrade for unlimited →</a>`;
      msgsEl.appendChild(m);
      msgsEl.scrollTop = 99999;
      return;
    }
    if (typeof incrementDailyChat === 'function') incrementDailyChat();
    if (typeof _updateChatPlaceholder === 'function') _updateChatPlaceholder();
  }

	  // Accept text from parameter (global chat routing) or from input element
	  const input=$('home-chat-in');const text=passedText||(input?.value||'').trim();if(!text)return;
	  if(input)input.value='';
	  if(typeof trackUsage==='function')trackUsage('ai_chats_sent');
	  window.OD?.track?.('alex_prompt_sent', {
	    platform: 'reconai',
	    module: 'home',
	    metadata: { chars: text.length, source: passedText ? 'prefill' : 'input' },
	  });

  const um=document.createElement('div');um.className='hc-msg-u';um.textContent=text;
  msgsEl.appendChild(um);
  // Inject trade card if message looks like a trade request
  if(typeof window.tryInjectTradeCard==='function')window.tryInjectTradeCard(text,msgsEl);
  // Summon an adaptive KPI card if the message asks for one ("show my draft capital").
  if(window.TodayCards&&window.TodayCards.matchCardKey){
    try{
      const _ck=window.TodayCards.matchCardKey(text);
      if(_ck){
        const _r=typeof window.myR==='function'?window.myR():null;
        const _lg=S.leagues?.find(l=>l.league_id===S.currentLeagueId);
        const _ph=window.SeasonCalendar?.describe?window.SeasonCalendar.describe(_lg):null;
        const _as=(_r&&window.assessTeamFromGlobal)?window.assessTeamFromGlobal(_r.roster_id):null;
        const _html=window.TodayCards.renderCard(_ck,window.TodayCards.buildCtx(S,_r,_lg,_ph,_as));
        if(_html){const cm=document.createElement('div');cm.className='hc-msg-a';cm.innerHTML='<div class="scout-adaptive-rail">'+_html+'</div>';msgsEl.appendChild(cm);}
      }
    }catch(e){/* ignore */}
  }
  const lm=document.createElement('div');lm.className='hc-msg-a';
  lm.innerHTML='<span class="ld"><span>.</span><span>.</span><span>.</span></span>';
  msgsEl.appendChild(lm);
  msgsEl.scrollTop=99999;

  try{
    homeChatHistory.push({role:'user',content:text});
    // Keep history short to stay under token limits
    if(homeChatHistory.length>4)homeChatHistory=homeChatHistory.slice(-4);
    // Build compact context — attach to latest message only
    const ctxStr=dhqCompactContext();
    // Supplement with league format data for contextual valuations
    const _hcLeague=S.leagues?.find(l=>l.league_id===S.currentLeagueId);
    const _hcExtra=_hcLeague?'\nROSTER_POSITIONS:'+(_hcLeague.roster_positions||[]).join(',')+'\nSCORING:'+JSON.stringify(_hcLeague.scoring_settings||{}).substring(0,200):'';
    const msgs=homeChatHistory.map((m,i)=>{
      // Attach context to the LAST user message only
      if(m.role==='user'&&i===homeChatHistory.length-1){
        return{role:'user',content:ctxStr+_hcExtra+'\n\n'+m.content};
      }
      // Trim old assistant messages to save tokens
      if(m.role==='assistant'&&m.content.length>400){
        return{role:'assistant',content:m.content.substring(0,400)+'...'};
      }
      return m;
    });
    const needsSearch=/search for|look up|find news|injury report|breaking news|trade rumor|SEARCH FOR CURRENT|Scout Report|current situation|dynasty outlook|2026/i.test(text);
    // Player-scout (and other typed) asks route through dhqAI so they get the
    // right system prompt + structured NFL-fit context + news enrichment.
    // Everything else stays on the generic home-chat path.
    const _dhqAI=window.dhqAI||window.App?.dhqAI;
    let reply;
    if(opts?.callType&&typeof _dhqAI==='function'){
      reply=await _dhqAI(opts.callType,text,opts.context||'',{messages:msgs,useWebSearch:opts.useWebSearch||needsSearch});
    }else{
      reply=await callClaude(msgs,needsSearch,2,500);
    }
    homeChatHistory.push({role:'assistant',content:reply});
    lm.innerHTML=_sanitizeAIResponse(reply);
  }catch(e){lm.innerHTML=`<span style="color:var(--red)">Error: ${escHtml(e.message)}</span>`;}
  msgsEl.scrollTop=99999;
}

// ── Trade Chat ─────────────────────────────────────────────────
function sendTradeChatMsg(text){
  if(!hasAnyAI(false)){
    if(typeof showToast==='function')showToast('Sign in or subscribe to enable AI chat');
  }
  const inp=$('trade-chat-in');if(inp)inp.value=text;
  sendTradeChat();
}

async function sendTradeChat(){
  if(!hasAnyAI(false)){
    const msgs=$('trade-chat-msgs');
    if(msgs){expandChat(msgs);const m=document.createElement('div');m.className='hc-msg-a';m.style.fontSize='13px';m.innerHTML='Trade advisor requires a subscription. <a onclick="switchTab(\'settings\')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Sign in or subscribe in Settings</a>.';msgs.appendChild(m);msgs.scrollTop=99999;}
    return;
  }
	  const input=$('trade-chat-in');const text=(input&&input.value||'').trim();if(!text)return;
	  if(input)input.value='';
	  window.OD?.track?.('alex_prompt_sent', {
	    platform: 'reconai',
	    module: 'trades',
	    metadata: { chars: text.length },
	  });
	  const msgsEl=$('trade-chat-msgs');
  expandChat(msgsEl);
  const um=document.createElement('div');um.className='hc-msg-u';um.style.fontSize='13px';um.textContent=text;
  msgsEl.appendChild(um);
  const lm=document.createElement('div');lm.className='hc-msg-a';lm.style.fontSize='13px';
  lm.innerHTML='<span class="ld"><span>.</span><span>.</span><span>.</span></span>';
  msgsEl.appendChild(lm);msgsEl.scrollTop=99999;
  try{
    tradeChatHistory.push({role:'user',content:text});
    if(tradeChatHistory.length>4)tradeChatHistory=tradeChatHistory.slice(-4);
    const ctx=dhqCompactContext();
    // Build rich owner context — who they are, what they need, how they trade
    let ownerCtx='';
    const ownerProfileStr=dhqBuildOwnerProfiles();
    if(ownerProfileStr)ownerCtx='\nLEAGUE OWNERS (use these specific names and needs in your answer):\n'+ownerProfileStr;
    let tradeStats='';
    if(LI_LOADED&&LI.leagueTradeTendencies?.totalTrades>0){
      const lt=LI.leagueTradeTendencies;
      tradeStats=`\nLEAGUE: ${lt.totalTrades} trades in history, ${lt.pickHeavy} involved picks`;
    }
    const msgs=tradeChatHistory.map(function(m,i){
      if(m.role==='user'&&i===tradeChatHistory.length-1){
      // Build dynamic pick value string from actual DHQ engine data
      const teams=S.rosters?.length||16;
      let pickStr='Picks: ';
      if(LI_LOADED&&LI.dhqPickValues){
        const pv=LI.dhqPickValues;
        const rv=(r)=>{const e=pv[((r-1)*teams)+1]?.value||0;const m=pv[((r-1)*teams)+Math.ceil(teams/2)]?.value||0;const l=pv[r*teams]?.value||0;return`R${r}:${l}-${e}(early=${e},mid=${m},late=${l})`;};
        pickStr+=rv(1)+', '+rv(2)+', '+rv(3)+', '+rv(4);
      }else{
        pickStr+='1st≈5000-8500, 2nd≈2200-3800, 3rd≈1000-1800, 4th≈400-800';
      }
      return{role:'user',content:`Dynasty trade advisor with REAL league data. RULES:
1. Name SPECIFIC owners from the list below — use their actual names
2. MATH MUST WORK: both sides of a trade must be within 15% of equal DHQ value. If Player A is DHQ 3500, the return must total DHQ 3000-4000. Never propose a DHQ 3500 player for a DHQ 7000 player straight up.
3. Show the math: "Your side: Player A (DHQ 3500) + 2026 R2 (~DHQ 2000) = ~5500 total. Their side: Player B (DHQ 5200) = fair deal"
4. Only propose trades where the OTHER owner benefits too — explain what THEY gain
5. Draft a short Sleeper DM message to copy-paste
6. If user wants to win now, propose getting better players. If rebuilding, propose getting picks/youth.
7. NEVER suggest selling a top-10 DHQ player for a player ranked 50+ lower. Elite players (7000+ DHQ or top 5 at position) should only be traded for elite returns.
8. NEVER suggest a trade where one side has 30%+ more DHQ than the other. That is a robbery, not a trade.
DHQ scale: 0-10000 (elite=7000+ DHQ or top 5 at position, 4000+=starter, 2000+=depth). ${pickStr}. Always say "DHQ" not "FC".
${ctx}${ownerCtx}${tradeStats}\n\n${m.content}`};
      }
      if(m.role==='assistant'&&m.content.length>400)return{role:'assistant',content:m.content.substring(0,400)+'...'};
      return m;
    });
    const tradeNeedsSearch=/search for|look up|find news|breaking/i.test(text);
    const reply=await callClaude(msgs,tradeNeedsSearch,2,500);
    tradeChatHistory.push({role:'assistant',content:reply});
    lm.innerHTML=_sanitizeAIResponse(reply);
    // Auto-save every 3rd message
    if(tradeChatHistory.length%6===0)autoSaveMemory(tradeChatHistory,'Trades');
  }catch(e){lm.innerHTML='<span style="color:var(--red)">Error: '+escHtml(e.message)+'</span>';}
  msgsEl.scrollTop=99999;
}

// ── Waiver Chat ────────────────────────────────────────────────
function sendWaiverChatMsg(text){
  if(!hasAnyAI(false)){
    if(typeof showToast==='function')showToast('Sign in or subscribe to enable AI chat');
  }
  const input=$('wq-chat-in');
  if(input){input.value=text;}
  sendWaiverChat();
}
window.sendWaiverChatMsg=sendWaiverChatMsg;
window.sendTradeChatMsg=sendTradeChatMsg;
window.runWaiverAgent=runWaiverAgent;
window.sendHomeChat=sendHomeChat;
window.sendWaiverChat=sendWaiverChat;
window.sendTradeChat=sendTradeChat;

async function sendWaiverChat(){
  if(!hasAnyAI(false)){
    const msgs=$('wq-chat-msgs');
    if(msgs){
      expandChat(msgs);
      const m=document.createElement('div');
      m.className='hc-msg-a';m.style.fontSize='13px';
      m.innerHTML='Waiver assistant requires a subscription. <a onclick="switchTab(\'settings\')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Sign in or subscribe in Settings</a>.';
      msgs.appendChild(m);msgs.scrollTop=99999;
    }
    return;
  }
  const input=$('wq-chat-in');const text=input?.value?.trim();if(!text)return;
  input.value='';

  const msgs=$('wq-chat-msgs');
  expandChat(msgs);
  const um=document.createElement('div');
  um.className='hc-msg-u';um.style.fontSize='13px';um.textContent=text;
  msgs.appendChild(um);msgs.scrollTop=99999;

  // Loading
  const lm=document.createElement('div');
  lm.className='hc-msg-a';lm.style.fontSize='13px';
  lm.innerHTML='<span class="ld"><span>.</span><span>.</span><span>.</span></span>';
  msgs.appendChild(lm);msgs.scrollTop=99999;

  try{
    const faab=getFAAB();const slots=getRosterSlots();
    const avail=getAvailablePlayers();
    const sc8=S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings||{};
    const availStr=avail.slice(0,30).map(function(d){
      const isI=['DL','LB','DB'].includes(d.p.position||'');
      const raw=S.playerStats?.[d.id]?.prevRawStats;
      const ppg=isI&&raw?+(calcIDPScore(raw,sc8)/Math.max(1,raw.gp||17)).toFixed(1):null;
      const avg=S.playerStats?.[d.id]?.seasonAvg||0;
      const statPart=ppg?(','+ppg+'idpPPG'):avg?(',avg'+avg.toFixed(1)):'';
      const age=d.p.age>0?',age'+d.p.age:',rookie';
      return pName(d.id)+'('+d.p.position+age+',v'+d.val+statPart+')';
    }).join(';');
    const ctx='MY TEAM:\n'+dhqContext(false)+'\n'+dhqBuildMentalityContext()+'\n'+(faab.isFAAB?'FAAB:$'+faab.remaining:'Waiver priority #'+(myR()?.settings?.waiver_position||'?'))+' | Open slots:'+slots.openBench+'\n\nAVAILABLE FREE AGENTS (IDP shown with real PPG from your scoring settings):\n'+availStr;
    const reply=await callClaude([{role:'user',content:'Dynasty waiver wire advisor. Answer based ONLY on the actual available players listed.\n\n'+ctx+'\n\nIDP NOTE: In this league sacks='+((S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings?.idp_sack)??4)+'pts, INT='+((S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings?.idp_int)??5)+'pts, PassDef='+((S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings?.idp_pass_def)??3)+'pts. DBs with INT/PD potential are premium. Edge rushers with sack upside too.\n\nQuestion: '+text+'\n\nBe specific — name actual players. 3-5 sentences max.'}]);
    lm.innerHTML=_sanitizeAIResponse(reply);
  }catch(e){lm.innerHTML=`<span style="color:var(--red)">Error: ${escHtml(e.message)}</span>`;}
  msgs.scrollTop=99999;
}

// ── Draft Chat ─────────────────────────────────────────────────
function sendDraftChatMsg(text){const inp=$('draft-chat-in');if(inp)inp.value=text;sendDraftChat();}

async function sendDraftChat(){
  if(!hasAnyAI(false)){
    const msgs=$('draft-msgs');
    if(msgs){expandChat(msgs);const m=document.createElement('div');m.className='hc-msg-a';m.style.fontSize='13px';m.innerHTML='Draft advisor requires a subscription. <a onclick="switchTab(\'settings\')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Sign in or subscribe in Settings</a>.';msgs.appendChild(m);msgs.scrollTop=99999;}
    return;
  }
	  const input=$('draft-chat-in');const text=input.value.trim();if(!text)return;
	  input.value='';
	  window.OD?.track?.('alex_prompt_sent', {
	    platform: 'reconai',
	    module: 'draft',
	    metadata: { chars: text.length },
	  });
	  expandChat($('draft-msgs'));
  addDraftMsg(text,'u');
  const year=$('draft-year-sel')?.value||'2026';
  const loading=document.createElement('div');loading.className='hc-msg-a';loading.style.fontSize='13px';
  loading.innerHTML='<span class="ld"><span>.</span><span>.</span><span>.</span></span>';
  $('draft-msgs').appendChild(loading);$('draft-msgs').scrollTop=99999;
  try{
    draftChatHistory.push({role:'user',content:text});
    if(draftChatHistory.length>4)draftChatHistory=draftChatHistory.slice(-4);
    // Build rich draft context
    const myPicks=S.tradedPicks.filter(p=>p.owner_id===S.myRosterId&&String(p.season)===year).map(p=>'R'+p.round).join(',');
    const mentalityCtx=dhqBuildMentalityContext();
	    const agingStarters=(myR()?.players||[]).filter(pid=>{
	      const pos=pM(pPos(pid));const age=pAge(pid)||26;
	      const declineEnd=(LI.ageCurveWindows||{})[pos]?.decline?.[1]||(LI.peakWindows||{})[pos]?.[1]||29;
	      return age>declineEnd&&dynastyValue(pid)>2000&&['QB','RB','WR','TE'].includes(pos);
	    }).map(pid=>pNameShort(pid)+'('+pPos(pid)+','+pAge(pid)+')').join(', ');
    const sc=S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings||{};
    const draftCtx=`${year} ROOKIE DRAFT ADVISOR.
RULES: Never recommend K or IDP in R1-R2. Offense-first in early rounds. IDP is mid-late round value only.
${mentalityCtx}
Team: ${dhqCompactContext()}
My ${year} picks: ${myPicks||'none'}
Aging starters past value window: ${agingStarters||'none'}
Scoring: SF=${(sc.pass_td??4)>4?'premium':'standard'}, PPR=${sc.rec??0}, sack=${sc.idp_sack??4}, INT=${sc.idp_int??5}
DYNASTY DRAFT PRINCIPLES: In SF leagues, QBs are 2-3x more valuable. Draft for ceiling in rebuild, floor if contending. Consider league tendencies — if your league overdrafts a position, target the falling value at other positions.
NOTE: Sleeper's rookie data improves as the NFL draft approaches. Pre-NFL draft rankings are speculative.`;
    const msgs=draftChatHistory.map((m,i)=>
      i===draftChatHistory.length-1&&m.role==='user'?{role:'user',content:draftCtx+'\n\n'+m.content}:m
    );
    const needsSearch=/search|look up|who is|rank|rookie|prospect|mock/i.test(text);
    const reply=await callClaude(msgs,needsSearch,2,500);
    draftChatHistory.push({role:'assistant',content:reply});
    loading.innerHTML=_sanitizeAIResponse(reply);
  }catch(e){loading.innerHTML=`<span style="color:var(--red)">Error: ${escHtml(e.message)}</span>`;}
  $('draft-msgs').scrollTop=99999;
}

function addDraftMsg(text,role){
  const d=document.createElement('div');d.className=`hc-msg-${role==='user'?'u':'a'}`;d.style.fontSize='13px';
  d.innerHTML=text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  $('draft-msgs').appendChild(d);$('draft-msgs').scrollTop=99999;
}

// ── Expose on window.App ──────────────────────────────────────
Object.assign(window.App, {
  // State
  homeChatHistory,
  tradeChatHistory,
  tradeBuilderAssets,
  draftChatHistory,
  // PROVIDERS, _newsCache already on window.App from shared/ai-dispatch.js

  // Conversation memory
  loadConvMemory,
  saveConvMemory,
  addConvMemory,
  buildMemoryCtx,
  autoSaveMemory,
  buildMentalityCtx,

  // Context builders
  buildCtx,
  buildCtxCompact,

  // Provider, Core AI — already on window.App from shared/ai-dispatch.js

  // Chat UI helpers
  expandChat,
  collapseDraftChat,
  homeAsk,
  goAsk,

  // Home chat
  sendHomeChat,

  // Trade chat
  sendTradeChatMsg,
  sendTradeChat,

  // Waiver chat
  sendWaiverChat,

  // Draft chat
  sendDraftChatMsg,
  sendDraftChat,
  addDraftMsg,

  // Waiver AI agent
  runWaiverAgent,

});

// ── Waiver AI Agent ────────────────────────────────────────────
async function runWaiverAgent(){
  const btn=$('wq-btn');
  if(!hasAnyAI(false)){
    // Fallback: generate a data-driven queue without AI
    btn.textContent='Building...';btn.disabled=true;
    try{
      const avail=getAvailablePlayers();
      const faab=typeof getFAAB==='function'?getFAAB():{remaining:0,budget:0,isFAAB:false};
      const slots=typeof getRosterSlots==='function'?getRosterSlots():{openBench:0};
      const assess=typeof assessTeamFromGlobal==='function'?assessTeamFromGlobal(S.myRosterId):null;
      const faabMarket=LI_LOADED&&LI.faabByPos?LI.faabByPos:{};
      const posMapF=p=>{if(['DE','DT'].includes(p))return'DL';if(['CB','S'].includes(p))return'DB';return p;};
      const needPositions=assess?.needs?.map(n=>n.pos)||[];

      // Score and rank
      const ranked=avail.slice(0,15).map((a,i)=>{
        const pos=posMapF(a.p.position);
        const fillsNeed=needPositions.includes(pos);
        const st=S.playerStats?.[a.id]||{};
        const ppg=st.prevAvg||st.seasonAvg||0;
        const market=faabMarket[pos];
        let faabLo=0,faabHi=0;
        if(market&&market.count>=3&&faab.budget>0&&faab.isFAAB){
          const fl=faab.minBid||1;
          const sug=Math.max(fl,Math.min(Math.round(faab.remaining*0.12),Math.round(market.avg*(a.val/4000))));
          faabLo=Math.max(fl,Math.round(sug*0.7));
          faabHi=Math.min(faab.remaining,Math.round(sug*1.3));
        }
        const conf=a.val>=4000?'High':a.val>=2000?'Medium':'Speculative';
        const reason=fillsNeed?'Fills '+pos+' need'+(ppg?' · '+ppg.toFixed(1)+' PPG':''):ppg?ppg.toFixed(1)+' PPG · '+a.val.toLocaleString()+' DHQ':'Dynasty value: '+a.val.toLocaleString();
        return{name:pName(a.id),pid:a.id,pos,team:a.p.team||'FA',val:a.val,rank:i+1,faabLo,faabHi,conf,reason,fillsNeed};
      });

      // Sort: needs first, then by value
      ranked.sort((a,b)=>(b.fillsNeed?1:0)-(a.fillsNeed?1:0)||b.val-a.val);
      ranked.forEach((r,i)=>r.rank=i+1);

      const list=ranked.slice(0,6);
      const confCol=c=>c==='High'?'var(--green)':c==='Medium'?'var(--amber)':'var(--text3)';
      const confCls=c=>c==='High'?'wv-high':c==='Medium'?'wv-med':'wv-low';

      $('wq-list').innerHTML=`
        <div style="font-size:13px;color:var(--text3);margin-bottom:8px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px">
          Data-driven recommendations · ${avail.length} available · ${slots.openBench} open slots
          ${faab.isFAAB?` · $${faab.remaining} FAAB`:''}
        </div>
        ${list.map(r=>`
          <div class="wv-queue-item ${confCls(r.conf)}" onclick="openPlayerModal('${r.pid}')">
            <div class="wv-rank">#${r.rank}</div>
            <div class="wv-item-info">
              <div class="wv-item-name">
                ${r.name}
                <span class="rr-pos" style="${getPosBadgeStyle(r.pos)}">${r.pos}</span>
              </div>
              <div class="wv-item-reason">${r.reason}</div>
            </div>
            <div class="wv-item-right">
              ${r.faabLo?`<div class="wv-faab-badge">$${r.faabLo}–${r.faabHi}</div>`:''}
              <div class="wv-conf-badge" style="color:${confCol(r.conf)}">${r.conf}</div>
            </div>
          </div>`).join('')}
        <div style="font-size:13px;color:var(--text3);padding:8px 0;text-align:center">
          Enable AI in Settings for personalized recommendations with drop suggestions.
        </div>`;
    }catch(e){
      $('wq-list').innerHTML=`<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl)">Waiver engine temporarily unavailable. Showing top projected pickups above.</div>`;
    }
    btn.textContent='Generate';btn.disabled=false;
    return;
  }
  btn.textContent='Scanning...';btn.disabled=true;
  $('wq-list').innerHTML='<div style="padding:16px;text-align:center"><div style="display:inline-block;width:16px;height:16px;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;margin-right:8px;vertical-align:middle"></div><span style="color:var(--text3);font-size:13px">Analyzing roster needs, FAAB context, and available players...</span></div>';
  try{
    const avail=getAvailablePlayers();
    const posFilter=$('avail-pos-sel')?.value||'';
    const filtered=posFilter?avail.filter(a=>a.p.position===posFilter):avail;
    const top20=filtered.slice(0,20);
    const faab=getFAAB();
    const slots=getRosterSlots();
    const leagueFaab=(()=>{
      const budgets=S.rosters.map(r=>(r.settings?.waiver_budget||200)-(r.settings?.waiver_budget_used||0));
      const avg=budgets.length?Math.round(budgets.reduce((a,b)=>a+b,0)/budgets.length):100;
      return{avg};
    })();
    const histSpend={};
    const isFAAB=faab.isFAAB;
    const spendCtx='';
    const myPlayers=myR()?.players||[];
    const myPosCounts={};
    myPlayers.forEach(pid=>{const pos=pPos(pid);if(pos)myPosCounts[pos]=(myPosCounts[pos]||0)+1;});
    const LI=window.App.LI||{};
    const LI_LOADED=window.App.LI_LOADED;
    const topAvailStr=top20.slice(0,10)
      .filter(({id})=>!(LI.playerMeta?.[id]?.source==='FC_ROOKIE')&&(S.players[id]?.years_exp||0)>0)
      .map(({id,p,val})=>{
      return`${pName(id)}(${p.position},${p.age||'?'},${p.team||'FA'},DHQ${val})`;
    }).join(';');
    const slotsToFill=Math.max(1,Math.min(4,slots.openBench>0?slots.openBench:1));
    const faabFields=isFAAB?'"faab_low":0,"faab_high":0,':'';
    const faabCtxStr=LI_LOADED&&LI.faabByPos?
      Object.entries(LI.faabByPos).slice(0,4).map(([pos,d])=>`${pos}:avg$${d.avg}(${d.count}claims)`).join(';'):'';
    const sc=S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings||{};
    const prompt=`Waiver agent. ${S.season} offseason. DHQ values 0-10000 scale.
CRITICAL RULES:
1. ONLY recommend players from the AVAILABLE list below. Do NOT recommend any player not on this list — they are rostered by other teams.
2. Rookies (0 years experience) can ONLY be added through the rookie draft, NOT waivers.
3. Only recommend VETERAN free agents who have played at least 1 NFL season.
4. Respond with ONLY a JSON object — no markdown, no backticks, no explanation.
${dhqBuildMentalityContext()}
ROSTER:${slots.openBench}open,${slots.rosterMax}max. POS:${Object.entries(myPosCounts).map(([p,c])=>`${p}:${c}`).join(',')}
${isFAAB?`FAAB:$${faab.remaining}/$${faab.budget}${faab.minBid>0?',min bid $'+faab.minBid:''}.${faabCtxStr?'History:'+faabCtxStr:''}`:'Waiver priority #'+(myR()?.settings?.waiver_position||'?')}
AVAILABLE FREE AGENTS (ONLY pick from this list):${topAvailStr||'still loading'}
IDP:sack=${sc.idp_sack??4},INT=${sc.idp_int??5},PD=${sc.idp_pass_def??3}
${slots.openBench===0?'ROSTER FULL — must suggest who to drop.':''}
Recommend ${slotsToFill} adds from the AVAILABLE list above. JSON only:
{"recommendations":[{"name":"player","position":"POS","team":"TM","rank":1,"age":0,"dynastyValue":0,"reason":"why",${faabFields}"copyText":"Sleeper msg"}]}`;
    const reply=await callClaude([{role:'user',content:prompt}]);
    let data={recommendations:[]};
    try{
      let clean=reply;
      clean=clean.replace(/```(?:json|JSON|js|javascript)?\s*/g,'').replace(/```\s*/g,'');
      const firstBrace=clean.indexOf('{');
      const lastBrace=clean.lastIndexOf('}');
      if(firstBrace>=0&&lastBrace>firstBrace){
        clean=clean.substring(firstBrace,lastBrace+1);
      }
      data=JSON.parse(clean);
    }catch(err){
      $('wq-list').innerHTML=`<div class="card"><div style="font-size:13px;color:var(--text2);line-height:1.6;padding:4px">${_sanitizeAIResponse(reply)}</div></div>`;
      btn.textContent='Generate';btn.disabled=false;return;
    }
    const mentLabel={balanced:'⚖️ Balanced',winnow:'🏆 Win Now',rebuild:'🔄 Rebuild',prime:'⭐ Dynasty Prime'}[loadMentality().mentality]||'';
    if(data.recommendations){
      data.recommendations=data.recommendations.filter(r=>{
        const pid=Object.entries(S.players).find(([,p])=>(p.first_name+' '+p.last_name).toLowerCase()===r.name?.toLowerCase())?.[0];
        if(pid&&LI.playerMeta?.[pid]?.source==='FC_ROOKIE')return false;
        if(pid&&S.players[pid]?.years_exp===0)return false;
        return true;
      });
    }
    const confFromRank=rank=>rank===1?'High':rank<=3?'High':rank<=5?'Medium':'Speculative';
    const confCol2=c=>c==='High'?'var(--green)':c==='Medium'?'var(--amber)':'var(--text3)';
    const confCls2=c=>c==='High'?'wv-high':c==='Medium'?'wv-med':'wv-low';

    $('wq-list').innerHTML=`
      <div style="font-size:13px;color:var(--text3);margin-bottom:8px;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;display:flex;gap:10px;flex-wrap:wrap">
        ${mentLabel?'<span>'+mentLabel+'</span>':''}<span>${avail.length} available</span>
        <span style="color:${slots.openBench>0?'var(--green)':'var(--red)'}">${slots.openBench} open slot${slots.openBench!==1?'s':''}</span>
        ${isFAAB?`<span style="color:var(--green)">$${faab.remaining} FAAB</span>`:''}
      </div>
      ${data.recommendations.length?data.recommendations.map(r=>{
        const pid2=Object.entries(S.players).find(([,p])=>(p.first_name+' '+p.last_name).toLowerCase()===r.name?.toLowerCase())?.[0]||'';
        const conf2=confFromRank(r.rank);
        return`<div class="wv-queue-item ${confCls2(conf2)}" ${pid2?`onclick="openPlayerModal('${pid2}')"`:''}style="cursor:${pid2?'pointer':'default'}">
          <div class="wv-rank">#${r.rank}</div>
          <div class="wv-item-info">
            <div class="wv-item-name">
              ${r.name}
              <span class="rr-pos" style="${getPosBadgeStyle(r.position)}">${r.position||'?'}</span>
              ${r.age?'<span style="font-size:13px;color:var(--text3)">'+r.age+'</span>':''}
            </div>
            <div class="wv-item-reason">
              ${r.reason}
              ${r.drop?'<br><span style="color:var(--red)">Drop: '+r.drop+'</span>'+(r.drop_reason?' <span style="color:var(--text3)">('+r.drop_reason+')</span>':''):''}
            </div>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              ${r.copyText?`<button class="copy-btn" style="font-size:13px" onclick="event.stopPropagation();copyText(${JSON.stringify(r.copyText)},this)">Copy claim</button>`:''}
              <button class="copy-btn" style="font-size:13px" onclick="event.stopPropagation();goAsk('Deep dive: should I add ${(r.name||'').replace(/'/g,'')}?')">Ask more</button>
            </div>
          </div>
          <div class="wv-item-right">
            ${isFAAB&&r.faab_low!=null?`<div class="wv-faab-badge">$${r.faab_low}–${r.faab_high}</div>`:''}
            <div class="wv-conf-badge" style="color:${confCol2(conf2)}">${conf2}</div>
          </div>
        </div>`;}).join('')
      :'<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px">No strong waiver adds this week.</div>'}`;
  }catch(e){$('wq-list').innerHTML=`<div class="card"><div class="empty" style="color:var(--red)">Error: ${escHtml(e.message)}</div></div>`;}
  btn.textContent='Generate';btn.disabled=false;
}

// Expose chat state on window.App so they're reachable via the canonical namespace
// (see State Registry in app.js for the full inventory)
window.App.homeChatHistory    = homeChatHistory;
window.App.tradeChatHistory   = tradeChatHistory;
window.App.draftChatHistory   = draftChatHistory;
window.App.tradeBuilderAssets = tradeBuilderAssets;

// Bare window globals for inline handlers / cross-module access
window.buildMentalityCtx = buildMentalityCtx;
// Aliases used by ui.js, draft-ui.js — dhqContext is buildCtx, dhqBuildMentalityContext is buildMentalityCtx
window.dhqContext = buildCtx;
window.dhqBuildMentalityContext = buildMentalityCtx;
window.homeAsk = homeAsk;
window.goAsk = goAsk;
window.expandChat = expandChat;
window.collapseDraftChat = collapseDraftChat;
window.sendDraftChatMsg = sendDraftChatMsg;
window.sendDraftChat = sendDraftChat;
window.addDraftMsg = addDraftMsg;

// ── Module global exports (Vite migration) ───────────────────────────────────
window.buildCtx = buildCtx;
window.buildCtxCompact = buildCtxCompact;
window.buildMemoryCtx = buildMemoryCtx;
window.loadConvMemory = loadConvMemory;
window.saveConvMemory = saveConvMemory;
window.addConvMemory = addConvMemory;
window.autoSaveMemory = autoSaveMemory;

// ── Mobile keyboard detection ──────────────────────────────────
// Hides mobile nav and repositions chat overlay when virtual keyboard opens
if (window.visualViewport) {
  const updateKeyboardState = () => {
    const vv = window.visualViewport;
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const focused = document.activeElement;
    const acceptsText = focused && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName);
    const isKeyboard = acceptsText && offset > 80;
    document.documentElement.style.setProperty('--keyboard-offset', isKeyboard ? `${Math.round(offset)}px` : '0px');
    document.body.classList.toggle('keyboard-open', isKeyboard);
    if (!acceptsText) document.body.classList.remove('gm-bar-typing');
  };
  window.visualViewport.addEventListener('resize', updateKeyboardState);
  window.visualViewport.addEventListener('scroll', updateKeyboardState);
  document.addEventListener('focusin', () => setTimeout(updateKeyboardState, 60));
  document.addEventListener('focusout', () => setTimeout(updateKeyboardState, 80));
}
