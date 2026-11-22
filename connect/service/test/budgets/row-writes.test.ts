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
  const reads=[];
  const record=(sql,r)=>{writes.push({sql,rows:r.meta.rows_written});reads.push({sql,rows:r.meta.rows_read});return r;};
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
  else if(url.pathname==='/v1/encryption/peers'){
   const response=await worker.fetch(request,target);
   return Response.json({reads,body:await response.json()},{status:response.status});
  }
  else return worker.fetch(request,env);
  return Response.json({reads,writes,rows:writes.reduce((n,w)=>n+w.rows,0),deletes});
 }};`},bundle:true,format:'esm',platform:'browser',conditions:['workerd'],external:['node:*'],write:false});
const applyIndexes=async (f:Awaited<ReturnType<typeof fixture>>)=>
 f.db.exec((await readFile('.generated/migrations/0014.sql','utf8')).replaceAll('\n',' '));
const setup=async (bindings={},indexes=true)=>{
 const f=await fixture(bindings, {scriptPath:undefined,script:instrumented.outputFiles[0].text});
 try {
  if(indexes)await applyIndexes(f);
  return f;
 }catch(error){await f.close();throw error;}
};
const sweep=async f=>{const r=await f.call('/sweep');assert.equal(r.status,200);return r.json();};

test('under-quota capture admission skips the account history scan',async t=>{
 const f=await setup();try{
  const a=await f.identity('reservation-history'), now=Date.now(), future=now+86400000;
  await f.db.exec((await readFile('.generated/migrations/0017.sql','utf8')).replaceAll('\n',' '));
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<500) INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,status) SELECT 'existing-'||i,?,'[]',?, ?,?,'ready' FROM n")
   .bind(a.id,500000,future,future).run();
  const insert=(key:string,bytes:number)=>f.db.prepare("INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until) VALUES(?,?,'[]',?,?,?)")
   .bind(key,a.id,bytes,future,future).run();
  const before=await insert('before',1000);
  await f.db.exec((await readFile('.generated/migrations/0018.sql','utf8')).replaceAll('\n',' '));
  const after=await insert('after',1000);
  const reserved=async()=> (await f.db.prepare('SELECT bytes FROM capture_quota_reservations WHERE account_id=?').bind(a.id).first()).bytes;
  t.diagnostic(`D1 rows read per reservation: ${before.meta.rows_read} before, ${after.meta.rows_read} after`);
  assert.ok(before.meta.rows_read>=500);
  assert.ok(after.meta.rows_read<=10,JSON.stringify(after.meta));
  assert.equal(await reserved(),250002000);
  await assert.rejects(insert('after',400000000));
  assert.equal(await reserved(),250002000);
  await f.db.prepare("UPDATE captures SET expires_at=? WHERE id='existing-1'").bind(now-1).run();
  await insert('large',499999000);
  assert.equal(await reserved(),500500000);
  assert.deepEqual((await f.db.prepare("SELECT id FROM captures WHERE status!='deleted' ORDER BY reservation_seq").all()).results.map(r=>r.id),['existing-1','after','large']);
  await sweep(f);
  assert.equal(await reserved(),500000000);
 }finally{await f.close();}
});

test('cleanup row reads do not scale with retired uploads',async t=>{
 const f=await setup({},false);try{
  const a=await f.identity('retired-history');
  const capture=id(953);
  await f.db.prepare("INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,status) VALUES(?,?,?,0,0,0,'deleted')").bind(capture,a.id,'[]').run();
  await f.db.prepare("INSERT INTO attempts(key,capture_id,created_at) VALUES('retry',?,0)").bind(capture).run();
  await sweep(f);
  await f.db.batch([
   f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<12000) INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,status) SELECT printf('historical-%05d',i),?,'[]',0,0,0,'deleted' FROM n").bind(a.id),
   f.db.prepare("INSERT INTO attempts(key,capture_id,created_at,terminal,released) SELECT id,id,0,1,1 FROM captures WHERE id LIKE 'historical-%'"),
   f.db.prepare("INSERT INTO files(capture_id,path,size,sha256,object_key) SELECT id,'summary.md',0,'',id FROM captures WHERE id LIKE 'historical-%'"),
  ]);
  const before=await sweep(f);
  await applyIndexes(f);
  const after=await sweep(f);
  assert.deepEqual(before.deletes,['retry']);
  assert.deepEqual(after.deletes,before.deletes);
  assert.equal(after.rows,0);
  const totalReads=({reads}:{reads:{rows:number}[]})=>reads.reduce((sum,statement)=>sum+statement.rows,0);
  const beforeReads=totalReads(before),afterReads=totalReads(after);
  t.diagnostic(`D1 rows read per sweep: ${beforeReads} before, ${afterReads} after`);
  assert.ok(beforeReads>12000);
  assert.ok(afterReads<100,JSON.stringify(after.reads));
 }finally{await f.close();}
});

test('settled cleanup skips published live objects and finds late terminal work',async t=>{
 const f=await setup();try{
  const a=await f.identity('published-history'), live=id(957), deleted=id(958), now=Date.now(), future=now+86400000;
  await f.db.batch([
   ...[live,deleted].map(capture=>f.db.prepare("INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,status) VALUES(?,?,'[]',0,?,?,'ready')").bind(capture,a.id,future,future)),
   f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1200) INSERT INTO attempts(key,capture_id,created_at,terminal) SELECT printf('published-%04d',i),?,0,1 FROM n").bind(live),
   f.db.prepare("INSERT INTO files(capture_id,path,size,sha256,object_key) SELECT capture_id,key,0,'',key FROM attempts WHERE capture_id=?").bind(live),
   f.db.prepare("INSERT INTO attempts(key,capture_id,created_at) VALUES('late',?,?)").bind(deleted,now),
  ]);
  const before=await sweep(f);
  await f.db.exec((await readFile('.generated/migrations/0019.sql','utf8')).replaceAll('\n',' '));
  const after=await sweep(f);
  const total=({reads}:{reads:{rows:number}[]})=>reads.reduce((sum,s)=>sum+s.rows,0);
  t.diagnostic(`D1 rows read per sweep with live history: ${total(before)} before, ${total(after)} after`);
  assert.ok(total(before)>1200);
  assert.ok(total(after)<total(before)/20,JSON.stringify(after.reads));
  assert.deepEqual(after.deletes,[]);
  assert.equal(after.rows,0);
  await f.db.prepare("UPDATE captures SET status='deleted' WHERE id=?").bind(deleted).run();
  assert.deepEqual((await sweep(f)).deletes,['late']);
  await f.bucket.put('late','arrived after uncertain cleanup');
  await f.db.prepare("UPDATE attempts SET terminal=1 WHERE key='late'").run();
  await f.db.prepare("INSERT INTO attempts(key,capture_id,created_at) VALUES('orphan',?,0)").bind(live).run();
  await f.db.prepare("UPDATE attempts SET terminal=1 WHERE key='orphan'").run();
  assert.deepEqual((await sweep(f)).deletes,['orphan','late']);
  assert.equal(await f.bucket.head('late'),null);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM attempts WHERE released=1").first()).n,2);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM capture_cleanup_queue").first()).n,0);
  await f.db.prepare("UPDATE captures SET status='deleted' WHERE id=?").bind(live).run();
  assert.equal((await sweep(f)).deletes.length,1000);
  assert.equal((await sweep(f)).deletes.length,200);
  assert.deepEqual((await sweep(f)).deletes,[]);
 }finally{await f.close();}
});

test('device key lookups skip revoked grants and expired refresh tokens',async t=>{
 const f=await setup({},false);try{
  const a=await f.identity('registry-reader');
  const grant='registry-reader-read',key={version:1,recipient:'age1jyg59kq02njlzz0h99thxywpltpp2ywtsgef3h8sawepwnglyq3qqz5957',signing:'01'.repeat(32)};
  await f.db.batch([
   f.db.prepare('UPDATE auth_grants SET approved_at=1 WHERE id=?').bind(grant),
   f.db.prepare('INSERT INTO encryption_keys(grant_id,version,recipient,signing) VALUES(?,1,?,?)').bind(grant,key.recipient,key.signing),
   f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO oauthRefreshToken(id,token,clientId,userId,expiresAt,scopes) SELECT 'old-refresh-'||i,'old-refresh-'||i,?,'registry-reader','2000-01-01T00:00:00.000Z','[]' FROM n").bind(grant),
   f.db.prepare("INSERT INTO oauthRefreshToken(id,token,clientId,userId,expiresAt,scopes) VALUES(?,?,?,?,?,'[]')").bind(grant,'fixture-refresh-token',grant,'registry-reader',new Date(Date.now()+86400000).toISOString()),
   f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO auth_grants(id,client_id,device_hash,user_code,scope,account_id,user_id,expires_at,approved_at,revoked_at) SELECT 'retired-'||i,'retired-'||i,'retired-'||i,'retired-'||i,'read',?,'registry-reader',0,1,2 FROM n").bind(a.id),
   f.db.prepare("INSERT INTO encryption_keys(grant_id,version,recipient,signing) SELECT id,1,?,? FROM auth_grants WHERE revoked_at=2").bind(key.recipient,key.signing),
  ]);
  const peers=async()=>{
   const response=await f.call('/v1/encryption/peers',{token:a.read});
   assert.equal(response.status,200);
   return response.json();
  };
  const before=await peers();
  await applyIndexes(f);
  const after=await peers();
  assert.deepEqual(after.body,before.body);
  assert.deepEqual(after.body.devices,[{grantId:grant,scope:'read',key}]);
  const registryReads=({reads}:{reads:{sql:string;rows:number}[]})=>reads.find(statement=>statement.sql.includes('JOIN encryption_keys'))?.rows??0;
  const beforeReads=registryReads(before),afterReads=registryReads(after);
  t.diagnostic(`D1 rows read per key lookup: ${beforeReads} before, ${afterReads} after`);
  assert.ok(beforeReads>=2000);
  assert.ok(afterReads>0&&afterReads<20,JSON.stringify(after.reads));
 }finally{await f.close();}
});

test('uncertain cleanup uses one cursor write and visits every key across bounded pages',async()=>{
 const f=await setup();try{
  const a=await f.identity('uncertain-cursor'),capture=id(950);
  await f.db.prepare("INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,status) VALUES(?,?,?,0,0,0,'deleted')").bind(capture,a.id,'[]').run();
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1500) INSERT INTO attempts(key,capture_id,created_at,bytes) SELECT printf('uncertain-%04d',i),?,0,1 FROM n").bind(capture).run();
  await f.db.prepare('UPDATE r2_budget SET physical_used=1500').run();
  const first=await sweep(f);assert.equal(first.rows,2,'one cursor stamp plus its index entry');assert.equal(first.deletes.length,1000);
  assert.equal(first.writes.filter(({rows})=>rows>0).length,1,'only the page cursor is stamped');
  const second=await sweep(f);assert.equal(second.rows,2);assert.equal(second.deletes.length,1000);
  assert.equal(new Set([...first.deletes,...second.deletes]).size,1500,'wrapped selection cannot starve later uncertain keys');
  assert.equal((await f.db.prepare('SELECT physical_used FROM r2_budget').first()).physical_used,1500,'uncertain attempts remain charged');
 }finally{await f.close();}
});

test('a small uncertain backlog keeps deleting late objects without recurring SQL stamps',async()=>{
 const f=await setup();try{
  const a=await f.identity('uncertain-idle'),capture=id(951);
  await f.db.prepare("INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until,status) VALUES(?,?,?,0,0,0,'deleted')").bind(capture,a.id,'[]').run();
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<49) INSERT INTO attempts(key,capture_id,created_at) SELECT printf('uncertain-%04d',i),?,0 FROM n").bind(capture).run();
  assert.equal((await sweep(f)).rows,2);
  await f.bucket.put('uncertain-0001','late');
  const next=await sweep(f);assert.equal(next.rows,0);assert.equal(next.deletes.length,49);assert.equal(await f.bucket.head('uncertain-0001'),null);
 }finally{await f.close();}
});

test('retired attempts stop writing; uncertain late objects remain retryable without releasing reservations',async()=>{
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
  assert.deepEqual(idle.deletes,['uncertain'],'free uncertain deletes continue without SQL stamps');
  await f.bucket.put('uncertain','late');
  const retry=await sweep(f);assert.deepEqual(retry.deletes,['uncertain']);
  assert.equal(retry.rows,0,'the same cursor needs no recurring checkpoint');
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
  await f.db.exec((await readFile('migrations/baseline/0006.sql','utf8')).replaceAll('\n',' '));
  await f.db.prepare('UPDATE analytics_control SET enabled=1').run();
  assert.equal((await(await f.call('/analytics')).json()).rows,1,'checkpoint persists');
  assert.equal((await(await f.call('/analytics')).json()).rows,0,'maintenance is read-only');
  await f.db.exec((await readFile('migrations/baseline/0009.sql','utf8')).replaceAll('\n',' '));
  await f.db.prepare('UPDATE aggregate_dau_state SET as_of_ms=0').run();
  assert.equal((await(await f.call('/activity')).json()).rows,1,'stale aggregate checkpoint advances');
  // Fix the watermark beyond this quarter to avoid a boundary-clock flake.
  const ahead=(Math.floor(Date.now()/900000)+1)*900000;
  await f.db.prepare('UPDATE aggregate_dau_state SET as_of_ms=?').bind(ahead).run();
  for(let i=0;i<2;i++)assert.equal((await(await f.call('/activity')).json()).rows,0);
  assert.equal((await f.db.prepare('SELECT as_of_ms FROM aggregate_dau_state').first()).as_of_ms,ahead,'no watermark regression');
 }finally{await f.close();}
});
