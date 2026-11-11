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
function fixture(external = true, stored: any = null) {
  let contribution: any, discard: any, interval: (() => void) | undefined, saved: any, launch: string | undefined;
  let dispose = () => {};
  const ctx = { onDispose: (fn: () => void) => { dispose = fn; }, setInterval: (fn: () => void) => { interval = fn; return () => { interval = undefined; }; },
    storage: { get: () => stored, set: (_key: string, value: unknown) => { saved = structuredClone(value); } },
    os: { openExternal: async (url: string) => { launch = url; return external; } }, register: (c: any) => { if (c.id === 'record') contribution = c; else discard = c; } };
  plugin.register(ctx);
  return { click: () => contribution.render().props.onClick(), discard: () => discard.data.run(), tick: () => interval?.(), saved: () => saved, launch: () => launch || (shared.submissions.find((v: any) => v.method === 'shell.exec' && v.params.command.includes('hermes record')) as any)?.params.command, watching: () => Boolean(interval), dispose: () => dispose() };
}
async function packet(secret: string, phase: string) {
  const payload = JSON.stringify({ phase, ...(phase === 'saved' ? { source: '/private/owned.apparent' } : {}) });
  return Response.json({ payload, mac: await sign(secret, payload) });
}
function reset() {
  shared.submissions = []; shared.failSubmit = false; shared.session = 'runtime-A'; shared.owner = { connectionId: 'local-A', profile: 'work' };
  shared.draftText = ''; shared.draftInserts = []; shared.draftSubmits = [];
  shared.captureBundle = '/private/owned.apparent'; shared.handoffSource = 'c'.repeat(32);
  shared.runtimeCalls = 0; shared.runtimeDescribeHook = null;
  shared.routes = [{ connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local' }];
  shared.runtime.instance_id = 'runtime-instance-A';
  shared.launchWait = null; shared.keyReads = []; shared.failLaunch = false;
  (globalThis as any).localStorage = { getItem: () => 'fresh-draft-1' };
  (globalThis as any).document = { querySelectorAll: () => [{ isConnected: true }] };
}
test('completion submits once to captured gateway/session after foreground switches; next click records again', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; let acknowledgements = 0; const f = fixture();
  globalThis.fetch = async url => {
    if (String(url).includes('/ack/')) { acknowledgements++; return Response.json({ ok: true }); }
    return packet(shared.key, phase);
  };
  try {
    f.click(); await until(() => f.launch());
    assert.match(f.launch()!, /hermes record '[a-f0-9]{32}\/\d+'/);
    const first = f.saved();
    shared.session = 'runtime-B'; shared.owner = { connectionId: 'other-gateway', profile: 'work' };
    phase = 'saved'; f.tick(); await until(() => acknowledgements === 1);
    f.tick(); await new Promise(resolve => setTimeout(resolve, 5));
    const sent = shared.submissions.filter((v: any) => v.method === 'prompt.submit') as any[];
    assert.equal(sent.length, 1);
    assert.equal(sent[0].params.session_id, 'runtime-A');
    assert.equal(sent[0].route.connectionId, 'local-A');
    assert.equal(sent[0].params.input_id, first.token);
    assert.equal(shared.keyReads.length, 1);
    assert.equal(shared.keyReads[0].route.connectionId, 'local-A');
    assert.equal(shared.keyReads[0].params.session_id, 'local-helper');
    assert.ok(!JSON.stringify(f.saved()).includes(shared.key));
    shared.owner = { connectionId: 'local-A', profile: 'work' }; phase = 'recording';
    f.click(); await until(() => f.saved()?.token && f.saved().token !== first.token);
  } finally { globalThis.fetch = originalFetch; }
});
test('lost submit replies retry only original input_id and stop; no title lookup', async () => {
  reset(); shared.failSubmit = true; const originalFetch = globalThis.fetch; const f = fixture();
  globalThis.fetch = async () => packet(shared.key, 'saved');
  try {
    f.click(); await until(() => f.launch()); f.tick(); await until(() => !f.watching());
    const sends = shared.submissions.filter((v: any) => v.method === 'prompt.submit');
    assert.equal(sends.length, 2);
    assert.deepEqual(sends[0], sends[1]);
    f.tick(); assert.equal(shared.submissions.filter((v: any) => v.method === 'prompt.submit').length, 2);
  } finally { shared.failSubmit = false; globalThis.fetch = originalFetch; }
});
test('a listener knowing the public launch ID cannot forge completion', async () => {
  reset(); const originalFetch = globalThis.fetch; const f = fixture(); let requested: string | undefined;
  globalThis.fetch = async url => { requested = String(url); return packet(f.saved().token, 'saved'); };
  try {
    f.click(); await until(() => f.launch()); f.tick(); await until(() => requested);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(!requested!.includes(shared.key));
    assert.equal(shared.submissions.filter((v: any) => v.method === 'prompt.submit').length, 0);
    assert.equal(f.saved().source, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
test('changed route mapping or replaced runtime cannot receive the saved recording', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const change of [() => { shared.routes[0].targetProfile = 'other'; }, () => { shared.runtime.instance_id = 'replacement'; }]) {
      reset(); const f = fixture();
      let phase = 'recording';
      let stateReads = 0; let releaseSaved!: () => void; let savedReadStarted!: () => void;
      const savedRead = new Promise<void>(resolve => { savedReadStarted = resolve; });
      const savedResponse = new Promise<void>(resolve => { releaseSaved = resolve; });
      globalThis.fetch = async () => {
        stateReads++;
        if (stateReads === 2) { savedReadStarted(); await savedResponse; }
        return packet(shared.key, phase);
      };
      f.click(); await until(() => f.launch());
      // Drive until a second poll is actually in fetch. That proves the initial
      // poll released its working guard; a single tick can be ignored while it runs.
      await until(() => { f.tick(); return stateReads >= 2; });
      await savedRead;
      change(); phase = 'saved'; releaseSaved();
      await until(() => !f.watching());
      assert.equal(shared.submissions.filter((v: any) => v.method === 'prompt.submit').length, 0);
      assert.equal(f.saved().source, '/private/owned.apparent');
      await f.discard(); assert.equal(f.saved(), null);
    }
  } finally { reset(); globalThis.fetch = originalFetch; }
});
test('remote destinations still start recording through the dedicated local helper only', async () => {
  reset();
  const f = fixture(false);
  f.click(); await until(() => f.watching());
  assert.equal(shared.submissions.length, 1);
  const call = shared.submissions[0] as any;
  assert.equal(call.method, 'shell.exec');
  assert.equal(call.route.connectionId, 'local-A');
  assert.equal(call.params.session_id, 'local-helper');
  assert.ok(call.params.command.includes(f.launch()));
  reset(); shared.owner = { connectionId: 'remote-A', profile: 'work' };
  shared.routes = [{ connectionId: 'remote-A', profile: 'work', targetProfile: 'work', mode: 'ssh' }, { connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local' }];
  const remote = fixture(false); remote.click();
  await until(() => remote.launch());
  assert.match(remote.launch()!, /hermes record '[a-f0-9]{32}\/\d+'/);
  assert.equal((shared.submissions[0] as any).route.connectionId, 'local-A');
  reset();
});
test('a lost local launch reply retains the original pending handoff without launching again', async () => {
  reset(); shared.failLaunch = true;
  const f = fixture(false); f.click();
  await until(() => f.watching());
  assert.ok(f.saved().token);
  assert.equal(shared.submissions.length, 1);
  f.click(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(shared.submissions.length, 1);
  f.dispose(); reset();
});
test('unloading during local launch leaves recovery persisted and never creates a timer afterward', async () => {
  reset(); let finish!: () => void;
  shared.launchWait = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture(false); f.click();
  await until(() => shared.submissions.length === 1);
  f.dispose(); finish(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(f.saved().token);
  assert.equal(f.watching(), false);
  reset();
});
test('old pending sources cannot bypass the private-key protocol after reload', async () => {
  reset();
  const old = { token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', port: 45000, created: Date.now(), source: '/private/old.apparent',
    destination: { session: 'runtime-A', connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local', local: true }, runtime: shared.runtime };
  const f = fixture(true, old);
  await until(() => f.saved() === null);
  assert.equal(f.watching(), false);
  assert.equal(shared.submissions.length, 0);
  assert.equal(shared.keyReads.length, 0);
});
test('reload obtains the private key again and retries the same saved handoff without launching', async () => {
  reset(); shared.failSubmit = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet(shared.key, 'saved');
  try {
    const first = fixture(); first.click(); await until(() => first.launch()); first.tick();
    await until(() => !first.watching());
    const stored = first.saved(); first.dispose();
    assert.ok(!JSON.stringify(stored).includes(shared.key));
    reset();
    const resumed = fixture(true, stored);
    await until(() => resumed.saved() === null);
    assert.equal(resumed.launch(), undefined);
    assert.equal(shared.keyReads.length, 1);
    assert.equal(shared.submissions.length, 1);
    assert.equal((shared.submissions[0] as any).params.input_id, stored.token);
    assert.equal((shared.submissions[0] as any).params.session_id, stored.destination.session);
    resumed.dispose();
  } finally { reset(); globalThis.fetch = originalFetch; }
});

test('empty new draft submits after recording and typed draft is preserved with an acknowledged insertion', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const typed of ['', 'Please inspect this carefully']) {
      reset(); shared.session = null; shared.draftText = typed; const f = fixture();
      globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet(shared.key, 'saved');
      f.click(); await until(() => f.launch()); f.tick();
      await until(() => typed ? shared.draftInserts.length === 1 : shared.draftSubmits.length === 1);
      if (typed) {
        assert.equal(shared.draftInserts[0].id, 'new');
        assert.equal(shared.draftInserts[0].opts.mode, 'block');
        assert.equal(shared.draftInserts[0].text.includes('/private/owned.apparent'), true);
        assert.equal(shared.draftSubmits.length, 0);
        assert.equal(shared.draftText, typed);
      } else {
        assert.equal(shared.draftSubmits[0].id, 'new');
        assert.equal(shared.draftSubmits[0].text.includes('/private/owned.apparent'), true);
      }
      f.dispose();
    }
  } finally { globalThis.fetch = originalFetch; reset(); }
});

test('new-draft identity change blocks return; explicit retry binds to the current fresh draft', async () => {
  const originalFetch = globalThis.fetch; reset(); shared.session = null; const f = fixture(); let key = 'fresh-draft-1';
  (globalThis as any).localStorage = { getItem: () => key };
  globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet(shared.key, 'saved');
  try {
    f.click(); await until(() => f.launch()); key = 'fresh-draft-2'; f.tick(); await until(() => !f.watching());
    assert.equal(shared.draftSubmits.length, 0);
    assert.ok(f.saved()?.source);
    key = 'fresh-draft-3'; f.click(); await until(() => shared.draftSubmits.length === 1);
    assert.equal(shared.draftSubmits[0].id, 'new');
  } finally { f.dispose(); reset(); }
});

test('draft navigation during the final awaited runtime check prevents capture startup', async () => {
  reset(); shared.session = null; const f = fixture();
  shared.runtimeDescribeHook = count => { if (count === 4) (globalThis as any).localStorage = { getItem: () => 'fresh-draft-moved' }; };
  try {
    f.click(); await until(() => f.saved() === null);
    assert.equal(f.launch(), undefined);
    assert.equal(shared.submissions.some((v: any) => v.method === 'shell.exec' && v.params.command.includes('hermes record')), false);
  } finally { f.dispose(); reset(); }
});

test('new-draft navigation during the final post-read runtime await blocks composer mutation', async () => {
  reset(); shared.session = null; const stored = { version: 3, token: 'f'.repeat(32), port: 45000, created: Date.now(), source: '/private/owned.apparent', draftKey: 'current-draft',
    destination: { session: '', connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local', local: true },
    runtime: shared.runtime, localRoute: { connectionId: 'local-A', profile: 'work', targetProfile: 'work' }, localRuntime: shared.runtime, helper: 'local-helper' };
  const f = fixture(true, stored);
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    const finalRuntimeCall = shared.runtimeCalls + 2;
    shared.runtimeDescribeHook = count => { if (count === finalRuntimeCall) (globalThis as any).localStorage = { getItem: () => 'new-draft-after-read' }; };
    f.click(); await until(() => !f.watching());
    assert.equal(shared.draftSubmits.length, 0);
    assert.equal(shared.draftInserts.length, 0);
    assert.ok(f.saved()?.source);
  } finally { f.dispose(); reset(); }
});

test('restored new draft stays paused until explicit click and does not launch a second capture', async () => {
  reset(); shared.session = null;
  const stored = { version: 3, token: 'e'.repeat(32), port: 45000, created: Date.now(), source: '/private/owned.apparent', draftKey: 'prior-draft',
    destination: { session: '', connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local', local: true },
    runtime: shared.runtime, localRoute: { connectionId: 'local-A', profile: 'work', targetProfile: 'work' }, localRuntime: shared.runtime, helper: 'local-helper' };
  const originalFetch = globalThis.fetch; const f = fixture(true, stored);
  globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet(shared.key, 'saved');
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.watching(), false);
    assert.equal(f.launch(), undefined);
    f.click(); await until(() => shared.draftSubmits.length === 1);
    assert.equal(f.launch(), undefined);
    assert.equal(shared.submissions.some((v: any) => v.method === 'shell.exec' && v.params.command.includes('hermes record')), false);
  } finally { f.dispose(); globalThis.fetch = originalFetch; reset(); }
});

test('remote retry refreshes the same capture source and sends only its Connect ID', async () => {
  reset(); shared.owner = { connectionId: 'remote-A', profile: 'work' };
  shared.routes = [{ connectionId: 'remote-A', profile: 'work', targetProfile: 'work', mode: 'ssh' }, { connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local' }];
  const originalFetch = globalThis.fetch; const f = fixture(); let connectReady = false;
  globalThis.fetch = async url => {
    if (String(url).includes('/ack/')) return Response.json({ ok: true });
    const payload = JSON.stringify({ phase: 'saved', source: '/private/owned.apparent' });
    return Response.json({ payload, mac: await sign(shared.key, payload) });
  };
  try {
    f.click(); await until(() => f.launch()); f.tick(); await until(() => !f.watching());
    assert.equal(shared.submissions.filter((v: any) => v.method === 'prompt.submit').length, 0);
    assert.equal(f.saved().source, '/private/owned.apparent');
    connectReady = true; shared.handoffSource = 'd'.repeat(32); f.click(); await until(() => f.saved() === null);
    const sent = shared.submissions.filter((v: any) => v.method === 'prompt.submit') as any[];
    assert.equal(sent.length, 1);
    assert.match(sent[0].params.text, /d{32}/);
    assert.ok(!sent[0].params.text.includes('/private/owned.apparent'));
  } finally { globalThis.fetch = originalFetch; reset(); }
});

test('local destination resolves a Connect handoff ID to its exact saved local bundle', async () => {
  reset(); const originalFetch = globalThis.fetch; const f = fixture();
  globalThis.fetch = async url => String(url).includes('/ack/') ? Response.json({ ok: true }) : packet(shared.key, 'saved').then(async response => {
    const packet = await response.json(); const payload = JSON.stringify({ phase: 'saved', source: shared.handoffSource });
    return Response.json({ payload, mac: await sign(shared.key, payload) });
  });
  try {
    f.click(); await until(() => f.launch()); f.tick(); await until(() => f.saved() === null);
    const sent = shared.submissions.filter((v: any) => v.method === 'prompt.submit') as any[];
    assert.equal(sent.length, 1);
    assert.match(sent[0].params.text, /\/private\/owned\.apparent/);
    assert.ok(shared.submissions.some((v: any) => v.method === 'shell.exec' && v.params.command.includes('capture inspect')));
    assert.ok(shared.submissions.some((v: any) => v.method === 'shell.exec' && v.params.command.includes('capture handoff')));
  } finally { globalThis.fetch = originalFetch; reset(); }
});

test('text typed during the final connection check is preserved instead of submitted over', async () => {
  reset(); shared.session = null;
  const stored = { version: 3, token: 'e'.repeat(32), port: 45000, created: Date.now(), source: '/private/owned.apparent', draftKey: 'prior-draft',
    destination: { session: '', connectionId: 'local-A', profile: 'work', targetProfile: 'work', mode: 'local', local: true },
    runtime: shared.runtime, localRoute: { connectionId: 'local-A', profile: 'work', targetProfile: 'work' }, localRuntime: shared.runtime, helper: 'local-helper' };
  const originalFetch = globalThis.fetch; const f = fixture(true, stored);
  globalThis.fetch = async () => Response.json({ ok: true });
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    shared.runtimeDescribeHook = count => { if (count === 2) shared.draftText = 'Keep this unfinished instruction'; };
    f.click(); await until(() => f.saved() === null);
    assert.equal(shared.draftSubmits.length, 0);
    assert.equal(shared.draftInserts.length, 1);
    assert.equal(shared.draftText, 'Keep this unfinished instruction');
  } finally { f.dispose(); globalThis.fetch = originalFetch; reset(); }
});
