import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecordFixture } from '@apparent/record/fixtures';
import {
  cloneCapabilitySnapshot, cloneCommandResult, cloneJsonDto, cloneRecordCommand,
} from '../../src/record/wire.ts';

test('accepts public fixture snapshots, fixed command variants, and correlated results', async () => {
  const fixture = createRecordFixture();
  const snapshot = fixture.driver.current();
  assert.deepEqual(cloneCapabilitySnapshot(snapshot), snapshot);

  const refresh = { type: 'refresh', requestId: 'wire-refresh', expected: {
    providerEpoch: snapshot.providerEpoch, revision: snapshot.revision,
  } } as const;
  assert.deepEqual(cloneRecordCommand(refresh), refresh);
  const result = await fixture.client.execute(refresh);
  assert.deepEqual(cloneCommandResult(result, refresh.requestId), result);
  assert.equal(cloneCommandResult(result, 'different-request'), undefined);

  const selectPen = { type: 'select-pen', value: 'coral', requestId: 'wire-pen', expected: {
    providerEpoch: snapshot.providerEpoch, revision: snapshot.revision,
  } } as const;
  assert.deepEqual(cloneRecordCommand(selectPen), selectPen);
  assert.equal(cloneRecordCommand({ ...selectPen, value: 'system-default' }), undefined);
});

test('rejects selector fields, exotic objects, accessors, cycles, sparse and oversized graphs', () => {
  const fixture = createRecordFixture();
  const snapshot = fixture.driver.current();
  const command = { type: 'refresh', requestId: 'wire-invalid', expected: {
    providerEpoch: snapshot.providerEpoch, revision: snapshot.revision,
  } };
  assert.equal(cloneRecordCommand({ ...command, owner: 'onboarding' }), undefined);

  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal(cloneJsonDto(accessor), undefined);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(cloneJsonDto(cyclic), undefined);
  assert.equal(cloneJsonDto(new Date()), undefined);
  assert.equal(cloneJsonDto([, 'sparse']), undefined);
  assert.equal(cloneJsonDto({ value: 'x'.repeat(64 * 1024) }), undefined);
  assert.equal(cloneJsonDto({ ['__proto__']: { polluted: true } }), undefined);
});

test('accepts Record 0.1.0 shortcut trial facts and preserves older snapshots without optional additions', () => {
  for (const scenario of [
    'shortcut-trial-idle', 'shortcut-trial-physical-press-release', 'shortcut-trial-no-event',
    'shortcut-trial-expired', 'shortcut-trial-cancelled', 'shortcut-trial-unknown',
    'shortcut-trial-unrelated-request', 'shortcut-trial-stale-epoch', 'shortcut-trial-changed-binding',
    'shortcut-trial-reconnect',
  ] as const) {
    const snapshot = createRecordFixture(scenario).driver.current();
    assert.deepEqual(cloneCapabilitySnapshot(snapshot), snapshot, `public fixture ${scenario} remains wire-compatible`);
  }

  const current = createRecordFixture().driver.current();
  const legacy = structuredClone(current) as any;
  delete legacy.shortcutTrial;
  delete legacy.shortcut.bindingId;
  assert.deepEqual(cloneCapabilitySnapshot(legacy), legacy, 'older v2 snapshots remain valid and unchanged');

  const unavailable = createRecordFixture().driver.current();
  assert.deepEqual(unavailable.shortcutTrial, { state: 'unavailable' });
  assert.equal(cloneCapabilitySnapshot(unavailable)?.shortcutTrial?.state, 'unavailable');

  const reserved = createRecordFixture('shortcut-trial-no-event').driver.current();
  const pressing = { ...reserved, shortcutTrial: { ...(reserved.shortcutTrial as any), state: 'pressing' } };
  assert.deepEqual(cloneCapabilitySnapshot(pressing), pressing, 'pressing retains its exact reservation binding and expiry');
});

test('accepts exact begin/cancel trial commands without converting accepted dispatch into observed facts', async () => {
  const idle = createRecordFixture('shortcut-trial-idle');
  const snapshot = idle.driver.current();
  const trial = snapshot.shortcutTrial as any;
  const begin = {
    type: 'begin-shortcut-trial', requestId: 'trial-begin-1',
    reservationId: 'reservation-test-1', bindingId: trial.bindingId,
    effectiveBinding: trial.effectiveBinding, sourceEpoch: trial.sourceEpoch,
    sourceRevision: trial.sourceRevision, expiresAt: '2026-11-06T13:01:00.000Z',
    expected: { providerEpoch: snapshot.providerEpoch, revision: snapshot.revision },
  } as const;
  assert.deepEqual(cloneRecordCommand(begin), begin);
  const beginResult = await idle.client.execute(begin);
  assert.equal(cloneCommandResult(beginResult, begin.requestId)?.status, 'accepted');
  assert.equal(idle.driver.current().shortcutTrial?.state, 'idle', 'accepted dispatch does not synthesize reservation readback');

  const reserved = createRecordFixture('shortcut-trial-no-event');
  const beforeCancel = reserved.driver.current();
  const cancel = { type: 'cancel-shortcut-trial', requestId: 'trial-cancel-1',
    reservationId: (beforeCancel.shortcutTrial as any).reservationId,
    expected: { providerEpoch: beforeCancel.providerEpoch, revision: beforeCancel.revision },
  } as const;
  assert.deepEqual(cloneRecordCommand(cancel), cancel);
  const cancelResult = await reserved.client.execute(cancel);
  assert.equal(cloneCommandResult(cancelResult, cancel.requestId)?.status, 'accepted');
  assert.equal(reserved.driver.current().shortcutTrial?.state, 'reserved', 'accepted cancellation is not observed cancellation');
});

