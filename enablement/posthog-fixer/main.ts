import {once} from 'node:events';
import {config, secret} from './config.ts';
import {Store} from './store.ts';
import {T3} from './t3.ts';
import {Worker, contextReader} from './worker.ts';
import {server} from './http.ts';
import {activatedSupportFd, supportServer} from './support-socket.ts';

async function main() {
  process.umask(0o077);
  const c = config(process.env);
  secret(c.webhookTokenFile); secret(c.t3TokenFile);
  const supportFd = c.support && activatedSupportFd();
  const store = new Store(c.stateDirectory, JSON.stringify({project: c.projectId, posthog: c.posthogOrigin, t3: c.t3Origin, projectId: c.t3ProjectId}));
  const t3 = new T3(c.t3Origin, c.t3TokenFile);
  const worker = new Worker(store, c, {call: (tag, payload) => t3.call(tag, payload), context: contextReader(c)});
  const app = server(store, c);
  const support = supportFd === undefined ? undefined : supportServer(store, c);
  try {
    if (support) await once(support.listen({fd:supportFd}), 'listening');
    await once(app.listen(c.port, '127.0.0.1'), 'listening');
  } catch (error) {
    support?.close();
    store.close();
    throw error;
  }
  let stopping = false;
  let inFlight: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (!stopping && !worker.busy) inFlight = worker.tick().catch(() => console.error('posthog-fixer: worker unavailable'));
  }, 5000);
  const stop = () => {
    if (stopping) return; stopping = true; clearInterval(timer);
    const closed = [new Promise<void>(resolve => {app.close(() => resolve());})];
    if (support) closed.push(new Promise<void>(resolve => {support.close(() => resolve());}));
    void Promise.all([...closed, inFlight]).finally(() => {store.close();});
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  console.log('posthog-fixer: listening on loopback');
}
main().catch(() => {console.error('posthog-fixer: startup failed; check private configuration and single-owner lock'); process.exitCode = 1;});
