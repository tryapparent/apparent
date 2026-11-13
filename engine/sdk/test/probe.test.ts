import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {parseMovieInfo, probeMovie, EngineProbeError} from '../src/index.ts';

const raw = {
  format: {duration: '3.000000'},
  streams: [
    {index: 0, codec_type: 'video', start_time: '0.000', duration: '2.000', width: 64, height: 48, avg_frame_rate: '25/1'},
    {index: 1, codec_type: 'audio', start_time: '-0.021', duration: '3.000'},
  ],
};
test('preserves distinct container/video clocks and original audio stream identity', () => {
  const info = parseMovieInfo(JSON.stringify(raw));
  assert.equal(info.durationMs, 3000);
  assert.deepEqual(info.video, {streamIndex: 0, startMs: 0, durationMs: 2000, width: 64, height: 48, fps: 25});
  assert.deepEqual(info.audio, [{streamIndex: 1, startMs: -21, durationMs: 3000, segments: null}]);
});
test('retains native nonempty audio segments without inferring them on Linux', () => {
  const input = structuredClone(raw) as any;
  input.streams[1].segments = [{start_time: '1.250', duration: '0.500'}];
  assert.deepEqual(parseMovieInfo(JSON.stringify(input)).audio[0].segments, [{startMs: 1250, durationMs: 500}]);
});
test('unavailable timings and audio-only media remain explicit', () => {
  assert.deepEqual(parseMovieInfo(JSON.stringify({format: {}, streams: [
    {index: 3, codec_type: 'audio', duration: 'N/A'},
  ]})), {durationMs: null, video: null, audio: [{streamIndex: 3, startMs: null, durationMs: null, segments: null}]});
});
test('both native display matrices yield the same rotated bounds and unknown rates normalize numerically', () => {
  const nativeMatrix = [0, -1, 1, 0];
  const ffprobeMatrix = '\n00000000: 0 -65536 0\n00000001: 65536 0 0\n00000002: 0 0 1073741824\n';
  for (const fields of [{displayTransform: nativeMatrix}, {side_data_list: [{displaymatrix: ffprobeMatrix}]}]) {
    const input = {...raw, streams: [{...raw.streams[0], ...fields, avg_frame_rate: '0.000000000/1'}]};
    const info = parseMovieInfo(JSON.stringify(input));
    assert.equal(info.video?.width, 48);
    assert.equal(info.video?.height, 64);
    assert.equal(info.video?.fps, null);
  }
  for (const fields of [{displayTransform: [1, 0]}, {side_data_list: [{displaymatrix: 'bad matrix'}]}])
    assert.throws(() => parseMovieInfo(JSON.stringify({...raw, streams: [{...raw.streams[0], ...fields}]})), {code: 'invalid_response'});
});
test('rejects malformed metadata, unsafe timings and ambiguous stream identities', () => {
  for (const value of [null, {}, {...raw, streams: {}}, {...raw, format: {duration: 'Infinity'}},
    {...raw, format: {duration: '9007199254740992'}}, {...raw, streams: [...raw.streams, raw.streams[0]]},
    {...raw, streams: [{...raw.streams[0], width: -1}]},
    {...raw, streams: [{...raw.streams[0], avg_frame_rate: '25/0'}]},
    {...raw, streams: [{...raw.streams[1], segments: 'unknown'}]},
  ]) assert.throws(() => parseMovieInfo(JSON.stringify(value)), {code: 'invalid_response'});
});

test('a real executable receives literal arguments and errors never expose its private diagnostics', async () => {
  const directory = mkdtempSync('/tmp/apparent-dev-engine-sdk-');
  try {
    const executable = join(directory, 'provider');
    const movie = join(directory, 'space ; $(never-run).mp4');
    writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\nprintf \'%s\' \'' + JSON.stringify(raw) + '\'\n', {mode: 0o700});
    assert.equal((await probeMovie({executable, movie})).video?.width, 64);
    const {readFileSync} = await import('node:fs');
    assert.equal(readFileSync(executable + '.args', 'utf8'), `probe-v1\n${movie}\n`);
    writeFileSync(executable, '#!/bin/sh\necho private-path-and-token >&2\nexit 1\n');
    await assert.rejects(probeMovie({executable, movie}), error => error instanceof EngineProbeError &&
      error.code === 'probe_failed' && !String(error).includes('private-path'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test('missing runtime, deadline and cancellation have different results and settle after exit', async () => {
  const directory = mkdtempSync('/tmp/apparent-dev-engine-sdk-');
  try {
    const executable = join(directory, 'provider');
    const movie = join(directory, 'movie');
    await assert.rejects(probeMovie({executable, movie}), {code: 'unavailable'});
    writeFileSync(executable, '#!/bin/sh\nexec sleep 20\n', {mode: 0o700});
    await assert.rejects(probeMovie({executable, movie, timeoutMs: 50}), {code: 'timeout'});
    const controller = new AbortController();
    const pending = probeMovie({executable, movie, signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, {code: 'cancelled'});
    await assert.rejects(probeMovie({executable: 'provider', movie}), {code: 'invalid_request'});
    await assert.rejects(probeMovie({executable, movie, timeoutMs: 0}), {code: 'invalid_request'});
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('malformed and oversized provider output cannot become a successful probe', async () => {
  const directory = mkdtempSync('/tmp/apparent-dev-engine-sdk-');
  try {
    const executable = join(directory, 'provider'), movie = join(directory, 'movie');
    writeFileSync(executable, '#!/bin/sh\nprintf "not-json"\n', {mode: 0o700});
    await assert.rejects(probeMovie({executable, movie}), {code: 'invalid_response'});
    writeFileSync(executable, '#!/bin/sh\nexec head -c 2097152 /dev/zero\n');
    await assert.rejects(probeMovie({executable, movie}), {code: 'invalid_response'});
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
