import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fixture,id,file} from '../helpers.mjs';

// Count SQL statements, NOT merely batch RPCs. This is an audit seam around
// real D1/R2, not an emulation of Cloudflare's remote CPU or billing enforcement.
const instrumented=await build({stdin:{resolveDir:process.cwd(),contents:`
 import worker from './src/worker.ts';
 let failedDelete=false,failedStamp=false,deletePages=0,stampPages=0;
 function counted(env,counts){
  const DB={prepare(sql){const wrap=s=>({bind(...args){if(args.length>100)throw new Error('D1 parameter budget exceeded');return wrap(s.bind(...args));},
   first(...args){counts.sql++;return s.first(...args);},all(...args){counts.sql++;return s.all(...args);},run(...args){counts.sql++;return s.run(...args);},sql,raw:s});return wrap(env.DB.prepare(sql));},
   async batch(items){counts.sql+=items.length;if(items.some(s=>s.sql.startsWith('UPDATE attempts SET cleaned_at'))){stampPages++;if(env.FAIL_STAMP&&!failedStamp&&stampPages===Number(env.FAIL_AT||1)){failedStamp=true;throw new Error('injected stamp failure');}}const result=await env.DB.batch(items.map(s=>s.raw));if(env.LOSE_PUBLICATION_ACK&&items.some(s=>s.sql.startsWith('UPDATE files SET object_key')))throw new Error('lost publication receipt');return result;}};
  const BUCKET=new Proxy(env.BUCKET,{get(target,key){const value=target[key];return typeof value==='function'? async(...args)=>{counts.r2++;if(key==='delete'){if(env.PERSISTENT_DELETE_FAILURE&&args[0].includes('persistent-0150'))throw Error('persistent deletion failure');deletePages++;if(env.FAIL_DELETE&&!failedDelete&&deletePages===Number(env.FAIL_AT||1)){failedDelete=true;throw new Error('injected delete failure');}}const result=await value.apply(target,args);if(key==='put'&&env.TOMBSTONE_AFTER_PUT)await env.DB.prepare("UPDATE captures SET status='deleted'").run();return result;}:value;}});
  return {...env,DB,BUCKET};
 }
 export default {
  async fetch(request,env){const counts={sql:0,r2:0};const response=await worker.fetch(request,counted(env,counts));if(counts.sql>50||counts.sql+counts.r2>1000)throw new Error('request exceeds Free budget: '+JSON.stringify(counts));response.headers.set('X-Test-SQL',String(counts.sql));response.headers.set('X-Test-R2',String(counts.r2));return response;},
  async scheduled(controller,env){const counts={sql:0,r2:0};try{await worker.scheduled(controller,counted(env,counts));}finally{console.log('cleanup operations: '+JSON.stringify(counts));if(counts.sql>50||counts.sql+counts.r2>1000)throw new Error('cleanup exceeds Free budget: '+JSON.stringify(counts));}}
 };`},bundle:true,format:'esm',platform:'browser',conditions:['workerd'],external:['node:*'],write:false});

test('512-file admission/completion stay within Free statement and internal-service budgets',async()=>{
 const f=await fixture({}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
 const a=await f.identity('budget'),capture=id(310),p='/v1/captures/'+capture;
 const files=Array.from({length:512},(_,i)=>file(`frames/frame-${i}.png`,''));
 const admission=await f.call(p,{token:a.token,method:'POST',body:{files}});
 assert.equal(admission.status,200);
 console.log('admission SQL:',admission.headers.get('X-Test-SQL'));
 assert.ok(Number(admission.headers.get('X-Test-SQL'))<=50,'512-file admission must fit 50 SQL statements');
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM files WHERE capture_id=?').bind(capture).first()).n,512);
 // Supply real R2 checksums for every entry, then exercise all 512 head calls.
 for(let i=0;i<files.length;i++){
  const key='budget-'+i;await f.bucket.put(key,'',{sha256:files[i].sha256});
  await f.db.prepare('UPDATE files SET object_key=? WHERE capture_id=? AND path=?').bind(key,capture,files[i].path).run();
 }
 const complete=await f.call(p+'/complete',{token:a.token,method:'POST'});
 assert.equal(complete.status,200);
 assert.equal(Number(complete.headers.get('X-Test-R2')),512);
 assert.equal(Number(complete.headers.get('X-Test-SQL')),6);
 assert.ok(512+6<1000,'internal service budget is not the external 50-fetch budget');
 for(const [suffix,options] of [['/complete',{method:'POST'}],['',{}],['/files/frames/frame-0.png',{}],['/files/frames/frame-0.png',{method:'PUT',raw:''}],['',{method:'DELETE'}],['',{method:'POST',body:{files}}]]){
  const r=await f.call(p+suffix,{token:a.token,...options});
  assert.equal(r.status,options.body?404:200);assert.ok(Number(r.headers.get('X-Test-SQL'))<=50);
  await r.arrayBuffer();
 }
 }finally{await f.close();}
});

