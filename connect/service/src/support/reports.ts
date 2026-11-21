import policy from '#bend/report-policy';
import { DAY, bounded, fail, hash, hex, json, rate, stmt } from '../common.ts';
import type { Env } from '../types.ts';

const MAX_BYTES = 24 * 1024 * 1024;
const TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const RETENTION = 7 * DAY;
const PENDING = 15 * 60 * 1000;
const timing = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean };
const AGE_HEADER = new TextEncoder().encode('age-encryption.org/v1\n');

type Report = {
  id: string;
  upload_hash: string;
  digest: string;
  bytes: number;
  ready: number;
  expires_at: number;
};

const objectKey = (report: Pick<Report, 'id' | 'digest'>) => `support-reports/${report.id}/${report.digest}.age`;
const authorization = (request: Request) => /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
const load = (env: Env, id: string) => stmt(env, 'SELECT * FROM support_reports WHERE id=?', id).first<Report>();

export async function supportRoutes(request: Request, env: Env, url: URL) {
  if (url.pathname !== '/v1/support-reports/key' && !url.pathname.startsWith('/v1/support-reports/')) return;
  const recipient = env.SUPPORT_REPORT_RECIPIENT;
  const readToken = env.SUPPORT_REPORT_READ_TOKEN;
  if (!recipient || !/^age1[a-z0-9]{58}$/.test(recipient) || !readToken || !/^[a-f0-9]{64}$/.test(readToken))
    fail('support_unavailable', 503);
  if (url.pathname === '/v1/support-reports/key' && request.method === 'GET')
    return json({ recipient, maxBytes: MAX_BYTES });

  const id = /^\/v1\/support-reports\/([a-f0-9]{32})$/.exec(url.pathname)?.[1];
  if (!id) fail('not_found', 404);
  const credential = authorization(request);
  if (!credential) fail('unauthorized', 401);
  if (request.method === 'GET') {
    if (!timing.timingSafeEqual(new TextEncoder().encode(credential), new TextEncoder().encode(readToken)))
      fail('unauthorized', 401);
    const report = await load(env, id);
    if (!report?.ready || report.expires_at <= Date.now()) fail('not_found', 404);
    const object = await env.BUCKET.get(objectKey(report));
    if (!object) fail('not_found', 404);
    return new Response(object.body, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(report.bytes) },
    });
  }
  if (request.method !== 'PUT') fail('not_found', 404);

  const checksum = request.headers.get('X-Ciphertext-SHA256') ?? '';
  const size = Number(request.headers.get('Content-Length'));
  if (!Number.isSafeInteger(size) || size < 0 || !policy.upload_size(size) || !/^[a-f0-9]{64}$/.test(checksum))
    fail('invalid_report');
  const uploadHash = await hash(credential);
  const now = Date.now();
  let report = await load(env, id);
  if (!report) {
    const source = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    await rate(env, 'support-report-source:' + await hash(readToken + source), 5);
    await rate(env, 'support-report-global', 30);
    await stmt(env, `INSERT INTO support_reports(id,upload_hash,digest,bytes,expires_at)
      SELECT ?,?,?,?,? WHERE (SELECT COALESCE(SUM(bytes),0) FROM support_reports WHERE expires_at>?) <= ?
      ON CONFLICT(id) DO NOTHING`, id, uploadHash, checksum, size, now + PENDING, now, TOTAL_BYTES - size).run();
    report = await load(env, id);
  }
  if (!report) fail('support_capacity', 503);
  if (report.upload_hash !== uploadHash || report.digest !== checksum || report.bytes !== size)
    fail('report_conflict', 409);
  if (report.expires_at <= Date.now()) fail('report_expired', 410);
  if (report.ready) return json({ id, ready: true });
  await rate(env, 'support-report-bytes', 48);
  await rate(env, 'support-report-id:' + id, 6);

  const ciphertext = await bounded(request, size);
  if (ciphertext.byteLength !== size || !AGE_HEADER.every((byte, index) => ciphertext[index] === byte))
    fail('invalid_ciphertext');
  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext))) !== checksum)
    fail('hash_mismatch');
  const key = objectKey(report);
  await env.BUCKET.put(key, ciphertext);
  const clock = Date.now();
  const ready = await stmt(env, `UPDATE support_reports SET ready=1,expires_at=?
    WHERE id=? AND ready=0 AND expires_at>? RETURNING id`, clock + RETENTION, id, clock).first();
  if (!ready) {
    const current = await load(env, id);
    if (current?.ready && current.expires_at > clock) return json({ id, ready: true });
    await env.BUCKET.delete(key);
    fail('report_expired', 410);
  }
  return json({ id, ready: true });
}

export async function cleanupSupportReports(env: Env) {
  const now = Date.now();
  const rows = await stmt(env, 'SELECT id,digest FROM support_reports WHERE cleaned=0 AND expires_at<=? ORDER BY expires_at LIMIT 100', now)
    .all<Pick<Report, 'id' | 'digest'>>().catch((error: unknown) => {
      if (error instanceof Error && /no such table: support_reports\b/.test(error.message)) return null;
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
