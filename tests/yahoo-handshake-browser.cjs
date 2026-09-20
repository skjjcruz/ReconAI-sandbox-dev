'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'@playwright/test');
const {fixture}=require('./proxy-security-runtime.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../shared/yahoo-api.js'),'utf8');
const documentSource=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const head=documentSource.match(/<script>\s*\/\/ Capture Yahoo[\s\S]*?<\/script>/)[0];
const app='https://dhqfootball.com/index.html?vault=1',endpoint='https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/yahoo-proxy';
(async()=>{let browser;try{
const f=await fixture();browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const probes=[],unexpected=[];
async function context(width,height){const context=await browser.newContext({viewport:{width,height}});
await context.addInitScript(({token})=>{if(location.origin==='https://dhqfootball.com')localStorage.setItem('fw_session_v1',JSON.stringify({token,user:{id:'11111111-1111-4111-8111-111111111111'}}));},{token:f.token});
await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
 if(url.origin==='https://dhqfootball.com'&&url.pathname==='/index.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head>'+head+'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;margin:18px}button{font:inherit;min-height:48px;padding:10px}#status{overflow-wrap:anywhere}</style><script>window.assetHashObserved=location.hash;</script></head><body><button id="connect">Connect Yahoo</button><p id="status"></p><img src="/probe.png"><script>window.OD={getSessionToken:()=>JSON.parse(localStorage.getItem("fw_session_v1")).token};</script><script>'+source+'</script><script>const status=document.getElementById("status");document.getElementById("connect").onclick=async()=>{try{await Yahoo.startAuth()}catch(e){status.textContent=e.message}};if(Yahoo.hasCallback()){Yahoo.handleCallback().then(()=>status.textContent="Connected").catch(e=>status.textContent=e.message)}else if(Yahoo.hasSession()){status.textContent="Connected"}</script></body></html>'});
 if(url.origin==='https://dhqfootball.com'&&url.pathname==='/probe.png'){probes.push({url:request.url(),referer:request.headers().referer||''});return route.fulfill({status:204});}
 if(url.origin==='https://api.login.yahoo.com'&&url.pathname==='/oauth2/request_auth')return route.fulfill({contentType:'text/html',body:'<button id="approve" style="height:48px">Approve fixture consent</button><script>document.getElementById("approve").onclick=()=>location.href='+JSON.stringify(endpoint+'?code=fixture-provider-code&state='+url.searchParams.get('state'))+'</script>'});
 if(url.origin===new URL(endpoint).origin&&url.pathname===new URL(endpoint).pathname){const response=await f.handler(new Request(request.url(),{method:request.method(),headers:request.headers(),...(request.method()==='POST'?{body:request.postData()}: {})}));if(response.status===302){const destination=response.headers.get('location');assert.equal(new URL(destination).origin,'https://dhqfootball.com');return route.fulfill({contentType:'text/html',body:'<script>location.replace('+JSON.stringify(destination)+')</script>'});}return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
 unexpected.push(url.origin+url.pathname);return route.abort();
});return context;}
const first=await context(320,700),initiator=await first.newPage();await initiator.goto(app+'#league');await initiator.locator('#connect').click();await initiator.waitForURL('https://api.login.yahoo.com/**');
const transferred=initiator.url(),second=await context(390,844),recipient=await second.newPage();await recipient.goto(transferred);await recipient.locator('#approve').click();await recipient.waitForURL('https://dhqfootball.com/**');await recipient.waitForFunction(()=>document.getElementById('status').textContent.includes('tab and account'));
assert.equal(f.state.exchanges,0);assert.equal(f.state.tokens.size,0);assert.equal(await recipient.evaluate(()=>assetHashObserved),'');assert.equal(await recipient.evaluate(()=>sessionStorage.getItem('yahoo_session_id')),null);
console.log('PASS Chrome separate browser receiving unused consent URL cannot bind provider tokens');
await initiator.locator('#approve').click();await initiator.waitForURL('https://dhqfootball.com/**');await initiator.waitForFunction(()=>document.getElementById('status').textContent==='Connected');assert.equal(f.state.exchanges,1);assert.equal(f.state.tokens.size,1);assert.equal(await initiator.evaluate(()=>assetHashObserved),'');assert.equal(new URL(initiator.url()).hash,'#league');
assert.ok(probes.every(p=>!p.url.includes('fixture-provider-code')&&!p.referer.includes('fixture-provider-code')&&!p.referer.includes('dhq-yahoo')));
await initiator.reload();await initiator.waitForFunction(()=>document.getElementById('status').textContent==='Connected');assert.equal(f.state.exchanges,1);
console.log('PASS Chrome 320 initiating tab completes/reloads; code is cleared before asset/action probes');
await initiator.setViewportSize({width:844,height:390});assert.equal(await initiator.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
console.log('PASS Chrome short landscape reconnect control remains in viewport');
assert.deepEqual(unexpected,[],'all requests must stay inside explicitly routed fixtures');
fs.mkdirSync(path.resolve(__dirname,'../output/playwright'),{recursive:true});await recipient.screenshot({path:path.resolve(__dirname,'../output/playwright/yahoo-transferred-proof-recovery.png')});
}finally{if(browser)await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
