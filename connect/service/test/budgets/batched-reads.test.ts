import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture} from '../../../enablement/verification/service/helpers.mjs';

const compiled=await build({stdin:{resolveDir:process.cwd(),contents:`
 import {getObject} from './src/storage.ts';import {rate} from './src/common.ts';
 const proxies=new WeakMap();let writes=0,gets=0,clock=0,failGrant=false,holdRate=false,held=false,released=false;const realNow=Date.now;Date.now=()=>clock||realNow();
 function db(inner){if(proxies.has(inner))return proxies.get(inner);const record=r=>{writes+=r.meta.rows_written;return r;};
 const out={prepare(sql){const wrap=s=>({bind(...v){return wrap(s.bind(...v));},async run(){const r=record(await s.run());if(failGrant&&sql.startsWith('UPDATE r2_budget SET b_used')){failGrant=false;throw Error('lost commit acknowledgement');}return r;},async all(){return record(await s.all());},async first(col){if(holdRate&&sql.startsWith('INSERT INTO rate_limits')){holdRate=false;held=true;for(let i=0;!released&&i<1000;i++)await new Promise(r=>setTimeout(r,5));if(!released)throw Error('barrier timeout');}const r=record(await s.all()),row=r.results[0]??null;return col?row?.[col]??null:row;}});return wrap(inner.prepare(sql));}};proxies.set(inner,out);return out;}
 export default {async fetch(req,env){const u=new URL(req.url);if(u.searchParams.has('at'))clock=Number(u.searchParams.get('at'));if(u.pathname==='/release'){released=true;return Response.json({});}if(u.searchParams.has('holdRate'))holdRate=true;if(u.searchParams.has('failGrant'))failGrant=true;if(u.searchParams.has('advance'))clock=Date.now()+Number(u.searchParams.get('advance'));if(u.pathname==='/stats')return Response.json({writes,gets,held});
 const target={...env,DB:db(env.DB),BUCKET:{async get(){gets++;return null;}}};try{for(let i=0;i<Number(u.searchParams.get('n')??1);i++){
 if(u.pathname==='/rate')await rate(target,'mcp-relay:test',Number(u.searchParams.get('max')??20000));else await getObject(target,'synthetic');}
 return Response.json({writes,gets});}catch(e){return Response.json({code:e.code,writes,gets},{status:e.status??500});}}};`},bundle:true,format:'esm',platform:'browser',conditions:['workerd'],external:['node:*'],write:false});
