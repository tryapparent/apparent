// Synthetic browser boundary: real packaged homepage/Connect, no live API or
// provider traffic. Screenshots stay in private scratch, never public assets.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {chromium} from 'playwright-core';
import {analyticsHomepage, analyticsScript} from '../../../public/site/scripts/site-build/product-analytics.mjs';
const config={enabled:true,host:'https://eu.i.posthog.com',token:'phc_synthetic',environment:'synthetic'};
const repo=resolve('../..'), artifact=resolve('dist-analytics-test');
const snapshot=resolve(repo,'public/site/published-homepage');
const evidence=resolve(process.env.CONNECT_EVIDENCE||`${process.env.TMPDIR}/apparent-analytics-evidence`);
await mkdir(evidence,{recursive:true});
const server=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/assets/product-analytics.js') {res.setHeader('Content-Type','text/javascript');return res.end(await analyticsScript(config));}
  if(path==='/') {res.setHeader('Content-Type','text/html');return res.end(analyticsHomepage(await readFile(resolve(snapshot,'index.html'),'utf8'),config));}
  let file=resolve(artifact,'.'+path);
  if(/^\/(?:connect|hosted)(?:\/(?:device|shares))?\/?$/.test(path))file=resolve(artifact,'.'+path,'index.html');
  let bytes;try{bytes=await readFile(file);}catch{bytes=await readFile(resolve(snapshot,'.'+path));}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.ttf':'font/ttf'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch{res.writeHead(404).end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/home/simon/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const results=[];
