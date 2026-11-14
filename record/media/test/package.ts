// Explicit proof of the staged/signed consumer, including the real CLI export.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
assert.equal(args.length, 4); assert.equal(args[0], '--binary'); assert.equal(args[2], '--settings');
const binary = resolve(args[1]), settings = resolve(args[3]);
const runtime = join(settings, 'runtime', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const app = join(settings, 'app/electron/record-media');
const root = mkdtempSync(join(tmpdir(), 'apparent-dev-record-package-'));
try {
  const bundle = join(root, 'proof.apparent'); mkdirSync(bundle, {mode: 0o700});
  const source = join(root, 'source.mp4'), movie = join(bundle, 'recording.mp4'), output = join(root, 'export.mp4');
  const run = (command: string, argv: string[], env = process.env) =>
    execFileSync(command, argv, {env, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024});
  const ffmpeg = (argv: string[]) => run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...argv]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=25:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
  ffmpeg(['-display_rotation:v:0', '90', '-i', source, '-map', '0', '-c', 'copy', movie]);
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const original = hash(movie);
  const facts = JSON.parse(run(runtime, [join(app, 'worker.js'), join(app, 'native/apparent-engine-media'), movie],
    {...process.env, ELECTRON_RUN_AS_NODE: '1'}));
  assert.equal(facts.durationMs, 1000); assert.equal(facts.width, 48); assert.equal(facts.height, 64);
  assert.equal(facts.audioTracks, 1);
  writeFileSync(join(bundle, 'apparent.json'), JSON.stringify({
    version: 1, id: 'synthetic-engine-adoption', createdAtMs: 0, durationMs: 1000, source: 'iphone',
    target: {mode: 'display', displayId: 0, frame: {x: 0, y: 0, width: 48, height: 64, scale: 1}},
    transcript: {source: 'test', text: '', segments: []}, strokes: [], marks: [], keyframes: [],
    contactSheet: 'unused.png', video: 'recording.mp4', videoOffsetMs: 0, events: [], cursor: [],
  }));
  const metadata = hash(join(bundle, 'apparent.json'));
  // Isolate all application state; no GUI, capture, permissions or config edits.
  const home = join(root, 'home'); mkdirSync(home, {mode: 0o700});
  run(binary, ['export', bundle, '--out', output, '--no-zoom'],
    {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), APPIMAGE_EXTRACT_AND_RUN: '1'});
  const result = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
  const video = result.streams.find((stream: {codec_type: string}) => stream.codec_type === 'video');
  assert.equal(video.width, 48); assert.equal(video.height, 64);
  assert.equal(result.streams.filter((stream: {codec_type: string}) => stream.codec_type === 'audio').length, 1);
  assert(Math.abs(Number(result.format.duration) - 1) <= 0.1);
  ffmpeg(['-xerror', '-i', output, '-f', 'null', '-']);
  assert.equal(hash(movie), original); assert.equal(hash(join(bundle, 'apparent.json')), metadata);
  console.log('Packaged Record/Engine worker and CLI exported decodable rotated audio/video; source bundle unchanged.');
} finally { rmSync(root, {recursive: true, force: true}); }
