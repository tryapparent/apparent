#!/usr/bin/env node
/**
 * Disposable loopback Connect fixture for installed foreground-sharing checks.
 * It is not a Connect service and must only receive a synthetic bundle.
 */
import {createHash, randomBytes} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {chmod, mkdir, readFile, realpath, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

type ManifestFile = {path: string; size: number; sha256: string};
type Capture = {id: string; format: string; files: ManifestFile[]; data: Map<string, Buffer>; ready: boolean};
type FixtureState = {
  origin: string; calls: Record<string, number>; captures: Map<string, Capture>;
  approved: number; polls: number; putCount: number;
  bytesIn: number; digests: string[]; aborted: number;
  devices: Array<{grantId: string; scope: string; key: unknown}>; pendingKey: unknown; pendingScope: string;
};
const token = 'synthetic-upload-token-only';
const refresh = 'synthetic-refresh-token-only';
const readToken = 'synthetic-read-token-only';
const readRefresh = 'synthetic-read-refresh-only';
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const json = (res: ServerResponse, status: number, value: unknown) => {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {'content-type': 'application/json', 'content-length': String(body.length), 'cache-control': 'no-store'});
  res.end(body);
};
async function body(req: IncomingMessage, limit = 2_100_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk); size += value.length;
    if (size > limit) throw new Error('request_too_large');
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
function loopback(req: IncomingMessage) {
  const remote = req.socket.remoteAddress;
  return remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || remote === '::1';
}
function authorized(req: IncomingMessage, res: ServerResponse) {
  if (req.headers.authorization === `Bearer ${token}` || req.headers.authorization === `Bearer ${readToken}`) return true;
  json(res, 401, {error: {code: 'unauthorized'}}); return false;
}
function routeLabel(method: string, url: URL) {
  // Route labels intentionally omit capture/share identifiers and query values.
  const pieces = url.pathname.split('/').filter(Boolean);
  if (pieces[0] === 'v1' && pieces[1] === 'captures' && pieces[2]) {
    if (pieces[3] === 'files') return `${method} /v1/captures/:id/files/:path`;
    return `${method} /v1/captures/:id${pieces[3] === 'complete' ? '/complete' : ''}`;
  }
  return `${method} ${url.pathname}`;
}
async function handle(req: IncomingMessage, res: ServerResponse, state: FixtureState) {
  let notedDisconnect = false;
  const noteDisconnect = () => {
    if (!notedDisconnect && !res.writableFinished) { notedDisconnect = true; state.aborted++; }
  };
  req.once('aborted', noteDisconnect);
  res.once('close', noteDisconnect);
  const url = new URL(req.url ?? '/', state.origin);
  const method = req.method ?? 'GET';
  const key = routeLabel(method, url); state.calls[key] = (state.calls[key] ?? 0) + 1;
  try {
    if (url.pathname === '/__fixture/status' && method === 'GET') {
      if (!loopback(req)) return json(res, 403, {error: 'local_only'});
      return json(res, 200, {calls: state.calls, approvedLogins: state.approved,
        captures: [...state.captures.values()].map(c => ({format: c.format, ready: c.ready, files: c.files.length,
          received: c.files.every(f => { const bytes = c.data.get(f.path); return !!bytes && bytes.length === f.size && sha(bytes) === f.sha256; })})),
        uploadedBytes: state.bytesIn, syntheticOnly: true});
    }
    if (url.pathname === '/v1/device/start' && method === 'POST') {
      const value = JSON.parse((await body(req, 16_384)).toString('utf8')) as {scope?: string; encryptionKey?: unknown};
      if (value.scope !== 'upload' && value.scope !== 'read') return json(res, 400, {error: {code: 'invalid_scope'}});
      state.pendingScope = value.scope;
      state.pendingKey = value.encryptionKey ?? null;
      state.polls = 0;
      return json(res, 200, {
        deviceCode: 'synthetic-device-code', userCode: 'TEST-CODE',
        verificationUri: `${state.origin}/hosted/device?code=TEST-CODE`, expiresIn: 300, interval: 1,
      });
    }
    if (url.pathname === '/v1/device/poll' && method === 'POST') {
      const value = JSON.parse((await body(req, 16_384)).toString('utf8')) as {deviceCode?: string};
      if (value.deviceCode !== 'synthetic-device-code') return json(res, 400, {error: {code: 'invalid_device_code'}});
      state.polls++;
      if (state.polls === 1) return json(res, 200, {status: 'pending'});
      state.approved++;
      const scope = state.pendingScope;
      const grantId = `synthetic-approved-${scope}-grant`;
      // Match the native test Server: enroll only a key submitted by this
      // explicit synthetic device-login flow; no peer is pre-seeded.
      if (state.pendingKey && !state.devices.some(peer => peer.grantId === grantId)) {
        state.devices.push({grantId, scope, key: state.pendingKey});
      }
      const approvedToken = scope === 'upload' ? token : readToken;
      const approvedRefresh = scope === 'upload' ? refresh : readRefresh;
      return json(res, 200, {
        status: 'approved', scope, accessToken: approvedToken, refreshToken: approvedRefresh,
        expiresIn: 3600, refreshExpiresIn: 86400, grantId,
      });
    }
    if (url.pathname === '/v1/token/refresh' && method === 'POST') {
      const value = JSON.parse((await body(req, 16_384)).toString('utf8')) as {refreshToken?: string};
      const scope = value.refreshToken === refresh ? 'upload' : value.refreshToken === readRefresh ? 'read' : '';
      if (!scope) return json(res, 401, {error: {code: 'unauthorized'}});
      return json(res, 200, {accessToken: scope === 'upload' ? token : readToken, refreshToken: value.refreshToken, scope, expiresIn: 3600, refreshExpiresIn: 86400, grantId: `synthetic-approved-${scope}-grant`});
    }
    if (url.pathname === '/v1/encryption/peers' && method === 'GET') {
      if (!authorized(req, res)) return;
      const scope = req.headers.authorization === `Bearer ${token}` ? 'upload' : 'read';
      return json(res, 200, {accountId: 'synthetic-account-loopback', grantId: `synthetic-approved-${scope}-grant`, scope, devices: state.devices});
    }
    const captureMatch = /^\/v1\/captures\/([a-f0-9]{32})(?:\/(.*))?$/.exec(url.pathname);
    if (captureMatch) {
      if (!authorized(req, res)) return;
      const [, id, suffix = ''] = captureMatch;
      if (!suffix && method === 'POST') {
        const value = JSON.parse((await body(req, 128 * 1024)).toString('utf8')) as {format?: string; files?: ManifestFile[]};
        if (!Array.isArray(value.files) || !value.files.length || value.files.length > 8) return json(res, 400, {error: {code: 'invalid_manifest'}});
        for (const file of value.files) {
          if (!file || typeof file.path !== 'string' || file.path.length > 128 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 4_194_304 || !/^[a-f0-9]{64}$/.test(file.sha256)) return json(res, 400, {error: {code: 'invalid_manifest'}});
        }
        let capture = state.captures.get(id);
        if (capture && JSON.stringify(capture.files) !== JSON.stringify(value.files)) return json(res, 409, {error: {code: 'manifest_conflict'}});
        capture ??= {id, format: value.format ?? 'plaintext-v1', files: value.files, data: new Map(), ready: false};
        state.captures.set(id, capture);
        return json(res, 200, {id, status: capture.ready ? 'ready' : 'pending', format: capture.format});
      }
      const fileMatch = /^files\/(.+)$/.exec(suffix);
      if (fileMatch && method === 'GET') {
        const capture = state.captures.get(id); if (!capture) return json(res, 404, {error: {code: 'not_found'}});
        const filePath = fileMatch[1]!.split('/').map(part => decodeURIComponent(part)).join('/');
        const bytes = capture.data.get(filePath); if (!bytes) return json(res, 404, {error: {code: 'not_found'}});
        res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': String(bytes.length), 'cache-control': 'no-store'}); return res.end(bytes);
      }
      if (fileMatch && method === 'PUT') {
        const capture = state.captures.get(id); if (!capture) return json(res, 404, {error: {code: 'not_found'}});
        const filePath = fileMatch[1]!.split('/').map(part => decodeURIComponent(part)).join('/');
        const expected = capture.files.find(file => file.path === filePath);
        if (!expected) return json(res, 404, {error: {code: 'not_found'}});
        const bytes = await body(req, Math.max(expected.size + 1, 2_100_000));
        state.putCount++;
        if (req.aborted || res.destroyed) return;
        if (bytes.length !== expected.size || sha(bytes) !== expected.sha256) return json(res, 409, {error: {code: 'hash_mismatch'}});
        capture.data.set(filePath, bytes); state.bytesIn += bytes.length; state.digests.push(sha(bytes));
        return json(res, 200, {ok: true});
      }
      if (suffix === 'complete' && method === 'POST') {
        const capture = state.captures.get(id); if (!capture) return json(res, 404, {error: {code: 'not_found'}});
        const complete = capture.files.every(file => {
          const value = capture.data.get(file.path); return value && value.length === file.size && sha(value) === file.sha256;
        });
        if (!complete) return json(res, 409, {error: {code: 'incomplete'}});
        capture.ready = true; await body(req, 16_384);
        return json(res, 200, {id, status: 'ready', ...(capture.format === 'plaintext-v1' ? {} : {format: capture.format})});
      }
      if (!suffix && method === 'GET') {
        const capture = state.captures.get(id); if (!capture) return json(res, 404, {error: {code: 'not_found'}});
        return json(res, 200, {id, status: capture.ready ? 'ready' : 'pending', ...(capture.format === 'plaintext-v1' ? {} : {format: capture.format}), files: capture.files});
      }
      return json(res, 404, {error: {code: 'not_found'}});
    }
    return json(res, 404, {error: {code: 'not_found'}});
  } catch (error) {
    if (req.aborted || res.destroyed) return;
    json(res, 400, {error: {code: error instanceof Error ? error.message : 'invalid_request'}});
  }
}

