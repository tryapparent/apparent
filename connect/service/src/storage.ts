import type {Env, FileRow, ManifestFile, AttemptSnapshot} from './types.ts';
import {fail,stmt,random} from './common.ts';

// Lifetime beta allowances. No request, calendar or deployment reset path.
const valid=`id=1 AND typeof(a_used)='integer' AND typeof(a_cap)='integer' AND a_used>=0 AND a_cap BETWEEN 0 AND 500000 AND a_used<=a_cap
 AND typeof(b_used)='integer' AND typeof(b_cap)='integer' AND b_used>=0 AND b_cap BETWEEN 0 AND 5000000 AND b_used<=b_cap
 AND typeof(physical_used)='integer' AND typeof(physical_cap)='integer' AND physical_used>=0 AND physical_cap BETWEEN 0 AND 9500000000 AND physical_used<=physical_cap`;
async function exhausted(env: Env) {
 let row;try{row=await stmt(env,`SELECT id FROM r2_budget WHERE ${valid}`).first();}catch{fail('budget_unavailable',503);}
 fail(row?'budget_exhausted':'budget_unavailable',503);
}
async function reserveReads(env: Env,count: number) {
 let result;try{result=await stmt(env,`UPDATE r2_budget SET b_used=b_used+? WHERE ${valid} AND b_used<=b_cap-?`,count,count).run();}catch{fail('budget_unavailable',503);}
 if(!result.meta.changes)await exhausted(env);
}
export async function checkedHeads(env: Env,files: FileRow[],verified: (object: R2Object | null,file: ManifestFile) => unknown) {
 // One bulk grant, including an early miss. Never refund operation grants.
 await reserveReads(env,files.length);
 for(const f of files){if(!f.object_key)fail('not_ready',409);const h=await env.BUCKET.head(f.object_key);if(!verified(h,f))fail('not_ready',409);}
}
export async function getObject(env: Env,key: string | null,options?: R2GetOptions) {
 if(!key)return null;
 await reserveReads(env,1);return env.BUCKET.get(key,options);
}
export async function uploadAttempt(env: Env,capture: string,account: string,file: ManifestFile) {
 const key=`${account}/${capture}/${random()}`;
 let result;try{
  result=await env.DB.batch([
   stmt(env,`UPDATE r2_budget SET a_used=a_used+1,physical_used=physical_used+? WHERE ${valid} AND a_used<a_cap AND physical_used<=physical_cap-?`,file.size,file.size),
   stmt(env,'INSERT INTO attempts(key,capture_id,created_at,bytes) SELECT ?,?,?,? WHERE changes()=1',key,capture,Date.now(),file.size)
  ]);
 }catch{fail('budget_unavailable',503);}
 if(!result[0].meta.changes)await exhausted(env);
 // A permit/key is used exactly once. A retry must acquire a new durable grant.
 let used=false;
 return {key,put(stream: ReadableStream<Uint8Array>){if(used)throw new Error('used upload attempt');used=true;return env.BUCKET.put(key,stream,{sha256:file.sha256});}};
}
export async function settledAttempt(env: Env,key: string) {
 // Only called after BOTH stream and unique provider PUT have settled.
 await stmt(env,'UPDATE attempts SET terminal=1 WHERE key=?',key).run();
}
// DeleteObject is free and must remain available at every spending cap.
export async function deleteAttempts(env: Env,attempts: AttemptSnapshot[],now=Date.now()) {
 const keys=attempts.map(a=>a.key);
 // Snapshot terminal eligibility BEFORE deletion. Reading it afterwards could
 // release bytes for a PUT that finished after the delete and recreated its key.
 const terminal=JSON.stringify(attempts.filter(a=>a.terminal===1).map(a=>a.key));
 await env.BUCKET.delete(keys);
 const reclaim=`SELECT COALESCE(sum(bytes),0) FROM attempts WHERE released=0 AND terminal=1 AND key IN (SELECT value FROM json_each(?))`;
 await env.DB.batch([
  stmt(env,`UPDATE r2_budget SET physical_used=physical_used-(${reclaim}) WHERE ${valid} AND physical_used>=(${reclaim})`,terminal,terminal),
  // changes() belongs to the preceding update inside this serialized batch.
  // Stamp failure rolls back the decrement; retries cannot decrement twice.
  stmt(env,'UPDATE attempts SET cleaned_at=?,released=CASE WHEN terminal=1 AND key IN (SELECT value FROM json_each(?)) AND changes()=1 THEN 1 ELSE released END WHERE key IN (SELECT value FROM json_each(?))',now,terminal,JSON.stringify(keys))
 ]);
}
