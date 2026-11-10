import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeProgress, type ProgressSnapshot, type ProgressIntent, type WriteResult } from '../src/progress.ts';

const initial: ProgressSnapshot = {
  tourRevision: { present: true, value: 1 }, seen: { present: true, value: true }, resume: { present: false },
  shortcutChosen: { present: true, value: true }, shortcutTestedFor: { present: true, value: 'Alt+S' }, firstCaptureCompleted: { present: false },
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('practice completion sends only owner leaf intent with the authoritative baseline', async () => {
  let intent: ProgressIntent | undefined;
  const state = new PracticeProgress({ read: async () => initial, commit: async value => { intent = value; return 'saved'; } });
  await state.load(); await state.finish();
  assert.equal(state.state, 'saved');
  assert.deepEqual(intent, { expected: initial, set: { firstCaptureCompleted: true, seen: true }, remove: ['resume'] });
});

test('duplicate finish while a write is pending never issues a second transaction', async () => {
  const write = deferred<WriteResult>(); let writes = 0;
  const state = new PracticeProgress({ read: async () => initial, commit: () => { writes++; return write.promise; } });
  await state.load(); const pending = state.finish(); await state.finish();
  assert.equal(state.state, 'saving'); assert.equal(writes, 1);
  write.resolve('saved'); await pending; assert.equal(state.state, 'saved');
});

test('unknown publication requires readback, and visible completion does not cause another write', async () => {
  let snapshot = initial; let writes = 0;
  const state = new PracticeProgress({ read: async () => snapshot, commit: async () => { writes++; return 'unknown'; } });
  await state.load(); await state.finish(); await state.finish();
  assert.equal(writes, 1); assert.equal(state.state, 'unknown');
  snapshot = { ...initial, firstCaptureCompleted: { present: true, value: true } };
  await state.load(); assert.equal(state.state, 'saved'); await state.finish(); assert.equal(writes, 1);
});

test('failed save becomes retryable only after explicit readback of the unchanged baseline', async () => {
  let writes = 0;
  const state = new PracticeProgress({ read: async () => initial, commit: async () => { writes++; return writes === 1 ? 'failed' : 'saved'; } });
  await state.load(); await state.finish(); await state.finish(); assert.equal(writes, 1);
  await state.load(); assert.equal(state.state, 'ready'); await state.finish(); assert.equal(writes, 2);
});

test('setup replay or shortcut change conflicts instead of accepting a stale practice finish', async () => {
  let snapshot = initial; let writes = 0;
  const state = new PracticeProgress({ read: async () => snapshot, commit: async () => { writes++; return 'conflict'; } });
  await state.load(); await state.finish();
  snapshot = { ...initial, seen: { present: true, value: false }, resume: { present: true, value: 'welcome' } };
  await state.load(); assert.equal(state.state, 'conflict'); await state.finish(); assert.equal(writes, 1);
});

test('absent and null remain different in progress CAS/readback', async () => {
  let snapshot = initial;
  const state = new PracticeProgress({ read: async () => snapshot, commit: async () => 'saved' });
  await state.load(); snapshot = { ...initial, resume: { present: true, value: null } };
  await state.load(); assert.equal(state.state, 'conflict');
});

test('close cancels the native port and ignores a late durable success', async () => {
  const write = deferred<WriteResult>(); let signal: AbortSignal | undefined;
  const state = new PracticeProgress({ read: async () => initial, commit: (_intent, current) => { signal = current; return write.promise; } });
  await state.load(); const pending = state.finish(); state.close();
  assert.equal(signal?.aborted, true); write.resolve('saved'); await pending; assert.equal(state.state, 'closed');
});

test('late reads cannot replace a newer read or reopen a closed presentation', async () => {
  const first = deferred<ProgressSnapshot>(); let reads = 0;
  const state = new PracticeProgress({ read: () => ++reads === 1 ? first.promise : Promise.resolve(initial), commit: async () => 'saved' });
  const old = state.load(); await state.load(); state.close(); first.resolve(initial); await old;
  assert.equal(state.state, 'closed');
});

test('transport failure is unknown, not proof of failed publication', async () => {
  const state = new PracticeProgress({ read: async () => initial, commit: async () => { throw new Error('EOF'); } });
  await state.load(); await state.finish(); assert.equal(state.state, 'unknown');
});
