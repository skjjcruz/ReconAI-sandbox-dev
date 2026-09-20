'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture:serverFixture}=require('./proxy-security-runtime.cjs');
const shared=process.env.READINESS_YAHOO_SHARED;
if(!shared)throw Error('Set READINESS_YAHOO_SHARED to the reviewed canonical Yahoo worktree');
const {fixture:browserFixture,A}=require(path.join(shared,'tests/yahoo-browser-binding.cjs'));
assert.equal(fs.readFileSync(path.join(shared,'yahoo-api.js'),'utf8'),fs.readFileSync(path.resolve(__dirname,'../shared/yahoo-api.js'),'utf8'),'vendored connector must exactly match reviewed canonical source');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8'),boot=fs.readFileSync(path.resolve(__dirname,'../js/app.js'),'utf8');
const head=html.match(/<script>\s*\/\/ Capture Yahoo[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
assert.ok(html.indexOf(head)<html.indexOf('<link'),'callback scrubber must precede asset markup');
assert.match(boot,/await window\.Yahoo\.handleCallback\(\);[\s\S]*?await window\.Yahoo\.fetchUserLeagues\(\)/);
assert.doesNotMatch(boot,/sessionStorage\.setItem\('yahoo_session_id',_yahooSessionParam\)/);
const endpoint='https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy';
(async()=>{
const backend=await serverFixture();const local=new Map([['fw_session_v1',JSON.stringify({token:backend.token,user:{id:A}})]]);
const fetch=(body,init)=>backend.handler(new Request(endpoint,{method:'POST',headers:{...init.headers,Origin:'https://dhqfootball.com'},body:JSON.stringify(body)}));
const initiating=browserFixture({local,fetch});await initiating.api.startAuth();const state=new URL(initiating.context.location.href).searchParams.get('state');
const response=await backend.handler(new Request(endpoint+'?code=recipient-provider-fixture-code&state='+state));assert.equal(response.status,302);
assert.equal(backend.state.exchanges,0);assert.equal(backend.state.tokens.size,0);
const recipient=browserFixture({local:new Map(local),fetch,url:response.headers.get('location')});vm.runInContext(head,recipient.context);
assert.equal(recipient.context.location.hash,'');await assert.rejects(recipient.api.handleCallback(),/tab and account/);
assert.equal(recipient.requests.length,0);assert.equal(backend.state.exchanges,0);assert.equal(backend.state.tokens.size,0);
console.log('PASS transferred consent callback in separate same-account browser cannot exchange/store');
// This fixture now exercises the normal path with the initiating browser's own
// provider code. No actual Yahoo consent or provider credentials are exercised.
const normal=await backend.handler(new Request(endpoint+'?code=initiating-provider-fixture-code&state='+state));
initiating.setUrl(normal.headers.get('location'));vm.runInContext(head,initiating.context);
assert.equal(initiating.context.location.hash,'');assert.equal(initiating.context.location.search,'?vault=1');
const sessionId=await initiating.api.handleCallback();assert.equal(backend.state.tokens.get(sessionId).owner_key,'app:'+A);assert.equal(backend.state.exchanges,1);
assert.equal(initiating.context.location.hash,'#league');assert.equal(initiating.context.__DHQ_YAHOO_CALLBACK,undefined);
console.log('PASS initiating browser completes actual client/handler proof and preserves route context');
const replay=browserFixture({local,session:initiating.session,fetch,url:normal.headers.get('location')});vm.runInContext(head,replay.context);await assert.rejects(replay.api.handleCallback(),/tab and account/);assert.equal(backend.state.exchanges,1);
console.log('PASS reload/replay cannot resubmit consumed proof; completed session remains usable');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Execute the production boot branch itself, including its error UI and order.
(async()=>{
const start=boot.indexOf('    const _yahooSessionParam = window.__DHQ_YAHOO_CALLBACK');
const end=boot.indexOf('    // ── Yahoo session auto-restore',start);
assert.ok(start>0&&end>start);const branch=boot.slice(start,end)+'\n}';
for(const reject of [false,true]){
 const queued=[],calls=[],status=[],elements=new Map();let release;const proof=new Promise(r=>release=r);
 const context={URL,URLSearchParams,console,document:{title:'Fixture'},window:{__DHQ_YAHOO_CALLBACK:{state:'fixture'},location:{href:'https://dhqfootball.com/index.html?vault=1',search:'?vault=1'},history:{replaceState(){}},Yahoo:{hasCallback:()=>true,handleCallback:async()=>{calls.push('proof');await proof;if(reject)throw Error('Connection proof failed');},fetchUserLeagues:async()=>{calls.push('leagues');return{};},parseUserLeagues:()=>[{leagueKey:'fixture-league'}]}},
 platformAccessAllowed:()=>true,S:{user:null,players:Object.fromEntries(Array.from({length:100},(_,i)=>[i,{}]))},setTimeout:fn=>queued.push(fn),ss:(_key,text)=>status.push(text),prog(){},$:id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);},_connectYahooLeague:async()=>calls.push('connect'),showYahooLeaguePicker:()=>calls.push('picker')};
 vm.createContext(context);vm.runInContext(branch,context);assert.equal(queued.length,1);const run=queued[0]();await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,['proof']);release();await run;
 if(reject){assert.deepEqual(calls,['proof']);assert.ok(status.some(s=>s.includes('Connection proof failed')));assert.equal(elements.get('prog').style.display,'none');}
 else assert.deepEqual(calls,['proof','leagues','connect']);
}
console.log('PASS actual Scout boot awaits proof before league fetch and shows actionable failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