test('full 1000-attempt cleanup stays within Free statement and internal-service budgets',async()=>{
 const f=await fixture({}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
 const a=await f.identity('cleanup'),capture=id(311),p='/v1/captures/'+capture;
 assert.equal((await f.call(p,{token:a.token,method:'POST',body:{files:[file()]}})).status,200);
 await f.call(p,{token:a.token,method:'DELETE'});
 await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO attempts(key,capture_id,created_at) SELECT printf('budget-%d',i-1),?,0 FROM n").bind(capture).run();
 await f.bucket.put('budget-999','orphan');
 const scheduled=await(await f.mf.getWorker()).scheduled();
 assert.equal(scheduled.outcome,'ok','cleanup must fit 50 SQL statements: '+JSON.stringify(scheduled));
 assert.equal((await f.bucket.list()).objects.length,0);
 }finally{await f.close();}
});

test('full manifests and oldest-prefix eviction keep a constant statement budget across 20 accounts',async()=>{
 const f=await fixture({}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
 const owners=[];
 for(let n=0;n<20;n++)owners.push(await f.identity('owner-'+n));
 const oldFiles=Array.from({length:512},(_,i)=>({...file(`frames/frame-${i}.png`,''),size:i===0?8000000:0}));
 // Zero-byte entries mean there is no finite capture/attempt count implied
 // by the byte quota. Exercise >50 captures per account and set-based SQL.
 for(let n=0;n<20;n++){
  const manifest=JSON.stringify(n===0?oldFiles:[{...file(),size:8000000}]);
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<60) INSERT INTO captures(id,account_id,manifest,bytes,expires_at,pending_until) SELECT printf('%032x',?+i),?,?,8000000,?,? FROM n").bind(n*60,owners[n].id,manifest,Date.now()+86400000,Date.now()+86400000).run();
  await f.db.prepare("INSERT INTO files(capture_id,path,size,sha256) SELECT c.id,json_extract(j.value,'$.path'),json_extract(j.value,'$.size'),json_extract(j.value,'$.sha256') FROM captures c,json_each(c.manifest) j WHERE c.account_id=?").bind(owners[n].id).run();
 }
 const files=oldFiles.map((f,i)=>({...f,size:i===0?90000000:0})),p='/v1/captures/'+id(9999),opts={token:owners[0].token,method:'POST',body:{files}};
 for(const [request,expected] of [[opts,200],[opts,200],[{...opts,body:{files:[file()]}},409]]){
  const r=await f.call(p,request);assert.equal(r.status,expected);assert.ok(Number(r.headers.get('X-Test-SQL'))<=50);
 }
 const deleted=(await f.db.prepare("SELECT id,account_id FROM captures WHERE status='deleted' ORDER BY reservation_seq").all()).results;
 assert.deepEqual(deleted,Array.from({length:9},(_,i)=>({id:id(i+1),account_id:owners[0].id})));
 const r=await f.call('/v1/account',{token:owners[0].read});assert.equal((await r.json()).usedBytes,498000000);assert.ok(Number(r.headers.get('X-Test-SQL'))<=50);
 // Expire every reservation; cleanup must not execute per capture/file/account.
 await f.db.prepare('UPDATE captures SET expires_at=0').run();
 await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2001) INSERT INTO attempts(key,capture_id,created_at) SELECT printf('multi-%04d',i),printf('%032x',(i%1200)+1),0 FROM n").run();
 await f.bucket.put('multi-2001','last page');
 const worker=await f.mf.getWorker();
 for(let i=0;i<3;i++)assert.equal((await worker.scheduled()).outcome,'ok');
 assert.equal(await f.bucket.head('multi-2001'),null);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM captures WHERE status!='deleted'").first()).n,0);
 assert.ok((await f.db.prepare('SELECT count(*) AS n FROM attempts WHERE cleaned_at>0').first()).n<=3,'only page cursor markers are written');
 await f.bucket.put('multi-0001','late');
 for(let i=0;i<3;i++)assert.equal((await worker.scheduled()).outcome,'ok');
 assert.equal(await f.bucket.head('multi-0001'),null);
 }finally{await f.close();}
});

