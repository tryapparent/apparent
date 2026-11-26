import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPresentation, transition, validEvents, projectSnapshot } from '../../src/notes/presentation.ts';

test('fresh list requests replace anchoring and request focus even with the list already open', () => {
  let state = initialPresentation([20, 30]);
  state = transition(state, { kind: 'badge', rect: [100, 40, 584, 56] });
  state = transition(state, { kind: 'list' });
  assert.equal(state.mode, 'list');
  assert.deepEqual(state.badgeRect, [100, 40, 584, 56]);
  const revision = state.focusRevision;
  state = transition(state, { kind: 'badge', rect: [-600, 80, 584, 56] });
  state = transition(state, { kind: 'list' });
  assert.deepEqual(state.badgeRect, [-600, 80, 584, 56]);
  assert.equal(state.focusRevision, revision + 1);
  assert.deepEqual(state.position, [20, 30]);
});

test('only admitted save effects transition; failed writes and draft snapshots keep recovery state', () => {
  let state = transition(initialPresentation([0, 0]), { kind: 'open', pin: 2, position: [80, 90] });
  // Rust emits no presentation event for a draft or failed Store operation.
  const apply = (events: Parameters<typeof transition>[1][]) => events.reduce(transition, state);
  assert.deepEqual(apply([]), state);
  state = transition(state, { kind: 'save' });
  assert.equal(state.mode, 'badge');
  state = transition(state, { kind: 'list' });
  assert.deepEqual(apply([]), state);
  state = transition(state, { kind: 'dismiss' });
  assert.equal(state.mode, 'badge');
  assert.equal(transition(state, { kind: 'outside' }).mode, 'badge');
});

test('private event protocol rejects malformed and competing presentation authority', () => {
  assert.equal(validEvents([{ kind: 'list' }, { kind: 'badge', rect: [0, 0, 50, 20] }]), true);
  for (const events of [[{ kind: 'list', mode: 'editor' }], [{ kind: 'open', pin: 1, position: [NaN, 0] }],
    [{ kind: 'edit', pin: 1 }], [{ kind: 'delete' }], [{ kind: 'embedded', value: 1 }], [{ kind: 'badge', rect: [0, 0] }]]) {
    assert.equal(validEvents(events), false);
  }
});

test('Store snapshots preserve save recovery and count durable saves only', () => {
  const draft = { pin: 1, t: 100, x: 0.5, y: 0.5, text: 'Keep my correction' };
  let state = projectSnapshot(initialPresentation([0, 0]), {
    events: [{ kind: 'open', pin: 1, position: [50, 60] }], notes: [], drafts: [draft], error: null,
  });
  assert.equal(state.notes.length, 0);
  state = projectSnapshot(state, { events: [], notes: [], drafts: [draft], error: 'Try again' });
  assert.equal(state.mode, 'editor');
  assert.equal(state.error, 'Try again');
  assert.equal(state.drafts[0].text, draft.text);
  state = projectSnapshot(state, { events: [{ kind: 'save' }], notes: [draft], drafts: [], error: null });
  assert.equal(state.mode, 'badge');
  assert.equal(state.notes.length, 1);
  state = projectSnapshot(state, { events: [{ kind: 'list' }], notes: [draft], drafts: [], error: null });
  assert.equal(state.mode, 'list');
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].text, draft.text);
});
