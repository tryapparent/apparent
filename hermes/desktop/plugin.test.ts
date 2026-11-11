import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { host, shared } from './testing/sdk.ts';
import { sign } from './controller.ts';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (['@hermes/plugin-sdk', 'react/jsx-runtime'].includes(specifier)) return { url: new URL('./testing/sdk.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const plugin = (await import('./plugin.ts')).default;
hooks.deregister();
async function until(predicate: () => unknown) {
  const deadline = Date.now() + 1500;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Async test condition did not settle'); await new Promise(resolve => setTimeout(resolve, 2)); }
}
function fixture(stored: any = null, delayedWrite = 0) {
  let contribution: any, discard: any, interval: (() => void) | undefined, saved: any;
  let writes = 0;
  let startDelayedWrite!: () => void; let releaseDelayedWrite!: () => void;
  const delayedStarted = new Promise<void>(resolve => { startDelayedWrite = resolve; });
  const delayedRelease = new Promise<void>(resolve => { releaseDelayedWrite = resolve; });
  let dispose = () => {};
  const ctx = {
    onDispose: (fn: () => void) => { dispose = fn; },
    setInterval: (fn: () => void) => { interval = fn; return () => { interval = undefined; }; },
    storage: { get: () => stored, set: async (_key: string, value: unknown) => {
      writes++;
      if (writes === delayedWrite) { startDelayedWrite(); await delayedRelease; }
      saved = structuredClone(value);
    } },
    register: (item: any) => { if (item.id === 'record') contribution = item; else discard = item; },
  };
  plugin.register(ctx);
  return { click: () => contribution.render().props.onClick(), discard: () => discard.data.run(), tick: () => interval?.(), saved: () => saved,
    watching: () => Boolean(interval), waitDelayedWrite: () => delayedStarted, releaseDelayedWrite, writes: () => writes, dispose: () => dispose() };
}
async function packet(phase: string, source = shared.source) {
  const payload = JSON.stringify({ phase, ...(phase === 'saved' ? { source } : {}) });
  return Response.json({ payload, mac: await sign(shared.key, payload) });
}
function reset() {
  shared.sessionCreateGate = undefined; shared.sessionCreateStart = undefined;
  shared.owner = { connectionId: 'ssh-A', profile: 'work' };
  shared.session = 'runtime-A'; shared.storedSession = 'stored-A';
  shared.routes = [
    { connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote' },
    { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
  ];
  shared.requests = []; shared.submissions = []; shared.errors = [];
  shared.insertions = []; shared.draftReads = []; shared.opens = [];
  shared.source = 'cccccccccccccccccccccccccccccccc'; shared.draft = 'typed draft must remain unchanged'; shared.acceptSubmit = true; shared.acceptInsert = true;
  shared.newDraft = 'typed draft must remain unchanged'; shared.draftReadGate = undefined; shared.draftReadStart = undefined;
  shared.sessionCreate = { session_id: 'created-runtime', stored_session_id: 'created-stored' };
}

test('starts through the local legacy shell contract and inserts a handoff block without changing typed text', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; let acknowledgements = 0; const f = fixture();
  globalThis.fetch = async url => {
    if (String(url).includes('/ack/')) { acknowledgements++; return Response.json({ ok: true }); }
    return packet(phase);
  };
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.params.command.includes('hermes record')));
    const start = shared.requests[0] as any;
    assert.equal(start.route.connectionId, 'local-A');
    assert.deepEqual(Object.keys(start.params), ['command']);
    assert.match(start.params.command, /^apparent hermes record '[a-f0-9]{32}\/\d+'$/);
    phase = 'saved'; f.tick(); await until(() => acknowledgements === 1);
    assert.equal(shared.submissions.length, 0);
    assert.equal(shared.insertions.length, 1);
    assert.equal(shared.insertions[0].session, 'runtime-A');
    assert.ok(shared.draftReads.includes('runtime-A'));
    assert.equal(shared.insertions[0].mode, 'block');
    assert.match(shared.insertions[0].text, /apparent_inspect/);
    assert.match(shared.insertions[0].text, /make-it-apparent/);
    assert.match(shared.insertions[0].text, /playable video/);
    assert.match(shared.draft, /^typed draft must remain unchanged\n\nApparent recording/);
    assert.ok(shared.requests.every((item: any) => item.method === 'shell.exec' && !('session_id' in item.params)));
    assert.equal(shared.requests.some((item: any) => item.method === 'runtime.describe' || item.method === 'prompt.submit'), false);
    assert.equal(f.saved(), null);
  } finally { globalThis.fetch = originalFetch; }
});

