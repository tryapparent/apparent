import {createServer} from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {secret} from './config.ts';
import type {Config} from './config.ts';
import type {Store} from './store.ts';

export function notification(value: unknown, project: number): string | null {
  const input = value as {project_id?: unknown; event?: {event?: unknown; distinct_id?: unknown}};
  if (!input || ![project, String(project)].includes(input.project_id as number | string)) throw Error('Wrong project');
  if (input.event?.event !== '$error_tracking_issue_created') return null;
  const issue = input.event.distinct_id;
  if (typeof issue !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(issue))
    throw Error('Invalid issue');
  return issue.toLowerCase();
}
export function server(store: Store, c: Config) {
  const app = createServer(async (req, res) => {
    const reply = (status: number, data: object) => {if (!res.destroyed) res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}).end(JSON.stringify(data));};
    if (req.url === '/health' && req.method === 'GET') return reply(200, {ok:true});
    if (req.url !== '/webhooks/posthog' || req.method !== 'POST') return reply(404, {error:'not_found'});
    try {
      const expected = `Bearer ${secret(c.webhookTokenFile)}`;
      const actual = req.headers.authorization ?? '';
      const hash = (value: string) => createHash('sha256').update(value).digest();
      if (!timingSafeEqual(hash(actual), hash(expected))) {reply(401, {error:'unauthorized'}); req.resume(); return;}
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        reply(415, {error:'json_required'}); req.resume(); return;
      }
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 16384) {reply(413, {error:'too_large'}); return;}
        chunks.push(Buffer.from(chunk));
      }
      let issue: string | null;
      try {issue = notification(JSON.parse(Buffer.concat(chunks).toString('utf8')), c.projectId);}
      catch {return reply(400, {error:'invalid_notification'});}
      if (!issue) return reply(202, {status:'ignored'});
      const status = store.enqueue(issue, c.queueLimit);
      if (status === 'full') {res.setHeader('Retry-After','60'); return reply(503, {error:'queue_full'});}
      return reply(202, {status});
    } catch {reply(503, {error:'unavailable'});}
  });
  app.requestTimeout = 5000; app.headersTimeout = 5000; app.timeout = 5000;
  app.maxHeadersCount = 30;
  return app;
}
