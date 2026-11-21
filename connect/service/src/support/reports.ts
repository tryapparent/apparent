import { DAY, bearer, fail, json, stmt } from '../common.ts';
import { captureRoutes, supportCapture } from '../captures.ts';
import { getObject } from '../storage.ts';
import type { Env, FileRow } from '../types.ts';

const timing = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean };
const encoder = new TextEncoder();
const objectKey = (report: {id: string; digest: string}) => `support-reports/${report.id}/${report.digest}.age`;
const unavailableLegacy = (error: unknown) => error instanceof Error && /no such table: support_reports\b/.test(error.message);
const legacyReport = (env: Env, id: string) => stmt(env,'SELECT id,digest,bytes,ready,expires_at FROM support_reports WHERE id=?',id)
  .first<{id: string; digest: string; bytes: number; ready: number; expires_at: number}>().catch((error: unknown) => {
    if (unavailableLegacy(error)) return null;
    throw error;
  });
const readyReport = (env: Env, id: string) => stmt(env,`SELECT id FROM captures WHERE id=? AND ${supportCapture} AND status='ready' AND expires_at>?`,id,Date.now()).first();

export async function supportRoutes(request: Request, env: Env, url: URL) {
  const prefix = '/v1/support-reports/';
  if (!url.pathname.startsWith(prefix)) return;
  const recipient = env.SUPPORT_REPORT_RECIPIENT;
  const readToken = env.SUPPORT_REPORT_READ_TOKEN;
  if (!recipient || !/^age1[a-z0-9]{58}$/.test(recipient) || !readToken || !/^[a-f0-9]{64}$/.test(readToken))
    fail('support_unavailable', 503);
  if (url.pathname === prefix+'key' && request.method === 'GET') {
    await bearer(request, env, true);
    return json({ recipient });
  }
  const match = /^\/v1\/support-reports\/([a-f0-9]{32})(.*)$/.exec(url.pathname);
  if (!match) fail('not_found', 404);
  const [,id,route] = match;
  if ((request.method==='POST' && (route==='/capture' || route==='/capture/complete')) ||
      (request.method==='PUT' && /^\/capture\/files\/support\/part-[0-5]\.age$/.test(route))) {
    if (route==='/capture') {
      await bearer(request, env, true);
      if (await legacyReport(env,id)) fail('report_conflict',409);
    }
    const capture = new URL(url);
    capture.pathname = '/v1/captures/'+id+route.slice('/capture'.length);
    return captureRoutes(request, env, capture, undefined, true);
  }
  if (request.method !== 'GET') fail('not_found', 404);
  const credential = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!credential || !timing.timingSafeEqual(encoder.encode(credential),encoder.encode(readToken)))
    fail('unauthorized',401);
  const part = /^\/archive\/(part-[0-5]\.age)$/.exec(route);
  if (route === '/archive' || part) {
    if (!await readyReport(env,id)) fail('not_found',404);
    const {results} = await stmt(env,'SELECT path,size,object_key FROM files WHERE capture_id=? ORDER BY path',id)
      .all<Pick<FileRow,'path'|'size'|'object_key'>>();
    if (!part) return json({parts:results.map(({path,size})=>({name:path.slice('support/'.length),size}))});
    const file = results.find(({path})=>path==='support/'+part[1]);
    if (!file) fail('not_found',404);
    const object = await getObject(env,file.object_key);
    if (!object) fail('not_found',404);
    if (!await readyReport(env,id)) {
      await object.body.cancel();
      fail('not_found',404);
    }
    return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size)}});
  }
  if (route !== '') fail('not_found',404);
  const report = await legacyReport(env,id);
  if (!report?.ready || report.expires_at<=Date.now()) fail('not_found',404);
  const object=await env.BUCKET.get(objectKey(report));
  if (!object) fail('not_found',404);
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(report.bytes)}});
}

export async function cleanupSupportReports(env: Env) {
  const now = Date.now();
  const rows = await stmt(env, 'SELECT id,digest FROM support_reports WHERE cleaned=0 AND expires_at<=? ORDER BY expires_at LIMIT 100', now)
    .all<{id: string; digest: string}>().catch((error: unknown) => {
      if (unavailableLegacy(error)) return null;
      throw error;
    });
  if (!rows) return;
  if (rows.results.length) {
    await env.BUCKET.delete(rows.results.map(objectKey));
    await stmt(env, `UPDATE support_reports SET cleaned=1
      WHERE id IN (SELECT value FROM json_each(?)) AND expires_at<=?`,
    JSON.stringify(rows.results.map(report => report.id)), now).run();
  }
  await stmt(env, 'DELETE FROM support_reports WHERE cleaned=1 AND expires_at<=?', now - DAY).run();
}
