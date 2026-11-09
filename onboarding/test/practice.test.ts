import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeWorkflow, type CaptureIdentity, type Completion, type Observation } from '../src/practice.ts';

const capture: CaptureIdentity = { generation: '3', captureId: 'capture-a', requestId: null };
function fixture() {
  const workflow = new PracticeWorkflow({ session: 'session', transport: 'transport' });
  workflow.begin('attempt');
  let sequence = 0;
  let fact: Observation = { attempt: 'attempt', sequence, capture, phase: 'recording', boardVisible: false, boardInk: false, screenInk: 0, noteSaved: false };
  const observe = (patch: Partial<Observation> = {}) => {
    fact = { ...fact, sequence: ++sequence, ...patch };
    return workflow.observe(fact);
  };
  const command = (action: string) => workflow.command(action, workflow.view.context);
  const complete = (patch: Partial<Completion> = {}) => workflow.complete({ capture, current: true, outcome: { kind: 'saved', bundlePath: '/practice.apparent' }, clipboard: 'copied', ...patch });
  const toNote = () => { observe(); observe({ boardVisible: true }); return observe({ boardInk: true }); };
  const toStop = () => { toNote(); observe({ boardVisible: false, noteSaved: true }); observe({ screenInk: 1 }); };
  const toLocate = () => { complete(); command('practice-paste'); command('practice-pasted'); };
  return { workflow, observe, command, complete, toNote, toStop, toLocate };
}

test('real drawing, durable note, clipboard, human confirmation and exact bundle open complete the lesson', () => {
  const f = fixture();
  f.observe({ phase: 'selecting', capture: null });
  assert.equal(f.workflow.view.stage, 'screen');
  f.observe({ phase: 'recording', capture });
  assert.equal(f.workflow.view.stage, 'whiteboard');
  f.observe({ boardInk: true, screenInk: 1 });
  assert.equal(f.workflow.view.stage, 'whiteboard');
  assert.deepEqual(f.observe({ boardVisible: true }), [{ kind: 'close-whiteboard', capture }]);
  assert.equal(f.workflow.view.stage, 'note');
  f.observe({ boardVisible: false, screenInk: 2 });
  assert.equal(f.workflow.view.stage, 'note');
  f.observe({ noteSaved: true });
  assert.equal(f.workflow.view.stage, 'screen-ink');
  f.observe();
  assert.equal(f.workflow.view.stage, 'screen-ink');
  f.observe({ screenInk: 3 });
  assert.equal(f.workflow.view.stage, 'stop');
  f.observe({ phase: 'processing' });
  assert.equal(f.workflow.view.stage, 'preparing');
  f.toLocate();
  f.workflow.openedBundle(capture, '/practice.apparent');
  assert.equal(f.workflow.view.stage, 'complete');
  assert.deepEqual(f.command('practice-finish'), [{ kind: 'complete', capture, bundlePath: '/practice.apparent' }]);
  assert.deepEqual(f.command('practice-finish'), []);
});

test('renderer commands never invent capture, ink, note, copy, or bundle-open receipts', () => {
  const f = fixture();
  for (const action of ['practice-paste', 'practice-pasted', 'practice-note-saved', 'practice-finish', 'capture-started', 'copied']) f.command(action);
  assert.equal(f.workflow.view.stage, 'start');
  f.toNote();
  f.command('practice-note-saved');
  f.observe();
  assert.equal(f.workflow.view.stage, 'note');
  f.toLocate();
  f.command('practice-finish');
  assert.equal(f.workflow.view.stage, 'locate');
});

test('closing an owned board before ink returns to its opening lesson', () => {
  const f = fixture();
  f.observe({ boardVisible: true });
  assert.equal(f.workflow.view.stage, 'board-ink');
  f.observe({ boardVisible: false });
  assert.equal(f.workflow.view.stage, 'whiteboard');
  f.observe({ boardInk: true });
  assert.equal(f.workflow.view.stage, 'whiteboard');
});

test('early finish teaches paste/location but cannot complete required practice', () => {
  const f = fixture(); f.toNote();
  f.observe({ phase: 'processing', noteSaved: true, screenInk: 50 });
  assert.equal(f.workflow.view.stage, 'preparing');
  f.toLocate(); f.workflow.openedBundle(capture, '/practice.apparent');
  assert.equal(f.workflow.view.stage, 'retry');
  assert.equal(f.workflow.view.savedBundle, true);
  assert.deepEqual(f.command('practice-finish'), []);
});

