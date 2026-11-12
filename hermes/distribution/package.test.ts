import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,rm,writeFile,symlink,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {install} from './install.ts';
test('complete archive installs in empty profile; partial install is preserved', async()=>{
 const job=await mkdtemp('/tmp/apparent-dev-hermes-package-');
 try {
  const out=path.join(job,'release');
  execFileSync(process.execPath,['--experimental-strip-types','hermes/desktop/package.ts',out]);
  const name=(await readFile('hermes/plugin.yaml','utf8')).match(/^version: "(.*)"/m)![1];
  const unpack=path.join(job,'unpacked');await mkdir(unpack);
  execFileSync('tar',['-xzf',path.join(out,`apparent-hermes-${name}.tar.gz`),'-C',unpack]);
  execFileSync(process.execPath,['--experimental-strip-types','--test','hermes/desktop/plugin.test.ts'],{env:{...process.env,HERMES_PLUGIN_ENTRY:path.join(unpack,'apparent/desktop/plugin.js')}});
  const profile=path.join(job,'profile');
  execFileSync(process.execPath,[path.join(unpack,'install.cjs'),'--profile',profile]);
  const plugin=path.join(profile,'plugins/apparent');
  assert.match(await readFile(path.join(plugin,'desktop/plugin.js'),'utf8'),/COMPOSER_AREAS/);
  assert.equal(JSON.parse(await readFile(path.join(plugin,'compatibility.json'),'utf8')).version,name);
  assert.ok(await readFile(path.join(plugin,'__init__.py')));
  const partial=path.join(job,'partial');await mkdir(path.join(partial,'plugins/apparent'),{recursive:true,mode:0o700});
  await writeFile(path.join(partial,'plugins/apparent/private'),'preserve');
  await install(path.join(unpack,'apparent'),partial);
  await install(path.join(unpack,'apparent'),partial);
  await writeFile(path.join(partial,'plugins/apparent/adapter.py'),'modified');
  await assert.rejects(install(path.join(unpack,'apparent'),partial),/Existing modified/);
  assert.equal(await readFile(path.join(partial,'plugins/apparent/private'),'utf8'),'preserve');
  const linked=path.join(job,'linked');await mkdir(path.join(linked,'plugins/apparent'),{recursive:true,mode:0o700});
  const outside=path.join(job,'outside');await writeFile(outside,'untouched');
  await symlink(outside,path.join(linked,'plugins/apparent/adapter.py'));
  await assert.rejects(install(path.join(unpack,'apparent'),linked),/Existing modified/);
  assert.equal(await readFile(outside,'utf8'),'untouched');
  const writable=path.join(job,'writable');await mkdir(writable);await chmod(writable,0o777);
  await assert.rejects(install(path.join(unpack,'apparent'),writable),/untrusted/);
 } finally {await rm(job,{recursive:true,force:true});}
});
