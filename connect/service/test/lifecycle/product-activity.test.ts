import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,id,file} from '../helpers.mjs';
import {activitySubject,admitProductActivity,cleanupProductActivity} from '../../src/reporting/product-activity.ts';
import {setAnalyticsChoice} from '../../src/analytics.ts';
import type {Env} from '../../src/types.ts';
const secret='synthetic-better-auth-secret-only-for-tests-32bytes';
async function setup(){const f=await fixture({SHARING_ENABLED:'true',POSTHOG_ENABLED:'false'});for(const n of ['0003','0006','0007','0008','0009','0010','0012'])await f.db.exec((await readFile('.generated/migrations/'+n+'.sql','utf8')).replaceAll('\n',' '));return {...f,env:{DB:f.db,BETTER_AUTH_SECRET:secret} as Env};}
const rows=async f=>(await f.db.prepare('SELECT * FROM product_activity').all()).results;
async function settled(f,n){for(let i=0;i<100;i++){if((await rows(f)).length===n)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Worker activity did not settle');}
test('real Worker authenticates recording starts; accounts deduplicate across devices and metrics expose aggregates only',async()=>{
 const f=await setup();try{
  const initial=(await f.db.prepare('SELECT * FROM reporting_product_activity').all()).results;
  assert.equal(initial.length,2);assert.ok(initial.every(r=>r.daily_active_accounts===null&&r.weekly_active_accounts===null));
  const schema=(await f.db.prepare('PRAGMA table_info(reporting_product_activity)').all()).results;
  assert.deepEqual(schema.map(r=>[r.name,r.type]),[['product','TEXT'],['day_utc','TEXT'],['daily_active_accounts','INTEGER'],['weekly_active_accounts','INTEGER'],['collection_started_at_ms','INTEGER'],['as_of_ms','INTEGER'],['coverage','TEXT']]);
  const a=await f.identity('activity-a'),b=await f.identity('activity-b');
  assert.equal((await f.call('/v1/activity/recording-started',{method:'POST',body:{}})).status,401);
  assert.equal((await f.call('/v1/activity/recording-started',{token:a.token,method:'POST',body:{accountId:b.id}})).status,400);
  for(const token of [a.token,a.read,a.token,b.token])assert.equal((await f.call('/v1/activity/recording-started',{token,method:'POST',body:{}})).status,200);
  await settled(f,2);const stored=await rows(f);assert.ok(stored.every(r=>r.product==='desktop'&&!JSON.stringify(r).includes(a.id)&&!JSON.stringify(r).includes('email')));
  const desktop=await activitySubject(f.env,a.id,'desktop'),connect=await activitySubject(f.env,a.id,'connect');
  assert.notEqual(desktop,connect);assert.ok(stored.some(r=>r.subject===desktop));
  const path='/v1/captures/'+id(940);
  assert.equal((await f.call(path,{token:a.token,method:'POST',body:{files:[file()]}})).status,200);
  await f.call(path+'/files/summary.md',{token:a.token,method:'PUT',raw:'hello'});
  assert.equal((await f.call(path+'/complete',{token:a.token,method:'POST'})).status,200);
  await settled(f,3);await(await f.mf.getWorker()).scheduled();
  const metrics=(await f.db.prepare('SELECT * FROM reporting_product_activity ORDER BY product').all()).results;
  assert.deepEqual(metrics.map(r=>[r.product,r.daily_active_accounts,r.weekly_active_accounts]),[['connect',1,1],['desktop',2,2]]);
  assert.ok(metrics.every(r=>!Object.hasOwn(r,'subject')&&!Object.hasOwn(r,'account_id')));
  for(const table of ['analytics_choices','analytics_consent','analytics_outbox'])assert.equal((await f.db.prepare('SELECT count(*) n FROM '+table).first()).n,0);

 }finally{await f.close();}
});
test('seven UTC dates deduplicate weekly; expiry, deletion, objections and exclusions reconcile without a persisted mapping',async()=>{
 const f=await setup();try{
  const a=await f.identity('one-day'),b=await f.identity('six-days'),c=await f.identity('expired');
  for(const account of [a,b,c])await admitProductActivity(f.env,account.id,'desktop');
  await f.db.prepare("UPDATE product_activity SET last_day=date('now','-1 day') WHERE subject=?").bind(await activitySubject(f.env,a.id,'desktop')).run();
  await f.db.prepare("UPDATE product_activity SET last_day=date('now','-6 days') WHERE subject=?").bind(await activitySubject(f.env,b.id,'desktop')).run();
  await f.db.prepare("UPDATE product_activity SET last_day=date('now','-7 days') WHERE subject=?").bind(await activitySubject(f.env,c.id,'desktop')).run();
  const metric=()=>f.db.prepare("SELECT * FROM reporting_product_activity WHERE product='desktop'").first();
  assert.equal((await metric()).daily_active_accounts,null);assert.equal((await metric()).weekly_active_accounts,2);
  await cleanupProductActivity(f.env);assert.equal((await rows(f)).length,2);
  await f.db.prepare('DELETE FROM auth_grants WHERE account_id=?').bind(b.id).run();await f.db.prepare('DELETE FROM accounts WHERE id=?').bind(b.id).run();
  await cleanupProductActivity(f.env);assert.equal((await metric()).weekly_active_accounts,1);
  const env={...f.env,POSTHOG_ENABLED:'true',POSTHOG_PROJECT_TOKEN:'phc_synthetic'};
  const stopped=await setAnalyticsChoice(env,a.id,false,null);assert.deepEqual(await rows(f),[]);
  await setAnalyticsChoice(env,a.id,true,stopped.revision);await admitProductActivity(f.env,a.id,'desktop');assert.deepEqual(await rows(f),[],'aggregate objection survives individual reconsent');
 }finally{await f.close();}
});
test('privacy signals, synthetic exclusions, kill switch and missing metric schema cannot break product calls',async()=>{
 const f=await setup();try{
  const a=await f.identity('privacy');
  for(const headers of [{'Sec-GPC':'1'},{DNT:'1'}])assert.equal((await f.call('/v1/activity/recording-started',{token:a.token,method:'POST',body:{},headers})).status,200);
  await(await f.mf.getWorker()).scheduled();assert.deepEqual(await rows(f),[]);
  await f.db.prepare('INSERT INTO aggregate_dau_exclusions(account_id) VALUES(?)').bind(a.id).run();
  await admitProductActivity(f.env,a.id,'desktop');assert.deepEqual(await rows(f),[]);
  await f.db.prepare('DELETE FROM aggregate_dau_exclusions WHERE account_id=?').bind(a.id).run();
  await f.db.exec('UPDATE analytics_control SET enabled=0');await admitProductActivity(f.env,a.id,'desktop');assert.deepEqual(await rows(f),[]);
  await f.db.exec('DROP TABLE product_activity');assert.equal((await f.call('/v1/activity/recording-started',{token:a.token,method:'POST',body:{}})).status,200);
 }finally{await f.close();}
});
