import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fixture,id,file} from '../helpers.mjs';

// Observe actual workerd/D1 row accounting, excluding fixture setup. No fake DB.
const instrumented=await build({stdin:{resolveDir:process.cwd(),contents:`
 import {cleanup} from './src/captures.ts';
 import {admit} from './src/common.ts';
 import {flushAnalytics} from './src/analytics.ts';
 import {deleteAttempts} from './src/storage.ts';
 import {cleanupDailyActivity} from './src/reporting/aggregate-dau.ts';
 import worker from './src/worker.ts';
 export default {async fetch(request,env){
  const writes=[],deletes=[];
  const record=(sql,r)=>{writes.push({sql,rows:r.meta.rows_written});return r;};
  const DB={prepare(sql){const wrap=s=>({bind(...args){return wrap(s.bind(...args));},
   async first(...args){return (await this.all(...args)).results[0]??null;},
   async all(){return record(sql,await s.all());},async run(){return record(sql,await s.run());},raw:s,sql});return wrap(env.DB.prepare(sql));},
   async batch(items){const results=await env.DB.batch(items.map(s=>s.raw));return results.map((r,i)=>record(items[i].sql,r));}};
  const BUCKET={async delete(keys){deletes.push(...keys);return env.BUCKET.delete(keys);}};
  const target={...env,DB,BUCKET},url=new URL(request.url);
  if(url.pathname==='/sweep')await cleanup(target);
  else if(url.pathname==='/admit')await admit(target,url.searchParams.get('user'));
  else if(url.pathname==='/analytics')await flushAnalytics(target);
  else if(url.pathname==='/activity')await cleanupDailyActivity(target);
  else if(url.pathname==='/delete')await deleteAttempts(target,await request.json());
  else return worker.fetch(request,env);
  return Response.json({writes,rows:writes.reduce((n,w)=>n+w.rows,0),deletes});
 }};`},bundle:true,format:'esm',platform:'browser',conditions:['workerd'],external:['node:*'],write:false});
const setup=(bindings={})=>fixture(bindings, {scriptPath:undefined,script:instrumented.outputFiles[0].text});
const sweep=async f=>{const r=await f.call('/sweep');assert.equal(r.status,200);return r.json();};

test('retired attempts stop writing; uncertain late objects retry hourly without releasing reservations',async()=>{
 const f=await setup();try{
  const a=await f.identity('row-budget'),capture=id(901);
  // A real producer-created capture; fixture rows represent retained attempts.
  assert.equal((await f.call('/v1/captures/'+capture,{token:a.token,method:'POST',body:{files:[file()]}})).status,200);
  assert.equal((await f.call('/v1/captures/'+capture,{token:a.token,method:'DELETE'})).status,200);
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1001) INSERT INTO attempts(key,capture_id,created_at,terminal) SELECT printf('finished-%04d',i),?,0,1 FROM n").bind(capture).run();
  await f.db.prepare("INSERT INTO attempts(key,capture_id,created_at,bytes) VALUES('uncertain',?,0,5)").bind(capture).run();
  await f.db.prepare('UPDATE r2_budget SET physical_used=5').run();
  for(let i=0;i<2;i++)await sweep(f);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM attempts WHERE released=1').first()).n,1001,'zero-byte terminal attempts retire too');
  const idle=await sweep(f);
  assert.equal(idle.rows,0,'idle cleanup must not rewrite finished attempts or a zero-reclaim ledger');
  assert.deepEqual(idle.deletes,[],'uncertain keys wait for their retry interval');
  await f.bucket.put('uncertain','late');
  await sweep(f);assert.ok(await f.bucket.head('uncertain'),'late object waits for bounded retry');
  await f.db.prepare("UPDATE attempts SET cleaned_at=cleaned_at-3600000 WHERE key='uncertain'").run();
  const retry=await sweep(f);assert.deepEqual(retry.deletes,['uncertain']);
  assert.equal(retry.rows,1,'only uncertain cleanup checkpoint is written');
  assert.equal(await f.bucket.head('uncertain'),null);
  assert.equal((await f.db.prepare('SELECT physical_used FROM r2_budget').first()).physical_used,5);
  await f.db.prepare("UPDATE attempts SET terminal=1 WHERE key='uncertain'").run();
  await f.bucket.put('uncertain','settled');
  await sweep(f); // Terminal transition bypasses the hourly retry delay.
  assert.equal((await f.db.prepare('SELECT physical_used FROM r2_budget').first()).physical_used,0);
  assert.equal((await sweep(f)).rows,0);
 }finally{await f.close();}
});

