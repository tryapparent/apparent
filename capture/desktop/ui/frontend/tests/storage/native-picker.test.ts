import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openNativePicker } from './native-picker.ts';

test('refreshes visible pre-picker contention before another real Change', async () => {
  const calls: string[] = [];
  let refreshes = 0, observations = 0;
  const result = await openNativePicker({
    refresh: async () => { calls.push('refresh'); return ++refreshes === 1 ? 'busy' : 'ready'; },
    change: async () => { calls.push('change'); },
    observe: async () => { calls.push('observe'); return ++observations === 1 ? { busy: true } : { picker: 'owned AX picker' }; },
  });
  assert.deepEqual(result, { picker: 'owned AX picker', attempts: 3 });
  assert.deepEqual(calls, ['refresh', 'refresh', 'change', 'observe', 'refresh', 'change', 'observe']);
});

test('persistent contention is bounded without opening a picker', async () => {
  let refreshes = 0;
  await assert.rejects(openNativePicker({
    refresh: async () => { refreshes++; return 'busy'; },
    change: async () => { assert.fail('Change must stay disabled'); },
    observe: async () => { assert.fail('No picker was requested'); },
  }), /three attempts/);
  assert.equal(refreshes, 3);
});

for (const boundary of ['refresh', 'change', 'observe'] as const) {
  test(`${boundary} unknown/timeout failure is never retried`, async () => {
    let refreshes = 0;
    const failure = new Error('unclassified outcome or deadline');
    await assert.rejects(openNativePicker({
      refresh: async () => { refreshes++; if (boundary === 'refresh') throw failure; return 'ready'; },
      change: async () => { if (boundary === 'change') throw failure; },
      observe: async () => { throw failure; },
    }), error => error === failure);
    assert.equal(refreshes, 1);
  });
}
