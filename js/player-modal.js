// ═══════════════════════════════════════════════════════════════
// js/player-modal.js — Player detail bottom sheet modal
// Extracted from ui.js to keep it editable as a standalone unit.
//
// Globals expected (all set before this file loads):
//   S, $, LI, LI_LOADED, _newsCache       — state & cache
//   pName, pPos, pAge, pTeam, fullTeam, myR — player helpers (app.js)
//   getDcLabel, peakYears, _reconVerdict   — roster helpers (ui.js)
//   dynastyValue, getPlayerRank, tradeValueTier — valuation (dhq-engine, constants)
//   calcIDPScore, getPlayerAction          — scoring / action (app.js, team-assess)
//   callClaude, callGrokNews, hasAnyAI     — AI layer (ai-dispatch, dhq-ai)
//   goAsk, switchTab                       — navigation (ai-chat, app)
//   showToast, copyText, escHtml           — UI utils (app.js)
// ═══════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Player Modal ───────────────────────────────────────────────
// _newsCache already declared in ai-chat.js (Grok news) — reuse it for player news too
// Both caches key by player ID so they don't conflict

function resetPlayerModalState(){
  const el=$('player-modal');
  if(!el)return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden','true');
  const card=el.querySelector('.pm-card');
  if(card)card.style.transform='';
}

async function fetchPlayerNews(playerId){
  if(_newsCache[playerId])return _newsCache[playerId];
  const p=S.players[playerId];if(!p)return null;
  const name=p.first_name+' '+p.last_name;
  const pos=p.position||'';
  const team=p.team||'FA';
  const result=await callGrokNews(`What is the latest news about ${name} (${pos}, ${team}) specifically? ONLY discuss ${name}, no other players. Include any recent trades, signings, injuries, or dynasty fantasy football community reaction from X/Twitter.`);
  if(result)_newsCache[playerId]=result;
  return result;
}

async function loadPlayerNewsNow(playerId){
  const newsEl=$('pm-news');if(!newsEl)return;
  newsEl.innerHTML='<div style="color:var(--text3);font-size:13px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite"></span>Loading from X...</div>';
  try{
    const newsPromise=fetchPlayerNews(playerId);
    const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),5000));
    const news=await Promise.race([newsPromise,timeoutPromise]);
    if(news){
      newsEl.innerHTML=`<div style="font-size:13px;color:var(--text2);line-height:1.5">${news.replace(/\n/g,'<br>')}</div><div style="font-size:13px;color:var(--text3);margin-top:4px">via Grok · X/Twitter</div>`;
    }else{
      newsEl.innerHTML='<div style="color:var(--text3);font-size:13px">No recent news found for this player.</div>';
    }
  }catch(e){
    newsEl.innerHTML=e.message==='timeout'
      ?'<div style="color:var(--text3);font-size:13px">News request timed out. Tap to retry.</div>'
      :'<div style="color:var(--red);font-size:13px">Error loading news. Check your xAI key in Settings.</div>';
  }
}

