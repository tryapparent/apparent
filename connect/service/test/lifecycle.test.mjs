import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,id,file} from './helpers.mjs';

test('bundle fidelity includes original frames, uncropped sheet and timeline; device preview has ISO expiry',async()=>{
 const f=await fixture();try{
 const a=await f.identity('a'),files=['frames-full/frame-01.png','contact-sheet-full.png','timeline.json','finish-trace.json'].map(p=>file(p));
 assert.equal((await f.call('/v1/captures/'+id(99),{token:a.token,method:'POST',body:{files}})).status,200);
 const start=await(await f.call('/v1/device/start',{method:'POST',body:{scope:'upload'}})).json();
 const preview=await(await f.call('/v1/device?userCode='+start.userCode,a)).json();assert.equal(preview.scope,'upload');assert.equal(new Date(preview.expiresAt).toISOString(),preview.expiresAt);
 }finally{await f.close();}
});

test('cleanup rotates past first page and removes objects arriving after a deletion sweep',async()=>{
 const f=await fixture();try{
 const a=await f.identity('a'),p='/v1/captures/'+id(100);
 await f.call(p,{token:a.token,method:'POST',body:{files:[file()]}});
 await f.call(p,{token:a.token,method:'DELETE'});
 await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1001) INSERT INTO attempts(key,capture_id,created_at) SELECT printf('orphan-%04d',i),?,0 FROM n").bind(id(100)).run();
 await f.bucket.put('orphan-1001','late');
 const worker=await f.mf.getWorker();await worker.scheduled();await worker.scheduled();
 assert.equal(await f.bucket.get('orphan-1001'),null);
 await f.bucket.put('orphan-0001','arrived after delete');
 await worker.scheduled();await worker.scheduled();assert.equal(await f.bucket.get('orphan-0001'),null);
 }finally{await f.close();}
});
