import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fstatSync, lstatSync} from 'node:fs';
import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import type {Config} from './config.ts';
import type {Store} from './store.ts';
import {fetchSupportArchive} from './support-report.ts';

export const supportSocket = '/run/apparent-posthog-support.sock';

export function activatedSupportFd(env = process.env): number {
  if (env.LISTEN_PID !== String(process.pid) || env.LISTEN_FDS !== '1' || env.LISTEN_FDNAMES !== 'apparent-support')
    throw Error('System support socket activation is required');
  const socket = lstatSync(supportSocket);
  const inherited = fstatSync(3);
  if (!socket.isSocket() || socket.uid !== 0 || !inherited.isSocket())
    throw Error('Invalid system support socket');
  return 3;
}

export function authorizedSupportPeer(executable: string, socket: Socket, uid: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['connect', 'check-support-peer', String(uid)], {
      stdio: ['ignore', 'ignore', 'ignore', socket], timeout: 2500,
    });
    child.once('error', reject);
    child.once('close', code => resolve(code === 0));
  });
}

export function supportServer(store: Store, c: Config, loadArchive = fetchSupportArchive, authorizePeer = authorizedSupportPeer) {
  const support = c.support;
  if (!support) throw Error('Support reader is unavailable');
  let loading = false;
  const app = createServer(async (req, res) => {
    const finish = (status: number) => {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else res.writeHead(status, {'Cache-Control':'no-store'}).end();
    };
    const thread = /^\/support\/([a-f0-9-]{36})$/.exec(req.url ?? '')?.[1];
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
    if (req.method !== 'GET' || !thread || !token || req.socket.remoteAddress !== undefined) return finish(404);
    if (loading) return finish(503);
    loading = true;
    try {
      const digest = createHash('sha256').update(token).digest('hex');
      if (!store.supportAccessActive(thread, Date.now(), digest)) return finish(404);
      if (!await authorizePeer(support.executable, req.socket, support.agentUid)) return finish(404);
      const report = store.supportAccess(thread, digest, Date.now());
      if (!report) return finish(404);
      res.setTimeout(900000, () => res.destroy());
      const archive = await loadArchive(c, report);
      try {
        if (!store.supportAccessActive(thread, Date.now(), digest)) return finish(404);
        if (res.destroyed) return;
        res.writeHead(200, {'Content-Type':'application/x-tar', 'Content-Length':archive.bytes,
          'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
        await pipeline(archive.body, res);
      } finally {
        archive.body.destroy();
        await archive.dispose();
      }
    } catch {finish(503);}
    finally {loading = false;}
  });
  app.requestTimeout = 5000; app.headersTimeout = 5000; app.timeout = 5000;
  app.maxHeadersCount = 20;
  return app;
}
