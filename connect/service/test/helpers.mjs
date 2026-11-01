import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
export const digest = s => createHash('sha256').update(s).digest('hex');
export async function fixture(bindings={},options={}) {
 const {instances=false,...workerOptions}=options;
 const config={modules:true,scriptPath:'dist/worker.js',compatibilityDate:'2026-02-05',d1Databases:{DB:'shared-db'},r2Buckets:{BUCKET:'shared-bucket'},bindings:{SITE_ORIGIN:'https://site.example',API_ORIGIN:'https://api.example',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),...bindings},...workerOptions};
 const runtime=instances?{workers:[{...config,name:'first'},{...config,name:'second'}]}:config;
 const mf = new Miniflare(runtime);
 const db=await mf.getD1Database('DB',instances?'first':undefined),bucket=await mf.getR2Bucket('BUCKET',instances?'first':undefined);
 await db.exec((await readFile('migrations/0001.sql','utf8')).replaceAll('\n',' '));
 await db.exec((await readFile('migrations/0002.sql','utf8')).replaceAll('\n',' '));
 const call=async (path,{token,cookie,csrf,origin,method='GET',body,raw,headers={}}={})=>mf.dispatchFetch('https://api.example'+path,{method,redirect:'manual',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(origin?{Origin:origin}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:raw!==undefined?{body:raw}:{})});
 async function identity(id,beta='active') {
  const token=randomBytes(32).toString('hex'),read=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO accounts(id,email,beta,created_at) VALUES(?,?,?,?)').bind(id,id+'@example.com',beta,Date.now()).run();
  for(const [t,s] of [[token,'upload'],[read,'read']]) await db.prepare('INSERT INTO tokens VALUES(?,?,?,?)').bind(digest(t),id,s,Date.now()+86400000).run();
  await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(digest(session),id,csrf,Date.now()+86400000).run();
  return {id,token,read,cookie:'__Host-apparent_session='+session,csrf,origin:'https://site.example'};
 }
 return {mf,db,bucket,call,identity,reload:()=>mf.setOptions(instances?{workers:runtime.workers.map(w=>({...w,scriptPath:undefined,script:w.script+'\n// reloaded'}))}:{...config,scriptPath:undefined,script:config.script+'\n// reloaded'}),close:()=>mf.dispose()};
}
export const id = n => n.toString(16).padStart(32,'0');
export const file = (path='summary.md',text='hello') => ({path,size:Buffer.byteLength(text),sha256:digest(text)});
