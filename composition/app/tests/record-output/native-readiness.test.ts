import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitNativeHostReadiness } from '../../src/record/omarchy/native-host.ts';

test('cold native startup after the old three-second retry cap still requires a positive owned-identity probe', async () => {
  let clock = 0;
  const identity = { pid: 123, ticks: '456' };
  const probe = async () => clock >= 4000 ? identity : undefined;
  let oldResult;
  for (let attempt = 0; attempt < 30 && !oldResult; attempt++) { oldResult = await probe(); if (!oldResult) clock += 100; }
  assert.equal(oldResult, undefined); assert.equal(clock, 3000);
  clock = 0;
  assert.equal(await awaitNativeHostReadiness(probe, () => {}, () => clock, async ms => { clock += ms; }), identity);
  assert.equal(clock, 4000);
});

test('unavailable or invalid identity times out without returning ownership or performing cleanup', async () => {
  let clock = 0;
  const error = new Error('owned identity unavailable');
  await assert.rejects(awaitNativeHostReadiness(async () => { throw error; }, () => {},
    () => clock, async ms => { clock += ms; }), failure => (failure as Error).cause === error);
  assert.equal(clock, 30000);
});

test('exact-deadline and slow late readiness refuse; near-deadline readiness can pass', async () => {
  for (const observed of [29999, 30000, 31000]) {
    let clock = 0;
    const result = awaitNativeHostReadiness(async () => { clock = observed; return 'qualified'; }, () => {},
      () => clock, async ms => { clock += ms; });
    if (observed < 30000) assert.equal(await result, 'qualified');
    else await assert.rejects(result, /timed out/);
  }
});

test('an exited launch never becomes ready even if a probe returns an identity', async () => {
  let exited = false, clock = 0;
  await assert.rejects(awaitNativeHostReadiness(async () => { exited = true; return 'qualified'; },
    () => { if (exited) throw new Error('launch exited'); }, () => clock, async ms => { clock += ms; }), /launch exited|timed out/);
});
