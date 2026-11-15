import assert from 'node:assert/strict';
import {test} from 'node:test';
import {movieTimes, bundleTimesForFrames} from '../src/policy.ts';

test('offset-clamped movie requests retain their distinct bundle identities', () => {
  const bundle = [0, 250, 500, 1000], requested = movieTimes(bundle, 500);
  assert.deepEqual(requested, [0, 0, 0, 500]);
  const frames = requested.map((requestedMs, requestIndex) => ({requestIndex, requestedMs}));
  assert.deepEqual(bundleTimesForFrames(frames, bundle, 500), bundle);
});

test('backwards requests and duplicates retain caller order', () => {
  const bundle = [2500, 550, 550, 1550];
  const frames = movieTimes(bundle, 350).map((requestedMs, requestIndex) => ({requestIndex, requestedMs}));
  assert.deepEqual(bundleTimesForFrames(frames, bundle, 350), bundle);
  assert.deepEqual(movieTimes([0], 0), [0]);
});

test('invalid times fail before a native request can be assembled', () => {
  for (const times of [[], Array(49).fill(0), [-1], [NaN], [Infinity], [0.5], [Number.MAX_SAFE_INTEGER + 1]])
    assert.throws(() => movieTimes(times, 0));
  for (const offset of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => movieTimes([0], offset));
});

test('missing, reordered or relabelled native frames cannot silently change a crop association', () => {
  const bundle = [0, 250, 1000], good = movieTimes(bundle, 500).map((requestedMs, requestIndex) => ({requestIndex, requestedMs}));
  for (const frames of [good.slice(1), good.slice().reverse(),
    [{...good[0], requestIndex: 1}, ...good.slice(1)],
    [{...good[0], requestedMs: 1}, ...good.slice(1)]])
    assert.throws(() => bundleTimesForFrames(frames, bundle, 500));
});
