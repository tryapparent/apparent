// Cross-owner proof; the isolated Hermes build does not import Agent sources.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {installPackage, system} from '../../capture/agent/setup/hermes.ts';

test('Agent consumes the compiled archive for empty, partial, repeat and conflicting installs', async()=>{
 const job=await mkdtemp('/tmp/apparent-dev-hermes-consumer-');
 try {
  const release=process.env.HERMES_PACKAGE || path.join(job,'release');
  if(!process.env.HERMES_PACKAGE)execFileSync(process.execPath,['--experimental-strip-types','hermes/desktop/package.ts',release]);
  const version=(await readFile('hermes/plugin.yaml','utf8')).match(/^version: "(.*)"/m)![1];
  const archive=path.join(release,`apparent-hermes-${version}.tar.gz`);
  const digest=(await readFile(archive+'.sha256','utf8')).trim().split(/\s+/)[0];
  const profile=path.join(job,'profile');
  const plugin=path.join(profile,'plugins/apparent');
  const desktop=path.join(plugin,'desktop/plugin.js');
  assert.equal(installPackage(system,archive,digest,profile),true);
  const compiled=await readFile(desktop);
  assert.ok(compiled.length>0);
  const compatibility=JSON.parse(await readFile(path.join(plugin,'compatibility.json'),'utf8'));
  assert.equal(compatibility.schema,1);
  assert.equal(compatibility.plugin,'apparent');
  assert.equal(compatibility.version,version);
  assert.equal(compatibility.hermes,'>=0.23.0');
  assert.ok(compatibility.platforms.includes(process.platform));
  const agent=path.join(plugin,'adapter.py');
  const original=await readFile(agent);
  const identity=await stat(agent);
  const unrelated=path.join(plugin,'user-file');
  await writeFile(unrelated,'preserve');
  await rm(desktop);
  assert.equal(installPackage(system,archive,digest,profile),true);
  assert.deepEqual(await readFile(desktop),compiled);
  assert.deepEqual(await readFile(agent),original);
  assert.equal((await stat(agent)).ino,identity.ino);
  assert.equal((await stat(agent)).mtimeMs,identity.mtimeMs);
  const installed=await stat(desktop);
  assert.equal(installPackage(system,archive,digest,profile),true);
  assert.equal((await stat(desktop)).ino,installed.ino);
  assert.equal((await stat(desktop)).mtimeMs,installed.mtimeMs);
  await writeFile(agent,'modified owned file');
  await rm(desktop);
  assert.equal(installPackage(system,archive,digest,profile),false);
  assert.equal(await readFile(agent,'utf8'),'modified owned file');
  await assert.rejects(stat(desktop),{code:'ENOENT'});
  assert.equal(await readFile(unrelated,'utf8'),'preserve');
 } finally {await rm(job,{recursive:true,force:true});}
});
