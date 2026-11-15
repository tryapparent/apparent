import {config, secret} from './config.ts';
import {Store} from './store.ts';
import {T3} from './t3.ts';
import {Worker, contextReader} from './worker.ts';
import {server} from './http.ts';

async function main() {
  process.umask(0o077);
  const c = config(process.env);
  secret(c.webhookTokenFile); secret(c.t3TokenFile);
  const store = new Store(c.stateDirectory, JSON.stringify({project: c.projectId, posthog: c.posthogOrigin, t3: c.t3Origin, projectId: c.t3ProjectId}));
  const t3 = new T3(c.t3Origin, c.t3TokenFile);
  const worker = new Worker(store, c, {call: (tag, payload) => t3.call(tag, payload), context: contextReader(c)});
  const app = server(store, c);
  let stopping = false;
  let inFlight: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (!stopping && !worker.busy) inFlight = worker.tick().catch(() => console.error('posthog-fixer: worker unavailable'));
  }, 5000);
  const stop = () => {
    if (stopping) return; stopping = true; clearInterval(timer);
    app.close(() => {
      // Finish the bounded in-flight operation before releasing the process lock.
      void inFlight.finally(() => {store.close(); process.exitCode = 0;});
    });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  app.listen(c.port, '127.0.0.1', () => console.log('posthog-fixer: listening on loopback'));
  app.on('error', () => {clearInterval(timer); store.close(); console.error('posthog-fixer: listener unavailable'); process.exitCode = 1;});
}
main().catch(() => {console.error('posthog-fixer: startup failed; check private configuration and single-owner lock'); process.exitCode = 1;});
