import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { digest, fixture } from '../helpers.mjs';

test('support reports accept one anonymous encrypted upload and require a support reader', async t => {
 const reader='b'.repeat(64), writer='c'.repeat(64), id='d'.repeat(32);
 const f=await fixture({SUPPORT_REPORT_RECIPIENT:'age1'+'a'.repeat(58),SUPPORT_REPORT_READ_TOKEN:reader});
 t.after(f.close);
 await f.db.exec((await readFile('.generated/migrations/0016.sql','utf8')).replaceAll('\n',' '));
 const route='/v1/support-reports/'+id;
 const content=Buffer.concat([Buffer.from('age-encryption.org/v1\n'),Buffer.alloc(60,37)]);
 const upload=(bytes=content,token=writer)=>f.call(route,{method:'PUT',token,raw:bytes,headers:{
  'Content-Length':String(bytes.length),'X-Ciphertext-SHA256':digest(bytes),
 }});
 assert.equal((await f.call('/v1/support-reports/key')).status,200);
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
});
