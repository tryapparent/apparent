/** Actual extracted native package, public compiled SDK, synthetic media only. */
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {decodeMovieFrames} from '@apparent/engine-sdk';

export async function qualifyFrames(executable: string, directory: string, movie: string, rotated: string) {
  let next = 0;
  const output = () => { const path = join(directory, 'frame-job-' + next++); mkdirSync(path, {mode: 0o700}); return path; };
  async function decode(stage: string, options: Parameters<typeof decodeMovieFrames>[0]) {
    try { return await decodeMovieFrames(options); }
    catch (error) {
      // This qualifier supplies synthetic inputs only. On failure, one bounded
      // direct invocation observes the native stage hidden by the SDK's public
      // redaction boundary. Preserve the original failure, never admit a retry.
      try {
        const diagnostic = spawnSync(executable, ['frames-v1', options.movie, output(),
          String(options.maxEdge ?? 0), options.timesMs.join(',')], {
          encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
        });
        const failure = diagnostic.stderr?.match(/^Engine frames: (?:invalidRequest|unsafeOutput|decodeFailed|resourceLimit|writeFailed|preciseTiming|videoTrack|segments|mediaTime|cursor|cursorRange|sampleTime|generatorTime|rgbaContext|sequentialReader|sequentialTime|sequentialImage|invalid_request|unsafe_output|decode_failed|resource_limit|write_failed|unavailable|platform_error code=-?\d+ underlying=-?\d+)$/m)?.[0] ?? 'unclassified';
        const timing = diagnostic.stderr?.match(/^Engine frame timing: sample=-?\d+\/\d+ actual=-?\d+\/\d+ request=\d+$/m)?.[0];
        const reader = diagnostic.stderr?.match(/^Engine frame reader: status=\d+ code=-?\d+ underlying=-?\d+$/m)?.[0];
        console.error(JSON.stringify({frameQualificationStage: stage, nativeExit: diagnostic.status,
          signal: diagnostic.signal, nativeFailure: failure, nativeTiming: timing, nativeReader: reader}));
      } catch {
        console.error(JSON.stringify({frameQualificationStage: stage, nativeFailure: 'diagnostic_unavailable'}));
      }
      throw error;
    }
  }
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const hashes = [hash(movie), hash(rotated)];
  const started = performance.now();
  const times = [800, 0, 400, 400, 10_000];
  const frames = await decode('scaled-requests', {executable, movie, outputDirectory: output(), timesMs: times, maxEdge: 32});
  assert.deepEqual(frames.map(f => f.requestIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(frames.map(f => f.requestedMs), times);
  assert.deepEqual(frames.map(f => [f.width, f.height]), times.map(() => [32, 24]));
  assert(frames[4].actualMs >= 900 && frames[4].actualMs < 1000);
  assert.equal(hash(frames[2].file), hash(frames[3].file));
  for (const frame of frames) {
    assert.equal(statSync(frame.file).mode & 0o777, 0o600);
    assert.equal(readFileSync(frame.file).length, frame.width * frame.height * 4);
  }
  const portrait = await decode('rotated-dimensions', {executable, movie: rotated, outputDirectory: output(), timesMs: [0], maxEdge: 32});
  assert.deepEqual([portrait[0].width, portrait[0].height], [24, 32]);
  const nativeSize = await decode('never-upscale', {executable, movie, outputDirectory: output(), timesMs: [0], maxEdge: 1024});
  assert.deepEqual([nativeSize[0].width, nativeSize[0].height], [64, 48], 'maximum edge must never enlarge the source');

  const pattern = join(directory, 'two-color.mp4'), turned = join(directory, 'two-color-rotated.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
    'color=c=red:s=64x48:r=10:d=1,drawbox=x=32:y=0:w=32:h=48:color=blue:t=fill',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-y', pattern], {stdio: 'pipe'});
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-display_rotation:v:0', '90', '-i', pattern, '-c', 'copy', '-y', turned], {stdio: 'pipe'});
  const orientation = await decode('rotated-pixels', {executable, movie: turned, outputDirectory: output(), timesMs: [0]});
  assert.deepEqual([orientation[0].width, orientation[0].height], [48, 64]);
  const oriented = readFileSync(orientation[0].file);
  for (const [y, channel] of [[16, 2], [48, 0]]) {
    const index = (y * 48 + 24) * 4;
    assert(oriented[index + channel] > oriented[index + (2 - channel)] + 40, 'display rotation must preserve image orientation');
  }

  // Real source-time changes, with B frames and an open GOP. Unsorted requests,
  // duplicates, first/last clamps and between-sample selection use native PTS.
  const colors = join(directory, 'colors "quotes" backslash\\ !.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=c=green:s=64x48:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=10:d=1',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-threads', '1',
    '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', '-bf', '3', '-x264-params', 'open-gop=1',
    '-pix_fmt', 'yuv420p', '-y', colors], {stdio: 'pipe'});
  const colorsHash = hash(colors);
  const samples = await decode('temporal-colors', {executable, movie: colors, outputDirectory: output(),
    timesMs: [2500, 550, 1550, 1550, 99_999, 1050, 2050]});
  for (const [index, channel] of [2, 0, 1, 1, 2, 1, 2].entries()) {
    const rgba = readFileSync(samples[index].file), pixel = ((24 * 64) + 32) * 4;
    assert(rgba[pixel + channel] > 90, 'native frame must have the source-time color');
    for (let other = 0; other < 3; other++) if (other !== channel)
      assert(rgba[pixel + channel] > rgba[pixel + other] + 40);
  }
  assert.deepEqual(samples.map(f => f.actualMs), [2500, 500, 1500, 1500, 2900, 1000, 2000]);
  assert.equal(hash(colors), colorsHash);

  const delayed = join(directory, 'delayed-video.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-itsoffset', '0.35', '-i', movie, '-map', '0:v',
    '-an', '-c', 'copy', '-y', delayed], {stdio: 'pipe'});
  const gap = await decode('edit-list-offset', {executable, movie: delayed, outputDirectory: output(), timesMs: [0, 450, 99_999]});
  assert.deepEqual(gap.map(f => f.actualMs), [350, 430, 1310], 'movie clock must retain native edit-list offsets');

  const invalid = join(directory, 'invalid-frame-input.mp4'); writeFileSync(invalid, 'SYNTHETIC PRIVATE SENTINEL');
  await assert.rejects(decodeMovieFrames({executable, movie: invalid, outputDirectory: output(), timesMs: [0]}), {code: 'decode_failed'});
  const occupied = output(); writeFileSync(join(occupied, 'sentinel'), 'keep');
  const refusal = spawnSync(executable, ['frames-v1', movie, occupied, '0', '0'], {encoding: 'utf8', timeout: 10_000});
  assert.notEqual(refusal.status, 0); assert.equal(refusal.stdout, '');
  assert.deepEqual(readdirSync(occupied), ['sentinel']); assert.equal(readFileSync(join(occupied, 'sentinel'), 'utf8'), 'keep');
  const unsafe = output(); chmodSync(unsafe, 0o755);
  const insecure = spawnSync(executable, ['frames-v1', movie, unsafe, '0', '0'], {encoding: 'utf8', timeout: 10_000});
  assert.notEqual(insecure.status, 0); assert.deepEqual(readdirSync(unsafe), []);
  const alias = join(directory, 'frame-output-alias'); symlinkSync(output(), alias);
  const linked = spawnSync(executable, ['frames-v1', movie, alias, '0', '0'], {encoding: 'utf8', timeout: 10_000});
  assert.notEqual(linked.status, 0);
  const badOperation = spawnSync(executable, ['arbitrary', movie, output(), '0', '0'], {encoding: 'utf8', timeout: 10_000});
  assert.notEqual(badOperation.status, 0); assert.equal(badOperation.stdout, '');
  const controller = new AbortController();
  const pending = decodeMovieFrames({executable, movie, outputDirectory: output(), timesMs: [0], signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {code: 'cancelled'});
  assert.deepEqual([hash(movie), hash(rotated)], hashes);
  console.log(JSON.stringify({capability: 'movie-frames/1', platform: process.platform, arch: process.arch,
    providerMode: process.platform === 'darwin' && process.env.APPARENT_ENGINE_QUALIFY_SEQUENTIAL === '1' ? 'sequential' : 'default',
    elapsedMs: Math.round(performance.now() - started), checks: ['packed-public-sdk', 'actual-native-decoding',
      'request-identities', 'duplicates', 'backward-seek', 'presentation-clock', 'edge-clamps', 'scale',
      'display-rotation-and-pixels', 'edit-list-offsets', 'never-upscale', 'private-files',
      'unsafe-output-refusal', 'cancellation', 'source-preservation']}));
}