function openPlayerModal(playerId){
  const p=S.players[playerId]||S.players[String(playerId)];
  if(!p){
    resetPlayerModalState();
    console.warn('[PM] Player not found:',playerId,'| DB size:',Object.keys(S.players||{}).length);
    return;
  }
  window.OD?.track?.('player_modal_opened', {
    platform: 'reconai',
    module: document.querySelector('.panel.active')?.id?.replace(/^panel-/, '') || null,
    entityType: 'player',
    entityId: playerId,
    metadata: { pos: pPos(playerId), team: p.team || 'FA' },
  });
  window._pmPid=playerId;
  const li=window.App?.LI||window.LI||{};
  const liLoaded=Boolean(window.App?.LI_LOADED||window.LI_LOADED);
  const pos=p.position||'?';const age=p.age||26;const val=dynastyValue(playerId);
  const exp=p.years_exp??0;
  const ageCurveMap=window.App?.ageCurveWindows||{};
  const peakMap=window.App?.peakWindows||{QB:[28,34],RB:[23,25],WR:[25,28],TE:[26,29],DL:[25,29],LB:[24,28],DB:[24,27],K:[28,35]};
  const modalPos=pPos(playerId);
  const [pLo,pHi]=peakMap[modalPos]||[24,29];
  const declineHi=ageCurveMap[modalPos]?.decline?.[1]||pHi+2;
  const peak=Math.round((pLo+pHi)/2);
  const onMyTeam=(myR()?.players||[]).includes(String(playerId));
  const stats=S.playerStats?.[playerId]||{};
  const proj=S.playerProj?.[playerId];
  const {tier,col}=tradeValueTier(val);
  const pk=peakYears(playerId);
  const dcLbl=getDcLabel(playerId);
  const posRank=S.posRanks?.[playerId];

  // Banner
  $('pm-photo').src=`https://sleepercdn.com/content/nfl/players/${playerId}.jpg`;
  $('pm-photo').style.display='';
  $('pm-initials').textContent=((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase();
  $('pm-initials').style.display='none';
  const displayPos = window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
  $('pm-pos-badge').textContent=displayPos;
  $('pm-pos-badge').className='';
  $('pm-pos-badge').style.cssText=`position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);font-size:13px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap;${getPosBadgeStyle(pos)}`;
  $('pm-name').innerHTML=`${pName(playerId)} ${onMyTeam?'<span style="font-size:13px;color:var(--green);font-weight:600">✓ roster</span>':''}`;
  $('pm-bio').innerHTML=`${displayPos} · ${fullTeam(p.team)} · Age ${age} · ${exp}yr exp${p.college?' · '+p.college:''}`;

  // Alex Says — strategy-aware verdict at top of every player card
  const verdictEl=$('pm-verdict');
  if(verdictEl){
    const meta2=liLoaded?li.playerMeta?.[playerId]:null;
    const pa2=typeof getPlayerAction==='function'?getPlayerAction(playerId):{label:'Hold',col:'var(--accent)',reason:''};

    // Strategy context: check untouchables, target positions, sell positions
    const strat=window.GMStrategy?.getStrategy?window.GMStrategy.getStrategy():{};
    let stratLabel=pa2.label;
    let stratReason=pa2.reason||'';
    let stratCol=pa2.col||'var(--accent)';

    if((strat.untouchables||[]).includes(String(playerId))){
      stratLabel='HOLD';stratReason='Marked as untouchable in your strategy.';stratCol='var(--green)';
    } else if((strat.blockList||[]).includes(String(playerId))){
      stratLabel='SKIP';stratReason='On your block list. Pass on this player.';stratCol='var(--text3)';
    } else if((strat.targetList||[]).includes(String(playerId))){
      stratLabel='BUY';stratReason='On your personal target list. Prioritize acquisition.';stratCol='var(--accent)';
    } else if((strat.targetPositions||[]).includes(pos)){
      stratLabel=pa2.label==='Sell'||pa2.label==='Sell High'?pa2.label:'BUY';
      stratReason=pa2.label==='Sell'||pa2.label==='Sell High'?stratReason:'This '+pos+' fits your strategy. '+(pa2.reason||'');
    } else if((strat.sellPositions||[]).includes(pos)){
      stratLabel=pa2.label==='Buy'||pa2.label==='Build Around'?pa2.label:'SELL';
      stratReason=pa2.label==='Buy'||pa2.label==='Build Around'?stratReason:'Your strategy flags '+pos+' as a sell position. '+(pa2.reason||'');
      if(stratLabel==='SELL')stratCol='var(--red)';
    }

    // Check sell rules (sell above age threshold)
    const sellRule=(strat.sellRules||[]).find(r=>r.pos===pos&&(age||0)>=r.ageAbove);
    if(sellRule&&stratLabel!=='SKIP'){
      stratLabel='SELL HIGH';stratReason='Age '+age+' triggers your sell rule for '+pos+'. Trade while value holds.';stratCol='var(--amber)';
    }

    // Alignment badge
    const alignResult=window.GMStrategy?.checkAlignment?window.GMStrategy.checkAlignment({type:'trade',direction:onMyTeam?'sell':'acquire',position:pos,playerId:String(playerId),playerAge:age}):{alignment:'partial'};
    const alignColor=alignResult.alignment==='aligned'?'var(--green)':alignResult.alignment==='conflicts'?'var(--red)':'var(--text3)';
    const alignLabel=alignResult.alignment==='aligned'?'Strategy Aligned':alignResult.alignment==='conflicts'?'Conflicts Strategy':'Neutral';

    // Rationale line (one sharp sentence)
    const peakYrsLeft2=meta2?.peakYrsLeft||0;
    if(!stratReason){
      if(stratLabel==='Build Around')stratReason='Core dynasty asset. Long runway, elite production.';
      else if(stratLabel==='BUY'||stratLabel==='Buy')stratReason=peakYrsLeft2>=3?peakYrsLeft2+' peak years ahead. Acquire now.':'Ascending value. Acquire before price rises.';
      else if(stratLabel==='HOLD'||stratLabel==='Hold')stratReason=peakYrsLeft2>=3?'In prime with '+peakYrsLeft2+' peak years left. Reliable.':'Producing well. Hold unless you get an overpay.';
      else if(stratLabel==='SELL HIGH'||stratLabel==='Sell High')stratReason='Window closing. Maximize return now.';
	      else if(stratLabel==='SELL'||stratLabel==='Sell')stratReason='Past value window. Move while value remains.';
      else if(stratLabel==='Stash')stratReason=meta2?.source==='FC_ROOKIE'?'Incoming rookie. Monitor landing spot.':'Low cost upside. Worth a roster spot.';
    }

    verdictEl.style.display='block';
    verdictEl.innerHTML=`<div style="background:rgba(212,175,55,.07);border:1px solid rgba(212,175,55,.2);border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em">Alex says</span>
        <span style="font-size:16px;font-weight:800;color:${stratCol};letter-spacing:-.01em">${escHtml(stratLabel)}</span>
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:${alignColor};padding:1px 6px;border:1px solid ${alignColor};border-radius:8px;opacity:.85">${alignLabel}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:1.45">${escHtml(stratReason)}</div>
    </div>`;
  }
  // IDP data
  const isIDPModal=['DL','LB','DB'].includes(pos);
  const scModal=S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings||{};
  const rawModal=S.playerStats?.[playerId]?.prevRawStats;
  const idpBadge=$('pm-idp-badge');
  if(idpBadge)idpBadge.innerHTML=''; // no longer rendered as banner badge
  const idpPPGModal=isIDPModal&&rawModal?+(calcIDPScore(rawModal,scModal)/Math.max(1,rawModal.gp||17)).toFixed(1):null;

  // Value insight blurb
  const insightEl=$('pm-insight');
  if(insightEl){
    const meta=liLoaded?li.playerMeta?.[playerId]:null;
    if(meta){
      const mappedPos=meta.pos||pos;
      const [peakStart,peakEnd]=(li.peakWindows||{})[mappedPos]||[23,29];
      const declineEnd=(li.ageCurveWindows||{})[mappedPos]?.decline?.[1]||peakEnd+2;
      const yrsPast=Math.max(0,age-peakEnd);
      const trend=meta.trend||0;
      const gp=meta.recentGP||17;
      const yrsExp=p.years_exp||0;
      const team=p.team||'';

      let blurb='',blurbColor='var(--amber)';

	      if(meta.source==='FC_ROOKIE'){
	        blurb=`Incoming rookie with ${meta.peakYrsLeft||'?'} peak years ahead. Value based on DHQ dynasty consensus — no NFL production yet.`;
	        blurbColor='var(--green)';
	      }else if(meta.statusReason){
	        const roleNote=meta.roleLabel?` ${meta.roleLabel}.`:'';
	        blurb=`${meta.statusReason}.${roleNote} DHQ is capping the profile until the NFL role changes.`;
	        blurbColor=meta.statusCode==='active'?'var(--amber)':'var(--red)';
	      }else if(meta.roleLabel&&meta.roleMult<0.9){
	        blurb=`${meta.roleLabel} on the NFL depth chart. DHQ is discounting the role until playing-time confidence improves.`;
	        blurbColor='var(--amber)';
	      }else if(meta.opportunityLabel&&meta.opportunityMult<1){
	        blurb=`${meta.opportunityLabel}. DHQ is applying a softer opportunity discount, not a hard ceiling.`;
	        blurbColor='var(--amber)';
	      }else if(meta.sitMult<=0.45&&(!team||team==='FA')){
	        blurb=`Not rostered by anyone in the league and no NFL team. ${yrsPast>=2?'Likely retired or out of football.':'Needs a landing spot to have any value.'}`;
	        blurbColor='var(--red)';
	      }else if(age<=declineEnd&&yrsPast>0){
	        const valueLeft=Math.max(0,declineEnd-age);
	        const trendNote=trend<=-20?` PPG fell ${Math.abs(trend)}% — monitor the slide.`:trend>=15?` Still trending up ${trend}% — defying the curve.`:'';
	        blurb=`Past elite ${mappedPos} peak, but still inside the valuable veteran band at age ${age}.${valueLeft?` About ${valueLeft} value year${valueLeft>1?'s':''} left.`:' Final value year.'}${trendNote}`;
	        blurbColor='var(--amber)';
	      }else if(yrsPast>=5){
        const extra=gp<=12?` Only played ${gp} games last year.`:'';
        const trendNote=trend<=-15?` Production down ${Math.abs(trend)}%.`:'';
        blurb=`${yrsExp>8?yrsExp+'-year veteran, ':''}${yrsPast} years past ${mappedPos} prime at age ${age}. On borrowed time — sell if anyone's buying.${extra}${trendNote}`;
        blurbColor='var(--red)';
      }else if(yrsPast>=2){
        const trendNote=trend<=-20?` PPG dropped ${Math.abs(trend)}% last season.`:trend>=15?` Still trending up ${trend}% — defying age.`:'';
        const gpNote=gp<=12?` Durability concern — only ${gp} games.`:'';
        blurb=`${yrsPast} years past ${mappedPos} peak at age ${age}. ${meta.starterSeasons>=4?'Proven producer but ':''}Dynasty value declining.${trendNote}${gpNote}`;
        blurbColor='var(--red)';
      }else if(yrsPast===1){
        const trendNote=trend<=-20?` PPG fell ${Math.abs(trend)}% — the decline may be starting.`:trend>=15?` Still improving (+${trend}%) — could have more in the tank.`:' Watch closely this season.';
        blurb=`Just exited ${mappedPos} peak window at age ${age}.${trendNote}`;
        blurbColor='var(--amber)';
      }else if(age<=peakStart&&meta.peakYrsLeft>=5){
        const prodNote=meta.starterSeasons>=2?` Already a ${meta.starterSeasons}-year starter at just ${age} — rare.`:meta.starterSeasons===1?' Showed starter-level production in year one.':' Still developing.';
        const trendNote=trend>=20?` PPG up ${trend}% — breakout trajectory.`:'';
        blurb=`${meta.peakYrsLeft} peak years ahead at age ${age}.${prodNote}${trendNote} Dynasty stock rising.`;
        blurbColor='var(--green)';
      }else if(meta.peakYrsLeft>=3){
        const eliteNote=meta.sitMult>=1.30&&age<=25?' Elite young producer — exactly what dynasty is about.':'';
        const trendNote=trend>=20?` PPG up ${trend}% year-over-year.`:'';
        blurb=`In prime with ${meta.peakYrsLeft} peak years left. ${meta.starterSeasons>=3?meta.starterSeasons+'-year proven starter. ':''}${eliteNote}${trendNote}`;
        blurbColor='var(--green)';
      }else if(meta.peakYrsLeft>=1){
        const trendNote=trend<=-20?` Production declining (${trend}%).`:'';
        blurb=`${meta.peakYrsLeft} peak year${meta.peakYrsLeft>1?'s':''} left at age ${age}. Window closing${meta.starterSeasons>=3?' but still a reliable starter':''}.${trendNote}`;
        blurbColor='var(--amber)';
      }else{
        blurb=`Final ${mappedPos} peak year at age ${age}. Value peaks now — it only goes down from here.`;
        blurbColor='var(--amber)';
      }

      if(gp<=8&&gp>0&&!blurb.includes('games'))blurb+=` ⚠️ Only ${gp} games last season.`;

      if(blurb){
        const bg=blurbColor==='var(--red)'?'rgba(248,113,113,.06)':blurbColor==='var(--green)'?'rgba(52,211,153,.06)':'rgba(251,191,36,.06)';
        insightEl.innerHTML=`<div style="font-size:13px;color:${blurbColor};line-height:1.5;padding:8px 12px;background:${bg};border-radius:8px">${blurb}</div>`;
      }else insightEl.innerHTML='';
    }else insightEl.innerHTML='';
  }

  // Tags
  const tags=[];
  if(p.injury_status)tags.push(`<span style="background:var(--redL);color:var(--red);font-size:13px;font-weight:700;padding:2px 7px;border-radius:20px">${p.injury_status}</span>`);
  if(dcLbl)tags.push(`<span style="background:var(--bg4);color:var(--text2);font-size:13px;padding:2px 7px;border-radius:20px">${dcLbl}</span>`);
  if(posRank){
    const _allRostered=[];S.rosters.forEach(r=>(r.players||[]).forEach(p=>{const m=window.App?.LI?.playerMeta?.[p];if(m?.pos===pos&&(window.App?.LI?.playerScores?.[p]||0)>0)_allRostered.push(p);}));
    tags.push(`<span style="background:var(--accentL);color:var(--accent);font-size:13px;font-weight:700;padding:2px 7px;border-radius:20px" title="${posRank} of ${_allRostered.length} rostered ${pos}s in league">${pos}${posRank}</span>`);
  }
  if(p.height||p.weight)tags.push(`<span style="background:var(--bg4);color:var(--text3);font-size:13px;padding:2px 7px;border-radius:20px">${[(p.height?Math.floor((p.height||0)/12)+"'"+(( p.height||0)%12)+'"':''),p.weight?p.weight+'lbs':''].filter(Boolean).join(' · ')}</span>`);
  $('pm-tags').innerHTML=tags.join('');

  // Stats bar
  const prevYr=String(parseInt(S.season)-1).slice(2);
  const fcRankData=getPlayerRank(playerId);
  const fcTrend=fcRankData?.trend||0;
  const trendLabel=fcTrend>100?'▲ Rising':fcTrend<-100?'▼ Falling':'Stable';
  const trendCol=fcTrend>100?'var(--green)':fcTrend<-100?'var(--red)':'var(--text3)';
  let statBoxes;
  if(isIDPModal&&idpPPGModal){
    // IDP stats bar: DHQ, Rank, IDP PPG, Tackles, Sacks/INTs
    const tklTotal=rawModal?Math.round((rawModal.idp_tkl_solo||0)+(rawModal.idp_tkl_ast||0)):0;
    const sacksTotal=rawModal?(rawModal.idp_sack||0).toFixed(1):'—';
    const intsTotal=rawModal?(rawModal.idp_int||0):'—';
    statBoxes=[
      {val:val>0?val.toLocaleString():'—',lbl:'DHQ Value',col:col},
      {val:fcRankData?'#'+fcRankData.pos:'—',lbl:'Pos Rank',col:'var(--accent)'},
      {val:idpPPGModal||'—',lbl:'IDP PPG',col:idpPPGModal>=6?'var(--green)':idpPPGModal>=3?'var(--text)':'var(--text3)'},
      {val:tklTotal||'—',lbl:'Tackles',col:tklTotal>=80?'var(--green)':tklTotal>=40?'var(--text)':'var(--text3)'},
      {val:pos==='DB'?(intsTotal+'/'+(rawModal?.idp_pass_def||0)):sacksTotal,lbl:pos==='DB'?'INT/PD':'Sacks',col:'var(--text)'},
    ];
  }else{
    const _gp=stats.prevGP||stats.gp||'—';
    statBoxes=[
      {val:val>0?val.toLocaleString():'—',lbl:'DHQ Value',col:col},
      {val:fcRankData?'#'+fcRankData.pos:'—',lbl:'Pos Rank',col:'var(--accent)'},
      {val:stats.prevAvg?.toFixed(1)||stats.seasonAvg?.toFixed(1)||'—',lbl:`'${prevYr} PPG`,col:stats.prevAvg>15?'var(--green)':stats.prevAvg&&stats.prevAvg<8?'var(--red)':'var(--text)'},
      {val:typeof _gp==='number'?_gp:'—',lbl:'GP',col:_gp>=14?'var(--green)':_gp>=10?'var(--text)':'var(--red)'},
      {val:trendLabel,lbl:'30d Trend',col:trendCol},
    ];
  }
  $('pm-stats-bar').innerHTML=statBoxes.map(s=>`<div class="pm-stat-box"><div class="pm-stat-box-val" style="color:${s.col}">${s.val}</div><div class="pm-stat-box-lbl">${s.lbl}</div></div>`).join('');
  // NFL Depth label below stats bar
  const depthLbl=$('pm-depth-label');
  if(depthLbl){const _dc=getDcLabel(playerId);depthLbl.textContent=_dc?_dc+' · NFL Depth':'';}

  // Age curve
  const ages=Array.from({length:17},(_,i)=>i+20);
  const segColor=a=>{
    if(a<pLo-3)return'rgba(96,165,250,.3)';
    if(a<pLo)return'rgba(52,211,153,.5)';
    if(a>=pLo&&a<=pHi)return'rgba(52,211,153,.8)';
    if(a<=declineHi)return'rgba(251,191,36,.5)';
    return'rgba(248,113,113,.4)';
  };
  $('pm-curve').innerHTML=ages.map(a=>`<div class="acb-seg" style="background:${segColor(a)};opacity:${a===age?1:0.6};outline:${a===age?'2px solid white':'none'};outline-offset:-1px" title="Age ${a}">${a===age?age:''}</div>`).join('');
  $('pm-curve-lbl').innerHTML=`<span>20</span><span>Peak ${pLo}–${pHi}</span><span>36</span>`;
  $('pm-peak-tag').textContent=`Currently age ${age} · ${pk.label} · ${pk.desc}`;

  // Sparkline
  const weeklyPts=stats.weeklyPts||[];
  if(weeklyPts.length){
    $('pm-spark-wrap').style.display='block';
    const maxWk=Math.max(...weeklyPts,1);
    $('pm-spark').innerHTML=weeklyPts.map(w=>{
      const h=Math.max(3,Math.round((w/maxWk)*36));
      const col2=w===Math.max(...weeklyPts)?'var(--green)':w===Math.min(...weeklyPts)?'var(--red)':'var(--accent)';
      return`<div style="flex:1;height:${h}px;border-radius:2px 2px 0 0;background:${col2};opacity:.8" title="${w.toFixed(1)}pts"></div>`;
    }).join('');
    $('pm-spark-lbl').innerHTML=weeklyPts.map((_,i)=>`<span style="flex:1;text-align:center">W${i+1}</span>`).join('');
  }else{$('pm-spark-wrap').style.display='none';}

  // Trade value + right panel (peak years OR IDP stats)
  $('pm-trade-val').textContent=val>0?val.toLocaleString():liLoaded?'Not valued':'Loading...';
  $('pm-trade-tier').innerHTML=val>0?`<span style="color:${col}">${tier}</span>${fcRankData?' · Overall #'+fcRankData.overall:''}`:liLoaded?'<span style="color:var(--text3)">No DHQ production data</span>':'<span style="color:var(--text3)">DHQ engine loading...</span>';

  // Unified Trade Profile for ALL positions (offense + IDP)
  const rightPanel=$('pm-right-panel');
  if(rightPanel){
    const tpMeta=liLoaded?li.playerMeta?.[playerId]:null;
    const trend=tpMeta?.trend||0;
    const peakYrsLeft=tpMeta?.peakYrsLeft||0;
    const pa=typeof getPlayerAction==='function'?getPlayerAction(playerId):{label:'Hold',col:'var(--accent)',reason:''};

    // Trade Value Tier based on DHQ score
    const dhqVal=window.App?.LI?.playerScores?.[playerId]||0;
    const tvTier=dhqVal>=7000?{label:'Elite Trade Asset',col:'var(--green)',bg:'rgba(52,211,153,.1)'}:dhqVal>=4000?{label:'High Value',col:'var(--accent)',bg:'rgba(212,175,55,.1)'}:dhqVal>=2000?{label:'Mid Tier',col:'var(--amber)',bg:'rgba(251,191,36,.1)'}:{label:'Depth Piece',col:'var(--text3)',bg:'rgba(139,143,154,.08)'};

    // Market Trend — use playerTrends if available, else fall back to meta trend
    const ptData=window.App?.LI?.playerTrends?.[playerId];
    let mktTrendLabel,mktTrendCol;
    if(ptData){
      const ptVal=typeof ptData==='number'?ptData:(ptData.trend||ptData.delta||0);
      mktTrendLabel=ptVal>0?'▲ Rising':ptVal<0?'▼ Falling':'→ Stable';
      mktTrendCol=ptVal>0?'var(--green)':ptVal<0?'var(--red)':'var(--text3)';
    }else{
      mktTrendLabel=trend>=15?'▲ Rising':trend<=-15?'▼ Falling':'→ Stable';
      mktTrendCol=trend>=15?'var(--green)':trend<=-15?'var(--red)':'var(--text3)';
    }

    // Current Owner DNA — find who rosters this player
    const ownerProfiles=window.App?.LI?.ownerProfiles||{};
    let ownerDnaHtml='';
    if(S.rosters?.length){
      const ownerRoster=S.rosters.find(r=>(r.players||[]).includes(String(playerId)));
      if(ownerRoster&&ownerRoster.roster_id!==S.myRosterId){
        const ownerDna=ownerProfiles[ownerRoster.roster_id];
        const ownerUser=(S.leagueUsers||[]).find(u=>u.user_id===ownerRoster.owner_id);
        const ownerName=ownerUser?.metadata?.team_name||ownerUser?.display_name||'Owner';
        if(ownerDna?.dna){
          ownerDnaHtml=`<div style="margin-top:8px;padding:6px 8px;background:var(--bg4);border-radius:6px;font-size:12px;color:var(--text2)">
            <span style="color:var(--text3)">Owner:</span> <span style="font-weight:600">${escHtml(ownerName)}</span>
            <span style="margin-left:4px;padding:1px 6px;border-radius:8px;background:var(--accentL);color:var(--accent);font-weight:600;font-size:11px">${escHtml(ownerDna.dna)}</span>
          </div>`;
        }
      }
    }

    rightPanel.innerHTML=`
      <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Trade Profile${isIDPModal?' <span style="font-size:13px;color:var(--accent);background:var(--accentL);padding:1px 5px;border-radius:4px;font-weight:700;vertical-align:middle;margin-left:4px">IDP</span>':''}</div>
      <div style="font-size:20px;font-weight:800;color:${pa.col}">${pa.label}</div>
      <div style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:10px;background:${tvTier.bg};font-size:11px;font-weight:700;color:${tvTier.col}">${tvTier.label}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:6px">
	        <span style="font-weight:600;color:${mktTrendCol}">${mktTrendLabel}</span> · ${peakYrsLeft>0?peakYrsLeft+' peak yr'+(peakYrsLeft>1?'s':'')+' left':pk.desc||'Past value window'}
      </div>
      <div style="font-size:13px;color:var(--text3);margin-top:4px">${pa.reason}</div>
      ${ownerDnaHtml}`;
  }

  // Tag + note section
  const tagSec=$('pm-tag-section');
  if(tagSec){
    tagSec.style.display='block';
    const tagKey='player_tags_'+(S.currentLeagueId||'');
    let curTags={};
    try{ curTags=JSON.parse(localStorage.getItem(tagKey)||'{}'); }catch(e){ curTags={}; }
    const curTag=curTags[playerId]||'';
    const tagOpts=[{key:'trade',label:'Trade Block'},{key:'cut',label:'Cut'},{key:'untouchable',label:'Untouchable'},{key:'watch',label:'Watch'}];
    const noteKey='player_notes_'+(S.currentLeagueId||'');
    let curNotes={};
    try{ curNotes=JSON.parse(localStorage.getItem(noteKey)||'{}'); }catch(e){ curNotes={}; }
    const curNote=curNotes[playerId]||'';
    tagSec.innerHTML=`<div style="font-size:13px;font-weight:700;color:var(--text3);margin-bottom:4px">TAG</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${tagOpts.map(t=>{
        const isActive=curTag===t.key;
        return`<button class="chip" onclick="tagPlayer('${playerId}','${t.key}')" style="${isActive?'background:var(--accentL);color:var(--accent);border-color:var(--accent)':''}">${t.label}</button>`;
      }).join('')}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text3);margin-bottom:4px">NOTE</div>
      <textarea id="pm-note-text" placeholder="Your notes on this player…" style="width:100%;min-height:60px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box">${escHtml(curNote)}</textarea>
      <button onclick="addPlayerNote('${playerId}',document.getElementById('pm-note-text').value)" style="margin-top:6px;padding:6px 14px;font-size:12px;font-weight:700;background:var(--accentL);color:var(--accent);border:1px solid rgba(212,175,55,.3);border-radius:7px;cursor:pointer;font-family:inherit">Save note</button>`;
  }

  // Action buttons (hidden stubs — still wired for compat)
  const askBtn=$('pm-ask-btn');
  if(askBtn){
    askBtn.onclick=()=>{
      // Route through the player-scout tier with the structured NFL-fit context
      // (depth-chart role, named blockers + PPG, status, trend, capital) so the
      // reply is grounded in the player's real situation, not generic prose.
      let scoutCtx='';
      try{ scoutCtx=window.App?.computeNFLFit?.(playerId,{pos,player:p,dhq:dynastyValue(playerId)})?.contextString||''; }catch(e){}
      goAsk(
        `SEARCH FOR CURRENT INFO FIRST: Look up ${pName(playerId)} ${pos} ${fullTeam(p.team)} current situation, depth chart, and dynasty outlook for 2026. Then give a dynasty buy/sell/hold recommendation with current team context, role, and trade value. DHQ value: ${dynastyValue(playerId).toLocaleString()}.`,
        { callType:'player-scout', context:scoutCtx, useWebSearch:true }
      );
    };
  }
  const tradeBtn=$('pm-trade-btn');
  if(tradeBtn){
    tradeBtn.onclick=()=>{
      if(typeof window.openTradeBuilderForPlayer==='function'){
        closePlayerModal();
        window.openTradeBuilderForPlayer(playerId);
      }else{
        const ownerCtx=liLoaded&&li.ownerProfiles?Object.entries(li.ownerProfiles).filter(([rid])=>parseInt(rid)!==S.myRosterId).map(([rid,p2])=>{
          if(!p2.trades)return null;
          const name=S.leagueUsers.find(u=>{const r=S.rosters.find(r2=>r2.roster_id===parseInt(rid));return r&&u.user_id===r.owner_id;})?.display_name||'Team';
          return`${name}(${p2.dna}${p2.targetPos?',wants '+p2.targetPos:''})`;
        }).filter(Boolean).slice(0,6).join('; '):'';
        const histCtx=li.playerTradeHistory?.[playerId]?.length?`This player has been traded ${li.playerTradeHistory[playerId].length} time(s) in this league.`:'';
        if(onMyTeam){
          goAsk(`Find the best trade partner for ${pName(playerId)} (${pos}, DHQ ${dynastyValue(playerId).toLocaleString()}). ${histCtx} Consider which owner needs a ${pos} and what I should ask for in return. Owner profiles: ${ownerCtx}. Draft a Sleeper-ready trade message.`);
        }else{
          goAsk(`I want to acquire ${pName(playerId)} (${pos}, DHQ ${dynastyValue(playerId).toLocaleString()}). ${histCtx} Who owns them and what would be a fair offer? Owner profiles: ${ownerCtx}. Draft a Sleeper-ready trade message.`);
        }
      }
    };
  }

  // Phase 7: opening the player modal is no longer a logged event.
  // The field log only captures explicit user actions: tag, note, mock save, trade save.

  // Show card as bottom sheet
  const modal=$('player-modal');
  modal.onclick=e=>{if(e.target===modal)closePlayerModal();};
  modal.setAttribute('aria-hidden','false');
  // Scroll card to top before showing
  const pmCard=modal.querySelector('.pm-card');
  if(pmCard)pmCard.scrollTop=0;
  requestAnimationFrame(()=>modal.classList.add('open'));
  document.body.style.overflow='hidden';

  // News section removed (xAI disabled)
  const newsEl=$('pm-news');if(newsEl){newsEl.style.display='none';newsEl.innerHTML='';}
  // Load career stats
  const cardWrap=$('pm-card-stats');if(cardWrap)cardWrap.style.display='none';
  loadPlayerCardStats(playerId);
}

function getPosBadgeStyle(pos){
  const styles={QB:'background:rgba(96,165,250,.2);color:#60a5fa',RB:'background:rgba(52,211,153,.2);color:#34d399',WR:'background:rgba(108,99,245,.2);color:#a78bfa',TE:'background:rgba(251,191,36,.2);color:#fbbf24',DL:'background:rgba(251,146,60,.2);color:#fb923c',LB:'background:rgba(167,139,250,.2);color:#a78bfa',DB:'background:rgba(244,114,182,.2);color:#f472b6',K:'background:rgba(139,143,154,.15);color:var(--text3)',DEF:'background:rgba(248,113,113,.15);color:#f87171'};
  return styles[pos]||'background:rgba(74,78,90,.2);color:var(--text3)';
}

async function loadPlayerCardStats(playerId){
  const p=S.players[playerId];if(!p)return;
  const pos=p.position;
  const sc=S.leagues.find(l=>l.league_id===S.currentLeagueId)?.scoring_settings||{};
  const wrap=$('pm-card-stats');const inner=$('pm-card-stats-inner');
  if(!wrap||!inner)return;

  const pStats=S.playerStats?.[playerId]||{};
  const curRaw=pStats.curRawStats||null;
  const prevRaw=pStats.prevRawStats||null;
  const curYear=parseInt(S.season)||2025;
  const prevYear=curYear-1;

  // Update label to show actual years instead of "Career stats"
  const lbl=$('pm-card-stats-label');
  if(lbl){
    const hasCur=curRaw&&Object.keys(curRaw).length;
    const hasPrev=prevRaw&&Object.keys(prevRaw).length;
    if(hasCur&&hasPrev) lbl.textContent=`'${String(prevYear).slice(-2)}–'${String(curYear).slice(-2)} Stats`;
    else if(hasCur) lbl.textContent=`'${String(curYear).slice(-2)} Season Stats`;
    else if(hasPrev) lbl.textContent=`'${String(prevYear).slice(-2)} Season Stats`;
    else lbl.textContent='Season Stats';
  }

  if(!curRaw&&!prevRaw){
    wrap.style.display='block';
    inner.innerHTML='<div style="color:var(--text3);font-size:13px;padding:4px 0">Stats load automatically with your roster. If empty, check the Stats tab to load data.</div>';
    return;
  }

  wrap.style.display='block';

  const isIDP=['DL','LB','DB','DE','DT','CB','S'].includes(pos);
  const isQB=pos==='QB';
  const isRB=pos==='RB';
  const isK=pos==='K';

  let cols=[];
  if(isQB)cols=[{k:'gp',l:'GP'},{k:'pass_cmp',l:'CMP'},{k:'pass_att',l:'ATT'},{k:'pass_yd',l:'YDS'},{k:'pass_td',l:'TD'},{k:'pass_int',l:'INT'},{k:'rush_yd',l:'RUSH'},{k:'fpts',l:'FPTS'}];
  else if(isRB)cols=[{k:'gp',l:'GP'},{k:'rush_att',l:'ATT'},{k:'rush_yd',l:'YDS'},{k:'rush_td',l:'TD'},{k:'rec',l:'REC'},{k:'rec_yd',l:'REC YD'},{k:'rec_tgt',l:'TGT'},{k:'fpts',l:'FPTS'}];
  else if(['WR','TE'].includes(pos))cols=[{k:'gp',l:'GP'},{k:'rec_tgt',l:'TGT'},{k:'rec',l:'REC'},{k:'rec_yd',l:'YDS'},{k:'rec_td',l:'TD'},{k:'rush_yd',l:'RUSH'},{k:'fpts',l:'FPTS'}];
  else if(isK)cols=[{k:'gp',l:'GP'},{k:'fgm',l:'FGM'},{k:'fga',l:'FGA'},{k:'fgm_50p',l:'50+'},{k:'xpm',l:'XPM'},{k:'xpa',l:'XPA'},{k:'fpts',l:'FPTS'}];
  else if(isIDP)cols=[{k:'gp',l:'GP'},{k:'idp_tkl',l:'TKL'},{k:'idp_sack',l:'SACK'},{k:'idp_int',l:'INT'},{k:'idp_pass_def',l:'PD'},{k:'idp_qb_hit',l:'QBH'},{k:'idp_ff',l:'FF'},{k:'fpts',l:'FPTS'}];
  else cols=[{k:'gp',l:'GP'},{k:'fpts',l:'FPTS'}];

  const gridCols=`36px 28px ${cols.map(()=>'1fr').join(' ')}`;

  const toRow=(raw,yr)=>{
    if(!raw||!Object.keys(raw).length)return null;
    const g=(...keys)=>{for(const k of keys){if(raw[k]!=null&&raw[k]!==0)return raw[k];}return 0;};
    const gp=g('gp','games_played')||Math.round((pStats.weeklyPts?.length||pStats.prevWeeklyPts?.length||1));
    const fpts=yr===curYear?(pStats.seasonTotal||calcFantasyPts(raw,sc)):(pStats.prevTotal||calcFantasyPts(raw,sc));
    return{
      yr,gp,fpts:+fpts.toFixed(1),
      pass_cmp:g('pass_cmp'),pass_att:g('pass_att'),pass_yd:g('pass_yd'),pass_td:g('pass_td'),pass_int:g('pass_int'),
      rush_att:g('rush_att'),rush_yd:g('rush_yd'),rush_td:g('rush_td'),
      rec:g('rec'),rec_yd:g('rec_yd'),rec_td:g('rec_td'),
      rec_tgt:g('rec_tgt','targets','tgt'),
      idp_tkl:g('idp_tkl_solo','tkl_solo')+g('idp_tkl_ast','tkl_ast'),
      idp_sack:g('idp_sack','sack'),
      idp_int:g('idp_int','def_int','int'),
      idp_pass_def:g('idp_pass_def','def_pass_def','pass_defended'),
      idp_qb_hit:g('idp_qb_hit','qb_hit'),
      idp_ff:g('idp_ff','ff','fumble_forced'),
      fgm:g('fgm','fg_made'),fga:g('fga','fg_att'),
      fgm_50p:g('fgm_50p','fgm_50_plus','fg_made_50_plus'),
      xpm:g('xpm','xp_made'),xpa:g('xpa','xp_att'),
    };
  };

  const rows=[toRow(curRaw,curYear),toRow(prevRaw,prevYear)].filter(Boolean);

  if(!rows.length){
    inner.innerHTML='<div style="color:var(--text3);font-size:13px;padding:4px 0">No stats recorded for this player yet.</div>';
    return;
  }

  const fmt=(v,k)=>{
    if(!v&&v!==0)return'<span style="color:var(--text3)">—</span>';
    if(v===0)return'<span style="color:var(--text3)">0</span>';
    if(k==='fpts')return`<span style="color:var(--accent);font-weight:700">${v}</span>`;
    if(['pass_yd','rush_yd','rec_yd'].includes(k))return`<strong>${Math.round(v).toLocaleString()}</strong>`;
    if(['idp_sack','idp_int','idp_ff','idp_qb_hit'].includes(k)&&v>=5)return`<span style="color:var(--green);font-weight:600">${Number.isInteger(v)?v:v.toFixed(1)}</span>`;
    if(k==='idp_tkl'&&v>=80)return`<span style="color:var(--green);font-weight:600">${Math.round(v)}</span>`;
    if(k==='fgm_50p'&&v>=3)return`<span style="color:var(--green);font-weight:600">${v}</span>`;
    return Number.isInteger(v)?v:v.toFixed(1);
  };

  inner.innerHTML=`
    <div style="display:grid;grid-template-columns:${gridCols};align-items:center;padding:0 0 5px;border-bottom:2px solid var(--border2);margin-bottom:2px;gap:4px">
      <div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase">YR</div>
      <div style="font-size:13px;font-weight:700;color:var(--text3)">TM</div>
      ${cols.map(c=>`<div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;text-align:right">${c.l}</div>`).join('')}
    </div>
    ${rows.map(r=>`
      <div style="display:grid;grid-template-columns:${gridCols};align-items:center;padding:6px 0;border-bottom:1px solid var(--border);gap:4px">
        <div style="font-size:13px;font-weight:700;color:var(--text3)">${r.yr}</div>
        <div style="font-size:13px;font-weight:700;padding:2px 4px;border-radius:4px;background:var(--bg4);color:var(--text3);text-align:center">${p.team||'FA'}</div>
        ${cols.map(c=>`<div style="font-size:13px;font-weight:600;text-align:right">${fmt(r[c.k],c.k)}</div>`).join('')}
      </div>`).join('')}`;
}

function closePlayerModal(){
  const el=$('player-modal');
  if(!el)return;
  resetPlayerModalState();
  document.body.style.overflow='';
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePlayerModal();});

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',resetPlayerModalState);}
else{resetPlayerModalState();}

// Swipe-to-dismiss the player modal card
(function _initPmSwipe(){
  function init(){
    const overlay=$('player-modal');
    const card=overlay?overlay.querySelector('.pm-card'):null;
    if(!card)return;
    let startY=0;
    card.addEventListener('touchstart',e=>{startY=e.touches[0].clientY;},{passive:true});
    card.addEventListener('touchmove',e=>{
      const dy=e.touches[0].clientY-startY;
      if(dy>0&&card.scrollTop===0){card.style.transform=`translateY(${dy}px)`;e.preventDefault();}
    },{passive:false});
    card.addEventListener('touchend',e=>{
      const dy=e.changedTouches[0].clientY-startY;
      if(dy>110){closePlayerModal();}
      else{card.style.transform='';}
    },{passive:true});
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
  else{init();}
}());

// Phase 7: persist a user note on a player and log it to the field log.
function addPlayerNote(pid,text){
  const clean=(text||'').trim();
  const leagueId=S.currentLeagueId||'';
  const key='player_notes_'+leagueId;
  let notes={};
  try{ notes=JSON.parse(localStorage.getItem(key)||'{}'); }catch(e){ notes={}; }
  const prev=notes[pid]||'';
  if(clean){ notes[pid]=clean; } else { delete notes[pid]; }
  try{ localStorage.setItem(key,JSON.stringify(notes)); }catch(e){}
  if(typeof showToast==='function')showToast(clean?'Note saved':'Note cleared');
  // Only log additions / meaningful changes, not empty clears
  if(clean && clean !== prev && window.addFieldLogEntry){
    try{
      const name=typeof pName==='function'?pName(pid):pid;
      const preview=clean.length>60?clean.slice(0,57)+'…':clean;
      window.addFieldLogEntry('📝',`Note on ${name}: ${preview}`,'note',{actionType:'note',players:[{id:pid,name}]});
    }catch(e){}
  }
}
window.addPlayerNote=addPlayerNote;

function tagPlayer(pid,tag){
  const leagueId=S.currentLeagueId||'';
  const key='player_tags_'+leagueId;
  let tags={};
  try{ tags=JSON.parse(localStorage.getItem(key)||'{}'); }catch(e){ tags={}; }
  const wasTagged=tags[pid]===tag;
  if(wasTagged)delete tags[pid];
  else tags[pid]=tag;
  localStorage.setItem(key,JSON.stringify(tags));

  // Phase 7: log tag additions to the field log (not removals)
  if(!wasTagged&&window.addFieldLogEntry){
    try{
      const name=typeof pName==='function'?pName(pid):pid;
      window.addFieldLogEntry('🏷️',`Tagged ${name} as ${tag}`,'note',{actionType:'tag',players:[{id:pid,name}]});
    }catch(e){}
  }

  // Sync to Supabase (non-blocking)
  if(window.OD?.savePlayerTags)window.OD.savePlayerTags(leagueId,tags);

  // Update global tags cache
  window._playerTags=tags;

  document.querySelectorAll('#pm-tag-section .chip').forEach(btn=>{
    const t=btn.textContent.trim().toLowerCase().replace(/\s+/g,'');
    const isActive=tags[pid]===(t==='tradeblock'?'trade':t);
    btn.style.background=isActive?'var(--accentL)':'';
    btn.style.color=isActive?'var(--accent)':'';
    btn.style.borderColor=isActive?'var(--accent)':'';
  });
  if(typeof showToast==='function')showToast(tags[pid]===tag?'Tagged':'Tag removed');
}
window.tagPlayer=tagPlayer;

async function getPlayerFullCard(playerId){
  if(!hasAnyAI())return;
  const p=S.players[playerId];if(!p)return;
  const name=pName(playerId);const pos=p.position;const age=p.age||'?';const team=p.team||'FA';
  $('pm-news').innerHTML='<div style="color:var(--text3);font-size:13px">🔍 Searching for news...</div>';
  try{
    const reply=await callClaude([{role:'user',content:`IMPORTANT: Search for news ONLY about ${name} (${pos}, ${fullTeam(team)}, age ${age}). Do NOT include news about any other player. If you cannot find recent news specifically about ${name}, say "No recent news found for ${name}."
Return JSON only: {"news":[{"source":"source","text":"one sentence about ${name} only","date":"date"}],"tweet":"@WRScout_FW dynasty take on ${name} specifically, max 280 chars"}`}],true,1,500);

    let data={news:[],tweet:''};
    try{
      const clean=reply.replace(/```json|```/g,'').trim();
      const start=clean.indexOf('{');const end=clean.lastIndexOf('}');
      if(start>=0)data=JSON.parse(clean.substring(start,end+1));
    }catch(e){$('pm-news').innerHTML=`<div style="font-size:13px;color:var(--text2);line-height:1.6">${reply.replace(/\n/g,'<br>')}</div>`;return;}

    const playerLast=p.last_name||'';
    if(data.news)data.news=data.news.filter(n=>n.text&&(n.text.includes(playerLast)||n.text.includes(name)));

    $('pm-news').innerHTML=data.news?.length?data.news.slice(0,3).map(n=>`
      <div style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="font-size:13px;color:var(--accent);font-weight:600">${n.source||'NFL'}</span>
          ${n.date?`<span style="font-size:13px;color:var(--text3)">${n.date}</span>`:''}
        </div>
        <div style="font-size:13px;color:var(--text2);line-height:1.5">${n.text}</div>
      </div>`).join('')
    :'<div style="color:var(--text3);font-size:13px">No recent news found for '+name+'.</div>';

    if(data.tweet&&data.tweet.includes(playerLast)){
      $('pm-tweet').style.display='block';
      $('pm-tweet').innerHTML=`
        <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--rl);padding:12px 14px;margin-top:8px">
          <div style="font-size:13px;color:var(--accent);font-weight:600;margin-bottom:5px">@WRScout_FW</div>
          <div style="font-size:14px;color:var(--text);line-height:1.6">${data.tweet}</div>
        </div>
        <button class="copy-btn" style="margin-top:8px" onclick="copyText(${JSON.stringify(data.tweet)},this)">Copy tweet</button>`;
    }else{$('pm-tweet').style.display='none';}
  }catch(e){$('pm-news').innerHTML=`<div style="color:var(--red);font-size:13px">Error: ${escHtml(e.message)}</div>`;}
}

// ── Expose on window.App and window ─────────────────────────────
Object.assign(window.App, {
  fetchPlayerNews, loadPlayerNewsNow,
  openPlayerModal, getPosBadgeStyle, loadPlayerCardStats,
  closePlayerModal, getPlayerFullCard,
});
// window.tagPlayer already set inline above (needed by onclick handlers before this runs)
window.fetchPlayerNews    = fetchPlayerNews;
window.loadPlayerNewsNow  = loadPlayerNewsNow;
window.openPlayerModal    = openPlayerModal;
window.getPosBadgeStyle   = getPosBadgeStyle;
window.loadPlayerCardStats = loadPlayerCardStats;
window.closePlayerModal   = closePlayerModal;
window.getPlayerFullCard  = getPlayerFullCard;
