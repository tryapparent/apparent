import { test } from 'node:test';
import assert from 'node:assert/strict';
import { host, shared } from './testing/sdk.ts';
import { fixture, packet, reset, until } from './testing/fixture.ts';
import { sign } from './controller.ts';
import './testing/setup-cases.ts';

test('composer keeps the accepted Apparent mark while recording state changes', async () => {
  reset(); const f = fixture();
  const icon = () => f.surface().props.children;
  try {
    const before = icon();
    assert.equal(before.type, 'img');
    assert.equal(before.props.src, '__APPARENT_ICON__');
    f.click();
    await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    assert.deepEqual(icon(), before);
  } finally { f.dispose(); }
});

test('canonical remote recording uses an idempotent local helper shell session', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; let acknowledgements = 0; const f = fixture();
  globalThis.fetch = async url => {
    if (String(url).includes('/ack/')) { acknowledgements++; return Response.json({ ok: true }); }
    return packet(phase);
  };
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec' && item.params.command.includes('hermes record')));
    const start = shared.requests.find((item: any) => item.method === 'shell.exec' && item.params.command.includes('hermes record')) as any;
    assert.equal(start.route.connectionId, 'local-A');
    assert.deepEqual(Object.keys(start.params), ['session_id', 'command']);
    assert.equal(start.params.session_id, 'helper-runtime');
    const helper = shared.requests.find((item: any) => item.method === 'session.create' && item.route.connectionId === 'local-A') as any;
    assert.deepEqual(Object.keys(helper.params), ['request_id', 'source']);
    assert.match(helper.params.request_id, /^[a-f0-9]{32}$/);
    assert.equal(helper.params.source, 'gui');
    assert.equal(helper.params.hidden, undefined, 'send only parameters advertised by runtime.describe');
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
    assert.ok(shared.requests.filter((item: any) => item.method === 'shell.exec').every((item: any) => item.params.session_id === 'helper-runtime'));
    assert.equal(shared.requests.some((item: any) => item.method === 'prompt.submit'), false);
    assert.equal(f.saved(), null);
  } finally { globalThis.fetch = originalFetch; }
});

