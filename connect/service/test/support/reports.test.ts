import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { digest, fixture } from '../helpers.mjs';

test('support reports accept one anonymous encrypted upload and require a support reader', async t => {
 const reader='b'.repeat(64), writer='c'.repeat(64), id='d'.repeat(32);
 const f=await fixture({SUPPORT_REPORT_RECIPIENT:'age1'+'a'.repeat(58),SUPPORT_REPORT_READ_TOKEN:reader});
 t.after(f.close);
 const worker=await f.mf.getWorker();
 assert.equal((await worker.scheduled()).outcome,'ok');
 await f.db.exec((await readFile('.generated/migrations/0016.sql','utf8')).replaceAll('\n',' '));
 const route='/v1/support-reports/'+id;
 const content=Buffer.concat([Buffer.from('age-encryption.org/v1\n'),Buffer.alloc(60,37)]);
 const upload=(bytes=content,token=writer)=>f.call(route,{method:'PUT',token,raw:bytes,headers:{
  'Content-Length':String(bytes.length),'X-Ciphertext-SHA256':digest(bytes),
 }});
 assert.equal((await (await f.call('/v1/support-reports/key?archive=2')).json()).maxBytes,24*1024*1024);
 assert.equal((await f.call(route)).status,401);
 assert.equal((await f.call(route,{token:reader})).status,404);
 assert.deepEqual(await (await upload()).json(),{id,ready:true});
 assert.deepEqual(await (await upload()).json(),{id,ready:true});
 assert.equal((await upload(content,'e'.repeat(64))).status,409);
 assert.equal((await f.call(route,{token:writer})).status,401);
 const response=await f.call(route,{token:reader});
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),content);
 await f.db.prepare('UPDATE support_reports SET expires_at=0 WHERE id=?').bind(id).run();
 assert.equal((await f.call(route,{token:reader})).status,404);
 assert.equal((await worker.scheduled()).outcome,'ok');
 assert.equal(await f.bucket.head(`support-reports/${id}/${digest(content)}.age`),null);
 assert.equal(await f.db.prepare('SELECT id FROM support_reports WHERE id=?').bind(id).first(),null);
});

test('extended support archives admit the recorded bundle size while preserving the older client contract', async t => {
 const recipient='age1'+'a'.repeat(58),reader='b'.repeat(64),writer='c'.repeat(64),id='d'.repeat(32);
 const f=await fixture({SUPPORT_REPORT_RECIPIENT:recipient,SUPPORT_REPORT_READ_TOKEN:reader,SUPPORT_REPORT_EXTENDED_ARCHIVES:'1'});
 t.after(f.close);
 await f.db.exec((await readFile('.generated/migrations/0016.sql','utf8')).replaceAll('\n',' '));
 const key='/v1/support-reports/key';
 assert.deepEqual(await (await f.call(key)).json(),{recipient,maxBytes:24*1024*1024});
 assert.deepEqual(await (await f.call(key+'?archive=2')).json(),{recipient,maxBytes:32*1024*1024});
 const content=Buffer.alloc(29*1024*1024,37);
 content.write('age-encryption.org/v1\n');
 const checksum=digest(content);
 const route='/v1/support-reports/'+id;
 const upload=await f.call(route,{method:'PUT',token:writer,raw:content,headers:{
  'Content-Length':String(content.length),'X-Ciphertext-SHA256':checksum,
 }});
 assert.deepEqual(await upload.json(),{id,ready:true});
 const response=await f.call(route,{token:reader});
 assert.equal(response.status,200);
 assert.equal(digest(Buffer.from(await response.arrayBuffer())),checksum);
});