async function underTmp(value: string) {
  const absolute = await realpath(value);
  // macOS resolves /tmp to /private/tmp; compare canonical paths on both OSes.
  const relative = path.relative(await realpath('/tmp'), absolute);
  if (!relative.startsWith('apparent-dev-') || relative.includes(path.sep)) throw new Error('fixture paths must stay beneath /tmp/apparent-dev-<job>-<run>/');
  return absolute;
}
async function makeBundle(args: Record<string, string | boolean>) {
  const root = await underTmp(String(args.root ?? ''));
  const captures = path.resolve(String(args.captures ?? path.join(root, 'captures')));
  if (!captures.startsWith(root + path.sep)) throw new Error('--captures must be beneath the private fixture root');
  await mkdir(captures, {recursive: true, mode: 0o700}); await chmod(captures, 0o700);
  const directory = path.join(captures, 'synthetic.apparent');
  await mkdir(directory, {mode: 0o700});
  await mkdir(path.join(directory, 'frames'), {mode: 0o700});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R+8AAAAASUVORK5CYII=', 'base64');
  const summary = Buffer.from('Synthetic local foreground-upload fixture.\nNo person or private capture data.\n');
  const timestamp = Date.now();
  const metadata = Buffer.from(JSON.stringify({version: 1, id: randomBytes(16).toString('hex'), createdAtMs: timestamp, durationMs: 1000,
    target: {mode: 'display', app: null, bundleId: null, windowTitle: null, windowId: null, displayId: 1, frame: {x: 0, y: 0, width: 1, height: 1, scale: 1}},
    transcript: {source: 'synthetic', model: null, text: 'Synthetic foreground fixture', segments: [{t0: 0, t1: 1000, text: 'Synthetic foreground fixture'}], words: [], estimated: false, missing: null},
    strokes: [], marks: [], events: [], keyframes: [{index: 0, t: 0, reason: 'initial', file: 'frames/frame-0001.png', event: 'synthetic', said: null, markId: null, cursor: null}],
    contactSheet: 'contact-sheet.png', video: null, audio: null}) + '\n');
  const files: Record<string, Buffer> = {'apparent.json': metadata, 'summary.md': summary, 'contact-sheet.png': png, 'frames/frame-0001.png': png};
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(directory, name), bytes, {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({bundle: directory, captures, files: Object.entries(files).map(([name, bytes]) => ({path: name, size: bytes.length, sha256: sha(bytes)})), syntheticOnly: true}));
}

