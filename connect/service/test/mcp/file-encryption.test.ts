import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fixture,id,file} from '../helpers.mjs';

test('v2 constraint migration preserves existing captures, file ownership, sequence and budgets',async()=>{
  const f=await fixture({}, {v2Migration:false});try{
    const account=await f.identity('migration-v2');
    for(const [n,format] of [[1,'plaintext-v1'],[2,'apparent-encrypted-v1']] as const){
      const files=format==='plaintext-v1'?[file()]:[file('envelope.json','envelope'),file('sealed/part-000000.age','ciphertext')];
      assert.equal((await f.call('/v1/captures/'+id(n),{token:account.token,method:'POST',body:{format,files}})).status,200);
    }
    const before=(await f.db.prepare('SELECT * FROM captures ORDER BY reservation_seq').all()).results;
    const budget=await f.db.prepare('SELECT * FROM r2_budget').first();
    const files=(await f.db.prepare('SELECT * FROM files ORDER BY capture_id,path').all()).results;
    await f.db.exec((await readFile('.generated/migrations/0011.sql','utf8')).replace(/^--.*$/gm,'').replaceAll('\n',' '));
    assert.deepEqual((await f.db.prepare('SELECT * FROM captures ORDER BY reservation_seq').all()).results,before);
    assert.deepEqual((await f.db.prepare('SELECT * FROM files ORDER BY capture_id,path').all()).results,files);
    assert.deepEqual(await f.db.prepare('SELECT * FROM r2_budget').first(),budget);
    assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    const transport=[file('envelope.json','descriptor'),file('sealed/index.age','index'),file('sealed/file-000000.age','asset')];
    assert.equal((await f.call('/v1/captures/'+id(3),{token:account.token,method:'POST',body:{format:'apparent-encrypted-v2',files:transport}})).status,200);
    const created=await f.db.prepare('SELECT reservation_seq,format FROM captures WHERE id=?').bind(id(3)).first();
    assert.equal(created.format,'apparent-encrypted-v2');assert.ok(created.reservation_seq>before[1].reservation_seq);
    assert.equal((await f.call('/v1/captures/'+id(3),{token:account.read})).status,200);
    assert.equal((await f.call('/v1/captures/'+id(3),{token:(await f.identity('other-v2')).read})).status,404);
    assert.equal((await f.call('/v1/captures/'+id(3)+'/files/sealed/index.age',{token:account.read})).status,409,'pending captures stay private');
    assert.equal((await f.call('/v1/captures/'+id(3)+'/share',{token:account.token,method:'POST'})).status,409);
  }finally{await f.close();}
});

test('v2 admission rejects mixed, missing, sparse or duplicate objects without reserving quota',async()=>{
  const f=await fixture();try{
    const a=await f.identity('invalid-v2');
    const valid=[file('envelope.json'),file('sealed/index.age'),file('sealed/file-000000.age')];
    for(const files of [valid.slice(1),[...valid,file('summary.md')],[...valid,file('sealed/file-000002.age')],[...valid,valid[2]]]){
      assert.equal((await f.call('/v1/captures/'+id(7),{token:a.token,method:'POST',body:{format:'apparent-encrypted-v2',files}})).status,400);
      assert.equal((await f.db.prepare('SELECT count(*) n FROM captures').first()).n,0);
    }
  }finally{await f.close();}
});

 test('staged migration artifacts retain exact D1 ledger filenames and historical SQL bytes',async()=>{
  assert.deepEqual((await readdir('.generated/migrations')).sort(),Array.from({length:11},(_,i)=>String(i+1).padStart(4,'0')+'.sql'));
  for(let i=1;i<=11;i++){const name=String(i).padStart(4,'0')+'.sql';assert.deepEqual(await readFile('.generated/migrations/'+name),await readFile('migrations/'+(i<=5?'baseline/':'')+name));}
});