test('zero-reclaim deletion never mutates the ledger and cannot release against invalid state',async()=>{
 const f=await setup();try{
  const a=await f.identity('zero-budget'),capture=id(902);
  await f.db.prepare("INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until) VALUES(?,?,?,0,0,0)").bind(capture,a.id,'[]').run();
  await f.db.prepare("INSERT INTO attempts(key,capture_id,created_at,terminal) VALUES('zero',?,0,1)").bind(capture).run();
  await f.db.prepare("UPDATE r2_budget SET a_cap='invalid'").run();
  const remove=async()=>{const r=await f.call('/delete',{method:'POST',body:[{key:'zero',terminal:1}]});assert.equal(r.status,200);return r.json();};
  const invalid=await remove();assert.equal(invalid.writes.find(w=>w.sql.startsWith('UPDATE r2_budget')).rows,0);
  assert.equal((await f.db.prepare("SELECT released FROM attempts WHERE key='zero'").first()).released,0);
  await f.db.prepare('UPDATE r2_budget SET a_cap=500000').run();
  const valid=await remove();assert.equal(valid.writes.find(w=>w.sql.startsWith('UPDATE r2_budget')).rows,0);
  assert.equal((await f.db.prepare("SELECT released FROM attempts WHERE key='zero'").first()).released,1);
 }finally{await f.close();}
});

test('unchanged account admission and same-day analytics maintenance do not write',async()=>{
 const f=await setup({POSTHOG_PROJECT_TOKEN:'phc_synthetic',POSTHOG_ENVIRONMENT:'synthetic'});try{
  const a=await f.identity('no-change');
  assert.equal((await(await f.call('/admit?user=no-change')).json()).rows,0);
  await f.db.prepare("UPDATE auth_user SET email='changed@example.com' WHERE id='no-change'").run();
  assert.equal((await(await f.call('/admit?user=no-change')).json()).rows,1);
  assert.equal((await f.db.prepare('SELECT email FROM accounts WHERE id=?').bind(a.id).first()).email,'changed@example.com');
  await f.db.exec((await readFile('migrations/0006.sql','utf8')).replaceAll('\n',' '));
  await f.db.prepare('UPDATE analytics_control SET enabled=1').run();
  assert.equal((await(await f.call('/analytics')).json()).rows,1,'first UTC-day checkpoint persists');
  assert.equal((await(await f.call('/analytics')).json()).rows,0,'same-day empty maintenance is read-only');
  await f.db.exec((await readFile('migrations/0009.sql','utf8')).replaceAll('\n',' '));
  await f.db.prepare('UPDATE aggregate_dau_state SET as_of_ms=0').run();
  assert.equal((await(await f.call('/activity')).json()).rows,1,'stale aggregate checkpoint advances');
  // Fix the watermark beyond this quarter to avoid a boundary-clock flake.
  const ahead=(Math.floor(Date.now()/900000)+1)*900000;
  await f.db.prepare('UPDATE aggregate_dau_state SET as_of_ms=?').bind(ahead).run();
  for(let i=0;i<2;i++)assert.equal((await(await f.call('/activity')).json()).rows,0);
  assert.equal((await f.db.prepare('SELECT as_of_ms FROM aggregate_dau_state').first()).as_of_ms,ahead,'no watermark regression');
 }finally{await f.close();}
});
