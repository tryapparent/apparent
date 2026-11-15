import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {after, before, test} from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'apparent-dev-agent-native-'));
const owner = resolve(import.meta.dirname, '..'), app = join(root, 'app');
const movie = join(root, 'source literal $(never-run).mp4');
const native = join(app, 'native/apparent-engine-frames'), worker = join(app, 'worker.js');
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
let ordinal = 0;
const output = () => { const p = join(root, 'frames-' + ordinal++); mkdirSync(p, {mode: 0o700}); return p; };
const run = (args: string[]) => execFileSync(process.execPath, args, {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, timeout: 60_000, encoding: 'utf8'});
before(() => {
  const previous = process.umask(0o002);
  try { run(['--experimental-strip-types', join(owner, 'stage.ts'), '--out', app]); }
  finally { process.umask(previous); }
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
    'color=c=red:s=64x48:r=30:d=2,drawbox=x=32:y=0:w=32:h=48:color=blue:t=fill',
    '-c:v', 'libx264', '-threads', '1', '-g', '30', '-bf', '3', '-pix_fmt', 'yuv420p', '-y', movie], {stdio: 'pipe'});
});
after(() => rmSync(root, {recursive: true, force: true}));

test('actual published provider preserves fractional-frame clocks and clamped request identities', () => {
  const before = hash(movie), directory = output(), times = [0, 250, 500, 534, 567, 1050];
  const reply = JSON.parse(run([worker, native, movie, directory, '500', '32', times.join(',')]));
  assert.equal(reply.version, 1);
  assert.deepEqual(reply.frames.map((f: {requestIndex: number}) => f.requestIndex), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(reply.frames.map((f: {requestedMs: number}) => f.requestedMs), times);
  assert.deepEqual(reply.frames.map((f: {actualMovieMs: number}) => f.actualMovieMs), [0, 0, 0, 33, 66, 533]);
  assert.deepEqual(reply.frames.map((f: {width: number; height: number}) => [f.width, f.height]), times.map(() => [32, 24]));
  for (const frame of reply.frames) {
    const path = join(directory, frame.file);
    assert.equal(readFileSync(path).length, frame.width * frame.height * 4);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  assert.equal(hash(join(directory, reply.frames[0].file)), hash(join(directory, reply.frames[1].file)));
  assert.equal(hash(join(directory, reply.frames[1].file)), hash(join(directory, reply.frames[2].file)));
  assert.equal(hash(movie), before);
});

test('real headless worker returns display-oriented private pixels and stages only frame capabilities', () => {
  const turned = join(root, 'rotated.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-display_rotation:v:0', '90', '-i', movie, '-c', 'copy', '-y', turned], {stdio: 'pipe'});
  const before = hash(turned), directory = output();
  const reply = JSON.parse(run([worker, native, turned, directory, '0', '0', '0']));
  const frame = reply.frames[0]; assert.deepEqual([frame.width, frame.height], [48, 64]);
  const rgba = readFileSync(join(directory, frame.file));
  for (const [y, channel] of [[16, 2], [48, 0]]) {
    const at = (y * 48 + 24) * 4;
    assert(rgba[at + channel] > rgba[at + (2 - channel)] + 40);
  }
  const names = ['LICENSE', 'apparent-engine-frames'];
  if (process.platform === 'darwin') names.push('apparent-engine-frames-native');
  assert.deepEqual(readdirSync(join(app, 'native')).sort(), names.sort());
  assert.equal(statSync(join(app, 'native')).mode & 0o777, 0o755);
  assert.equal(hash(turned), before);
});

test('failed native request produces no partial reply and preserves SDK diagnostic redaction', () => {
  const provider = join(root, 'synthetic-provider'), sentinel = 'SYNTHETIC_PRIVATE_NATIVE_DIAGNOSTIC';
  writeFileSync(provider, '#!/bin/sh\nprintf "' + sentinel + '\\n" >&2\nexit 1\n'); chmodSync(provider, 0o700);
  assert(spawnSync(provider, [], {encoding: 'utf8'}).stderr.includes(sentinel));
  const result = spawnSync(process.execPath, [worker, provider, movie, output(), '0', '0', '0'],
    {encoding: 'utf8', timeout: 10_000, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Agent could not decode the requested movie frames\n');
});
