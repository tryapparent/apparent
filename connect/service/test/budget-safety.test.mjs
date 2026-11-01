import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,id,file} from './helpers.mjs';

// The injected SQL failure occurs inside the real D1 batch, after the insert
// trigger has run; no mock transaction can substitute for rollback evidence.
test('failed set insertion rolls back the capture, all files and quota eviction',async()=>{
 const f=await fixture();try{
 const a=await f.identity('rollback'),old=id(400),next=id(401);
 const files=Array.from({length:512},(_,i)=>({...file(`frames/frame-${i}.png`,''),size:i<5?90000000:i===5?50000000:0}));
 assert.equal((await f.call('/v1/captures/'+old,{token:a.token,method:'POST',body:{files}})).status,200);
 await f.db.exec("CREATE TRIGGER fail_file BEFORE INSERT ON files WHEN NEW.path='frames/frame-99.png' BEGIN SELECT RAISE(ABORT,'injected file failure'); END;");
 const r=await f.call('/v1/captures/'+next,{token:a.token,method:'POST',body:{files}});assert.equal(r.status,500);
 assert.deepEqual((await f.db.prepare('SELECT id,status FROM captures').all()).results,[{id:old,status:'pending'}]);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM files').first()).n,512);
 await f.db.exec('DROP TRIGGER fail_file');
 assert.equal((await f.call('/v1/captures/'+next,{token:a.token,method:'POST',body:{files}})).status,200);
 assert.equal((await f.db.prepare('SELECT status FROM captures WHERE id=?').bind(old).first()).status,'deleted');
 }finally{await f.close();}
});

test('cleanup distinguishes live linked objects, young uploads, old orphans and expired pending captures',async()=>{
 const f=await fixture();try{
 const a=await f.identity('orphans'),capture=id(410),pending=id(411);
 for(const c of [capture,pending])assert.equal((await f.call('/v1/captures/'+c,{token:a.token,method:'POST',body:{files:[file()]}})).status,200);
 await f.db.prepare("UPDATE captures SET status='ready' WHERE id=?").bind(capture).run();
 await f.db.prepare('UPDATE captures SET pending_until=0 WHERE id=?').bind(pending).run();
 for(const [key,c,created] of [['linked',capture,0],['young',capture,Date.now()],['old',capture,0],['pending',pending,Date.now()]]){
  await f.db.prepare('INSERT INTO attempts(key,capture_id,created_at) VALUES(?,?,?)').bind(key,c,created).run();
  await f.bucket.put(key,'hello');
 }
 await f.db.prepare("UPDATE files SET object_key='linked' WHERE capture_id=?").bind(capture).run();
 assert.equal((await(await f.mf.getWorker()).scheduled()).outcome,'ok');
 assert.deepEqual((await f.bucket.list()).objects.map(o=>o.key),['linked','young']);
 assert.equal((await f.db.prepare('SELECT status FROM captures WHERE id=?').bind(pending).first()).status,'deleted');
 assert.equal((await f.db.prepare("SELECT cleaned_at FROM attempts WHERE key='young'").first()).cleaned_at,0);
 // Age the abandoned upload: the next sweep must eventually remove it too.
 await f.db.prepare("UPDATE attempts SET created_at=0 WHERE key='young'").run();
 assert.equal((await(await f.mf.getWorker()).scheduled()).outcome,'ok');
 assert.deepEqual((await f.bucket.list()).objects.map(o=>o.key),['linked']);
 }finally{await f.close();}
});
