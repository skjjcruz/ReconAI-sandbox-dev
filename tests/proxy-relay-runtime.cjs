'use strict';
const assert=require('node:assert/strict');
const load=require('./helpers/proxy-ts-loader.cjs');
let passes=0,failures=0;
async function test(name,fn){try{await fn();passes++;console.log('PASS',name);}catch(e){failures++;console.error('FAIL',name,e.message);}}
const cors={'Access-Control-Allow-Origin':'https://dhqfootball.com'};
const post=body=>new Request('https://fixture.invalid/proxy',{method:'POST',body:JSON.stringify(body)});
const limiter=rpc=>load('supabase/functions/_shared/rate-limit.ts',{createClient:()=>({rpc})}).context;
const allowed={allowed:true,count:1,limit:60,retryAfter:0};
const defaults={corsHeaders:()=>cors,clientIp:()=> 'fixture-ip',checkRateLimit:async()=>allowed,rateLimitResponse:r=>r.allowed?null:Response.json({error:'limited'},{status:r.unavailable?503:429})};
(async()=>{
 await test('durable counter is shared across fresh workers and retains accurate Retry-After',async()=>{
  const counts=new Map();const rpc=async(name,args)=>{assert.equal(name,'check_rate_limit');const count=(counts.get(args.p_key)||0)+1;counts.set(args.p_key,count);return{data:{allowed:count<=2,count,limit:args.p_limit,retry_after:count>2?17:0}};};
  assert.equal((await limiter(rpc).checkRateLimit('same-ip',2,60)).allowed,true);assert.equal((await limiter(rpc).checkRateLimit('same-ip',2,60)).allowed,true);
  const l=limiter(rpc),r=await l.checkRateLimit('same-ip',2,60);assert.equal(r.allowed,false);const response=l.rateLimitResponse(r,cors);assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'17');assert.equal(response.headers.get('access-control-allow-origin'),cors['Access-Control-Allow-Origin']);
 });
 await test('limiter outage/malformed replies cannot reset allowance via fresh workers',async()=>{
  for(const rpc of [async()=>({error:Error('fixture')}),async()=>{throw Error('fixture');},async()=>({data:{allowed:true}}),async()=>({data:{allowed:'false',count:1,limit:60,retry_after:0}})]){
   for(let i=0;i<2;i++){const l=limiter(rpc),r=await l.checkRateLimit('same-ip',60,60);assert.equal(r.allowed,false);assert.equal(l.rateLimitResponse(r,cors).status,503);}
  }
  const l=load('supabase/functions/_shared/rate-limit.ts',{Deno:{env:{get:()=>''}}}).context;assert.equal(l.rateLimitResponse(await l.checkRateLimit('x',60,60),cors).status,503);
 });
 await test('all browser/native known origins retain CORS while unknown origin is not echoed',async()=>{
  const h=load('supabase/functions/_shared/cors.ts',{Deno:{env:{get:()=>''}}}).context;
  for(const origin of ['https://dhqfootball.com','https://www.dhqfootball.com','https://warroom.skjjcruz.com','https://skjjcruz.github.io','capacitor://localhost','https://localhost'])assert.equal(h.corsHeaders(new Request('https://fixture.invalid',{headers:{Origin:origin}}))['Access-Control-Allow-Origin'],origin);
  assert.notEqual(h.corsHeaders(new Request('https://fixture.invalid',{headers:{Origin:'https://attacker.invalid'}}))['Access-Control-Allow-Origin'],'https://attacker.invalid');
 });
 await test('ESPN preserves private cookies and provider data; rejects foreign/malformed calls before network',async()=>{
  const reads=[];const handler=load('supabase/functions/espn-proxy/index.ts',{...defaults,fetch:async(url,init)=>{reads.push(url);assert.equal(init.headers.Cookie,'espn_s2=fixture-s2; SWID=fixture-swid');assert.equal(init.redirect,'error');return Response.json({season:2026});}}).handler;
  const r=await handler(post({url:'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026',espnS2:'fixture-s2',swid:'fixture-swid'}));assert.equal(r.status,200);assert.equal((await r.json()).season,2026);
  for(const body of [null,[],{url:44},{url:'https://lm-api-reads.fantasy.espn.com.attacker.invalid/'}])assert.equal((await handler(post(body))).status,400);
  assert.equal((await handler(new Request('https://fixture.invalid'))).status,405);assert.equal(reads.length,1);
 });
 await test('ESPN unavailable storage never reaches provider',async()=>{
  let reads=0;const handler=load('supabase/functions/espn-proxy/index.ts',{...defaults,checkRateLimit:async()=>({allowed:false,unavailable:true}),fetch:async()=>{reads++;return Response.json({});}}).handler;
  assert.equal((await handler(post({url:'https://lm-api-reads.fantasy.espn.com/'}))).status,503);assert.equal(reads,0);
 });
 await test('MFL anonymous public read, actionable 404, explicit write and relative shard redirects remain supported',async()=>{
  const reads=[];let status=200;const handler=load('supabase/functions/mfl-proxy/index.ts',{...defaults,fetch:async(url,init)=>{
   reads.push({url,method:init.method,cookie:new Headers(init.headers).get('cookie')});assert.equal(init.redirect,'manual');
   if(url.includes('api.myfantasyleague.com'))return new Response(null,{status:302,headers:{location:'https://www42.myfantasyleague.com/2026/export?TYPE=lineup&L=123'}});
   if(url.includes('/export?TYPE=lineup'))return new Response(null,{status:302,headers:{location:'/2026/import?TYPE=lineup&L=123'}});
   return new Response(status===200?'{}':'notfound',{status});
  }}).handler;
  assert.equal((await handler(post({url:'https://www42.myfantasyleague.com/2026/export'}))).status,200);assert.equal(reads[0].cookie,null);
  reads.length=0;assert.equal((await handler(post({url:'https://api.myfantasyleague.com/2026/import?TYPE=lineup&L=123',method:'POST',cookie:'MFL_USER_ID=fixture'}))).status,200);
  assert.equal(reads.length,3);for(const read of reads){assert.equal(read.method,'POST');assert.equal(read.cookie,'MFL_USER_ID=fixture');}
  status=404;const r=await handler(post({url:'https://www42.myfantasyleague.com/2026/export'}));assert.equal(r.status,404);assert.match((await r.json()).error,/League ID and year/);
 });
 await test('MFL refuses off-provider first/second redirect and credentials are never forwarded there',async()=>{
  for(const offset of [0,1]){const reads=[];const handler=load('supabase/functions/mfl-proxy/index.ts',{...defaults,fetch:async(url,init)=>{reads.push(url);return new Response(null,{status:307,headers:{location:reads.length===offset+1?'https://attacker.invalid/steal':'https://www42.myfantasyleague.com/2026/login'}});}}).handler;
   const r=await handler(post({url:'https://api.myfantasyleague.com/2026/login',login:true,form:'PASSWORD=fixture',cookie:'MFL_USER_ID=fixture'}));assert.equal(r.status,502);assert.equal(reads.length,offset+1);assert.equal(reads.some(url=>url.includes('attacker')),false);
  }
 });
 await test('MFL login survives allowed redirect and captures intermediate session without echoing form',async()=>{
  const reads=[];const handler=load('supabase/functions/mfl-proxy/index.ts',{...defaults,fetch:async(url,init)=>{reads.push({url,method:init.method,body:init.body,cookie:new Headers(init.headers).get('cookie')});
   if(reads.length===1)return new Response(null,{status:302,headers:{location:'https://www42.myfantasyleague.com/2026/home','set-cookie':'MFL_USER_ID=fixture-new; Path=/; Secure'}});
   return new Response('Welcome',{status:200});
  }}).handler;
  const r=await handler(post({url:'https://api.myfantasyleague.com/2026/login',login:true,form:'PASSWORD=fixture-password'}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.ok,true);assert.equal(data.mflUserId,'fixture-new');assert.equal(data.host,'www42.myfantasyleague.com');assert.equal(reads[1].method,'GET');assert.equal(reads[1].body,undefined);assert.equal(reads[1].cookie,'MFL_USER_ID=fixture-new');assert.doesNotMatch(JSON.stringify(data),/fixture-password/);
 });
 await test('MFL cycles and malformed or foreign destinations fail without successful mutations',async()=>{
  let reads=0;const handler=load('supabase/functions/mfl-proxy/index.ts',{...defaults,fetch:async()=>{reads++;return new Response(null,{status:307,headers:{location:'/loop'}});}}).handler;
  for(const body of [null,[],{url:33},{url:'https://evilmyfantasyleague.com/'},{url:'https://myfantasyleague.com.attacker.invalid/'},{url:'https://user:pass@myfantasyleague.com/'}])assert.equal((await handler(post(body))).status,400);
  assert.equal(reads,0);assert.equal((await handler(post({url:'https://api.myfantasyleague.com/loop'}))).status,502);assert.equal(reads,5);
 });
 console.log(`Proxy relay runtime: ${passes} passed, ${failures} failed`);process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
