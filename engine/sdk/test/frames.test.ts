import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {tmpdir} from 'node:os';
import {decodeMovieFrames, EngineFrameError} from '../dist/index.js';

function fixture(t: {after(fn: () => void): void}) {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-engine-frames-sdk-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const executable = join(root, 'provider'), movie = join(root, 'space ; $(never-run).mp4');
  let job = 0;
  const output = () => { const path = join(root, 'job-' + job++); mkdirSync(path, {mode: 0o700}); return path; };
  const provider = (body: string) => writeFileSync(executable, '#!/bin/sh\n' + body + '\n', {mode: 0o700});
  return {root, executable, movie, output, provider};
}
const reply = {version: 1, frames: [
  {requestIndex: 0, requestedMs: 25, actualMs: 0, width: 1, height: 1, file: 'frame-000.rgba'},
]};
const valid = (value: unknown = reply) =>
  'printf \'\\377\\000\\000\\377\' > "$3/frame-000.rgba"\nchmod 600 "$3/frame-000.rgba"\nprintf \'%s\' \'' + JSON.stringify(value) + '\'';

test('literal arguments, verified private bytes and original request identity', async t => {
  const f = fixture(t), directory = f.output();
  const canonicalDirectory = realpathSync(directory);
  const parentAlias = join(f.root, 'parent-alias'); symlinkSync(f.root, parentAlias);
  f.provider('printf "%s\\n" "$@" > "$0.args"\n' + valid());
  const frames = await decodeMovieFrames({executable: f.executable, movie: f.movie,
    outputDirectory: join(parentAlias, basename(directory)), timesMs: [25]});
  assert.deepEqual(frames, [{...reply.frames[0], file: join(canonicalDirectory, 'frame-000.rgba')}]);
  assert.equal(readFileSync(f.executable + '.args', 'utf8'), 'frames-v1\n' + f.movie + '\n' + canonicalDirectory + '\n0\n25\n');
  assert.deepEqual([...readFileSync(frames[0].file)], [255, 0, 0, 255]);
});

test('output must be fresh, owned and private before execution', async t => {
  const f = fixture(t);
  f.provider('echo invoked > "$0.invoked"\nexit 1');
  const nonempty = f.output(); writeFileSync(join(nonempty, 'sentinel'), 'keep');
  const publicDir = f.output(); chmodSync(publicDir, 0o755);
  const linked = join(f.root, 'link'); symlinkSync(f.output(), linked);
  for (const outputDirectory of [nonempty, publicDir, linked, linked + '/', join(f.root, 'absent')])
    await assert.rejects(decodeMovieFrames({executable: f.executable, movie: f.movie, outputDirectory, timesMs: [25]}), {code: 'unsafe_output'});
  assert.equal(readFileSync(join(nonempty, 'sentinel'), 'utf8'), 'keep');
  assert.throws(() => readFileSync(f.executable + '.invoked'));
});

test('invalid requests and pre-aborted signals cannot start a provider', async t => {
  const f = fixture(t); f.provider('echo invoked > "$0.invoked"');
  const base = {executable: f.executable, movie: f.movie, outputDirectory: f.output(), timesMs: [25]};
  for (const change of [{timesMs: []}, {timesMs: Array(481).fill(0)}, {timesMs: Array(4)}, {timesMs: [-1]}, {timesMs: [NaN]},
    {timesMs: [Number.MAX_SAFE_INTEGER + 1]}, {movie: 'relative'}, {movie: '/bad\0file'},
    {maxEdge: 16385}, {maxEdge: 0.5}, {timeoutMs: 0}, {timeoutMs: 300001}, {signal: {} as AbortSignal}])
    await assert.rejects(decodeMovieFrames({...base, ...change}), {code: 'invalid_request'});
  await assert.rejects(decodeMovieFrames({...base, signal: AbortSignal.abort()}), {code: 'cancelled'});
  assert.throws(() => readFileSync(f.executable + '.invoked'));
});

test('missing runtime, deadline, cancellation, limits and native failure are distinct and redacted', async t => {
  const f = fixture(t);
  const call = (extra = {}) => decodeMovieFrames({executable: f.executable, movie: f.movie, outputDirectory: f.output(), timesMs: [25], ...extra});
  await assert.rejects(call(), {code: 'unavailable'});
  f.provider('exit 69');
  await assert.rejects(call(), {code: 'unavailable'});
  f.provider('exec sleep 20');
  await assert.rejects(call({timeoutMs: 30}), {code: 'timeout'});
  const controller = new AbortController(), pending = call({signal: controller.signal}); controller.abort();
  await assert.rejects(pending, {code: 'cancelled'});
  f.provider('echo PRIVATE_PATH_AND_TOKEN >&2\nexit 72');
  await assert.rejects(call(), error => error instanceof EngineFrameError && error.code === 'resource_limit' && !String(error).includes('PRIVATE'));
  f.provider('echo PRIVATE_PATH_AND_TOKEN >&2\nexit 1');
  await assert.rejects(call(), {code: 'decode_failed'});
});

test('unindexed, reordered, truncated or escaped output is never successful', async t => {
  const f = fixture(t);
  const values = [null, {...reply, unknown: true}, {version: 2, frames: reply.frames}, {version: 1, frames: []},
    {version: 1, frames: [{...reply.frames[0], requestIndex: 1}]},
    {version: 1, frames: [{...reply.frames[0], requestedMs: 26}]},
    {version: 1, frames: [{...reply.frames[0], width: 0}]},
    {version: 1, frames: [{...reply.frames[0], file: '../outside'}]},
    {version: 1, frames: [{...reply.frames[0], extra: true}]},
  ];
  for (const value of values) {
    f.provider(valid(value));
    await assert.rejects(decodeMovieFrames({executable: f.executable, movie: f.movie, outputDirectory: f.output(), timesMs: [25]}), {code: 'invalid_response'});
  }
  for (const extra of ['truncate -s 3 "$3/frame-000.rgba"', 'chmod 644 "$3/frame-000.rgba"', 'echo keep > "$3/unexpected"']) {
    f.provider(valid() + '\n' + extra);
    await assert.rejects(decodeMovieFrames({executable: f.executable, movie: f.movie, outputDirectory: f.output(), timesMs: [25]}), {code: 'invalid_response'});
  }
  writeFileSync(f.executable + '.outside', 'keep');
  f.provider('ln -s "$0.outside" "$3/frame-000.rgba"\nprintf \'%s\' \'' + JSON.stringify(reply) + '\'');
  await assert.rejects(decodeMovieFrames({executable: f.executable, movie: f.movie, outputDirectory: f.output(), timesMs: [25]}), {code: 'invalid_response'});
  assert.equal(readFileSync(f.executable + '.outside', 'utf8'), 'keep');
});
