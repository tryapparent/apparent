// Aggregate-only activity; no individual identifiers leave this service.
import type {Env} from '../types.ts';
import {hex,stmt} from '../common.ts';
export type Product='desktop'|'connect';
const eligible=`a.beta='active' AND lower(a.email) NOT LIKE '%.invalid'
 AND (SELECT enabled FROM analytics_control WHERE id=1)=1
 AND NOT EXISTS(SELECT 1 FROM aggregate_dau_exclusions WHERE account_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM analytics_choices WHERE account_id=a.id AND aggregate_objected=1)
 AND (NOT EXISTS(SELECT 1 FROM analytics_choices WHERE account_id=a.id)
  OR EXISTS(SELECT 1 FROM analytics_consent WHERE account_id=a.id AND consented_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)))`;
export async function activitySubject(env:Env,account:string,product:Product) {
 if(!/^[a-f0-9]{64}$/.test(account)||!['desktop','connect'].includes(product)||env.BETTER_AUTH_SECRET.length<32)throw Error('activity_unavailable');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('apparent-product-activity-v1\0'+product+'\0'+account))));
}
const excluded=(env:Env,account:string)=>(env.POSTHOG_EXCLUDED_ACCOUNT_IDS??'').split(',').map(s=>s.trim()).includes(account);
export async function admitProductActivity(env:Env,account:string,product:Product) {
 try {
  if(excluded(env,account))return;
  const subject=await activitySubject(env,account,product);
  await stmt(env,`INSERT INTO product_activity(subject,product,last_day)
   SELECT ?,?,date('now') FROM accounts a WHERE a.id=? AND ${eligible}
   AND EXISTS(SELECT 1 FROM product_activity_state WHERE id=1)
   AND ((SELECT count(*) FROM product_activity)<10000 OR EXISTS(SELECT 1 FROM product_activity WHERE subject=?))
   ON CONFLICT(subject) DO UPDATE SET last_day=excluded.last_day WHERE product_activity.last_day<excluded.last_day`,subject,product,account,subject).run();
 }catch{/* Missing schema or metric failure never blocks primary work. */}
}
export function queueProductActivity(env:Env,context:ExecutionContext|undefined,request:Request,account:string,product:Product) {
 if(!context||request.headers.get('Sec-GPC')==='1'||request.headers.get('DNT')==='1')return;
 try{context.waitUntil(admitProductActivity(env,account,product));}catch{/* fail open */}
}
const refreshTotals=(env:Env)=>stmt(env,`UPDATE product_activity_totals SET day_utc=date('now'),
 daily_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=product_activity_totals.product AND last_day=date('now')),
 weekly_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=product_activity_totals.product AND last_day>=date('now','-6 days') AND last_day<=date('now'))`);
export async function forgetProductActivity(env:Env,account:string) {
 const subjects=await Promise.all((['desktop','connect'] as const).map(product=>activitySubject(env,account,product)));
 await env.DB.batch([stmt(env,'DELETE FROM product_activity WHERE subject IN (?,?)',...subjects),refreshTotals(env)]);
}
export async function cleanupProductActivity(env:Env) {
 try {
  // Reconcile deletion/refusal/exclusion without retaining an account-to-subject
  // lookup. Derive the eligible set transiently; never log it or export it.
  const {results}=await stmt(env,`SELECT a.id FROM accounts a WHERE ${eligible} LIMIT 10001`).all<{id:string}>();
  if(results.length>10000)return;
  const allowed=(await Promise.all(results.filter(a=>!excluded(env,a.id)).flatMap(a=>(['desktop','connect'] as const).map(p=>activitySubject(env,a.id,p)))));
  await env.DB.batch([
   stmt(env,`DELETE FROM product_activity WHERE last_day<date('now','-6 days') OR last_day>date('now') OR subject NOT IN (SELECT value FROM json_each(?))`,JSON.stringify(allowed)),
   refreshTotals(env),
   stmt(env,"UPDATE product_activity_state SET as_of_ms=CAST(unixepoch('subsec')/900 AS INTEGER)*900000 WHERE id=1 AND as_of_ms<CAST(unixepoch('subsec')/900 AS INTEGER)*900000")
  ]);
 }catch{/* Failed reconciliation leaves the maintenance watermark stale. */}
}
