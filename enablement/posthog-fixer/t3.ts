import {randomUUID} from 'node:crypto';
import {secret} from './config.ts';

export type Projection = {thread: {id: string; projectId: string; settledAt: string | null}; runs: {id: string; status: string}[]};
const statuses = new Set(['preparing','queued','starting','running','waiting','completed','interrupted','failed','cancelled','rolled_back']);
const terminal = new Set(['completed','interrupted','failed','cancelled','rolled_back']);
export function projection(value: unknown, thread: string, project: string): Projection {
  const p = value as Projection;
  if (!p?.thread || p.thread.id !== thread || p.thread.projectId !== project ||
      !(p.thread.settledAt === null || typeof p.thread.settledAt === 'string') || !Array.isArray(p.runs) || !p.runs.length ||
      p.runs.some(run => typeof run.id !== 'string' || !statuses.has(run.status))) throw Error('Invalid T3 projection');
  return p;
}
export function settled(p: Projection): boolean {return !!p.thread.settledAt && p.runs.every(run => terminal.has(run.status));}
export class T3 {
  readonly origin: string; readonly tokenFile: string; readonly timeout: number;
  constructor(origin: string, tokenFile: string, timeout = 15000) {this.origin=origin; this.tokenFile=tokenFile; this.timeout=timeout;}
  async call(tag: string, payload: unknown): Promise<unknown> {
    const response = await fetch(`${this.origin}/api/auth/websocket-ticket`, {method: 'POST', redirect: 'error',
      headers: {Authorization: `Bearer ${secret(this.tokenFile)}`}, signal: AbortSignal.timeout(this.timeout)});
    if (!response.ok) throw Error('T3 ticket request failed');
    const ticket = await response.json() as {ticket?: string};
    if (typeof ticket.ticket !== 'string' || !ticket.ticket) throw Error('Invalid T3 ticket');
    const url = new URL('/ws', this.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('orchestrationProtocol', '2'); url.searchParams.set('wsTicket', ticket.ticket);
    return new Promise((resolve, reject) => {
      const id = randomUUID(); const ws = new WebSocket(url);
      let finished = false;
      const finish = (error?: Error, value?: unknown) => {
        if (finished) return; finished = true; clearTimeout(timer);
        try {ws.close();} catch { /* A failed connection may still be CONNECTING. */ }
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(Error('T3 RPC timed out')), this.timeout);
      ws.addEventListener('open', () => ws.send(JSON.stringify({_tag: 'Request', id, tag, payload, headers: []})));
      ws.addEventListener('error', () => finish(Error('T3 socket failed')));
      ws.addEventListener('close', () => finish(Error('T3 socket closed')));
      ws.addEventListener('message', event => {
        try {
          // Effect's JSON serialization frames are newline-delimited; ignore other request IDs and pushes.
          for (const line of String(event.data).split('\n').filter(Boolean)) {
            const frame = JSON.parse(line);
            if (frame._tag === 'Ping') ws.send(JSON.stringify({_tag: 'Pong'}));
            if (frame._tag !== 'Exit' || frame.requestId !== id) continue;
            if (frame.exit?._tag !== 'Success') return finish(Error('T3 RPC rejected'));
            return finish(undefined, frame.exit.value);
          }
        } catch {finish(Error('Invalid T3 RPC response'));}
      });
    });
  }
}
