// The real packaged CLI must adopt the worker, not merely ship unused files.
import assert from 'node:assert/strict';
import {verifyZoomNarration} from '../../../../agent/enablement/ci/zoom-package.ts';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
assert([4, 6].includes(args.length)); assert.equal(args[0], '--binary'); assert.equal(args[2], '--settings');
if (args.length === 6) assert.equal(args[4], '--proof-dir');
const binary = resolve(args[1]), settings = resolve(args[3]);
const runtime = join(settings, 'runtime', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const app = join(settings, 'app/electron/agent-media');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'apparent-dev-agent-package-')));
try {
  const bundle = join(root, 'synthetic.apparent'), home = join(root, 'home'), temporary = join(root, 'temporary');
  for (const directory of [bundle, home, temporary]) mkdirSync(directory, {mode: 0o700});
  const movie = join(bundle, 'recording.mp4');
  const env = {...process.env, HOME: home, CFFIXED_USER_HOME: home, XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'), TMPDIR: temporary, DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', APPIMAGE_EXTRACT_AND_RUN: '1'};
  const run = (command: string, argv: string[]) => execFileSync(command, argv, {env, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024});
  const ffmpeg = ['-v', 'error', '-nostdin', '-y'];
  const assertTemporaryClean = () => {
    for (const entry of readdirSync(temporary)) {
      assert(/^appimage_extracted_[0-9a-f]{32}$/.test(entry) && lstatSync(join(temporary, entry)).isDirectory(),
        'owned raw frame directories must be removed before return');
    }
  };
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
  const rangePlan = JSON.parse(execFileSync(runtime,[join(app,'range-worker.js'),
    '18446744073709551615','18446744073709551615','-'],{
    env:{...env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:5000}));
  assert.equal(rangePlan.status,'plan');assert.equal(rangePlan.fps,4);
  assert.equal(rangePlan.upperMs,'18446744073709551615');
  const ordinary=run(binary,['frames',bundle,'--from','0','--to','1']).trim().split('\n');
  assert.equal(ordinary.length,4,'omitted CLI FPS must use the Agent-owned default');
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
    // extract-and-run keeps its runtime cache between CLI invocations. It is
    // distinct from the adapter's owned apparent-frames-* pixel directories.
    assertTemporaryClean();
    if (args.length === 6) {
      mkdirSync(resolve(args[5]), {recursive: true, mode: 0o700});
      copyFileSync(png, join(resolve(args[5]), full ? 'full.png' : 'cropped.png'));
    }
  }
  // Per-child executable search excludes FFmpeg, selecting the actual native
  // fallback. Preserve system tools needed by AppImage's extract-and-run host.
  const search = join(root, 'without-ffmpeg'); mkdirSync(search,{mode:0o700});
  const linked = new Set<string>();
  for (const directory of ['/usr/bin','/bin']) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (name !== 'ffmpeg' && !linked.has(name)) {
        symlinkSync(join(directory,name),join(search,name)); linked.add(name);
      }
    }
  }
  const fallbackEnv = {...env,PATH:search};
  assert.equal((spawnSync('ffmpeg',['-version'],{env:fallbackEnv}).error as NodeJS.ErrnoException)?.code,'ENOENT');
  const observations: {fps:number; elapsedMs:number}[] = [];
  const range = (fps: number) => {
    const started = performance.now();
    const paths = execFileSync(binary,['frames',bundle,'--from','0','--to','2.5','--fps',String(fps)],
      {env:fallbackEnv,encoding:'utf8',timeout:90_000,maxBuffer:1024*1024}).trim().split('\n');
    observations.push({fps,elapsedMs:Math.round(performance.now()-started)});
    return paths;
  };
  const many = range(20); assert.equal(many.length,51,'fallback must span more than one SDK request');
  assert.equal(many[0],join(bundle,'zoom/range-0-2500/frame-001.png'));
  assert.equal(many[50],join(bundle,'zoom/range-0-2500/frame-051.png'));
  if (args.length === 6) {
    copyFileSync(many[0],join(resolve(args[5]),'range-first.png'));
    copyFileSync(many[50],join(resolve(args[5]),'range-last.png'));
  }
  for (const file of [many[0],many[50]]) {
    const decoded = JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',file])).streams[0];
    assert.deepEqual([decoded.width,decoded.height],[320,240]);
    const pixels = execFileSync('ffmpeg',[...ffmpeg,'-i',file,'-f','rawvideo','-pix_fmt','rgba','-'],{env,maxBuffer:1024*1024});
    for (const [x,channel] of [[80,0],[240,2]]) {
      const at = (120*320+x)*4;
      assert(pixels[at+channel] > pixels[at+2-channel]+40);
    }
  }
  const retained = join(bundle,'zoom/range-0-2500/keep.txt'); writeFileSync(retained,'unrelated output');
  const fewer = range(1); assert.equal(fewer.length,3);
  assert.deepEqual(readdirSync(join(bundle,'zoom/range-0-2500')).sort(),['frame-001.png','frame-002.png','frame-003.png','keep.txt']);
  assert.equal(readFileSync(retained,'utf8'),'unrelated output');
  const omitted = execFileSync(binary,['frames',bundle,'--from','0','--to','1'],{
    env:fallbackEnv,encoding:'utf8',timeout:90000}).trim().split('\n');
  assert.equal(omitted.length,5,'native fallback keeps its inclusive default cadence');
  const saved=join(root,'saved-frames.apparent');mkdirSync(join(saved,'frames'),{recursive:true,mode:0o700});
  for(const [i,path] of fewer.entries())copyFileSync(path,join(saved,`frames/frame-00${i+1}.png`));
  writeFileSync(join(saved,'apparent.json'),JSON.stringify({...JSON.parse(readFileSync(manifest,'utf8')),
    video:'missing.mp4',keyframes:[0,1000,2000].map((t,i)=>({index:i+1,t,reason:'speech',
      file:`frames/frame-00${i+1}.png`,event:''}))}),{mode:0o600});
  for(const [time,fps,count] of [['0.875',undefined,1],['0.874',4,0],['0.929',7,1],['0.928',7,0]] as const) {
    const output=run(binary,['frames',saved,'--from',time,'--to',time,...(fps===undefined?[]:['--fps',String(fps)])]);
    const files=output.trim().split('\n').filter(Boolean);assert.equal(files.length,count);
    if(count)assert.equal(files[0],join(saved,'frames/frame-002.png'));
  }
  verifyZoomNarration(binary, bundle, env);
  const before= readdirSync(join(bundle,'zoom/range-0-2500')).sort();
  for(const [from,to,fps,message] of [['2.5','0',4,'Frame range ends before it starts'],
    ['0','2.5',0,'FPS must be between 1 and 240'],['0','2.5',241,'FPS must be between 1 and 240']] as const) {
    const failure=spawnSync(binary,['frames',bundle,'--from',from,'--to',to,'--fps',String(fps)],{
      env,encoding:'utf8',timeout:10000});
    assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert(failure.stderr.includes(message));
    assert.deepEqual(readdirSync(join(bundle,'zoom/range-0-2500')).sort(),before,'invalid request changed generated outputs');
  }
  assertTemporaryClean();
  console.log('Synthetic range fallback observations (not a controlled benchmark): '+JSON.stringify(observations));
  assert.equal(hash(movie), sourceHash); assert.equal(hash(manifest), manifestHash);
  console.log('Packaged Agent/Engine zoom and native range fallback verified: indexed times, pixels, batching, stale-output cleanup and source preservation.');
} finally { rmSync(root, {recursive: true, force: true}); }
