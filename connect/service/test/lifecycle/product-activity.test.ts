import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,id,file} from '../helpers.mjs';
import {activitySubject,admitProductActivity,cleanupProductActivity} from '../../src/reporting/product-activity.ts';
import {setAnalyticsChoice} from '../../src/analytics.ts';
import type {Env} from '../../src/types.ts';
const secret='synthetic-better-auth-secret-only-for-tests-32bytes';
async function setup(cadence = false){const f=await fixture({SHARING_ENABLED:'true',POSTHOG_ENABLED:'false'});for(const n of ['0003','0006','0007','0008','0009','0010','0012','0013',...(cadence?['0015']:[])])await f.db.exec((await readFile('.generated/migrations/'+n+'.sql','utf8')).replaceAll('\n',' '));return {...f,env:{DB:f.db,BETTER_AUTH_SECRET:secret} as Env};}
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
test('reporting history deduplicates the Desktop total and preserves earlier aggregate snapshots', async () => {
 const f = await setup();
 try {
  const both = await f.identity('history-both');
  const connectOnly = await f.identity('history-connect');
  const desktopOnly = await f.identity('history-desktop');
  const expired = await f.identity('history-expired');
  await admitProductActivity(f.env, both.id, 'desktop');
  await admitProductActivity(f.env, both.id, 'connect');
  await admitProductActivity(f.env, connectOnly.id, 'connect');
  await admitProductActivity(f.env, desktopOnly.id, 'desktop');
  await admitProductActivity(f.env, expired.id, 'connect');
  const setDay = async (account: string, product: 'connect' | 'desktop', offset: string) =>
   f.db.prepare("UPDATE product_activity SET last_day=date('now',?) WHERE subject=?")
    .bind(offset, await activitySubject(f.env, account, product)).run();
  await setDay(both.id, 'desktop', '-6 days');
  await setDay(connectOnly.id, 'connect', '-6 days');
  await setDay(expired.id, 'connect', '-7 days');
  await f.db.exec("INSERT INTO product_activity_history(day_utc,desktop_daily,as_of_ms) VALUES(date('now','-1 day'),1,0),(date('now','-30 days'),1,0)");
  await cleanupProductActivity(f.env);
  const history = async () => (await f.db.prepare(`
   SELECT desktop_daily,connect_daily,desktop_weekly,connect_weekly
   FROM reporting_product_activity_history ORDER BY day_utc
  `).all()).results;
  assert.deepEqual(await history(), [
   {desktop_daily:1,connect_daily:null,desktop_weekly:null,connect_weekly:null},
   {desktop_daily:2,connect_daily:1,desktop_weekly:3,connect_weekly:2},
  ]);
  await f.db.prepare('INSERT INTO aggregate_dau_exclusions(account_id) VALUES(?)').bind(both.id).run();
  await cleanupProductActivity(f.env);
  assert.deepEqual((await history()).at(-1), {
   desktop_daily:1,connect_daily:null,desktop_weekly:2,connect_weekly:1,
  });
 } finally {
  await f.close();
 }
});
test('upload cadence counts completed uploads once and uses the same eligible Connect cohort for both totals', async () => {
 const f = await setup(true);
 try {
  const uploader = await f.identity('cadence-uploader');
  const sharer = await f.identity('cadence-sharer');
  const excluded = await f.identity('cadence-excluded');
  const desktop = await f.identity('cadence-desktop');
  const history = async () => (await f.db.prepare(
   'SELECT completed_uploads,active_accounts FROM reporting_connect_upload_cadence ORDER BY day_utc',
  ).all()).results;
  const complete = async (capture: number, token: string, headers?: Record<string, string>) => {
   const path = '/v1/captures/' + id(capture);
   assert.equal((await f.call(path, { token, method: 'POST', body: { files: [file()] } })).status, 200);
   assert.equal((await f.call(path + '/files/summary.md', { token, method: 'PUT', raw: 'hello' })).status, 200);
   assert.equal((await f.call(path + '/complete', { token, method: 'POST', headers })).status, 200);
   return path;
  };
  const cron = async () => (await f.mf.getWorker()).scheduled();
  assert.deepEqual(await history(), [{ completed_uploads: null, active_accounts: null }]);
  await admitProductActivity(f.env, uploader.id, 'connect', {
   occurredAt: Date.now() - 86_400_000,
   completedUpload: true,
  });
  assert.deepEqual(await rows(f), []);
  await f.db.prepare('INSERT INTO aggregate_dau_exclusions(account_id) VALUES(?)').bind(excluded.id).run();
  const sharePath = await complete(951, sharer.token, { 'Sec-GPC': '1' });
  assert.equal((await f.call(sharePath + '/share', { token: sharer.token, method: 'POST' })).status, 200);
  await settled(f, 1);
  await cron();
  assert.deepEqual(await history(), [{ completed_uploads: 0, active_accounts: 1 }]);

  await f.db.exec("INSERT INTO product_activity_history(day_utc,as_of_ms,connect_uploads,connect_upload_accounts) VALUES(date('now','-1 day'),0,4,2)");
  await f.db.exec("UPDATE product_activity SET last_day=date('now','-1 day'),last_cadence_day=date('now','-1 day'),daily_uploads=4");
  await admitProductActivity(f.env, desktop.id, 'desktop');
  await complete(952, excluded.token);
  const [firstUpload] = await Promise.all([complete(953, uploader.token), complete(954, uploader.token)]);
  assert.equal((await f.call(firstUpload + '/complete', { token: uploader.token, method: 'POST' })).status, 200);
  const secondSharePath = await complete(955, sharer.token, { DNT: '1' });
  assert.equal((await f.call(secondSharePath + '/share', { token: sharer.token, method: 'POST' })).status, 200);
  const expected = [{ completed_uploads: 4, active_accounts: 2 }, { completed_uploads: 2, active_accounts: 2 }];
  for (let i = 0; i < 100; i++) {
   const observed = await rows(f);
   if (observed.length === 3 && observed.some(r => r.daily_uploads === 2) &&
    observed.some(r => r.product === 'connect' && r.daily_uploads === 0)) break;
   await new Promise(resolve => setTimeout(resolve, 10));
  }
  await cron();
  assert.deepEqual(await history(), expected);
  const schema = (await f.db.prepare('PRAGMA table_info(reporting_connect_upload_cadence)').all()).results;
  assert.deepEqual(schema.map(r => r.name), ['day_utc', 'completed_uploads', 'active_accounts']);

  await f.db.prepare('INSERT INTO aggregate_dau_exclusions(account_id) VALUES(?)').bind(uploader.id).run();
  await cron();
  assert.deepEqual(await history(), [expected[0], { completed_uploads: 0, active_accounts: 1 }]);
 } finally {
  await f.close();
 }
});
