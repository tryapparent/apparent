import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeHost, decodePractice, type NativePractice } from '../src/host.ts';
import type { PracticeView } from '../src/session.ts';

const scope = { session: '1', transport: '2' };
const capture = { generation: '3', captureId: 'a', requestId: 'a' };
const baseline = { tourRevision: { present: true, value: 1 }, seen: { present: true, value: true }, resume: { present: false }, shortcutChosen: { present: true, value: true }, shortcutTestedFor: { present: true, value: 'Alt+S' }, firstCaptureCompleted: { present: false } };
function fixture() {
  const messages: any[] = [], views: PracticeView[] = [], timers = new Set<() => void>();
  const host = new PracticeHost({ send: value => messages.push(value), changed: view => views.push(view), timeout: callback => { timers.add(callback); return () => { timers.delete(callback); }; } });
  const facts: NativePractice = { version: 1, scope, attempt: '2', observation: { attempt: '2', sequence: 1, capture, phase: 'recording', boardVisible: true, boardInk: true, screenInk: 0, noteSaved: false }, completion: null, openedBundle: null };
  host.receive(facts);
  const read = messages.shift();
  host.reply({ type: 'practice-progress', ...read, result: baseline });
  return { host, messages, views, timers, facts };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('parent decoder rejects forged stages and malformed receipt/counter envelopes', () => {
  assert.equal(decodePractice({ practice: 'complete' }), null);
  const f = fixture();
  for (const value of [undefined, {}, { ...f.facts, scope: { ...scope, transport: '' } }, { ...f.facts, observation: { ...f.facts.observation, sequence: NaN } }, { ...f.facts, completion: { capture, clipboard: 'copied', current: true, outcome: { kind: 'saved' } } }]) assert.equal(decodePractice(value), null);
  f.host.close();
});

test('host only accepts scoped renderer commands; observations are never renderer commands', async () => {
  const f = fixture(); await settle();
  assert.equal(f.host.view?.stage, 'note');
  for (const action of ['practice-note-saved', 'practice-complete', 'practice-effect']) {
    assert.equal(await f.host.command({ action, context: f.host.view!.context }), false);
  }
  assert.equal(await f.host.command({ ...f.facts, action: 'practice-pasted' }), false);
  assert.equal(f.host.view?.stage, 'note');
  f.host.close();
});

test('shell-open receipts are consumed once, not replayed after a later paste confirmation', async () => {
  const f = fixture(); await settle();
  f.facts.observation = { ...f.facts.observation!, sequence: 2, noteSaved: true, boardVisible: false };
  f.host.receive(f.facts);
  f.facts.observation = { ...f.facts.observation!, sequence: 3, screenInk: 1 };
  f.facts.completion = { capture, current: true, clipboard: 'copied', outcome: { kind: 'saved', bundlePath: '/a.apparent' } };
  f.facts.openedBundle = { sequence: 1, bundlePath: '/a.apparent' };
  f.host.receive(f.facts);
  assert.equal(f.host.view?.stage, 'copied');
  await f.host.command({ action: 'practice-paste', context: f.host.view!.context });
  await f.host.command({ action: 'practice-pasted', context: f.host.view!.context });
  f.host.receive(f.facts);
  assert.equal(f.host.view?.stage, 'locate');
  f.facts.openedBundle.sequence = 2; f.host.receive(f.facts);
  assert.equal(f.host.view?.stage, 'complete');
  f.host.close();
});

test('late progress replies cannot match another transport; EOF cancels pending operations', async () => {
  const f = fixture(); await settle(); f.messages.length = 0;
  f.facts = { ...f.facts, scope: { ...scope, transport: '3' } };
  f.host.receive(f.facts); const read = f.messages.find(m => m.action === 'practice-progress');
  assert.equal(f.host.reply({ type: 'practice-progress', ...read, scope, result: baseline }), false);
  f.host.close(); await settle();
  assert.equal(f.timers.size, 0);
  assert.equal(f.host.reply({ type: 'practice-progress', ...read, result: baseline }), false);
  assert.equal(f.host.receive(f.facts), false);
});

test('a timed out progress read is failed and has no latent completion effect', async () => {
  const f = fixture(); await settle();
  f.host.receive({ ...f.facts, attempt: '3', observation: null });
  for (const timeout of [...f.timers]) timeout();
  await settle();
  assert.equal(f.host.view?.persistence, 'failed');
  assert.equal(f.messages.filter(m => m.operation === 'finished').length, 0);
  f.host.close();
});

test('another transport starts a fresh open receipt sequence even with the same attempt', async () => {
  const f = fixture(); await settle();
  const finishCapture = async () => {
    f.facts.observation = { ...f.facts.observation!, sequence: 2, noteSaved: true, boardVisible: false };
    f.host.receive(f.facts);
    f.facts.observation = { ...f.facts.observation!, sequence: 3, screenInk: 1 };
    f.facts.completion = { capture, current: true, clipboard: 'copied', outcome: { kind: 'saved', bundlePath: '/a.apparent' } };
    f.host.receive(f.facts);
    await f.host.command({ action: 'practice-paste', context: f.host.view!.context });
    await f.host.command({ action: 'practice-pasted', context: f.host.view!.context });
    f.facts.openedBundle = { sequence: 1, bundlePath: '/a.apparent' }; f.host.receive(f.facts);
    assert.equal(f.host.view?.stage, 'complete');
  };
  await finishCapture();
  f.facts = { ...f.facts, scope: { ...scope, transport: 'new' }, completion: null, openedBundle: null,
    observation: { ...f.facts.observation!, sequence: 1, noteSaved: false, boardVisible: true, screenInk: 0 } };
  f.host.receive(f.facts);
  await finishCapture();
  const ids = f.messages.map(message => Number(message.id));
  assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]!));
  f.host.close();
});