for(const failure of ['FAIL_DELETE','FAIL_STAMP'])test(failure+' preserves cleanup rotation for retry',async()=>{
 const f=await fixture({[failure]:true}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
 const a=await f.identity('failure'),capture=id(402);
 await f.call('/v1/captures/'+capture,{token:a.token,method:'POST',body:{files:[file()]}});
 await f.call('/v1/captures/'+capture,{token:a.token,method:'DELETE'});
 await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1001) INSERT INTO attempts(key,capture_id,created_at,terminal) SELECT printf('failure-%04d',i),?,0,1 FROM n").bind(capture).run();
 await f.bucket.put('failure-0001','orphan');await f.bucket.put('failure-1001','later page');
 const worker=await f.mf.getWorker();assert.equal((await worker.scheduled()).outcome,'exception');
 assert.equal((await f.db.prepare('SELECT max(cleaned_at) AS latest FROM attempts').first()).latest,0);
 if(failure==='FAIL_DELETE')assert.ok(await f.bucket.head('failure-0001'));
 else assert.equal(await f.bucket.head('failure-0001'),null);
 for(let i=0;i<2;i++)assert.equal((await worker.scheduled()).outcome,'ok');
 assert.equal((await f.bucket.list()).objects.length,0);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM attempts WHERE cleaned_at=0').first()).n,0);
 // A genuinely uncertain attempt can recreate its own key; retired keys cannot.
 await f.db.prepare("INSERT INTO attempts(key,capture_id,created_at) VALUES('failure-late',?,0)").bind(capture).run();
 await f.bucket.put('failure-late','late');
 assert.equal((await worker.scheduled()).outcome,'ok');
 assert.equal(await f.bucket.head('failure-late'),null);
 }finally{await f.close();}
});

test('PUT success, duplicate, checksum failure, cap denial and lost-publication failure have bounded SQL',async()=>{
 for(const tombstone of [false,true]){
 const f=await fixture({TOMBSTONE_AFTER_PUT:tombstone}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
 const a=await f.identity('put-budget'),p='/v1/captures/'+id(312);
 await f.call(p,{token:a.token,method:'POST',body:{files:[file()]}});
 const upload=raw=>f.call(p+'/files/summary.md',{token:a.token,method:'PUT',raw});
 const first=await upload('hello');
 console.log('PUT first/lost publication:',first.status,first.headers.get('X-Test-SQL'),first.headers.get('X-Test-R2'));
 assert.equal(first.status,tombstone?404:200);assert.equal(Number(first.headers.get('X-Test-SQL')),tombstone?11:6);assert.equal(Number(first.headers.get('X-Test-R2')),tombstone?3:1);
 if(!tombstone){
  for(const [raw,status,sql] of [['hello',200,8],['wrong',400,7]]){const r=await upload(raw);console.log('PUT retry:',r.status,r.headers.get('X-Test-SQL'),r.headers.get('X-Test-R2'));assert.equal(r.status,status);assert.equal(Number(r.headers.get('X-Test-SQL')),sql);assert.equal(Number(r.headers.get('X-Test-R2')),2);}
  await f.db.prepare('UPDATE r2_budget SET a_cap=a_used').run();const r=await upload('hello');assert.equal(r.status,503);assert.equal(Number(r.headers.get('X-Test-SQL')),5);assert.equal(Number(r.headers.get('X-Test-R2')),0);
 }
 }finally{await f.close();}
 }
});

test('a lost publication receipt keeps the committed object available',async()=>{
 const f=await fixture({LOSE_PUBLICATION_ACK:true}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
  for(const migration of ['0014','0017','0018','0019'])await f.db.exec((await readFile('.generated/migrations/'+migration+'.sql','utf8')).replaceAll('\n',' '));
  const a=await f.identity('put-ack'),capture=id(362),p='/v1/captures/'+capture;
  assert.equal((await f.call(p,{token:a.token,method:'POST',body:{files:[file()]}})).status,200);
  const response=await f.call(p+'/files/summary.md',{token:a.token,method:'PUT',raw:'hello'});
  assert.equal(response.status,500);
  assert.equal(Number(response.headers.get('X-Test-R2')),1);
  const attempt=await f.db.prepare('SELECT key,terminal,published,released FROM attempts WHERE capture_id=?').bind(capture).first();
  assert.deepEqual([attempt.terminal,attempt.published,attempt.released],[1,1,0]);
  assert.equal((await f.call(p+'/complete',{token:a.token,method:'POST'})).status,200);
  assert.equal(await (await f.call(p+'/files/summary.md',{token:a.read})).text(),'hello');
 }finally{await f.close();}
});

