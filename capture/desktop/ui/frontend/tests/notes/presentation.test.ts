import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPresentation, transition, validEvents, popupBounds, projectSnapshot } from '../../src/notes/presentation.ts';

test('fresh list requests replace anchoring and request focus even with the list already open', () => {
  let state = initialPresentation([20, 30]);
  state = transition(state, { kind: 'embedded', value: true });
  state = transition(state, { kind: 'badge', rect: [100, 40, 584, 56] });
  state = transition(state, { kind: 'list' });
  assert.equal(state.mode, 'list');
  assert.deepEqual(state.position, [684, 96]);
  const revision = state.focusRevision;
  state = transition(state, { kind: 'badge', rect: [-600, 80, 584, 56] });
  state = transition(state, { kind: 'list' });
  assert.deepEqual(state.position, [-16, 136]);
  assert.equal(state.focusRevision, revision + 1);
  assert.deepEqual(popupBounds({ x: -16, y: 136 }, { x: -800, y: 0, width: 800, height: 600 }, 350),
    { x: -332, y: 148, width: 332, height: 350 });
});

test('embedded hide and restore preserve editor, draft selection, and popup position', () => {
  const editor = transition(initialPresentation([1, 2]), { kind: 'open', pin: 7, position: [240, 180] });
  const hiddenBadge = transition(editor, { kind: 'embedded', value: true });
  assert.equal(hiddenBadge.embedded, true);
  assert.equal(hiddenBadge.mode, 'editor');
  assert.deepEqual(transition(hiddenBadge, { kind: 'embedded', value: false }), editor);
  assert.deepEqual(transition(editor, { kind: 'list' }).position, [240, 180]);
});

test('only admitted save/delete effects transition; failed writes and draft snapshots keep recovery state', () => {
  let state = transition(initialPresentation([0, 0]), { kind: 'open', pin: 2, position: [80, 90] });
  // Rust emits no presentation event for a draft or failed Store operation.
  const apply = (events: Parameters<typeof transition>[1][]) => events.reduce(transition, state);
  assert.deepEqual(apply([]), state);
  state = transition(state, { kind: 'save' });
  assert.equal(state.mode, 'badge');
  state = transition(state, { kind: 'list' });
  assert.deepEqual(apply([]), state); // failed delete leaves the list/error reachable
  state = transition(state, { kind: 'delete' });
  assert.equal(state.mode, 'list');
  state = transition(state, { kind: 'edit', pin: 2 });
  assert.equal(state.current, 2);
  assert.equal(state.mode, 'editor');
  state = transition(state, { kind: 'dismiss' });
  assert.equal(state.mode, 'badge');
  assert.equal(state.current, 2); // Store draft remains selectable on the next edit
  assert.equal(transition(state, { kind: 'outside' }).mode, 'badge');
});

test('private event protocol rejects malformed and competing presentation authority', () => {
  assert.equal(validEvents([{ kind: 'list' }, { kind: 'embedded', value: true }]), true);
  for (const events of [[{ kind: 'list', mode: 'editor' }], [{ kind: 'open', pin: 1, position: [NaN, 0] }],
    [{ kind: 'edit', pin: -1 }], [{ kind: 'embedded', value: 1 }], [{ kind: 'badge', rect: [0, 0] }]]) {
    assert.equal(validEvents(events), false);
  }
});

test('Store snapshots preserve draft/save/delete recovery and count durable saves only', () => {
  const draft = { pin: 1, t: 100, x: 0.5, y: 0.5, text: 'Keep my correction' };
  let state = projectSnapshot(initialPresentation([0, 0]), {
    events: [{ kind: 'open', pin: 1, position: [50, 60] }], notes: [], drafts: [draft], error: null,
  });
  assert.equal(state.notes.length, 0);
  state = projectSnapshot(state, { events: [], notes: [], drafts: [draft], error: 'Try again' });
  assert.equal(state.mode, 'editor');
  assert.equal(state.error, 'Try again');
  assert.equal(state.drafts[0].text, draft.text);
  state = projectSnapshot(state, { events: [{ kind: 'save' }], notes: [draft], drafts: [draft], error: null });
  assert.equal(state.mode, 'badge');
  assert.equal(state.notes.length, 1);
  state = projectSnapshot(state, { events: [{ kind: 'list' }], notes: [draft], drafts: [draft], error: null });
  state = projectSnapshot(state, { events: [], notes: [draft], drafts: [draft], error: 'Try deleting again' });
  assert.equal(state.mode, 'list');
  assert.equal(state.notes.length, 1);
  assert.equal(state.error, 'Try deleting again');
  state = projectSnapshot(state, { events: [{ kind: 'delete' }], notes: [], drafts: [], error: null });
  assert.equal(state.mode, 'list');
  assert.equal(state.notes.length, 0);
  assert.equal(state.error, null);
});
