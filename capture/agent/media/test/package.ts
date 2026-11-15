// The real packaged CLI must adopt the worker, not merely ship unused files.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
assert([4, 6].includes(args.length)); assert.equal(args[0], '--binary'); assert.equal(args[2], '--settings');
if (args.length === 6) assert.equal(args[4], '--proof-dir');
const binary = resolve(args[1]), settings = resolve(args[3]);
const runtime = join(settings, 'runtime', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const app = join(settings, 'app/electron/agent-media');
const root = mkdtempSync(join(tmpdir(), 'apparent-dev-agent-package-'));
try {
  const bundle = join(root, 'synthetic.apparent'), home = join(root, 'home'), temporary = join(root, 'temporary');
  for (const directory of [bundle, home, temporary]) mkdirSync(directory, {mode: 0o700});
  const movie = join(bundle, 'recording.mp4');
  const env = {...process.env, HOME: home, CFFIXED_USER_HOME: home, XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'), TMPDIR: temporary, DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', APPIMAGE_EXTRACT_AND_RUN: '1'};
  const run = (command: string, argv: string[]) => execFileSync(command, argv, {env, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024});
  const ffmpeg = ['-v', 'error', '-nostdin', '-y'];
  run('ffmpeg', [...ffmpeg, '-f', 'lavfi', '-i',
    'color=c=red:s=320x240:r=30:d=2,drawbox=x=160:y=0:w=160:h=240:color=blue:t=fill',
    '-c:v', 'libx264', '-threads', '1', '-g', '30', '-bf', '3', '-pix_fmt', 'yuv420p', movie]);
  const manifest = join(bundle, 'apparent.json');
  writeFileSync(manifest, JSON.stringify({
    version: 1, id: 'synthetic-agent-engine-adoption', createdAtMs: 0, durationMs: 1000,
    target: {mode: 'display', displayId: 0, frame: {x: 0, y: 0, width: 320, height: 240, scale: 1}},
    transcript: {source: 'test', text: '', segments: []}, strokes: [], marks: [], events: [], cursor: [],
    contactSheet: 'unused.png', video: 'recording.mp4', videoOffsetMs: 500,
    keyframes: [0, 1000].map((t, i) => ({index: i + 1, t, reason: 'speech', file: 'unused.png', event: ''})),
    autocrop: {label: 'Synthetic halves', fullFrames: 'unused', fullContactSheet: 'unused.png',
      crops: [0, 160].map((x, i) => ({index: i + 1, x, y: 0, width: 160, height: 240, kind: 'activity', reason: 'Synthetic half'}))},
  }));
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const sourceHash = hash(movie), manifestHash = hash(manifest);
  // Exercise the installed Electron runtime as a headless Node host as well.
  const directory = join(temporary, 'direct'); mkdirSync(directory, {mode: 0o700});
  const direct = JSON.parse(execFileSync(runtime, [join(app, 'worker.js'), join(app, 'native/apparent-engine-frames'), movie,
    directory, '500', '32', '0,200,400,600,800,1000'], {env: {...env, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8', timeout: 60_000}));
  assert.deepEqual(direct.frames.map((f: {requestedMs: number}) => f.requestedMs), [0, 200, 400, 600, 800, 1000]);
  rmSync(directory, {recursive: true});
  for (const full of [false, true]) {
    const output = run(binary, ['zoom', bundle, '--at', '0', '--span', '1', '--frames', '6', ...(full ? ['--full'] : [])]);
    for (const [i, t] of ['000', '200', '400', '600', '800', '000'].entries())
      assert(output.includes(`#${i + 1} 0:${i === 5 ? '01' : '00'}.${t}`), output);
    const png = join(bundle, 'zoom/zoom-0-1000.png');
    const stream = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', png])).streams[0];
    const [width, height] = full ? [1484, 754] : [1254, 934];
    assert.deepEqual([stream.width, stream.height], [width, height]);
    const rgba = execFileSync('ffmpeg', [...ffmpeg, '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {env, maxBuffer: 16 * 1024 * 1024});
    const color = (x: number, y: number, channel: number) => {
      const at = (y * width + x) * 4;
      assert(rgba[at + channel] > rgba[at + (2 - channel)] + 40, `wrong cell color (${x},${y})`);
    };
    for (let i = 0; i < 6; i++) {
      if (full) {
        color(12 + (i % 3) * 490 + 120, 12 + Math.floor(i / 3) * 370 + 180, 0);
        color(12 + (i % 3) * 490 + 360, 12 + Math.floor(i / 3) * 370 + 180, 2);
      } else color(12 + (i % 4) * 310 + 150, 12 + Math.floor(i / 4) * 460 + 225, i < 3 ? 0 : 2);
    }
    assert.deepEqual(readdirSync(temporary), [], 'owned raw frame directories must be removed before return');
    if (args.length === 6) {
      mkdirSync(resolve(args[5]), {recursive: true, mode: 0o700});
      copyFileSync(png, join(resolve(args[5]), full ? 'full.png' : 'cropped.png'));
    }
  }
  assert.equal(hash(movie), sourceHash); assert.equal(hash(manifest), manifestHash);
  console.log('Packaged Agent/Engine worker and both real zoom callers verified: offset identities, crop association, pixels, cleanup and source preservation.');
} finally { rmSync(root, {recursive: true, force: true}); }
