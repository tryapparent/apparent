import {ink} from './facts.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeSession } from '../src/session.ts';
import { type CaptureIdentity } from '../src/practice.ts';
import { type ProgressSnapshot, type WriteResult } from '../src/progress.ts';

const baseline: ProgressSnapshot = {
  tourRevision: { present: true, value: 1 }, seen: { present: true, value: true }, resume: { present: false },
  shortcutChosen: { present: true, value: true }, shortcutTestedFor: { present: true, value: 'Alt+S' }, firstCaptureCompleted: { present: false },
};
const capture: CaptureIdentity = { generation: '1', captureId: 'capture', requestId: null };
async function fixture(commit: () => Promise<WriteResult> = async () => 'saved') {
  const effects: string[] = [];
  const session = new PracticeSession({ session: 'session', transport: 'transport' }, {
    progress: { read: async () => baseline, commit },
    closeWhiteboard: value => { assert.deepEqual(value, capture); effects.push('close-board'); },
    finished: (value, path) => { assert.deepEqual(value, capture); assert.equal(path, '/practice.apparent'); effects.push('finished'); },
  });
  await session.begin('attempt');
  let sequence = 0;
  const observe = (screenInk: number, noteSaved: boolean, boardVisible = true) => session.observe({ attempt: 'attempt', sequence: ++sequence, capture, phase: 'recording', boardVisible, boardPoints: 4, screenInk: ink(screenInk), noteSaved });
  observe(0, false); observe(0, true, false); observe(1, true, false);
  session.complete({ capture, current: true, outcome: { kind: 'saved', bundlePath: '/practice.apparent' }, clipboard: 'copied' });
  const command = (action: string) => session.command(action, session.view.context);
  await command('practice-paste'); await command('practice-pasted'); session.openedBundle(capture, '/practice.apparent');
  return { session, effects, command };
}

test('composed workflow emits close only on real board ink and finishes only after persistence', async () => {
  let resolve!: (value: WriteResult) => void;
  const f = await fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.command('practice-finish');
  assert.deepEqual(f.effects, ['close-board']); assert.equal(f.session.view.persistence, 'saving');
  resolve('saved'); await pending;
  assert.deepEqual(f.effects, ['close-board', 'finished']);
});

test('failed persistence can be explicitly retried; no duplicate receipt or blind write', async () => {
  let writes = 0;
  const f = await fixture(async () => ++writes === 1 ? 'failed' : 'saved');
  await f.command('practice-finish');
  assert.equal(f.session.view.persistence, 'failed'); assert.deepEqual(f.effects, ['close-board']);
  await f.command('practice-finish');
  assert.equal(writes, 2); assert.deepEqual(f.effects, ['close-board', 'finished']);
});

test('close while persisting invalidates the completion effect without cancelling capture execution', async () => {
  let resolve!: (value: WriteResult) => void;
  const f = await fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.command('practice-finish'); f.session.close(); resolve('saved'); await pending;
  assert.deepEqual(f.effects, ['close-board']);
});

test('an old attempt saving cannot finish a new retry', async () => {
  let resolve!: (value: WriteResult) => void;
  const f = await fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.command('practice-finish'); await f.session.begin('next'); resolve('saved'); await pending;
  assert.deepEqual(f.effects, ['close-board']); assert.equal(f.session.view.stage, 'start');
});
