/** Real ingestion/audio publication; the local transcriber proves handoff, not recognition. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, cpSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function qualifyAudioIngestion(options: {
  binary: string; sourceBundle: string; root: string; home: string; runtimeDirectory: string;
}) {
  const {binary, sourceBundle, root, home, runtimeDirectory} = options;
  const input = join(root, 'audio-input.apparent'), output = join(root, 'audio-rebuilt.apparent');
  // Preserve a manifest and artifacts produced by the actual preceding ingestion,
  // rather than constructing a new consumer-shaped bundle schema here.
  cpSync(sourceBundle, input, {recursive: true, errorOnExist: true, force: false});
  chmodSync(input, 0o700);
  const movie = join(input, 'recording.mp4'), manifest = join(input, 'apparent.json');
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=25:d=2',
    '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', movie]);
  chmodSync(movie, 0o600);
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const beforeMovie = hash(movie), beforeManifest = hash(manifest);
  const sourceAudio = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=start_time,duration', '-of', 'json', movie], {encoding: 'utf8'})).streams[0];
  const sourceStart = Number(sourceAudio.start_time), sourceEnd = sourceStart + Number(sourceAudio.duration);
  assert(sourceStart > 0.45 && sourceStart < 0.51, 'the producer must encode a leading movie-time gap');

  const transcriber = join(root, 'audio-transcriber.ts'), receipt = join(root, 'audio-handoff.json');
  writeFileSync(transcriber, `import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.APPARENT_TRANSCRIBE_VERSION, '1');
assert.equal(process.argv[2], process.env.APPARENT_AUDIO);
const bytes = readFileSync(process.argv[2]);
assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
writeFileSync(process.argv[3], JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex')}), {mode:0o600, flag:'wx'});
console.log(JSON.stringify({version:1, text:''}));
`, {mode: 0o600});
  const config = join(root, 'audio-config.json');
  writeFileSync(config, JSON.stringify({transcriber: 'command', transcribeTimeoutSeconds: 10,
    transcribeCommand: [process.execPath, '--experimental-strip-types', transcriber, '{audio}', receipt]}), {mode: 0o600});
  const beforeConfig = hash(config);
  execFileSync('/bin/sh', ['-c', 'umask 002; exec "$@"', 'audio-package', binary,
    'reprocess', input, '--out', output, '--transcriber', 'command'], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
    env: {...process.env, HOME: home, CFFIXED_USER_HOME: home, APPARENT_CONFIG: config,
      APPARENT_MODELS_DIR: join(home, 'unused-models'), XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_RUNTIME_DIR: runtimeDirectory,
      DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', APPIMAGE_EXTRACT_AND_RUN: '1'},
  });
  const bundle = JSON.parse(readFileSync(join(output, 'apparent.json'), 'utf8'));
  assert.match(bundle.transcript.source, /^command:/, 'the controlled transcriber must receive real extracted audio');
  assert.equal(typeof bundle.audio, 'string');
  const wav = join(output, bundle.audio);
  assert.equal(statSync(wav).mode & 0o777, 0o600, 'audio privacy must not depend on caller umask');
  assert.equal(hash(wav), JSON.parse(readFileSync(receipt, 'utf8')).sha256, 'publish the exact validated transcriber input');
  const format = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', wav], {encoding: 'utf8'})).streams[0];
  assert.equal(format.codec_name, 'pcm_s16le'); assert.equal(format.channels, 1); assert.equal(Number(format.sample_rate), 16000);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', wav, '-f', 's16le', '-acodec', 'pcm_s16le', '-'],
    {timeout: 30_000, maxBuffer: 1024 * 1024});
  function rms(start: number, end: number) {
    let sum = 0, count = 0;
    for (let sample = Math.round(start * 16000); sample < Math.round(end * 16000); sample++) {
      const value = pcm.readInt16LE(sample * 2) / 32768;
      sum += value * value; count++;
    }
    return Math.sqrt(sum / count);
  }
  const durationMs = pcm.length / 32, leadingRms = rms(0, 0.3), toneRms = rms(0.7, 1);
  assert(leadingRms < 0.001, 'leading movie-time delay must remain silence');
  assert(toneRms > 0.04, 'the delayed source tone must survive decoding');
  // Allow one 48kHz AAC packet plus the output resampler's rounding, not a shifted timeline.
  assert(Math.abs(durationMs - sourceEnd * 1000) < 25, 'WAV end must stay on the movie clock');
  assert(!readdirSync(output).some(name => name.startsWith('.audio-export-')), 'owned temporary audio must be gone');
  assert.equal(hash(movie), beforeMovie); assert.equal(hash(manifest), beforeManifest); assert.equal(hash(config), beforeConfig);
  return {sourceStartMs: sourceStart * 1000, sourceEndMs: sourceEnd * 1000, durationMs, leadingRms, toneRms,
    wavSha256: hash(wav), sourcePreserved: true, callerUmask: '002', audioMode: '600', controlledTranscriber: true};
}
