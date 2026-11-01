import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,digest,id,file} from '../helpers.mjs';
const settings={POSTHOG_ENABLED:'true',POSTHOG_PROJECT_TOKEN:'phc_synthetic',POSTHOG_HOST:'https://eu.i.posthog.com',POSTHOG_ENVIRONMENT:'synthetic'};
async function setup(bindings={}) {
 const provider={status:200,bodies:[]};
 const f=await fixture({...settings,...bindings},{outboundService:async request=>{
  assert.equal(request.url,'https://eu.i.posthog.com/batch/');
  provider.bodies.push(await request.json());
  return Response.json({status:1},{status:provider.status});
 }});
 await f.db.exec((await readFile('migrations/0004.sql','utf8')).replaceAll('\n',' '));
 return {...f,provider};
}
const queued=async f=>(await f.db.prepare('SELECT * FROM analytics_outbox ORDER BY id').all()).results;
const sessionId=async(f,a)=>(await(await f.call('/v1/session',{cookie:a.cookie})).json()).account.analyticsId;
const sweep=async f=>assert.equal((await(await f.mf.getWorker()).scheduled()).outcome,'ok');
async function upload(f,a,n,text='private evidence') {
 const path='/v1/captures/'+id(n);
 assert.equal((await f.call(path,{token:a.token,method:'POST',body:{files:[file('summary.md',text)]}})).status,200);
 assert.equal((await f.call(path+'/files/summary.md',{token:a.token,method:'PUT',raw:text})).status,200);
 return path;
}
test('optional analytics: atomic distinct accounts, concurrent/idempotent completion and allowlisted delivery',async()=>{
 const f=await setup();try{
 assert.equal((await f.db.prepare('SELECT enabled FROM analytics_control').first()).enabled,0);
 const excluded=await f.identity(digest('collection disabled'));
 assert.equal(await sessionId(f,excluded),null);assert.deepEqual(await queued(f),[]);
 await f.db.exec('UPDATE analytics_control SET enabled=1');
 const a=await f.identity(digest('first')),b=await f.identity(digest('second'));
 assert.equal(await sessionId(f,a),'account:'+a.id);
 const device=await(await f.call('/v1/device/start',{method:'POST',body:{scope:'upload'}})).json();
 for(let i=0;i<2;i++)await f.call('/v1/device/approve',{cookie:a.cookie,csrf:a.csrf,origin:a.origin,method:'POST',body:{userCode:device.userCode}});
 const paths=await Promise.all([upload(f,a,1),upload(f,b,2,'a second private recording')]);
 await Promise.all(Array.from({length:4},()=>f.call(paths[0]+'/complete',{token:a.token,method:'POST'})));
 assert.equal((await f.call(paths[1]+'/complete',{token:b.token,method:'POST'})).status,200);
 assert.equal((await f.call(paths[0]+'/complete',{token:a.token,method:'POST'})).status,200);
 const before=await queued(f);assert.equal(before.filter(r=>r.event==='connect_upload_completed').length,2);
 assert.equal(before.filter(r=>r.event==='connect_account_created').length,2);
 assert.equal(before.filter(r=>r.event==='connect_device_connected').length,1);
 await sweep(f);
 const sent=f.provider.bodies[0];assert.ok(sent,'the real worker must contact the synthetic provider');
 assert.equal((await queued(f)).length,0);
 const uploads=sent.batch.filter(e=>e.event==='connect_upload_completed');
 assert.equal(uploads.length,2);assert.equal(new Set(uploads.map(e=>e.properties.distinct_id)).size,2);
 for(const event of uploads){assert.equal(event.properties.actor,'device');assert.equal(event.properties.environment,'synthetic');assert.match(event.uuid,/^[a-f0-9-]{36}$/);}
 assert.equal(sent.batch.filter(e=>e.event==='connect_storage_snapshot').length,3);
 const snapshot=sent.batch.find(e=>e.event==='connect_storage_snapshot'&&e.properties.distinct_id==='account:'+a.id);
 assert.equal(snapshot.properties.retained_bytes,Buffer.byteLength('private evidence'));assert.equal(snapshot.properties.retained_recordings,1);
 const serialized=JSON.stringify(sent);for(const secret of ['private evidence','a second private recording',a.token,a.cookie,'@example.com','summary.md',id(1),'https://api.example'])assert.ok(!serialized.includes(secret),secret);
 await sweep(f);assert.deepEqual(await queued(f),[]);assert.equal(f.provider.bodies.length,1);
 }finally{await f.close();}
});
test('provider failures preserve identical event identity; retries, deletion and expired reservations do not inflate storage',async()=>{
 const f=await setup();try{
 await f.db.exec('UPDATE analytics_control SET enabled=1');
 const a=await f.identity(digest('retry')),path=await upload(f,a,3,'hello');
 await f.call(path+'/complete',{token:a.token,method:'POST'});
 f.provider.status=503;await sweep(f);assert.ok((await queued(f)).length>0);
 await upload(f,a,4,'pending');await f.db.prepare('UPDATE captures SET pending_until=0 WHERE id=?').bind(id(4)).run();
 assert.equal((await f.call('/v1/account',{token:a.token})).status,200);
 f.provider.status=200;await sweep(f);assert.equal(f.provider.bodies.length,2);assert.deepEqual(f.provider.bodies[1],f.provider.bodies[0]);assert.deepEqual(await queued(f),[]);
 await f.call(path,{token:a.token,method:'DELETE'});
 await f.db.exec('UPDATE analytics_control SET snapshot_day=-1');
 await sweep(f);const snapshot=f.provider.bodies.at(-1).batch.find(e=>e.event==='connect_storage_snapshot');
 assert.equal(snapshot.properties.retained_bytes,0);assert.equal(snapshot.properties.pending_reserved_bytes,0);
 }finally{await f.close();}
});
test('collection remains bounded during outages and overflow is explicit, not a product failure',async()=>{
 const f=await setup();try{
 await f.db.exec("UPDATE analytics_control SET enabled=1; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO analytics_outbox(id,account_id,event,occurred_at) SELECT 'fill:'||x,'synthetic','connect_account_created',1 FROM n;");
 const a=await f.identity(digest('overflow'));
 assert.equal((await queued(f)).length,10000);assert.equal((await f.db.prepare('SELECT dropped FROM analytics_control').first()).dropped,1);
 assert.equal((await f.call('/v1/account',{token:a.token})).status,200);
 }finally{await f.close();}
});
test('excluded accounts cannot be linked or exported; disabled/invalid delivery never contacts provider',async()=>{
 const excluded=digest('excluded');
 for(const bindings of [{POSTHOG_EXCLUDED_ACCOUNT_IDS:excluded},{POSTHOG_ENABLED:'false'},{POSTHOG_HOST:'https://us.i.posthog.com'}]){
  const f=await setup(bindings);try{
   await f.db.exec('UPDATE analytics_control SET enabled=1');const a=await f.identity(excluded);
   assert.equal(await sessionId(f,a),null);await sweep(f);assert.equal(f.provider.bodies.length,0);
  }finally{await f.close();}
 }
});