for(const failure of ['FAIL_DELETE','FAIL_STAMP'])test(failure+' on cleanup page ten stays bounded and retries',async()=>{
 const f=await fixture({[failure]:true,FAIL_AT:10}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
 const a=await f.identity('late-failure'),capture=id(313);
 await f.call('/v1/captures/'+capture,{token:a.token,method:'POST',body:{files:[file()]}});
 await f.call('/v1/captures/'+capture,{token:a.token,method:'DELETE'});
 await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO attempts(key,capture_id,created_at,terminal) SELECT printf('last-%04d',i),?,0,1 FROM n").bind(capture).run();
 const worker=await f.mf.getWorker();assert.equal((await worker.scheduled()).outcome,'exception');
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM attempts WHERE cleaned_at>0').first()).n,900);
 assert.equal((await worker.scheduled()).outcome,'ok');
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM attempts WHERE cleaned_at=0').first()).n,0);
 }finally{await f.close();}
});

test('uncertain page-ten delete failure rotates without releasing reservations',async()=>{
 const f=await fixture({FAIL_DELETE:true,FAIL_AT:10}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
  const a=await f.identity('uncertain-failure'),capture=id(314);
  await f.call('/v1/captures/'+capture,{token:a.token,method:'POST',body:{files:[file()]}});
  await f.call('/v1/captures/'+capture,{token:a.token,method:'DELETE'});
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO attempts(key,capture_id,created_at,bytes) SELECT printf('uncertain-%04d',i),?,0,1 FROM n").bind(capture).run();
  await f.db.prepare('UPDATE r2_budget SET physical_used=1000').run();
  await f.bucket.put('uncertain-1000','failed deletion');
  const worker=await f.mf.getWorker();assert.equal((await worker.scheduled()).outcome,'exception');
  assert.ok(await f.bucket.head('uncertain-1000'));
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM attempts WHERE cleaned_at>0').first()).n,1,'a rotation marker is not a release receipt');
  assert.equal((await worker.scheduled()).outcome,'ok');
  assert.equal(await f.bucket.head('uncertain-1000'),null);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM attempts WHERE cleaned_at>0').first()).n,1);
  assert.equal((await f.db.prepare('SELECT physical_used FROM r2_budget').first()).physical_used,1000);
  assert.equal((await f.db.prepare('SELECT sum(released) AS n FROM attempts').first()).n,0);
 }finally{await f.close();}
});

test('persistent failure on a later uncertain page cannot starve later keys',async()=>{
 const f=await fixture({PERSISTENT_DELETE_FAILURE:true}, {scriptPath:undefined,script:instrumented.outputFiles[0].text});try{
  const a=await f.identity('persistent-cursor'),capture=id(315);
  await f.call('/v1/captures/'+capture,{token:a.token,method:'POST',body:{files:[file()]}});
  await f.call('/v1/captures/'+capture,{token:a.token,method:'DELETE'});
  await f.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1500) INSERT INTO attempts(key,capture_id,created_at,bytes) SELECT printf('persistent-%04d',i),?,0,1 FROM n").bind(capture).run();
  await f.db.prepare('UPDATE r2_budget SET physical_used=1500').run();
  await f.bucket.put('persistent-1400','later page');await f.bucket.put('persistent-0150','failed page');
  const worker=await f.mf.getWorker();for(let i=0;i<3;i++)await worker.scheduled();
  assert.equal(await f.bucket.head('persistent-1400'),null,'later keys get a deletion opportunity despite repeated earlier failure');
  assert.ok(await f.bucket.head('persistent-0150'));
  assert.equal((await f.db.prepare('SELECT physical_used FROM r2_budget').first()).physical_used,1500);
  assert.equal((await f.db.prepare('SELECT sum(released) AS n FROM attempts').first()).n,0);
 }finally{await f.close();}
});
