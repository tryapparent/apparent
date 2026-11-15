// Explicit proof of the staged/signed consumer, including the real CLI export.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const args = process.argv.slice(2);
assert([4, 6].includes(args.length)); assert.equal(args[0], '--binary'); assert.equal(args[2], '--settings');
if (args.length === 6) assert.equal(args[4], '--proof-dir');
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
  // Model the private recording files produced by capture, independently of the
  // verifier's umask. Keep the separate umask002 reprocessing privacy assertion.
  for (const file of [source, movie]) chmodSync(file, 0o600);
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const original = hash(movie);
  const facts = JSON.parse(run(runtime, [join(app, 'worker.js'), join(app, 'native/apparent-engine-media'), movie],
    {...process.env, ELECTRON_RUN_AS_NODE: '1'}));
  assert.equal(facts.durationMs, 1000); assert.equal(facts.width, 48); assert.equal(facts.height, 64);
  assert.equal(facts.audioTracks, 1);
  const bundleFacts = JSON.parse(run(runtime, [join(app, 'worker.js'), join(app, 'native/apparent-engine-media'), movie, 'bundle-v1'],
    {...process.env, ELECTRON_RUN_AS_NODE: '1'}));
  assert.equal(bundleFacts.durationMs, 1000); assert.equal(bundleFacts.width, 48); assert.equal(bundleFacts.height, 64);
  assert.equal(bundleFacts.audioTracks, 1);
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
  // The normal file-ingestion caller uses the same container metadata contract.
  // A silent fixture avoids installing/running a speech model in package proof.
  const input = join(root, 'ingest.apparent'), rebuilt = join(root, 'rebuilt.apparent');
  mkdirSync(input, {mode: 0o700});
  const silent = join(input, 'recording.mp4');
  ffmpeg(['-i', movie, '-c:v', 'copy', '-an', silent]);
  chmodSync(silent, 0o600);
  const incoming = {...JSON.parse(readFileSync(join(bundle, 'apparent.json'), 'utf8')),
    device: {name: 'Synthetic file', capture: 'mirror', width: 1, height: 1}};
  incoming.target.frame.width = 1; incoming.target.frame.height = 1;
  writeFileSync(join(input, 'apparent.json'), JSON.stringify(incoming));
  const beforeIngestion = hash(silent), beforeManifest = hash(join(input, 'apparent.json'));
  const runtimeDirectory = join(home, 'runtime'); mkdirSync(runtimeDirectory, {mode: 0o700});
  run('/bin/sh', ['-c', 'umask 002; exec "$@"', 'record-package', binary, 'reprocess', input, '--out', rebuilt], {...process.env, HOME: home, CFFIXED_USER_HOME: home,
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_RUNTIME_DIR: runtimeDirectory,
    DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', APPIMAGE_EXTRACT_AND_RUN: '1'});
  const assembled = JSON.parse(readFileSync(join(rebuilt, 'apparent.json'), 'utf8'));
  assert.equal(statSync(rebuilt).mode & 0o777, 0o700, 'bundle privacy must not depend on caller umask');
  assert.equal(assembled.target.frame.width, 48); assert.equal(assembled.target.frame.height, 64);
  assert.equal(assembled.durationMs, 1000); assert(assembled.keyframes.length > 0);
  for (const frame of assembled.keyframes) {
    const file = join(rebuilt, frame.file);
    const decoded = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file])).streams[0];
    assert.equal(decoded.width, 48); assert.equal(decoded.height, 64);
    ffmpeg(['-xerror', '-i', file, '-f', 'null', '-']);
  }
  assert.equal(hash(silent), beforeIngestion); assert.equal(hash(join(input, 'apparent.json')), beforeManifest);
  // Six distinct flags fill the ordinary budget and exercise phone assembly's
  // direct-mark path, independently of its periodic-candidate/full-frame path.
  const marked = join(root, 'marked.apparent'), markedOut = join(root, 'marked-rebuilt.apparent');
  mkdirSync(marked, {mode:0o700}); copyFileSync(silent, join(marked,'recording.mp4'));
  chmodSync(join(marked,'recording.mp4'),0o600);
  const marks = [0,100,200,300,400,500].map((t,index) => ({id:`f${index+1}`,shape:'flag',
    strokes:[],t0:t,t1:t,boxNorm:[0,0,1,1],description:'flagged this moment'}));
  writeFileSync(join(marked,'apparent.json'),JSON.stringify({...incoming,marks}),{mode:0o600});
  const markedMovie = hash(join(marked,'recording.mp4')), markedMetadata = hash(join(marked,'apparent.json'));
  run(binary,['reprocess',marked,'--out',markedOut],{...process.env,HOME:home,CFFIXED_USER_HOME:home,
    XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),XDG_RUNTIME_DIR:runtimeDirectory,
    DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'',APPIMAGE_EXTRACT_AND_RUN:'1'});
  const markedResult = JSON.parse(readFileSync(join(markedOut,'apparent.json'),'utf8'));
  assert.equal(markedResult.keyframes.length,6);
  assert.deepEqual(markedResult.keyframes.map((frame:{t:number})=>frame.t),[0,100,200,300,400,500]);
  assert(markedResult.keyframes.every((frame:{reason:string})=>frame.reason==='mark'));
  assert(markedResult.marks.every((mark:{frame?:string})=>mark.frame));
  assert.equal(hash(join(marked,'recording.mp4')),markedMovie); assert.equal(hash(join(marked,'apparent.json')),markedMetadata);
  for (const frame of markedResult.keyframes) {
    const pixels = execFileSync('ffmpeg',['-v','error','-nostdin','-i',join(markedOut,frame.file),'-f','rawvideo','-pix_fmt','rgba','-'],{maxBuffer:1024*1024});
    assert.equal(pixels.length,48*64*4); const center=(32*48+24)*4;
    assert(pixels[center+2]>pixels[center]+40,'decoded phone frame stays blue beneath annotations');
  }
  // Screen recovery/reprocessing has a distinct explicit-frame provider from
  // phone ingestion. Exercise its real packaged caller and nonzero movie offset.
  const screen = join(root, 'screen.apparent'), recovered = join(root, 'screen-rebuilt.apparent');
  mkdirSync(screen, {mode:0o700}); copyFileSync(silent, join(screen,'recording.mp4'));
  chmodSync(join(screen,'recording.mp4'),0o600);
  const screenInfo = {...incoming, source:'screen', device:undefined, durationMs:1500, videoOffsetMs:500,
    target:{...incoming.target,frame:{...incoming.target.frame,width:48,height:64}}};
  writeFileSync(join(screen,'apparent.json'),JSON.stringify(screenInfo),{mode:0o600});
  const screenHash = hash(join(screen,'recording.mp4')), screenMetadata = hash(join(screen,'apparent.json'));
  run(binary,['reprocess',screen,'--out',recovered],{...process.env,HOME:home,CFFIXED_USER_HOME:home,
    XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),XDG_RUNTIME_DIR:runtimeDirectory,
    DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'',APPIMAGE_EXTRACT_AND_RUN:'1'});
  const resultBundle = JSON.parse(readFileSync(join(recovered,'apparent.json'),'utf8'));
  assert(resultBundle.keyframes.length > 0); assert.equal(resultBundle.videoOffsetMs,500);
  for (const frame of resultBundle.keyframes) {
    assert(frame.t >= 500 && frame.t <= 1500,'bundle clock must survive explicit-frame decoding');
    const file = join(recovered,frame.file);
    const decoded = JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',file])).streams[0];
    assert.equal(decoded.width,48); assert.equal(decoded.height,64);
    ffmpeg(['-xerror','-i',file,'-f','null','-']);
  }
  assert.equal(hash(join(screen,'recording.mp4')),screenHash); assert.equal(hash(join(screen,'apparent.json')),screenMetadata);
  const benchmark=join(root,'screen-benchmark.apparent');
  run(binary,['reprocess',screen,'--out',benchmark,'--bench','1'],{...process.env,HOME:home,CFFIXED_USER_HOME:home,
    XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),XDG_RUNTIME_DIR:runtimeDirectory,
    DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'',APPIMAGE_EXTRACT_AND_RUN:'1'});
  const benchmarkBundle=JSON.parse(readFileSync(join(benchmark,'apparent.json'),'utf8'));
  assert.equal(benchmarkBundle.videoOffsetMs,500);assert(benchmarkBundle.keyframes.length>0);
  assert(benchmarkBundle.keyframes.every((frame:{t:number})=>frame.t>=500&&frame.t<=1500));
  assert.equal(hash(join(screen,'recording.mp4')),screenHash); assert.equal(hash(join(screen,'apparent.json')),screenMetadata);
  // A real full candidate page is larger than metadata's 32 KiB envelope.
  // Sparse/short fixtures cannot qualify this installed transport boundary.
  const longScreen=join(root,'full-page.apparent'),longOutput=join(root,'full-page-rebuilt.apparent');
  mkdirSync(longScreen,{mode:0o700});
  const longMovie=join(longScreen,'recording.mp4');
  ffmpeg(['-f','lavfi','-i','testsrc2=s=96x64:r=10:d=120','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',longMovie]);
  chmodSync(longMovie,0o600);
  writeFileSync(join(longScreen,'apparent.json'),JSON.stringify({...screenInfo,durationMs:120500,
    target:{...screenInfo.target,frame:{...screenInfo.target.frame,width:96,height:64}}}),{mode:0o600});
  const longHash=hash(longMovie),longMetadata=hash(join(longScreen,'apparent.json'));
  run(binary,['reprocess',longScreen,'--out',longOutput,'--bench','1'],{...process.env,HOME:home,CFFIXED_USER_HOME:home,
    XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),XDG_RUNTIME_DIR:runtimeDirectory,
    DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'',APPIMAGE_EXTRACT_AND_RUN:'1'});
  const longBundle=JSON.parse(readFileSync(join(longOutput,'apparent.json'),'utf8'));
  assert.equal(longBundle.videoOffsetMs,500);assert(longBundle.keyframes.length>0);
  assert(longBundle.keyframes.every((frame:{t:number})=>frame.t>=500&&frame.t<=120500));
  assert.equal(hash(longMovie),longHash);assert.equal(hash(join(longScreen,'apparent.json')),longMetadata);
  if (args.length === 6) {
    mkdirSync(resolve(args[5]),{recursive:true,mode:0o700});
    copyFileSync(join(markedOut,markedResult.keyframes[0].file),join(resolve(args[5]),'record-phone-flag.png'));
    copyFileSync(join(markedOut,'summary.md'),join(resolve(args[5]),'record-phone-summary.md'));
    copyFileSync(join(recovered,resultBundle.contactSheet),join(resolve(args[5]),'record-screen-sheet.png'));
    copyFileSync(join(recovered,resultBundle.keyframes[0].file),join(resolve(args[5]),'record-screen-frame.png'));
    copyFileSync(join(recovered,'apparent.json'),join(resolve(args[5]),'record-screen.json'));
    copyFileSync(join(recovered,'summary.md'),join(resolve(args[5]),'record-screen-summary.md'));
    copyFileSync(join(longOutput,longBundle.contactSheet),join(resolve(args[5]),'record-full-page-sheet.png'));
  }
  console.log('Packaged Record/Engine worker and CLI exported and ingested rotated media; decoded keyframes and source preservation verified.');
} finally { rmSync(root, {recursive: true, force: true}); }