test('destination owner, runtime id, stored id, and exact visible composer must still match', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; let reads = 0; const f = fixture();
  globalThis.fetch = async () => { reads++; return packet(phase); };
  try {
    f.click(); await until(() => shared.requests.length >= 1);
    phase = 'saved'; shared.owner = { connectionId: 'other', profile: 'work' };
    await until(() => { f.tick(); return reads >= 2; });
    assert.equal(shared.submissions.length, 0);
    assert.equal(f.saved().source, shared.source);
    shared.owner = { connectionId: 'ssh-A', profile: 'work' };
    shared.storedSession = 'replaced-stored-session';
    await until(() => { f.tick(); return reads >= 3; });
    assert.equal(shared.submissions.length, 0);
    assert.equal(f.saved().source, shared.source);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('empty drafts submit once through the exact pinned composer', async () => {
  reset(); shared.draft = '';
  const originalFetch = globalThis.fetch; const f = fixture(); globalThis.fetch = async () => packet('saved');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    f.tick(); await until(() => shared.submissions.length === 1);
    assert.equal(shared.submissions[0].session, 'runtime-A');
    assert.match(shared.submissions[0].text, /playable video/);
    assert.equal(shared.insertions.length, 0);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('fresh drafts bind through idempotent session.create and public openSession before recording', async () => {
  reset(); shared.session = null as any; shared.storedSession = null as any;
  shared.draft = '';
  const originalFetch = globalThis.fetch; let phase = 'recording'; const f = fixture();
  globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet(phase);
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    const create = shared.requests.find((item: any) => item.method === 'session.create') as any;
    assert.equal(create.route.connectionId, 'ssh-A');
    assert.deepEqual(Object.keys(create.params), ['idempotency_key']);
    assert.match(create.params.idempotency_key, /^[a-f0-9]{32}$/);
    assert.equal(shared.opens.length, 1);
    assert.equal((shared.opens[0] as any).storedSession, 'created-stored');
    assert.equal((shared.opens[0] as any).options.route.connectionId, 'ssh-A');
    assert.equal((shared.opens[0] as any).options.awaitHydration, true);
    assert.equal(shared.requests.some((item: any) => item.method === 'session.activate'), false);
    assert.equal(shared.insertions.length, 1, 'the pre-existing new-chat draft is preserved in the bound conversation');
    assert.equal(shared.insertions[0].text, 'typed draft must remain unchanged');
    assert.equal(shared.insertions[0].mode, 'block');
    assert.ok(shared.draftReads.includes('new'));
    assert.ok(shared.draftReads.includes('resumed-runtime'));
    const captureRequest = shared.requests.find((item: any) => item.method === 'shell.exec') as any;
    assert.deepEqual(captureRequest.route, shared.routes[1]);
    phase = 'saved'; f.tick(); await until(() => shared.insertions.length === 2);
    assert.equal(shared.insertions[1].session, 'resumed-runtime');
    assert.equal(shared.submissions.length, 0);
    assert.match(shared.draft, /typed draft must remain unchanged[\s\S]*playable video/);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('typing during fresh session creation preserves the live draft and aborts navigation and recording', async () => {
  reset(); shared.session = null as any; shared.storedSession = null as any; shared.newDraft = 'initial text';
  let release!: () => void;
  shared.sessionCreateGate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { shared.sessionCreateStart = resolve; });
  const f = fixture();
  try {
    f.click(); await started;
    shared.newDraft = 'initial text plus newly typed text';
    release();
    await until(() => shared.errors.length > 0);
    assert.equal(shared.newDraft, 'initial text plus newly typed text');
    assert.equal(shared.opens.length, 0);
    assert.equal(shared.requests.some((request: any) => request.method === 'shell.exec'), false);
    assert.equal(shared.insertions.length, 0);
    assert.equal(shared.submissions.length, 0);
  } finally { release(); f.dispose(); }
});

test('typing during the final fresh-route check aborts navigation with the latest text intact', async () => {
  reset(); shared.session = null as any; shared.storedSession = null as any; shared.newDraft = 'initial text';
  const originalRoutes = host.profileRoutes;
  let calls = 0, checking = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  host.profileRoutes = async () => {
    if (++calls === 4) { checking = true; await gate; }
    return originalRoutes();
  };
  const f = fixture();
  try {
    f.click(); await until(() => checking);
    shared.newDraft = 'initial text plus text during route validation';
    release();
    await until(() => shared.errors.length > 0);
    assert.equal(shared.newDraft, 'initial text plus text during route validation');
    assert.equal(shared.opens.length, 0);
    assert.equal(shared.requests.some((request: any) => request.method === 'shell.exec'), false);
    assert.equal(shared.insertions.length, 0);
  } finally { release(); host.profileRoutes = originalRoutes; f.dispose(); }
});

test('remote destinations require an existing Connect ID and never trigger upload or read-grant changes', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'saved'; const f = fixture();
  globalThis.fetch = async () => packet(phase, '/private/local.apparent');
  try {
    f.click(); await until(() => shared.requests.length > 0);
    f.tick(); await until(() => shared.errors.some(message => message.includes('existing Connect ID')));
    assert.equal(shared.submissions.length, 0);
    assert.equal(shared.requests.every((item: any) => item.method === 'shell.exec'), true);
    assert.ok(!JSON.stringify(shared.requests).includes('upload'));
    assert.ok(!JSON.stringify(shared.requests).includes('read grant'));
  } finally { globalThis.fetch = originalFetch; }
});

test('a false composer dispatch retains the source for manual recovery without retrying', async () => {
  reset(); shared.acceptInsert = false; const originalFetch = globalThis.fetch;
  const f = fixture(); globalThis.fetch = async () => packet('saved');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    f.tick(); await until(() => shared.errors.some(message => message.includes('did not dispatch')));
    assert.equal(shared.submissions.length, 0);
    assert.equal(shared.insertions.length, 0);
    assert.equal(f.saved().source, shared.source);
    f.tick(); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(shared.insertions.length, 0);
    f.dispose();
    const reload = fixture(f.saved()); await new Promise(resolve => setTimeout(resolve, 10));
    reload.tick(); assert.equal(shared.insertions.length, 0);
    assert.equal(reload.watching(), false);
    reload.dispose();
  } finally { globalThis.fetch = originalFetch; }
});

test('storage delay followed by focus change cannot mutate even when session IDs stay the same', async () => {
  reset(); const originalFetch = globalThis.fetch; const f = fixture(null, 3);
  globalThis.fetch = async () => packet('saved');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    f.tick(); await f.waitDelayedWrite();
    shared.owner = { connectionId: 'ssh-B', profile: 'work' };
    shared.routes = [
      { connectionId: 'ssh-B', profile: 'work', targetProfile: 'work', mode: 'remote' },
      { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
    ];
    f.releaseDelayedWrite();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(shared.session, 'runtime-A');
    assert.equal(shared.storedSession, 'stored-A');
    assert.equal(shared.submissions.length, 0);
    assert.equal(shared.insertions.length, 0);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('a focus change while getDraft is delayed prevents composer mutation', async () => {
  reset(); const originalFetch = globalThis.fetch; const f = fixture();
  let begin!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  shared.draftReadGate = new Promise<void>(resolve => { release = resolve; });
  shared.draftReadStart = begin;
  globalThis.fetch = async () => packet('saved');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    f.tick(); await started;
    shared.owner = { connectionId: 'ssh-B', profile: 'work' };
    shared.routes = [
      { connectionId: 'ssh-B', profile: 'work', targetProfile: 'work', mode: 'remote' },
      { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
    ];
    release(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(shared.insertions.length, 0);
    assert.equal(shared.submissions.length, 0);
  } finally { shared.draftReadGate = undefined; shared.draftReadStart = undefined; globalThis.fetch = originalFetch; f.dispose(); }
});

test('reload during post-dispatch storage save cannot replay an ambiguous handoff', async () => {
  reset(); const originalFetch = globalThis.fetch; const f = fixture(null, 4);
  globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet('saved');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    f.tick(); await until(() => shared.insertions.length === 1);
    await f.waitDelayedWrite();
    assert.equal(f.saved().sending, true);
    f.dispose();
    const reload = fixture(f.saved()); await until(() => shared.errors.some(message => message.includes('may have dispatched')));
    reload.tick(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(shared.insertions.length, 1);
    assert.equal(shared.submissions.length, 0);
    assert.equal(reload.watching(), false);
    reload.dispose();
    f.releaseDelayedWrite();
  } finally { globalThis.fetch = originalFetch; }
});

test('a persisted ambiguous SDK dispatch is never replayed after reload', async () => {
  reset();
  const pending = {
    version: 3, token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', port: 45000, created: Date.now(), source: shared.source, sending: true,
    destination: { session: 'runtime-A', storedSession: 'stored-A', connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote', local: false },
    localRoute: { connectionId: 'local-A', profile: 'default', targetProfile: 'default' },
  };
  const f = fixture(pending); await until(() => shared.errors.length > 0);
  f.tick(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(shared.submissions.length, 0);
  assert.equal(shared.requests.length, 0);
  assert.equal(f.watching(), false);
});

test('no route or source failure sends into a different conversation', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; const f = fixture();
  globalThis.fetch = async () => packet(phase);
  try {
    f.click(); await until(() => shared.requests.length > 0);
    phase = 'saved'; shared.routes = shared.routes.filter(route => route.connectionId !== 'ssh-A');
    f.tick(); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(shared.submissions.length, 0);
    assert.equal(shared.insertions.length, 0);
    assert.equal(f.saved().source, shared.source);
  } finally { globalThis.fetch = originalFetch; }
});