test('canonical local recording binds shell work to the pinned destination session', async () => {
  reset(); shared.owner = { connectionId: 'local-A', profile: 'default' };
  shared.session = 'local-runtime'; shared.storedSession = 'local-stored';
  const originalFetch = globalThis.fetch; const f = fixture();
  globalThis.fetch = async () => packet('recording');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    const shellCalls = shared.requests.filter((item: any) => item.method === 'shell.exec') as any[];
    assert.equal(shellCalls[0].params.session_id, 'local-runtime');
    assert.equal(shared.requests.some((item: any) => item.method === 'session.create' && item.route.mode === 'local'), false);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('local delivery chooses the exact saved bundle even when Connect source and uploads are available', async () => {
  reset(); shared.owner = { connectionId: 'local-A', profile: 'default' };
  shared.session = 'local-runtime'; shared.storedSession = 'local-stored'; shared.draft = '';
  const originalFetch = globalThis.fetch; const f = fixture(); globalThis.fetch = async () => packet('saved', shared.source, '/private/exact-capture.apparent');
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    await new Promise(resolve => setTimeout(resolve, 10)); f.tick();
    await until(() => shared.submissions.length === 1);
    assert.equal(shared.submissions.length + shared.insertions.length, 1, JSON.stringify({ errors: shared.errors, requests: shared.requests, draftReads: shared.draftReads, draft: shared.draft }));
    assert.match(shared.submissions[0].text, /\/private\/exact-capture\.apparent/);
    assert.equal(shared.submissions[0].text.includes(shared.source), false);
    assert.equal(shared.requests.some((item: any) => item.method === 'session.create'), false);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('v3 local pending state migrates without treating its old Connect pointer as the source', async () => {
  reset(); shared.owner = { connectionId: 'local-A', profile: 'default' };
  shared.session = 'local-runtime'; shared.storedSession = 'local-stored';
  const originalFetch = globalThis.fetch;
  const legacy = { version: 3, token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', port: 45000,
    destination: { session: 'local-runtime', storedSession: 'local-stored', connectionId: 'local-A', profile: 'default', targetProfile: 'default', mode: 'local', local: true },
    localRoute: { connectionId: 'local-A', profile: 'default', targetProfile: 'default' }, created: Date.now(),
    source: shared.source };
  const f = fixture(legacy);
  globalThis.fetch = async () => packet('saved', shared.source, '/private/recovered.apparent');
  try {
    await until(() => shared.insertions.length === 1);
    assert.match(shared.insertions[0].text, /\/private\/recovered\.apparent/);
    assert.equal(shared.insertions[0].text.includes(shared.source), false);
    assert.ok(f.history().some((value: any) => value?.version === 4 && value?.bundlePath === '/private/recovered.apparent'));
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('only an unsupported runtime.describe selects the legacy command-only contract', async () => {
  reset(); shared.legacyRuntimeDescribe = true;
  const f = fixture();
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    const calls = shared.requests.filter((item: any) => item.method === 'shell.exec') as any[];
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(item => Object.keys(item.params).join(',') === 'command'));
    assert.equal(shared.requests.some((item: any) => item.method === 'session.create' && item.route.mode === 'local'), false);
  } finally { f.dispose(); }
});

test('unrelated runtime.describe errors stop before any shell launch', async () => {
  reset(); shared.runtimeDescribeError = Object.assign(new Error('gateway permission denied'), { code: 4001, data: { reason: 'permission_denied' } });
  const f = fixture();
  try {
    f.click(); await until(() => shared.errors.length > 0);
    assert.equal(shared.requests.some((item: any) => item.method === 'shell.exec'), false);
    assert.equal(f.saved(), null);
    assert.match(shared.errors[0], /gateway permission denied/);
  } finally { f.dispose(); }
});

test('destination owner, runtime id, stored id, and exact visible composer must still match', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; let reads = 0; const f = fixture();
  globalThis.fetch = async () => { reads++; return packet(phase); };
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
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

test('a changed authenticated receipt cannot switch the capture path or remote source', async () => {
  reset(); const originalFetch = globalThis.fetch; let phase = 'recording'; let factsChanged = false; const f = fixture();
  globalThis.fetch = async () => packet(phase, factsChanged ? 'dddddddddddddddddddddddddddddddd' : shared.source,
    factsChanged ? '/private/other-capture.apparent' : shared.bundlePath);
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    await new Promise(resolve => setTimeout(resolve, 10));
    phase = 'saved';
    shared.owner = { connectionId: 'other', profile: 'work' };
    f.tick(); await until(() => f.saved()?.bundlePath === shared.bundlePath);
    assert.equal(shared.submissions.length, 0);
    shared.owner = { connectionId: 'ssh-A', profile: 'work' };
    factsChanged = true;
    f.tick(); await until(() => shared.errors.some(message => message.includes('Recording return changed')));
    assert.equal(shared.submissions.length, 0);
    assert.equal(f.saved().bundlePath, shared.bundlePath);
    assert.equal(f.saved().remoteSource, shared.source);
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
    assert.deepEqual(Object.keys(create.params), ['request_id', 'source']);
    assert.match(create.params.request_id, /^[a-f0-9]{32}$/);
    assert.equal(create.params.source, 'gui');
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
    if (++calls === 5) { checking = true; await gate; }
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
  globalThis.fetch = async () => packet(phase, null);
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    f.tick(); await until(() => shared.errors.some(message => message.includes('existing Connect ID')));
    assert.equal(shared.submissions.length, 0);
    assert.ok(shared.requests.filter((item: any) => item.method === 'shell.exec').every((item: any) => item.params.session_id === 'helper-runtime'));
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
  reset(); const originalFetch = globalThis.fetch; const f = fixture(null, value => (value as any)?.source === shared.source);
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
  reset(); const originalFetch = globalThis.fetch; const f = fixture(null, value => value === null);
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
    version: 4, token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', port: 45000, created: Date.now(), source: shared.source, bundlePath: shared.bundlePath, remoteSource: shared.source, sending: true,
    destination: { session: 'runtime-A', storedSession: 'stored-A', connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote', local: false },
    localRoute: { connectionId: 'local-A', profile: 'default', targetProfile: 'default' },
  };
  const f = fixture(pending); await until(() => shared.errors.length > 0);
  f.tick(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(shared.submissions.length, 0);
  assert.equal(shared.requests.length, 0);
  assert.equal(f.watching(), false);
});

test('saved remote pending preserves exact receipt facts and sends only the Connect ID', async () => {
  reset();
  const pending = {
    version: 4, token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', port: 45000, created: Date.now(),
    source: shared.source, bundlePath: shared.bundlePath, remoteSource: shared.source,
    destination: { session: 'runtime-A', storedSession: 'stored-A', connectionId: 'ssh-A', profile: 'work', targetProfile: 'work', mode: 'remote', local: false },
    localRoute: { connectionId: 'local-A', profile: 'default', targetProfile: 'default' },
  };
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => packet('saved');
  const f = fixture(pending);
  try {
    await until(() => shared.insertions.length === 1);
    assert.equal(shared.insertions.length, 1);
    assert.match(shared.insertions[0].text, new RegExp(shared.source));
    assert.equal(shared.insertions[0].text.includes(shared.bundlePath), false);
    assert.equal(f.saved(), null);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});

test('no route or source failure sends into a different conversation', async () => {
  reset(); const originalFetch = globalThis.fetch;
  let phase = 'recording'; const f = fixture();
  globalThis.fetch = async () => packet(phase);
  try {
    f.click(); await until(() => shared.requests.some((item: any) => item.method === 'shell.exec'));
    phase = 'saved'; shared.routes = shared.routes.filter(route => route.connectionId !== 'ssh-A');
    f.tick(); await until(() => f.saved()?.source === shared.source);
    // The immediate mocked route check resolves in the microtask queue after save.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(shared.submissions.length, 0);
    assert.equal(shared.insertions.length, 0);
    assert.equal(shared.draftReads.length, 0);
    assert.equal(f.saved().source, shared.source);
  } finally { globalThis.fetch = originalFetch; f.dispose(); }
});
