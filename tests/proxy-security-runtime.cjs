'use strict';
const assert = require('node:assert/strict');
const { SignJWT, jwtVerify } = require('jose');
const load = require('./helpers/proxy-ts-loader.cjs');
const owner = '11111111-1111-4111-8111-111111111111';
const key = new TextEncoder().encode('fixture-signing-key-with-at-least-32-bytes');
const origin = 'https://dhqfootball.com';
const endpoint = 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy';
const cors = { 'Access-Control-Allow-Origin': origin };
const sha256Hex = async value => require('node:crypto').createHash('sha256').update(value).digest('hex');
let failures = 0, passes = 0;
async function test(name, fn) { try { await fn(); passes++; console.log('PASS',name); } catch(e) { failures++; console.error('FAIL',name, e.message); } }
async function fixture(options = {}) {
  const state = { version:1, exchanges:0, apiReads:0, saveError:false, states:new Map(), tokens:new Map(), ...options };
  const token = await new SignJWT({ app_metadata:{user_id:owner,session_version:1} }).setSubject(owner).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(key);
  const db = { from(table) {
    const predicates=[]; let op='select', value;
    const q = {
      select(){ return this; }, eq(k,v){predicates.push(r=>r[k]===v);return this;}, is(k,v){predicates.push(r=>(r[k]??null)===v);return this;},
      gt(k,v){predicates.push(r=>r[k]>v);return this;}, lt(k,v){predicates.push(r=>r[k]<v);return this;},
      update(v){op='update';value=v;return this;},delete(){op='delete';return this;},
      async insert(row){if(state.stateError)return{error:Error('fixture unavailable')};state.states.set(row.state_hash,{...row,browser_hash:null});return{error:null};},
      async upsert(row){if(state.saveError)return{error:Error('fixture secret database detail')};state.tokens.set(row.session_id,{...row});return{error:null};},
      async maybeSingle(){
        if(table==='app_users')return{data:state.deleted?null:{id:owner,session_version:state.version},error:state.userError?Error('fixture'):null};
        const rows=table==='yahoo_oauth_states'?state.states:state.tokens;
        const row=[...rows.values()].find(r=>predicates.every(f=>f(r)));if(!row)return{data:null,error:null};
        if(op==='delete')rows.delete(row.state_hash||row.session_id);if(op==='update')Object.assign(row,value);
        return{data:{...row},error:null};
      },single(){return this.maybeSingle();},then(resolve,reject){return this.maybeSingle().then(resolve,reject);}
    };return q;
  }};
  const env={get:name=>name==='JWT_SECRET'||name==='SUPABASE_JWT_SECRET'?new TextDecoder().decode(key):'fixture-config'};
  const globals={jwtVerify,sha256Hex,createClient:()=>db,Deno:{env},corsHeaders:()=>cors,
    isAllowedBrowserUrl:v=>{try{return new URL(v).origin===origin;}catch{return false;}},
    checkRateLimit:async()=>({allowed:true,count:1,limit:120,retryAfter:0}),rateLimitResponse:r=>r.allowed?null:Response.json({error:'limited'},{status:429}),
    fetch:async url=>{if(String(url).includes('get_token')){state.exchanges++;if(state.onExchange)await state.onExchange();return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});}state.apiReads++;return Response.json({fantasy_content:{users:[]}});}
  };
  const fs=require('node:fs'),path=require('node:path');
  if(fs.existsSync(path.resolve(__dirname,'../supabase/functions/_shared/yahoo-owner.ts'))){ const helper=load('supabase/functions/_shared/yahoo-owner.ts',globals).context; for(const key of ['requireYahooOwner','yahooOwnerIsCurrent','sha256Hex'])globals[key]=helper[key]; }
  globals.checkProxyLimit=globals.checkRateLimit;
  const {handler}=load('supabase/functions/yahoo-proxy/index.ts',globals);
  const post=(body, auth=token)=>handler(new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+auth,Origin:origin},body:JSON.stringify(body)}));
  const callback=(flow,cookie=flow.cookie)=>handler(new Request(endpoint+'?code=fixture-code&state='+encodeURIComponent(flow.state),{headers:cookie?{Cookie:cookie}:{}}));
  async function start(){
    const response=await post({action:'auth_url',return_url:origin+'/index.html?vault=1#league'});assert.equal(response.status,200);
    const url=(await response.json()).auth_url;const first=await handler(new Request(url));assert.equal(first.status,302);
    const cookie=first.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
    return{url,state:new URL(first.headers.get('location')).searchParams.get('state'),cookie:cookie.split(';')[0]};
  }
  return{state,db,globals,handler,post,callback,start,token};
}
(async()=>{
  await test('unsigned callback cannot select a victim owner or reach Yahoo',async()=>{
    const f=await fixture();const forged=btoa(JSON.stringify({ownerKey:'app:'+owner,return:origin+'/index.html'}));
    const r=await f.handler(new Request(endpoint+'?code=fixture&state='+encodeURIComponent(forged)));assert.equal(r.status,400);assert.equal(f.state.exchanges,0);assert.equal(f.state.tokens.size,0);
  });
  await test('revoked app token cannot start, read or refresh Yahoo',async()=>{
    const f=await fixture({version:2});for(const action of ['auth_url','api','refresh'])assert.equal((await f.post({action,endpoint:'/users',session_id:'fixture'})).status,401);assert.equal(f.state.exchanges,0);assert.equal(f.state.apiReads,0);
  });
  await test('callback errors never render caller HTML',async()=>{
    const f=await fixture();const r=await f.handler(new Request(endpoint+'?error='+encodeURIComponent('<img src=x onerror=alert(1)>')));assert.match(r.headers.get('content-type'),/^text\/plain/);assert.doesNotMatch(await r.text(),/onerror/);
  });
  await test('malformed JSON shape is actionable client error',async()=>{
    const f=await fixture();for(const body of [null,[],1,'auth_url'])assert.equal((await f.post(body)).status,400);
  });
  await test('valid browser-bound connection preserves query and fragment and stores one owner',async()=>{
    const f=await fixture();const flow=await f.start();assert.match(flow.state,/^[a-f0-9]{64}$/);assert.equal((await f.handler(new Request(flow.url))).status,400);
    assert.equal((await f.callback(flow,'')).status,400);assert.equal((await f.callback(flow,flow.cookie.split('=')[0]+'=wrong')).status,400);assert.equal(f.state.exchanges,0);
    const r=await f.callback(flow);assert.equal(r.status,302);const location=new URL(r.headers.get('location'));assert.equal(location.searchParams.get('vault'),'1');assert.equal(location.hash,'#league');assert.equal(f.state.tokens.get(location.searchParams.get('yahoo_session')).owner_key,'app:'+owner);
    assert.equal((await f.callback(flow)).status,400);assert.equal(f.state.exchanges,1);
  });
  await test('competing callbacks consume only once and expired state stays closed',async()=>{
    const f=await fixture(),flow=await f.start();const rs=await Promise.all([f.callback(flow),f.callback(flow)]);assert.equal(rs.filter(r=>r.status===302).length,1);assert.equal(f.state.exchanges,1);
    const expired=await f.start();f.state.states.get(await sha256Hex(expired.state)).expires_at=new Date(0).toISOString();assert.equal((await f.callback(expired)).status,400);
  });
  await test('unconfirmed token persistence cannot redirect success or disclose database detail',async()=>{
    const f=await fixture({saveError:true}),flow=await f.start();const r=await f.callback(flow);assert.equal(r.status,503);assert.equal(r.headers.get('location'),null);assert.doesNotMatch(await r.text(),/fixture secret/);assert.equal(f.state.tokens.size,0);
  });
  await test('session change before and during exchange prevents a stale success redirect',async()=>{
    const f=await fixture(),flow=await f.start();f.state.version++;assert.equal((await f.callback(flow)).status,401);assert.equal(f.state.exchanges,0);
    const g=await fixture(),other=await g.start();g.state.onExchange=()=>{g.state.version++;};assert.equal((await g.callback(other)).status,401);assert.equal(g.state.tokens.size,0);
  });
  await test('actual signature/expiry and account lookup failures fail closed without legacy downgrade',async()=>{
    const f=await fixture();
    const sign=claims=>new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setSubject(owner).setExpirationTime('1h').sign(key);
    const bad=await new SignJWT({app_metadata:{user_id:owner,session_version:1}}).setSubject(owner).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode('different-fixture-key-at-least-32-bytes'));
    const expired=await new SignJWT({app_metadata:{user_id:owner,session_version:1}}).setSubject(owner).setProtectedHeader({alg:'HS256'}).setExpirationTime(1).sign(key);
    for(const token of [bad,expired,await sign({app_metadata:{user_id:owner,sleeper_username:'Fixture'}})])assert.equal((await f.post({action:'auth_url'},token)).status,401);
    f.state.version=2;const mixed=await sign({app_metadata:{user_id:owner,session_version:1,sleeper_username:'Fixture'}});assert.equal((await f.post({action:'auth_url'},mixed)).status,401);
    f.state.version=1;f.state.userError=true;assert.equal((await f.post({action:'auth_url'})).status,401);f.state.userError=false;f.state.deleted=true;assert.equal((await f.post({action:'auth_url'})).status,401);
  });
  await test('signed legacy Sleeper owner remains supported without claiming app revocation parity',async()=>{
    const f=await fixture();const token=await new SignJWT({app_metadata:{sleeper_username:'LegacyFixture'}}).setSubject('legacyfixture').setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(key);
    const r=await f.post({action:'auth_url',return_url:origin+'/index.html'},token);assert.equal(r.status,200);const row=[...f.state.states.values()][0];assert.equal(row.owner_key,'sleeper:legacyfixture');assert.equal(row.session_version,null);
  });
  await test('stored Yahoo session is read only by matching authenticated owner',async()=>{
    const f=await fixture();f.state.tokens.set('owned',{session_id:'owned',owner_key:'app:'+owner,access_token:'fixture-access',expires_at:Date.now()+3600000});f.state.tokens.set('foreign',{session_id:'foreign',owner_key:'app:22222222-2222-4222-8222-222222222222',access_token:'private',expires_at:Date.now()+3600000});
    assert.equal((await f.post({action:'api',endpoint:'/users;use_login=1?format=json',session_id:'owned'})).status,200);assert.equal(f.state.apiReads,1);
    assert.equal((await f.post({action:'api',endpoint:'/users',session_id:'foreign'})).status,401);assert.equal((await f.post({action:'refresh',session_id:'foreign'})).status,401);assert.equal(f.state.apiReads,1);assert.equal(f.state.exchanges,0);
  });
  await test('state persistence failure is visible with CORS and no success URL',async()=>{
    const f=await fixture({stateError:true});const r=await f.post({action:'auth_url'});assert.equal(r.status,503);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('location'),null);assert.equal(f.state.exchanges,0);
  });
  console.log(`Proxy security runtime: ${passes} passed, ${failures} failed`);process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
