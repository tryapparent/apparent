import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Required provider proof, separate from the Rust/Electron-free policy loop.
const app = resolve(import.meta.dirname, '../../../capture/desktop/ui/frontend/electron/record-media');
const worker = join(app, 'worker.js'), engine = join(app, 'native/apparent-engine-media');
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
  const inspect = (file: string) => {
    const before = hash(file);
    const result = spawnSync(process.execPath, [worker, engine, file], {encoding:'utf8', timeout:40_000});
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
  writeFileSync(join(root,'invalid.mp4'),'SYNTHETIC PRIVATE SENTINEL');
  for (const file of [join(root,'invalid.mp4'),join(root,'missing.mp4'),'https://example.invalid/private.mp4']) {
    const result=spawnSync(process.execPath,[worker,engine,file],{encoding:'utf8',timeout:40_000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Record could not inspect the export movie\n');
  }
});