async function main() {
  const command = process.argv[2];
  const parsed = parseArgs({args: process.argv.slice(3), options: {
    root: {type: 'string'}, port: {type: 'string'},
  }}).values;
  if (command === 'bundle') return makeBundle(parsed);
  if (command !== 'serve') throw new Error('usage: foreground-fixture.ts serve --port 0 | bundle --root /tmp/apparent-dev-...');
  const port = Number(parsed.port ?? 0);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
  const state: FixtureState = {origin: '', calls: {}, captures: new Map(), approved: 0, polls: 0, putCount: 0, bytesIn: 0, digests: [], aborted: 0, devices: [], pendingKey: null, pendingScope: 'upload'};
  const server = createServer((req, res) => { void handle(req, res, state); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not bind TCP');
  state.origin = `http://127.0.0.1:${address.port}`;
  console.log(JSON.stringify({ready: true, origin: state.origin, syntheticOnly: true}));
  const stop = async () => {
    server.close();
    console.log(JSON.stringify({syntheticOnly: true, calls: state.calls, approvedLogins: state.approved, readyCaptures: [...state.captures.values()].filter(c => c.ready).length, uploadedBytes: state.bytesIn, abortedRequests: state.aborted}));
    process.exit(0);
  };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'fixture failed'); process.exitCode = 1; });
