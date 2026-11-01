// Explicit server-side product events only. Never pass requests, exceptions,
// credentials, paths, manifests, recording content or arbitrary properties here.
import type {Env} from './types.ts';
import {DAY,hash,stmt} from './common.ts';
interface Activity {
 id: string; account_id: string; event: string; occurred_at: number;
 bytes: number; captures: number; pending_bytes: number; physical_bytes: number;
}
const hosts=new Set(['https://eu.i.posthog.com']);
const events=new Set(['connect_account_created','connect_device_connected','connect_upload_completed','connect_storage_snapshot']);
const actor=(event: string)=>event==='connect_upload_completed'?'device':event==='connect_storage_snapshot'?'system':'browser';
const configured=(env:Env)=>env.POSTHOG_ENABLED==='true'&&!!env.POSTHOG_PROJECT_TOKEN&&hosts.has(env.POSTHOG_HOST||'')&&['production','synthetic','development'].includes(env.POSTHOG_ENVIRONMENT||'');
const exclusions=(env:Env)=>new Set((env.POSTHOG_EXCLUDED_ACCOUNT_IDS||'').split(',').map(s=>s.trim()).filter(Boolean));
export async function analyticsIdentity(env:Env,account:string) {
 if(!configured(env)||exclusions(env).has(account))return null;
 try {
  const control=await stmt(env,'SELECT enabled FROM analytics_control WHERE id=1').first<{enabled:number}>();
  return control?.enabled?'account:'+account:null;
 }catch{return null;}
}
export async function flushAnalytics(env: Env) {
 if(!configured(env))return;
 try {
  const control=await stmt(env,'SELECT enabled,dropped FROM analytics_control WHERE id=1').first<{enabled:number;dropped:number}>();
  if(!control?.enabled)return;
  const now=Date.now(),day=Math.floor(now/DAY);
  // One UTC-day snapshot per account. The checkpoint and rows commit together,
  // including across cron retries. Current storage is NOT cumulative uploads.
  await env.DB.batch([
   stmt(env,`INSERT OR IGNORE INTO analytics_outbox(id,account_id,event,occurred_at,bytes,captures,pending_bytes,physical_bytes)
    SELECT 'storage:'||a.id||':'||?,a.id,'connect_storage_snapshot',?,
     COALESCE((SELECT sum(bytes) FROM captures WHERE account_id=a.id AND status='ready' AND expires_at>?),0),
     (SELECT count(*) FROM captures WHERE account_id=a.id AND status='ready' AND expires_at>?),
     COALESCE((SELECT sum(bytes) FROM captures WHERE account_id=a.id AND status='pending' AND expires_at>? AND pending_until>?),0),
     COALESCE((SELECT sum(t.bytes) FROM attempts t JOIN captures c ON c.id=t.capture_id WHERE c.account_id=a.id AND t.released=0),0)
    FROM accounts a WHERE (SELECT snapshot_day FROM analytics_control WHERE id=1)<?
    LIMIT MAX(0,10000-(SELECT count(*) FROM analytics_outbox))`,day,now,now,now,now,now,day),
   stmt(env,`UPDATE analytics_control SET
    dropped=dropped+CASE WHEN snapshot_day<? THEN (SELECT count(*) FROM accounts a WHERE NOT EXISTS(SELECT 1 FROM analytics_outbox o WHERE o.id='storage:'||a.id||':'||?)) ELSE 0 END,
    snapshot_day=? WHERE id=1`,day,day,day),
   stmt(env,`UPDATE analytics_control SET dropped=dropped+(SELECT count(*) FROM analytics_outbox WHERE occurred_at<?) WHERE id=1`,now-90*DAY),
   stmt(env,'DELETE FROM analytics_outbox WHERE occurred_at<?',now-90*DAY)
  ]);
  const {results}=await stmt(env,'SELECT * FROM analytics_outbox ORDER BY occurred_at,id LIMIT 100').all<Activity>();
  if(!results.length)return;
  const excluded=exclusions(env);
  const safe=results.filter(row=>!excluded.has(row.account_id)&&events.has(row.event)&&/^[a-f0-9]{64}$/.test(row.account_id)&&[row.bytes,row.captures,row.pending_bytes,row.physical_bytes,row.occurred_at].every(n=>Number.isSafeInteger(n)&&n>=0));
  const batch=await Promise.all(safe.map(async row=>{
   const digest=await hash('apparent-analytics:'+row.id);
   const uuid=`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
   return {uuid,event:row.event,timestamp:new Date(row.occurred_at).toISOString(),properties:{
    distinct_id:'account:'+row.account_id,environment:env.POSTHOG_ENVIRONMENT,actor:actor(row.event),
    outcome:'success',$geoip_disable:true,$ip:null,
    ...(row.event==='connect_upload_completed'?{recording_bytes:row.bytes}:{}),
    ...(row.event==='connect_storage_snapshot'?{retained_bytes:row.bytes,retained_recordings:row.captures,pending_reserved_bytes:row.pending_bytes,physical_reserved_bytes:row.physical_bytes}:{}),
    collection_dropped:control.dropped
   }};
  }));
  if(batch.length){
   const response=await fetch(env.POSTHOG_HOST+'/batch/',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:env.POSTHOG_PROJECT_TOKEN,batch}),signal:AbortSignal.timeout(5000)});
   if(!response.ok)return;
   const result=await response.json() as {status?:number};if(result.status!==1)return;
  }
  // A failed send/ambiguous acknowledgement leaves rows for retry with the same
  // UUID and timestamp. Exclusions never go to the analytics provider.
  await stmt(env,`DELETE FROM analytics_outbox WHERE id IN (${results.map(()=>'?').join(',')})`,...results.map(row=>row.id)).run();
 }catch{
  // External analytics outages/config/migration gaps never fail product work.
  // Do not log the exception: provider text may include the submitted payload.
 }
}
