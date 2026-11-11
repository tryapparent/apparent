import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { shared } from './testing/sdk.ts';
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
function fixture(stored: any = null) {
  let contribution: any, discard: any, interval: (() => void) | undefined, saved: any;
  let dispose = () => {};
  const ctx = {
    onDispose: (fn: () => void) => { dispose = fn; },
    setInterval: (fn: () => void) => { interval = fn; return () => { interval = undefined; }; },
    storage: { get: () => stored, set: async (_key: string, value: unknown) => { saved = structuredClone(value); } },
    register: (item: any) => { if (item.id === 'record') contribution = item; else discard = item; },
  };
  plugin.register(ctx);
  return { click: () => contribution.render().props.onClick(), discard: () => discard.data.run(), tick: () => interval?.(), saved: () => saved, watching: () => Boolean(interval), dispose: () => dispose() };
}
async function packet(phase: string, source = shared.source) {
  const payload = JSON.stringify({ phase, ...(phase === 'saved' ? { source } : {}) });
  return Response.json({ payload, mac: await sign(shared.key, payload) });
}
function reset() {
  shared.owner = { connectionId: 'ssh-A', profile: 'work' };
  shared.session = 'runtime-A'; shared.storedSession = 'stored-A';
  shared.routes = [
    { connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote' },
    { connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local' },
  ];
  shared.requests = []; shared.submissions = []; shared.errors = [];
  shared.source = 'cccccccccccccccccccccccccccccccc'; shared.draft = 'typed draft must remain unchanged'; shared.acceptSubmit = true;
}

test('starts through the local legacy shell contract and submits once through the pinned composer API', async () => {
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
    assert.equal(shared.submissions.length, 1);
    assert.equal(shared.submissions[0].session, 'runtime-A');
    assert.match(shared.submissions[0].text, /apparent_inspect/);
    assert.match(shared.submissions[0].text, /make-it-apparent/);
    assert.match(shared.submissions[0].text, /playable video/);
    assert.equal(shared.draft, 'typed draft must remain unchanged');
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

test('new chats fail closed before recording because the SDK exposes no stable draft identity', async () => {
  reset(); shared.session = null as any; shared.storedSession = null as any;
  const f = fixture(); f.click(); await until(() => shared.errors.length > 0);
  assert.match(shared.errors[0], /Unsaved chats cannot be pinned safely/);
  assert.equal(shared.requests.length, 0);
  assert.equal(shared.submissions.length, 0);
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
  reset(); shared.acceptSubmit = false; const originalFetch = globalThis.fetch;
  const f = fixture(); globalThis.fetch = async () => packet('saved');
  try {
    f.click(); await until(() => shared.requests.length > 0);
    f.tick(); await until(() => shared.errors.some(message => message.includes('no longer visible')));
    assert.equal(shared.submissions.length, 0);
    assert.equal(f.saved().source, shared.source);
    f.tick(); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(shared.submissions.length, 0);
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
    f.tick(); await until(() => shared.errors.some(message => message.includes('original Hermes route changed')));
    assert.equal(shared.submissions.length, 0);
    assert.equal(f.saved().source, shared.source);
  } finally { globalThis.fetch = originalFetch; }
});