for (const clipboard of ['failed', 'notRequested'] as const) test(`${clipboard} clipboard keeps the saved bundle without claiming paste`, () => {
  const f = fixture(); f.toStop(); f.complete({ clipboard });
  assert.equal(f.workflow.view.stage, 'copy-failed');
  f.command('practice-pasted');
  assert.equal(f.workflow.view.stage, 'copy-failed');
  f.command('practice-locate');
  f.workflow.openedBundle(capture, '/practice.apparent');
  assert.equal(f.workflow.view.stage, 'retry');
});

test('cancel and retry discard every old milestone and reject delayed observations', () => {
  const f = fixture(); f.toStop(); f.observe({ phase: 'cancelled' });
  f.complete();
  assert.equal(f.workflow.view.stage, 'retry');
  assert.equal(f.workflow.view.savedBundle, false);
  f.workflow.begin('retry');
  f.observe({ phase: 'recording' }); // old attempt
  assert.equal(f.workflow.view.stage, 'start');
  f.observe({ attempt: 'retry', capture: { ...capture, captureId: 'capture-b' }, boardVisible: true, boardInk: true, noteSaved: false });
  assert.equal(f.workflow.view.stage, 'note');
  f.complete(); // old capture's finalizer
  assert.equal(f.workflow.view.stage, 'note');
});

test('polling, replayed frames and mutable caller objects do not replay effects', () => {
  const f = fixture(); f.toNote();
  assert.deepEqual(f.observe(), []);
  assert.deepEqual(f.observe({ sequence: 1, noteSaved: true }), []);
  assert.equal(f.workflow.view.stage, 'note');
  f.observe({ sequence: 20, noteSaved: true });
  assert.equal(f.workflow.view.stage, 'screen-ink');
  f.observe({ sequence: 20, screenInk: 1 });
  assert.equal(f.workflow.view.stage, 'screen-ink');
});

test('receipts must match capture, generation, request and currently admitted completion', () => {
  const f = fixture(); f.toStop();
  f.complete({ current: false });
  for (const mismatch of [{ generation: '4' }, { captureId: 'other' }, { requestId: 'other' }]) f.complete({ capture: { ...capture, ...mismatch } });
  assert.equal(f.workflow.view.stage, 'stop');
  f.complete();
  f.complete({ outcome: { kind: 'failed', message: 'late duplicate' } });
  assert.equal(f.workflow.view.stage, 'copied');
  f.command('practice-paste'); f.command('practice-pasted');
  f.workflow.openedBundle({ ...capture, generation: '4' }, '/practice.apparent');
  f.workflow.openedBundle(capture, '/other.apparent');
  assert.equal(f.workflow.view.stage, 'locate');
});

test('failed finalization never claims a saved bundle or copied clipboard', () => {
  const f = fixture(); f.toStop();
  f.complete({ outcome: { kind: 'failed', message: 'write failed' }, clipboard: 'copied' });
  assert.equal(f.workflow.view.stage, 'retry');
  assert.equal(f.workflow.view.savedBundle, false);
  f.command('practice-paste'); f.command('practice-pasted');
  f.workflow.openedBundle(capture, '/practice.apparent');
  assert.equal(f.workflow.view.stage, 'retry');
});

test('stale stage, session and transport commands cannot confirm a manual paste', () => {
  const f = fixture(); f.toStop(); f.complete();
  const old = f.workflow.view.context;
  f.command('practice-paste');
  f.workflow.command('practice-pasted', old);
  for (const patch of [{ session: 'old' }, { transport: 'old' }, { attempt: 'old' }]) {
    f.workflow.command('practice-pasted', { ...f.workflow.view.context, ...patch });
  }
  assert.equal(f.workflow.view.stage, 'paste');
  f.command('practice-pasted');
  assert.equal(f.workflow.view.stage, 'locate');
});

test('later/close and replaced transport revoke coaching without emitting a capture effect', () => {
  const f = fixture(); f.toStop(); const context = f.workflow.view.context;
  f.workflow.revoke(); f.complete(); f.observe({ phase: 'processing' });
  f.workflow.begin('new');
  assert.deepEqual(f.workflow.command('practice-finish', context), []);
  assert.equal(f.workflow.view.stage, 'stop');
});

test('invalid counters and a different live capture cannot satisfy the drawing lesson', () => {
  const f = fixture(); f.toNote();
  f.observe({ sequence: Number.NaN, noteSaved: true });
  f.observe({ sequence: 99, screenInk: -1 });
  f.observe({ sequence: 100, screenInk: 0, capture: { ...capture, generation: 'old' } });
  assert.equal(f.workflow.view.stage, 'note');
});
