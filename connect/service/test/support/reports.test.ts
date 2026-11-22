import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { digest, fixture } from '../helpers.mjs';

const reader = 'b'.repeat(64);
const recipient = 'age1'+'a'.repeat(58);
const config = { SUPPORT_REPORT_RECIPIENT: recipient, SUPPORT_REPORT_READ_TOKEN: reader, SHARING_ENABLED: 'true' };

test('signed-in reports stream beyond the former archive limit and remain available only to Support', async t => {
  const f = await fixture(config);
  t.after(f.close);
  const owner = await f.identity('reporter'), other = await f.identity('other');
  const id = 'd'.repeat(32), route = '/v1/support-reports/'+id;
  const media = [Buffer.alloc(34*1024*1024,37), Buffer.from('encrypted final part')];
  const files = media.map((bytes,index)=>({path:`support/part-${index}.age`,size:bytes.length,sha256:digest(bytes)}));
  const manifest = { files };
  const reserve = token => f.call(route+'/capture',{method:'POST',token,body:manifest});
  assert.equal((await f.call('/v1/support-reports/key')).status,401);
  assert.equal((await f.call('/v1/support-reports/key',{token:owner.read})).status,403);
  assert.deepEqual(await (await f.call('/v1/support-reports/key',{token:owner.token})).json(),{recipient});
  assert.equal((await reserve('c'.repeat(64))).status,401);
  assert.equal((await f.call(route,{method:'PUT',token:'c'.repeat(64),raw:media[1]})).status,404);
  assert.equal((await reserve(owner.token)).status,200);
  assert.equal((await reserve(other.token)).status,404);
  assert.equal((await f.call(route+'/archive',{token:reader})).status,404);
  for (const [index, file] of files.entries()) {
    assert.equal((await f.call(route+'/capture/files/'+file.path,{method:'PUT',token:owner.token,raw:media[index]})).status,200);
  }
  assert.equal((await f.call(route+'/capture/complete',{method:'POST',token:owner.token})).status,200);
  assert.equal((await f.call('/v1/captures/'+id,{token:owner.token})).status,404);
  assert.equal((await f.call('/v1/captures/'+id+'/share',{method:'POST',token:owner.token})).status,404);
  assert.equal((await f.call(route+'/archive',{token:owner.token})).status,401);
  const response = await f.call(route+'/archive',{token:reader});
  assert.deepEqual(await response.json(),{parts:files.map(({path,size})=>({name:path.slice('support/'.length),size}))});
  const stored = await f.call(route+'/archive/part-0.age',{token:reader});
  assert.equal(digest(Buffer.from(await stored.arrayBuffer())),files[0].sha256);
  await f.db.prepare('UPDATE captures SET expires_at=0 WHERE id=?').bind(id).run();
  assert.equal((await f.call(route+'/archive/part-0.age',{token:reader})).status,404);
});

test('reports and ordinary captures have independent allowances', async t => {
  const f = await fixture(config);
  t.after(f.close);
  const owner = await f.identity('reporter');
  const existing = '/v1/captures/'+'1'.repeat(32);
  const report = '/v1/support-reports/'+'2'.repeat(32)+'/capture';
  const reserve = (route, files) => f.call(route,{method:'POST',token:owner.token,body:{files}});
  const digestValue = 'a'.repeat(64);
  const files = Array.from({length:6},(_,index)=>({path:`frames/frame-${index}.png`,size:80_000_000,sha256:digestValue}));
  assert.equal((await reserve(existing,files)).status,200);
  const entry = {path:'support/part-0.age',size:37_000_000,sha256:digestValue};
  assert.equal((await reserve(report,[entry])).status,409);
  const migration = await readFile('.generated/migrations/0017.sql','utf8');
  await f.db.exec(migration.replaceAll('\n',' '));
  assert.equal((await reserve(report,[{...entry,path:'support/part-1.age'}])).status,400);
  assert.equal((await reserve(report,[entry])).status,200);
  const excess = '/v1/support-reports/'+'4'.repeat(32)+'/capture';
  assert.equal((await reserve(excess,files.map((part,index)=>({...part,path:`support/part-${index}.age`})))).status,409);
  const account = await f.call('/v1/account',{token:owner.token});
  assert.equal((await account.json()).usedBytes,480_000_000);
  const result = await f.call(existing,{token:owner.token});
  assert.equal((await result.json()).status,'pending');
  const next = '/v1/captures/'+'3'.repeat(32);
  assert.equal((await reserve(next,[{...entry,path:'recording.mp4'}])).status,200);
  assert.equal((await f.call(existing,{token:owner.token})).status,404);
  assert.equal((await f.db.prepare('SELECT status FROM captures WHERE id=?').bind('2'.repeat(32)).first())?.status,'pending');
});

test('Support can retrieve and expire previously submitted reports', async t => {
  const f = await fixture(config);
  t.after(f.close);
  const worker = await f.mf.getWorker();
  assert.equal((await worker.scheduled()).outcome,'ok');
  await f.db.exec((await readFile('.generated/migrations/0016.sql','utf8')).replaceAll('\n',' '));
  const id = 'd'.repeat(32);
  const bytes = Buffer.from('synthetic legacy ciphertext'), checksum = digest(bytes);
  const key = `support-reports/${id}/${checksum}.age`;
  await f.bucket.put(key,bytes);
  await f.db.prepare('INSERT INTO support_reports (id,upload_hash,digest,bytes,ready,expires_at) VALUES (?,?,?,?,1,?)')
    .bind(id,reader,checksum,bytes.length,Date.now()+60000).run();
  const route = '/v1/support-reports/'+id;
  const owner = await f.identity('reporter');
  assert.equal((await f.call(route+'/capture',{method:'POST',token:owner.token,body:{
    files:[{path:'support/part-0.age',size:bytes.length,sha256:checksum}],
  }})).status,409);
  assert.equal((await f.call(route+'/archive',{token:reader})).status,404);
  const response = await f.call(route,{token:reader});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  await f.db.prepare('UPDATE support_reports SET expires_at=0 WHERE id=?').bind(id).run();
  assert.equal((await f.call(route,{token:reader})).status,404);
  assert.equal((await worker.scheduled()).outcome,'ok');
  assert.equal(await f.bucket.head(key),null);
});