const setup=(options={})=>fixture({}, {...options,scriptPath:undefined,script:compiled.outputFiles[0].text});
test('hot downloads and MCP limits reserve durable batches instead of writing per chunk',async()=>{
 const f=await setup();try{
  assert.equal((await f.call('/read?n=1024')).status,200);
  let stats=await(await f.call('/stats')).json();assert.equal(stats.gets,1024);assert.ok(stats.writes<=32,JSON.stringify(stats));
  const firstReadWrites=stats.writes;
  assert.equal((await f.call('/read?n=1024')).status,200);
  stats=await(await f.call('/stats')).json();assert.equal(stats.gets,2048);assert.ok(stats.writes-firstReadWrites<=8,'steady-state write growth stays batched');
  const before=stats.writes;assert.equal((await f.call('/rate?n=1024')).status,200);
  stats=await(await f.call('/stats')).json();assert.ok(stats.writes-before<=32,JSON.stringify(stats));
  console.log(JSON.stringify({first1024ReadWrites:firstReadWrites,next1024ReadWrites:before-firstReadWrites,first1024RateWrites:stats.writes-before}));
  const used=await f.db.prepare('SELECT b_used FROM r2_budget').first();assert.ok(used.b_used>=2048,'all provider operations were reserved durably first');
 }finally{await f.close();}
});
test('independent workers and concurrent requests never exceed the durable read cap',async()=>{
 const f=await setup({instances:true});try{
  await f.db.prepare('UPDATE r2_budget SET b_cap=20').run();
  const responses=await Promise.all(Array.from({length:60},(_,i)=>f.call('/read',{instance:i%2?'first':'second'})));
  const success=responses.filter(r=>r.status===200).length;assert.ok(success<=20);assert.ok(success>0);
  const ledger=await f.db.prepare('SELECT b_used FROM r2_budget').first();assert.ok(ledger.b_used<=20);assert.ok(ledger.b_used>=success);
  const stats=await Promise.all(['first','second'].map(async instance=>(await f.call('/stats',{instance})).json()));assert.equal(stats.reduce((n,s)=>n+s.gets,0),success);
 }finally{await f.close();}
});
test('restart never restores unused grants and invalid ledgers block cached permits',async()=>{
 const f=await setup();try{
  assert.equal((await f.call('/read?n=3')).status,200);
  const before=await f.db.prepare('SELECT b_used FROM r2_budget').first();
  await f.reload();assert.equal((await f.call('/read?n=3')).status,200);
  const after=await f.db.prepare('SELECT b_used FROM r2_budget').first();assert.ok(after.b_used>before.b_used);
  await f.db.prepare("UPDATE r2_budget SET physical_cap='invalid'").run();
  assert.equal((await f.call('/read')).status,503);assert.equal((await(await f.call('/stats')).json()).gets,3);
 }finally{await f.close();}
});
test('batched rate grants retain the global limit across workers',async()=>{
 const f=await setup({instances:true});try{
  // All 180 requests exercise one hourly window, even across a wall-clock rollover.
  await Promise.all(['first','second'].map(instance=>f.call('/stats?at=1763208000000',{instance})));
  const replies=await Promise.all(Array.from({length:180},(_,i)=>f.call('/rate?max=130',{instance:i%2?'first':'second'})));
  const admitted=replies.filter(r=>r.status===200).length;assert.ok(admitted>0&&admitted<=130);
  assert.ok(replies.some(r=>r.status===429));
  assert.ok((await f.db.prepare("SELECT count FROM rate_limits WHERE key='mcp-relay:test'").first()).count<=130);
 }finally{await f.close();}
});
test('prepaid reads remain usable at the cap but cannot issue another provider call beyond it',async()=>{
 const f=await setup();try{
  await f.db.prepare('UPDATE r2_budget SET b_cap=9').run();
  assert.equal((await f.call('/read?n=2')).status,200);
  assert.equal((await f.db.prepare('SELECT b_used FROM r2_budget').first()).b_used,9);
  assert.equal((await f.call('/read?n=7')).status,200);
  assert.equal((await f.call('/read')).status,503);
  assert.equal((await(await f.call('/stats')).json()).gets,9);
 }finally{await f.close();}
});
test('hour rollover discards cached rate permits before admitting the new window',async()=>{
 const f=await setup();try{
  assert.equal((await f.call('/rate?max=130&n=2')).status,200);
  const before=await f.db.prepare("SELECT window,count FROM rate_limits WHERE key='mcp-relay:test'").first();
  const writes=(await(await f.call('/stats')).json()).writes;
  assert.equal((await f.call('/rate?max=130&n=2&advance=3600000')).status,200);
  const after=await f.db.prepare("SELECT window,count FROM rate_limits WHERE key='mcp-relay:test'").first();
  assert.equal(after.window,before.window+1);assert.equal(after.count,9);
  assert.ok((await(await f.call('/stats')).json()).writes>writes,'the new window acquired new durable grants');
 }finally{await f.close();}
});
test('a committed but unacknowledged read reservation never mints local permits',async()=>{
 const f=await setup();try{
  await f.db.prepare('UPDATE r2_budget SET b_cap=1').run();
  assert.equal((await f.call('/read?failGrant=1')).status,503);
  assert.equal((await f.db.prepare('SELECT b_used FROM r2_budget').first()).b_used,1,'the durable commit happened');
  assert.equal((await f.call('/read')).status,503);
  assert.equal((await(await f.call('/stats')).json()).gets,0,'no provider operation escaped failed admission');
  await f.reload();assert.equal((await f.call('/read')).status,503);
 }finally{await f.close();}
});

for(const max of [30,130])test('delayed rate reservation cannot move the window backward, max='+max,async()=>{
 const f=await setup();try{
  const old=f.call('/rate?holdRate=1&max='+max);
  let held=false;for(let i=0;i<100&&!held;i++){held=(await(await f.call('/stats')).json()).held;if(!held)await new Promise(r=>setTimeout(r,10));}
  assert.equal(held,true,'old reservation reached the pre-commit barrier');
  assert.equal((await f.call('/rate?advance=3600000&max='+max)).status,200);
  const before=await f.db.prepare("SELECT window,count FROM rate_limits WHERE key='mcp-relay:test'").first();
  await f.call('/release');assert.equal((await old).status,429);
  assert.deepEqual(await f.db.prepare("SELECT window,count FROM rate_limits WHERE key='mcp-relay:test'").first(),before,'current grants cannot be forgotten');
 }finally{await f.call('/release').catch(()=>{});await f.close();}
});