async function context(options={}) {
 const context=await browser.newContext({viewport:{width:1440,height:1000},...options});
 const sent=[],errors=[];let account=null;
 context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin)return route.continue();
  if(url.origin===config.host) {
   const body=request.postDataJSON();
   sent.push({body,headers:await request.allHeaders()});
   return route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origin},body:'{"status":1}'});
  }
  if(url.origin==='https://hosted.tryapparent.com'&&url.pathname==='/v1/session')return route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify(account?{authenticated:true,csrfToken:'private-csrf',account:{email:'private@example.com',beta:'active',analyticsId:account,waitlist:{interestedAtFiveDollars:false}},slots:{limit:20,used:2}}:{authenticated:false})});
  if(url.origin==='https://hosted.tryapparent.com'&&url.pathname==='/v1/device')return route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify({scope:'upload',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString()})});
  if(url.origin==='https://api.github.com')return route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
  return route.abort();
 });
 return {context,sent,errors,setAccount:value=>{account=value;},page:await context.newPage()};
}
const settle=page=>page.waitForTimeout(120);
try {
 const f=await context();
 await f.page.goto(origin+'/?utm_source=private@example.com&utm_medium=email&token=private-capability#private-fragment');
 await f.page.getByRole('button',{name:'No thanks',exact:true}).waitFor();await settle(f.page);assert.equal(f.sent.length,0);
 await f.page.screenshot({path:resolve(evidence,'consent-desktop.png')});
 await f.page.getByRole('button',{name:'No thanks',exact:true}).click();await f.page.reload();await settle(f.page);assert.equal(f.sent.length,0);
 await f.page.getByRole('button',{name:'Analytics settings',exact:true}).click();
 await f.page.getByRole('button',{name:'Allow analytics',exact:true}).click();
 await f.page.waitForFunction(()=>document.querySelector('aside[aria-label="Analytics preferences"]')?.shadowRoot?.querySelector('.settings'));
 await settle(f.page);
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].body.event,'$pageview');
 assert.equal(f.sent[0].body.properties.acquisition_source,'other');assert.equal(f.sent[0].body.properties.acquisition_medium,'email');
 assert.match(f.sent[0].body.properties.distinct_id,/^anon:/);
 const consentAt=await f.page.evaluate(()=>JSON.parse(localStorage.getItem('apparent.product-analytics.v1')).at);
 await f.page.locator('a[data-download-platform]').first().click();await settle(f.page);
 assert.equal(f.sent.filter(e=>e.body.event==='app_download_clicked').length,1);
 f.setAccount('account:'+'a'.repeat(64));
 await f.page.goto(origin+'/connect/device?code=private-device-code');await f.page.getByRole('heading',{name:'Automatic uploads',exact:true}).waitFor();await settle(f.page);
 const identity=f.sent.find(e=>e.body.event==='$identify');assert.ok(identity);assert.equal(identity.body.properties.distinct_id,'account:'+'a'.repeat(64));
 assert.equal(identity.body.properties.$anon_distinct_id,f.sent[0].body.properties.distinct_id);
 f.setAccount('account:'+'b'.repeat(64));await f.page.reload();await f.page.getByRole('heading',{name:'Automatic uploads',exact:true}).waitFor();await settle(f.page);
 const next=f.sent.filter(e=>e.body.event==='$identify').at(-1);assert.notEqual(next.body.properties.$anon_distinct_id,identity.body.properties.$anon_distinct_id);
 assert.equal(f.sent.filter(e=>e.body.event==='$pageview').at(-1).body.properties.distinct_id,'account:'+'b'.repeat(64));
 assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('apparent.product-analytics.v1')).at),consentAt);
 for(const {body,headers} of f.sent){
  const text=JSON.stringify(body);for(const secret of ['private@example.com','private-csrf','private-capability','private-fragment','private-device-code','?','/s/'])assert.ok(!text.includes(secret),secret);
  assert.equal(headers.referer,undefined);assert.equal(headers.cookie,undefined);assert.equal(headers.authorization,undefined);
  assert.equal(body.properties.environment,'synthetic');assert.equal(body.properties.$geoip_disable,true);
 }
 await f.page.getByRole('button',{name:'Analytics settings',exact:true}).click();await f.page.getByRole('button',{name:'No thanks',exact:true}).click();
 const before=f.sent.length;await f.page.reload();await settle(f.page);assert.equal(f.sent.length,before);
 assert.deepEqual(f.errors,[]);results.push('consent, download intent, real session-to-account linkage, identity reset, withdrawal and payload privacy');await f.context.close();
 for(const viewport of [{width:390,height:844},{width:320,height:844},{width:720,height:500}]) {
  const f=await context({viewport});await f.page.goto(origin+'/connect');
  const panel=f.page.getByRole('region',{name:'Optional website analytics'});await panel.waitFor();
  const box=await panel.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
  await f.page.screenshot({path:resolve(evidence,`consent-${viewport.width}.png`)});
  await f.page.getByRole('button',{name:'No thanks',exact:true}).focus();await f.page.keyboard.press('Tab');
  assert.equal(await f.page.getByRole('button',{name:'Allow analytics',exact:true}).evaluate(e=>e===e.getRootNode().activeElement),true);
  await f.page.keyboard.press('Enter');await settle(f.page);assert.equal(f.sent.length,1);await f.context.close();
 }
 results.push('390px, 320px and 200%-equivalent layout; keyboard choice');
 for(const privacy of ['dnt','gpc','storage']) {
  const f=await context();
  await f.context.addInitScript(privacy=>{
   if(privacy==='dnt')Object.defineProperty(navigator,'doNotTrack',{value:'1'});
   if(privacy==='gpc')Object.defineProperty(navigator,'globalPrivacyControl',{value:true});
   if(privacy==='storage')Storage.prototype.getItem=()=>{throw new Error('storage unavailable');};
  },privacy);
  await f.page.goto(origin+'/connect');await settle(f.page);assert.equal(f.sent.length,0);assert.equal(await f.page.getByRole('button',{name:'Allow analytics',exact:true}).count(),0);await f.context.close();
 }
 results.push('DNT, GPC and unavailable storage fail closed');
 const f2=await context();await f2.page.goto(origin+'/connect');await f2.page.getByRole('button',{name:'Allow analytics',exact:true}).click();await settle(f2.page);
 const sibling=await f2.context.newPage();await sibling.goto(origin+'/connect');await sibling.getByRole('button',{name:'Analytics settings',exact:true}).click();await sibling.getByRole('button',{name:'No thanks',exact:true}).click();await settle(f2.page);
 const beforeWithdrawal=f2.sent.length;await f2.page.evaluate(()=>window.dispatchEvent(new CustomEvent('apparent:analytics-account',{detail:'account:'+'c'.repeat(64)})));await settle(f2.page);assert.equal(f2.sent.length,beforeWithdrawal);await f2.context.close();results.push('cross-tab withdrawal stops pending identity linkage');
 for(const refusal of ['expiry','clock-reversal','gpc','dnt','storage-clear']) {
  const f=await context();
  const now=Date.now(),age=180*86400000;
  await f.context.addInitScript(({now,age,origin})=>{
   if(location.origin!==origin)return;
   window.__analyticsNow=now;Date.now=()=>window.__analyticsNow;
   Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>window.__analyticsGpc===true,configurable:true});
   Object.defineProperty(navigator,'doNotTrack',{get:()=>window.__analyticsDnt||null,configurable:true});
   if(!localStorage.getItem('apparent.product-analytics.v1'))localStorage.setItem('apparent.product-analytics.v1',JSON.stringify({choice:'allow',at:now-age+1000,id:'anon:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));
  },{now,age,origin});
  await f.page.goto(origin+'/');await f.page.getByRole('button',{name:'Analytics settings',exact:true}).waitFor();await settle(f.page);
  assert.equal(f.sent.length,1,`${refusal}: valid restored consent must collect before refusal`);
  let sibling;
  if(refusal==='storage-clear') {
   sibling=await f.context.newPage();await sibling.goto(origin+'/');await sibling.getByRole('button',{name:'Analytics settings',exact:true}).waitFor();await settle(f.page);
   await sibling.evaluate(()=>localStorage.clear());
   await f.page.waitForFunction(()=>document.querySelector('aside[aria-label="Analytics preferences"]')?.shadowRoot?.querySelector('.settings'));
   await settle(f.page);
  }else await f.page.evaluate(refusal=>{
   if(refusal==='expiry')window.__analyticsNow+=2000;
   if(refusal==='clock-reversal')window.__analyticsNow-=180*86400000;
   if(refusal==='gpc')window.__analyticsGpc=true;
   if(refusal==='dnt')window.__analyticsDnt='1';
  },refusal);
  const before=f.sent.length;
  await f.page.locator('a[data-download-platform]').first().evaluate(link=>{link.addEventListener('click',event=>event.preventDefault(),{once:true});link.click();});
  await f.page.evaluate(()=>window.dispatchEvent(new CustomEvent('apparent:analytics-account',{detail:'account:'+'d'.repeat(64)})));
  await settle(f.page);assert.equal(f.sent.length,before,`${refusal}: open page must stop every outbound event without reload`);
  assert.deepEqual(f.errors,[]);await f.context.close();
 }
 results.push('restored consent is checked at send time: expiry, reversed clock, changed GPC/DNT and cross-tab storage clear');
 for(const invalidAge of [180*86400000, -60000]) {
  const f=await context();
  await f.context.addInitScript(({invalidAge,origin})=>{if(location.origin===origin)localStorage.setItem('apparent.product-analytics.v1',JSON.stringify({choice:'allow',at:Date.now()-invalidAge,id:'anon:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));},{invalidAge,origin});
  await f.page.goto(origin+'/');await f.page.getByRole('button',{name:'Allow analytics',exact:true}).waitFor();await settle(f.page);assert.equal(f.sent.length,0);await f.context.close();
 }
 results.push('expired and future-dated restored consent require a fresh choice');
 console.log(JSON.stringify({results,evidence,limits:'Synthetic Chromium on Linux; no live PostHog, OAuth, deployment or native proof.'},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
