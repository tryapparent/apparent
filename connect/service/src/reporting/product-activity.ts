// Aggregate-only activity; no individual identifiers leave this service.
import type {Env} from '../types.ts';
import preference from '#bend/activity-preference';
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
type ConnectAction = { occurredAt: number; completedUpload: boolean };

function writeActivity(env: Env, account: string, product: Product, subject: string, action?: ConnectAction) {
 return stmt(env,`INSERT INTO product_activity(subject,product,last_day${action ? ',last_cadence_day,daily_uploads' : ''})
  SELECT ?,?,date('now')${action ? ",date('now'),?" : ''} FROM accounts a WHERE a.id=? AND ${eligible}
  ${action ? "AND date(? / 1000.0, 'unixepoch')=date('now')" : ''}
  AND EXISTS(SELECT 1 FROM product_activity_state WHERE id=1)
  AND ((SELECT count(*) FROM product_activity)<10000 OR EXISTS(SELECT 1 FROM product_activity WHERE subject=?))
  ON CONFLICT(subject) DO UPDATE SET last_day=excluded.last_day
  ${action ? `,last_cadence_day=excluded.last_cadence_day,
   daily_uploads=excluded.daily_uploads + CASE WHEN product_activity.last_cadence_day=excluded.last_cadence_day
    THEN product_activity.daily_uploads ELSE 0 END` : ''}
  WHERE product_activity.last_day<excluded.last_day
  ${action ? `OR (product_activity.last_day=excluded.last_day AND
   (product_activity.last_cadence_day IS NOT excluded.last_cadence_day OR excluded.daily_uploads>0))` : ''}`,
  subject,product,...(action
   ? [preference.upload_increment(action.completedUpload),account,action.occurredAt]
   : [account]),subject).run();
}
export async function admitProductActivity(env:Env,account:string,product:Product,action?: ConnectAction) {
 try {
  if(excluded(env,account))return;
  const subject=await activitySubject(env,account,product);
  if (product === 'connect' && action) {
   try {
    await writeActivity(env, account, product, subject, action);
    return;
   } catch {}
  }
  await writeActivity(env, account, product, subject);
 }catch{/* Missing schema or metric failure never blocks primary work. */}
}
export function queueProductActivity(env:Env,context:ExecutionContext|undefined,request:Request,account:string,product:Product,action?: ConnectAction) {
 if(!context||!preference.may_queue(request.headers.get('Sec-GPC')==='1',request.headers.get('DNT')==='1'))return;
 try{context.waitUntil(admitProductActivity(env,account,product,action));}catch{/* fail open */}
}
const refreshTotals=(env:Env)=>stmt(env,`UPDATE product_activity_totals SET day_utc=date('now'),
 daily_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=product_activity_totals.product AND last_day=date('now')),
 weekly_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=product_activity_totals.product AND last_day>=date('now','-6 days') AND last_day<=date('now'))`);
export async function forgetProductActivity(env:Env,account:string) {
 const subjects=await Promise.all((['desktop','connect'] as const).map(product=>activitySubject(env,account,product)));
 await env.DB.batch([stmt(env,'DELETE FROM product_activity WHERE subject IN (?,?)',...subjects),refreshTotals(env)]);
}
const snapshotActivity = (env: Env, pairs: [string, string][], includeUploads: boolean) => stmt(env, `
 WITH account_activity AS (
   SELECT desktop.last_day AS desktop_day, connect.last_day AS connect_day
    ${includeUploads ? ", CASE WHEN connect.last_cadence_day=date('now') THEN connect.daily_uploads END AS uploads" : ''}
   FROM json_each(?) AS pair
   LEFT JOIN product_activity AS desktop ON desktop.subject=json_extract(pair.value,'$[0]')
   LEFT JOIN product_activity AS connect ON connect.subject=json_extract(pair.value,'$[1]')
 )
 INSERT INTO product_activity_history
   (day_utc, desktop_daily, connect_daily, desktop_weekly, connect_weekly, as_of_ms
    ${includeUploads ? ',connect_uploads,connect_upload_accounts' : ''})
 SELECT date('now'),
   NULLIF(count(*) FILTER (WHERE desktop_day=date('now') OR connect_day=date('now')),0),
   NULLIF(count(*) FILTER (WHERE connect_day=date('now')),0),
   NULLIF(count(*) FILTER (WHERE desktop_day BETWEEN date('now','-6 days') AND date('now')
                          OR connect_day BETWEEN date('now','-6 days') AND date('now')),0),
   NULLIF(count(*) FILTER (WHERE connect_day BETWEEN date('now','-6 days') AND date('now')),0),
   CAST(unixepoch('subsec') * 1000 AS INTEGER)
   ${includeUploads ? `,sum(uploads) FILTER (WHERE connect_day=date('now')),
    NULLIF(count(uploads) FILTER (WHERE connect_day=date('now')),0)` : ''}
 FROM account_activity
 WHERE true
 ON CONFLICT(day_utc) DO UPDATE SET
   desktop_daily=excluded.desktop_daily, connect_daily=excluded.connect_daily,
   desktop_weekly=excluded.desktop_weekly, connect_weekly=excluded.connect_weekly,
   as_of_ms=excluded.as_of_ms
   ${includeUploads ? ',connect_uploads=excluded.connect_uploads,connect_upload_accounts=excluded.connect_upload_accounts' : ''}
 WHERE excluded.as_of_ms>=product_activity_history.as_of_ms
`, JSON.stringify(pairs));

export async function cleanupProductActivity(env:Env) {
 try {
  // Reconcile deletion/refusal/exclusion without retaining an account-to-subject
  // lookup. Derive the eligible set transiently; never log it or export it.
  const {results}=await stmt(env,`SELECT a.id FROM accounts a WHERE ${eligible} LIMIT 10001`).all<{id:string}>();
  if(results.length>10000)return;
  const pairs = await Promise.all(results.filter(a=>!excluded(env,a.id)).map(({id}) =>
    Promise.all([activitySubject(env,id,'desktop'), activitySubject(env,id,'connect')] as const)));
  await env.DB.batch([
   stmt(env,`DELETE FROM product_activity WHERE last_day<date('now','-6 days') OR last_day>date('now') OR subject NOT IN (SELECT value FROM json_each(?))`,JSON.stringify(pairs.flat())),
   refreshTotals(env),
   stmt(env,"UPDATE product_activity_state SET as_of_ms=CAST(unixepoch('subsec')/900 AS INTEGER)*900000 WHERE id=1 AND as_of_ms<CAST(unixepoch('subsec')/900 AS INTEGER)*900000")
  ]);
  const retainHistory = stmt(env, "DELETE FROM product_activity_history WHERE day_utc<date('now','-29 days')");
  try {
   await env.DB.batch([snapshotActivity(env, pairs, true), retainHistory]);
  } catch {
   await env.DB.batch([snapshotActivity(env, pairs, false), retainHistory]);
  }
 }catch{/* Failed reconciliation leaves the maintenance watermark stale. */}
}
