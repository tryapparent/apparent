import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,id,file} from '../helpers.mjs';

// Manifest-only fixtures exercise byte reservations without allocating large R2 objects.
const sized = bytes => Array.from({length:Math.max(1,Math.ceil(bytes/90000000))},(_,i)=>({...file(`frames/frame-${i}.png`),size:Math.min(90000000,Math.max(0,bytes-i*90000000))}));
const reserve = (f,a,n,bytes) => f.call('/v1/captures/'+id(n),{token:a.token,method:'POST',body:{files:sized(bytes)}});
const rows = async f => (await f.db.prepare('SELECT id,account_id,bytes,status FROM captures ORDER BY rowid').all()).results;

test('exact quota boundary retains captures; overflow evicts the oldest prefix only, isolated by account',async()=>{
 const f=await fixture();try{
 const a=await f.identity('a'),b=await f.identity('b');
 // IDs deliberately disagree with reservation order.
 for(const [owner,n,bytes] of [[a,90,100000000],[b,1,500000000],[a,80,150000000],[a,70,250000000]]) assert.equal((await reserve(f,owner,n,bytes)).status,200);
 assert.ok((await rows(f)).every(c=>c.status==='pending'),'exactly 500MB must not evict');
 // Mix ready and pending: both reserve quota and both participate in age ordering.
 await f.db.prepare("UPDATE captures SET status='ready' WHERE id=?").bind(id(90)).run();
 assert.equal((await reserve(f,a,60,100000001)).status,200);
 assert.deepEqual((await rows(f)).map(c=>[c.id,c.status]),[[id(90),'deleted'],[id(1),'pending'],[id(80),'deleted'],[id(70),'pending'],[id(60),'pending']]);
 assert.equal((await(await f.call('/v1/account',{token:a.read})).json()).usedBytes,350000001);
 assert.equal((await(await f.call('/v1/account',{token:b.read})).json()).usedBytes,500000000);
 const before=await rows(f);
 assert.equal((await reserve(f,a,60,100000001)).status,200);
 assert.equal((await reserve(f,a,60,100000002)).status,409);
 assert.equal((await reserve(f,a,90,100000000)).status,404,'evicted retry cannot resurrect or evict again');
 assert.deepEqual(await rows(f),before);
 }finally{await f.close();}
});

test('oversized capture or file fails before any eviction, including retries',async()=>{
 const f=await fixture();try{
 const a=await f.identity('a');assert.equal((await reserve(f,a,1,500000000)).status,200);
 const before=await rows(f);
 let r=await reserve(f,a,2,500000001);assert.equal(r.status,409);assert.equal((await r.json()).error.code,'quota_exceeded');
 for(const n of [1,3]){
  r=await f.call('/v1/captures/'+id(n),{token:a.token,method:'POST',body:{files:[{...file(),size:90000001}]}});
  assert.equal(r.status,400);assert.equal((await r.json()).error.code,'file_too_large');
 }
 assert.deepEqual(await rows(f),before);
 }finally{await f.close();}
});

test('concurrent reservations keep newest, and concurrent identical retries cannot evict it',async()=>{
 const f=await fixture();try{
 const a=await f.identity('a');
 const responses=await Promise.all([1,2,3,4].map(n=>reserve(f,a,n,270000000)));
 assert.ok(responses.every(r=>[200,404].includes(r.status)),'a successful reservation may be evicted before its response');
 const captures=await rows(f),newest=captures.at(-1);
 assert.equal(captures.length,4);assert.deepEqual(captures.map(c=>c.status),['deleted','deleted','deleted','pending']);
 assert.equal((await(await f.call('/v1/account',{token:a.read})).json()).usedBytes,270000000);
 const old=captures[0];
 const retries=await Promise.all(Array.from({length:6},()=>f.call('/v1/captures/'+old.id,{token:a.token,method:'POST',body:{files:sized(270000000)}})));
 assert.ok(retries.every(r=>r.status===404));
 const same=await Promise.all(Array.from({length:6},()=>f.call('/v1/captures/'+newest.id,{token:a.token,method:'POST',body:{files:sized(270000000)}})));
 assert.ok(same.every(r=>r.status===200));assert.deepEqual(await rows(f),captures);
 // Race first reservation of an identical ID: only one insertion/eviction occurs.
 const duplicate=await Promise.all(Array.from({length:6},()=>reserve(f,a,5,270000000)));
 assert.ok(duplicate.every(r=>r.status===200));
 const final=await rows(f);assert.equal(final.length,5);assert.deepEqual(final.map(c=>c.status),['deleted','deleted','deleted','deleted','pending']);
 }finally{await f.close();}
});

test('eviction tombstones block an in-flight upload and cleanup revisits late objects',async()=>{
 const f=await fixture();let controller;try{
 const a=await f.identity('a'),p='/v1/captures/'+id(1);
 assert.equal((await f.call(p,{token:a.token,method:'POST',body:{files:[file()]}})).status,200);
 const stream=new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('he'));}});
 const upload=f.mf.dispatchFetch('https://api.example'+p+'/files/summary.md',{method:'PUT',headers:{Authorization:'Bearer '+a.token},body:stream,duplex:'half'});
 let attempt;for(let i=0;i<100;i++){attempt=await f.db.prepare('SELECT key FROM attempts WHERE capture_id=?').bind(id(1)).first();if(attempt)break;await delay(10);}assert.ok(attempt);
 assert.equal((await reserve(f,a,2,500000000)).status,200);
 assert.equal((await f.call(p,{token:a.read})).status,404);
 const worker=await f.mf.getWorker();await worker.scheduled();
 controller.enqueue(new TextEncoder().encode('llo'));controller.close();controller=null;
 assert.equal((await upload).status,404);
 assert.equal((await f.call(p+'/complete',{token:a.token,method:'POST'})).status,404);
 assert.equal((await f.call(p+'/files/summary.md',{token:a.read})).status,404);
 assert.equal((await f.db.prepare('SELECT object_key FROM files WHERE capture_id=?').bind(id(1)).first()).object_key,null);
 await worker.scheduled();assert.equal((await f.bucket.list()).objects.length,0);
 // Model a late R2 completion even after a prior sweep; attempt tombstones persist.
 await f.bucket.put(attempt.key,'hello');await worker.scheduled();
 assert.equal(await f.bucket.get(attempt.key),null);
 assert.equal((await f.db.prepare('SELECT status FROM captures WHERE id=?').bind(id(1)).first()).status,'deleted');
 }finally{if(controller)controller.close();await f.close();}
});
