import assert from 'node:assert/strict';
import test from 'node:test';
import {auditedControl, type ControlReceipt} from '../foreground/control.ts';

test('retains Start, Inspect and Stop receipts with the owned ID and operation', async () => {
  const entries: ControlReceipt[] = [];
  let time = 10;
  const run = (operation: 'start' | 'inspect' | 'stop', receipt: unknown) => auditedControl({operation, captureId: 'owned-id',
    invoke: async () => receipt, record: async entry => { entries.push(entry); }, now: () => time++});
  const started = await run('start', {capture_id: 'owned-id', status: 'recording', first_frame: true});
  const inspected = await run('inspect', {capture_id: 'owned-id', status: 'recording'});
  const saved = await run('stop', {capture_id: 'owned-id', status: 'saved', bundle_path: '/synthetic/bundle'});
  assert.deepEqual([started, inspected, saved], [
    {capture_id: 'owned-id', status: 'recording', first_frame: true},
    {capture_id: 'owned-id', status: 'recording'},
    {capture_id: 'owned-id', status: 'saved', bundle_path: '/synthetic/bundle'},
  ]);
  assert.deepEqual(entries.map(({operation, phase, captureId}) => [operation, phase, captureId]), [
    ['start', 'request', 'owned-id'], ['start', 'result', 'owned-id'],
    ['inspect', 'request', 'owned-id'], ['inspect', 'result', 'owned-id'],
    ['stop', 'request', 'owned-id'], ['stop', 'result', 'owned-id'],
  ]);
  assert.deepEqual(entries[1]?.receipt, started);
  assert.deepEqual(entries[5]?.receipt, saved);
  assert.deepEqual(entries.map(entry => [entry.startedAt, entry.finishedAt]), [
    [10, undefined], [10, 11], [12, undefined], [12, 13], [14, undefined], [14, 15],
  ]);
});

test('records a transport failure once and preserves its identity without replay', async () => {
  const entries: ControlReceipt[] = [];
  const failure = Error('transport closed');
  let calls = 0;
  await assert.rejects(auditedControl({operation: 'stop', captureId: 'owned-id', invoke: async () => { calls++; throw failure; },
    record: async entry => { entries.push(entry); }}), error => error === failure);
  assert.equal(calls, 1);
  assert.deepEqual(entries.map(entry => entry.phase), ['request', 'failure']);
  assert.equal(entries[1]?.error, 'Error: transport closed');
});

test('evidence failure cannot mask a command failure or mark a success', async () => {
  const failure = Error('primary command error');
  const secondary: unknown[] = [];
  let calls = 0;
  await assert.rejects(auditedControl({operation: 'start', captureId: 'owned-id', invoke: async () => { calls++; throw failure; },
    record: async entry => { if (entry.phase === 'failure') throw Error('disk full'); },
    reportEvidenceFailure: async error => { secondary.push(error); }}), error => error === failure);
  assert.equal(calls, 1);
  assert.equal(String(secondary[0]), 'Error: disk full');

  await assert.rejects(auditedControl({operation: 'start', captureId: 'owned-id', invoke: async () => ({status: 'recording'}),
    record: async entry => { if (entry.phase === 'result') throw Error('cannot persist result'); }}), /cannot persist result/);
});

test('an unwritable request receipt prevents command admission', async () => {
  let calls = 0;
  await assert.rejects(auditedControl({operation: 'start', captureId: 'owned-id', invoke: async () => { calls++; },
    record: async () => { throw Error('cannot persist request'); }}), /cannot persist request/);
  assert.equal(calls, 0);
});
