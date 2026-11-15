import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Required provider proof, separate from the Rust/Electron-free policy loop.
const app = resolve(import.meta.dirname, '../../../capture/desktop/ui/frontend/electron/record-media');
const worker = join(app, 'worker.js'), engine = join(app, 'native/apparent-engine-media');
test('screen paging keeps offsets and makes progress through pages with no new presentation samples', t => {
  const root=mkdtempSync(join(tmpdir(),'apparent-dev-record-screen-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const movie=join(root,'long-hold.mp4');
  execFileSync('ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i',
    'color=c=red:s=64x48:r=1/400:d=0.1,drawbox=x=32:y=0:w=32:h=48:color=blue:t=fill',
    '-c:v','libx264','-threads','1','-pix_fmt','yuv420p',movie],{stdio:'pipe'});
  const before=readFileSync(movie),facts=JSON.parse(execFileSync(process.execPath,[worker,engine,movie,'bundle-v1'],{encoding:'utf8',timeout:30_000}));
  assert(facts.durationMs>=400_000);
  let cursor='null',pages=0,empty=0;const times:number[]=[];
  do {
    const directory=join(root,'page-'+pages);mkdirSync(directory,{mode:0o700});
    const page=JSON.parse(execFileSync(process.execPath,[join(app,'screen-worker.js'),join(app,'native/apparent-engine-frames'),
      movie,directory,String(facts.durationMs),'500','recovery',cursor,'300000'],{encoding:'utf8',timeout:60_000}));
    assert.equal(page.reply.version,1);assert(page.reply.frames.length<=480);
    if(!page.reply.frames.length)empty++;
    assert.deepEqual(readdirSync(directory).sort(),page.reply.frames.map((f:{file:string})=>f.file).sort());
    for(const [index,frame] of page.reply.frames.entries()) {
      assert.equal(frame.requestIndex,index);assert.equal(frame.requestedMs,frame.actualMovieMs+500);
      const file=join(directory,frame.file),pixels=readFileSync(file);
      assert.equal(statSync(file).nlink,1);assert.equal(statSync(file).mode&0o777,0o600);
      assert.deepEqual([frame.width,frame.height],[64,48]);assert.equal(pixels.length,64*48*4);
      for(const [x,channel] of [[16,0],[48,2]]){const at=(24*64+x)*4;assert(pixels[at+channel]>pixels[at+2-channel]+40);}
      times.push(frame.requestedMs);
    }
    cursor=page.nextCursor;pages++;assert(pages<=5,'continuation must finish the finite recording');
  } while(cursor!==null);
  assert.equal(pages,4);assert.equal(empty,3);assert.deepEqual(times,[500]);
  assert.deepEqual(readFileSync(movie),before);
  const invalid=join(root,'invalid');mkdirSync(invalid,{mode:0o700});
  const refused=spawnSync(process.execPath,[join(app,'screen-worker.js'),join(app,'native/apparent-engine-frames'),
    movie,invalid,'1000','0','recovery','{}','1000'],{encoding:'utf8',timeout:5000});
  assert.equal(refused.status,1);assert.equal(refused.stdout,'');assert.equal(refused.stderr,'Record could not decode screen movie candidates\n');
  assert.deepEqual(readdirSync(invalid),[]);
});
test('phone candidates span native batches, deduplicate actual times and retain private pixels', t => {
  const root=mkdtempSync(join(tmpdir(),'apparent-dev-record-phone-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const movie=join(root,'sparse.mp4'),directory=join(root,'frames'); mkdirSync(directory,{mode:0o700});
  // 61 frames over 122 seconds: 481 candidate requests, with a duplicate
  // presentation sample straddling the SDK's 480-request batch boundary.
  execFileSync('ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i',
    'color=c=red:s=64x48:r=1/2:d=120.2,drawbox=x=32:y=0:w=32:h=48:color=blue:t=fill',
    '-c:v','libx264','-threads','1','-pix_fmt','yuv420p',movie],{stdio:'pipe'});
  const before=readFileSync(movie);
  const reply=JSON.parse(execFileSync(process.execPath,[join(app,'phone-worker.js'),
    join(app,'native/apparent-engine-frames'),movie,directory,'122000'],{encoding:'utf8',timeout:60_000}));
  assert.equal(reply.version,1); assert.equal(reply.frames.length,61);
  assert.deepEqual(readdirSync(directory).sort(),reply.frames.map((f:{file:string})=>f.file).sort());
  for(const [index,frame] of reply.frames.entries()) {
    assert.equal(frame.requestIndex,index);assert.equal(frame.requestedMs,index*2000);
    assert.equal(frame.actualMovieMs,frame.requestedMs);assert.deepEqual([frame.width,frame.height],[64,48]);
    const file=join(directory,frame.file),pixels=readFileSync(file);
    assert.equal(statSync(file).mode&0o777,0o600);assert.equal(statSync(file).nlink,1);
    assert.equal(pixels.length,64*48*4);
    for(const [x,channel] of [[16,0],[48,2]]){const at=(24*64+x)*4;assert(pixels[at+channel]>pixels[at+2-channel]+40);}
  }
  assert.deepEqual(readFileSync(movie),before);
  const bad=join(root,'bad.mp4'),failed=join(root,'failed');writeFileSync(bad,'SYNTHETIC PRIVATE PATH');mkdirSync(failed,{mode:0o700});
  const failure=spawnSync(process.execPath,[join(app,'phone-worker.js'),join(app,'native/apparent-engine-frames'),bad,failed,'1000'],{encoding:'utf8',timeout:10_000});
  assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert.equal(failure.stderr,'Record could not decode phone movie candidates\n');
  assert.deepEqual(readdirSync(failed),[]);
});
test('Record frames use the actual published provider and retain clamped bundle identities', t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-record-frames-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const movie = join(root, 'recording.mp4'), output = join(root, 'frames');
  mkdirSync(output, {mode:0o700});
  execFileSync('ffmpeg', ['-v','error','-nostdin','-y','-f','lavfi','-i',
    'color=c=red:s=64x48:r=30:d=2,drawbox=x=32:y=0:w=32:h=48:color=blue:t=fill',
    '-c:v','libx264','-threads','1','-g','30','-bf','3','-pix_fmt','yuv420p',movie], {stdio:'pipe'});
  const before = readFileSync(movie), times = [0,250,500,534,567,1050];
  const reply = JSON.parse(execFileSync(process.execPath, [join(app,'frames-worker.js'),
    join(app,'native/apparent-engine-frames'),movie,output,'500','32',times.join(',')],
    {encoding:'utf8',timeout:60_000}));
  assert.equal(reply.version,1);
  assert.deepEqual(reply.frames.map((f: {requestedMs:number}) => f.requestedMs),times);
  assert.deepEqual(reply.frames.map((f: {requestIndex:number}) => f.requestIndex),[0,1,2,3,4,5]);
  assert.deepEqual(reply.frames.map((f: {actualMovieMs:number}) => f.actualMovieMs),[0,0,0,33,66,533]);
  for (const frame of reply.frames) {
    assert.deepEqual([frame.width,frame.height],[32,24]);
    const path = join(output,frame.file), pixels = readFileSync(path);
    assert.equal(pixels.length,32*24*4); assert.equal(statSync(path).mode & 0o777,0o600);
    for (const [x,channel] of [[8,0],[24,2]]) {
      const at = (12*32+x)*4;
      assert(pixels[at+channel] > pixels[at+2-channel]+40);
    }
  }
  assert.deepEqual(readFileSync(movie),before);
});
test('consumer provisioning refuses to replace an unowned directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-record-stage-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'sentinel'), 'existing unrelated output');
  const result = spawnSync(process.execPath, ['--experimental-strip-types', resolve(import.meta.dirname, '../stage.ts'), '--out', root],
    {encoding: 'utf8', timeout: 5_000});
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(root), ['sentinel']);
  assert.equal(readFileSync(join(root, 'sentinel'), 'utf8'), 'existing unrelated output');
});
test('staged Record worker consumes the published native provider with real media', t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-record-media-proof-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'source.mp4'), rotated = join(root, 'rotated.mp4'), silent = join(root, 'silent.mp4');
  const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v','error','-nostdin','-y',...args], {stdio:'pipe'});
  ffmpeg(['-f','lavfi','-i','color=c=blue:s=64x48:r=25:d=1','-f','lavfi','-i','sine=frequency=440:duration=1',
    '-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  // Use the producer's actual display-matrix fixture; a rotate tag alone is
  // silently ignored by some supported FFmpeg versions.
  ffmpeg(['-display_rotation:v:0','90','-i',source,'-c','copy',rotated]);
  ffmpeg(['-i',source,'-c:v','copy','-an',silent]);
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const inspect = (file: string, operation?: string) => {
    const before = hash(file);
    const result = spawnSync(process.execPath, [worker, engine, file, ...(operation ? [operation] : [])], {encoding:'utf8', timeout:40_000});
    assert.equal(result.status,0,result.stderr); assert.equal(hash(file),before);
    return JSON.parse(result.stdout);
  };
  const facts = inspect(source);
  assert.deepEqual({width:facts.width,height:facts.height,duration:facts.durationMs,audio:facts.audioTracks},
    {width:64,height:48,duration:1000,audio:1});
  assert.equal(facts.embeddedAudio,1);
  const turned = inspect(rotated);
  assert.equal(turned.width,48); assert.equal(turned.height,64);
  assert.equal(inspect(silent).embeddedAudio,null);
  const bundle = inspect(rotated, 'bundle-v1');
  assert.equal(bundle.width,48); assert.equal(bundle.height,64); assert.equal(bundle.audioTracks,1);
  const tail = join(root, 'audio-tail.mp4');
  ffmpeg(['-f','lavfi','-i','color=c=blue:s=64x48:r=25:d=1','-f','lavfi','-i','sine=frequency=440:duration=2',
    '-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',tail]);
  assert.equal(inspect(tail, 'export-v1').durationMs,1000);
  assert(Math.abs(inspect(tail, 'bundle-v1').durationMs - 2000) <= 50);
  const invalidOperation = spawnSync(process.execPath,[worker,engine,source,'arbitrary-operation'],{encoding:'utf8',timeout:5_000});
  assert.equal(invalidOperation.status,1); assert.equal(invalidOperation.stdout,'');
  assert.equal(invalidOperation.stderr,'Record could not inspect the export movie\n');
  writeFileSync(join(root,'invalid.mp4'),'SYNTHETIC PRIVATE SENTINEL');
  for (const file of [join(root,'invalid.mp4'),join(root,'missing.mp4'),'https://example.invalid/private.mp4']) {
    const result=spawnSync(process.execPath,[worker,engine,file],{encoding:'utf8',timeout:40_000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Record could not inspect the export movie\n');
  }
});