test('rejects impossible trial unions, malformed physical observations, unsafe revisions and extra fields', () => {
  const current = createRecordFixture('shortcut-trial-idle').driver.current();
  const observed = createRecordFixture('shortcut-trial-physical-press-release').driver.current();
  const malformedSnapshots = [
    { state: 'unavailable', reservationId: 'not-allowed' },
    { ...(current.shortcutTrial as any), reservationId: 'unexpected-on-idle' },
    { ...(current.shortcutTrial as any), sourceRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...(current.shortcutTrial as any), sourceRevision: Number.POSITIVE_INFINITY },
    { ...(current.shortcutTrial as any), bindingId: '' },
    { ...(current.shortcutTrial as any), effectiveBinding: '' },
    { ...(current.shortcutTrial as any), sourceEpoch: '' },
    { ...(observed.shortcutTrial as any), pressId: '' },
    { ...(observed.shortcutTrial as any), pressedAt: 'not-a-time' },
    { ...(observed.shortcutTrial as any), releasedAt: '2026-01-01T00:00:00Z', pressedAt: '2026-01-01T00:00:01Z' },
    { ...(observed.shortcutTrial as any), selector: 'foreign' },
    { state: 'reserved', sourceEpoch: 'e', sourceRevision: 1, bindingId: 'b', effectiveBinding: 'Ctrl+R', reservationId: '', expiresAt: '2026-01-01T00:00:00Z' },
    { state: 'pressing', sourceEpoch: 'e', sourceRevision: 1, bindingId: 'b', effectiveBinding: 'Ctrl+R', reservationId: 'r', expiresAt: 'bad-time', pressId: 'impossible-here' },
  ];
  for (const shortcutTrial of malformedSnapshots) {
    assert.equal(cloneCapabilitySnapshot({ ...current, shortcutTrial }), undefined);
  }

  const expected = { providerEpoch: current.providerEpoch, revision: current.revision };
  const begin = { type: 'begin-shortcut-trial', requestId: 'invalid-trial', expected,
    reservationId: 'r', bindingId: 'b', effectiveBinding: 'Ctrl+R', sourceEpoch: 'e', sourceRevision: 1,
    expiresAt: '2026-01-01T00:00:00Z' };
  for (const invalid of [
    { ...begin, sourceRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...begin, sourceRevision: Number.NaN },
    { ...begin, expiresAt: 'not-a-time' },
    { ...begin, bindingId: '' },
    { ...begin, extra: true },
    { ...begin, reservationId: '' },
  ]) assert.equal(cloneRecordCommand(invalid), undefined);
  assert.equal(cloneRecordCommand({ type: 'cancel-shortcut-trial', requestId: 'bad-cancel', expected, reservationId: '' }), undefined);
  assert.equal(cloneRecordCommand({ type: 'cancel-shortcut-trial', requestId: 'bad-cancel', expected, reservationId: 'r', sourceEpoch: 'selector' }), undefined);
});

test('preserves authenticated native copy receipts from the public Record contract without accepting malformed evidence', () => {
  const current = createRecordFixture('unsubscribe-during-recording').driver.current();
  const receipt = { kind: 'copy', at: '2026-11-06T13:00:00Z', ok: true,
    evidence: 'native-write-readback', artifactId: 'artifact-synthetic', requestId: 'copy-synthetic',
    digest: 'a'.repeat(64), byteLength: 78 };
  const withReceipt = (outcome: unknown) => ({ ...current, captures: current.captures.map(capture => ({
    ...capture, phase: 'saved', artifactId: receipt.artifactId, outcomes: [outcome],
  })) });
  const snapshot = withReceipt(receipt);
  assert.deepEqual(cloneCapabilitySnapshot(snapshot), snapshot);
  for (const invalid of [
    { ...receipt, evidence: 'dispatch' }, { ...receipt, ok: false },
    { ...receipt, digest: 'A'.repeat(64) }, { ...receipt, byteLength: 0 },
    { ...receipt, byteLength: Number.MAX_SAFE_INTEGER + 1 }, { ...receipt, requestId: '' },
    { ...receipt, artifactId: '' }, { ...receipt, ambientClipboard: 'forbidden' },
  ]) assert.equal(cloneCapabilitySnapshot(withReceipt(invalid)), undefined);
});

test('preserves public durable-note and screen-stroke cursor facts without deriving causal order', () => {
  for (const scenario of [
    'practice-note-draft', 'practice-note-empty', 'practice-note-failed', 'practice-note-cancelled',
    'practice-note-saved', 'practice-note-early-stroke', 'practice-note-first-post-stroke',
    'practice-note-unrelated-history', 'practice-note-unrelated-capture',
    'practice-note-late-pre-note-receipt', 'practice-note-late-finalization',
  ] as const) {
    const snapshot = createRecordFixture(scenario).driver.current();
    assert.deepEqual(cloneCapabilitySnapshot(snapshot), snapshot, scenario);
  }
  const snapshot = createRecordFixture('practice-note-first-post-stroke').driver.current();
  for (const cursor of [{ historyId: '', sequence: 1 }, { historyId: 'history', sequence: -1 },
    { historyId: 'history', sequence: Number.MAX_SAFE_INTEGER + 1 }, { historyId: 'history', sequence: 1, extra: true }]) {
    const malformed = structuredClone(snapshot) as any;
    malformed.captures[0].outcomes.find((outcome: any) => outcome.kind === 'accepted-stroke').cursor = cursor;
    assert.equal(cloneCapabilitySnapshot(malformed), undefined);
  }
  const forged = structuredClone(snapshot) as any;
  delete forged.captures[0].outcomes.find((outcome: any) => outcome.kind === 'note-save').receiptId;
  assert.equal(cloneCapabilitySnapshot(forged), undefined, 'a generic success cannot replace a durable note receipt');
});
