import assert from 'node:assert/strict';
import {test} from 'node:test';
import {movieTimes, bundleTimes} from '../src/frames-policy.ts';

test('assembly retains distinct keyframe identities when bundle times clamp to movie zero', () => {
  const times = [0, 250, 500, 1000];
  assert.deepEqual(movieTimes(times, 500), [0, 0, 0, 500]);
  const frames = [{requestIndex: 0, requestedMs: 0}, {requestIndex: 1, requestedMs: 0},
    {requestIndex: 2, requestedMs: 0}, {requestIndex: 3, requestedMs: 500}];
  assert.deepEqual(bundleTimes(frames, times, 500), times);
});

test('recovery preserves requested order, duplicates and the original bundle clock', () => {
  const times = [2000, 750, 750, 100];
  assert.deepEqual(movieTimes(times, 250), [1750, 500, 500, 0]);
  assert.deepEqual(bundleTimes([{requestIndex: 0, requestedMs: 1750}, {requestIndex: 1, requestedMs: 500},
    {requestIndex: 2, requestedMs: 500}, {requestIndex: 3, requestedMs: 0}], times, 250), times);
});

test('invalid or incomplete identities cannot relabel an assembly frame', () => {
  const times = [0, 250];
  for (const frames of [[], [{requestIndex: 0, requestedMs: 0}],
    [{requestIndex: 1, requestedMs: 0}, {requestIndex: 0, requestedMs: 0}],
    [{requestIndex: 0, requestedMs: 1}, {requestIndex: 1, requestedMs: 0}]])
    assert.throws(() => bundleTimes(frames, times, 500));
});

test('unsafe times and sparse arrays fail before a native request', () => {
  for (const times of [[], Array(49).fill(0), Array(1), [-1], [NaN], [Infinity], [0.5], [Number.MAX_SAFE_INTEGER + 1]])
    assert.throws(() => movieTimes(times, 0));
  for (const offset of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => movieTimes([0], offset));
  assert.throws(() => bundleTimes(Array(1), [0], 0));
});
