// Cross-owner proof; the isolated Hermes build does not import Agent sources.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
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

test('receiver installs the real release before enabling and does not require its Desktop runtime', async () => {
 const job=await mkdtemp('/tmp/apparent-dev-hermes-receiver-package-');
 try {
  const release=process.env.HERMES_PACKAGE || path.join(job,'release');
  if(!process.env.HERMES_PACKAGE)execFileSync(process.execPath,['--experimental-strip-types','hermes/desktop/package.ts',release]);
  const version=(await readFile('hermes/plugin.yaml','utf8')).match(/^version: "(.*)"/m)![1];
  const archive=path.join(release,`apparent-hermes-${version}.tar.gz`);
  const digest=(await readFile(archive+'.sha256','utf8')).trim().split(/\s+/)[0];
  const profile=path.join(job,'profile');
  const {setup}=await import('../../capture/agent/setup/hermes.ts');
  let enabled=false, enableCalls=0;
  const provider={...system, run(exe:string,args:string[],options?:{hermesHome:string;timeoutMs?:number}) {
   if(exe==='/fixture/apparent') {
    assert.deepEqual(args.slice(1),['--help']);
    assert(['inspect','fetch'].includes(args[0]));
    return {ok:true,output:`Usage: apparent ${args[0]} [OPTIONS]`};
   }
   if(exe==='/fixture/hermes') {
    assert.equal(options?.hermesHome,profile);
    if(args[0]==='--version')return {ok:true,output:'Hermes Agent v0.23.1'};
    if(args[0]==='config')return {ok:true,output:JSON.stringify(args[2]==='plugins.enabled' && enabled?['apparent']:[])};
    assert.deepEqual(args,['plugins','enable','apparent','--no-allow-tool-override']);
    assert.ok(readFileSync(path.join(profile,'plugins/apparent/__init__.py')).length>0);
    enabled=true;enableCalls++;
    return {ok:true,output:''};
   }
   return system.run(exe,args,options);
  }};
  const result=setup(provider,'/fixture/apparent',profile,false,archive,digest,{receiver:true,enable:true,hermesExecutable:'/fixture/hermes'});
  assert.deepEqual(result.repairs.map(r=>[r.id,r.status]),[['plugin-install','applied'],['plugin-enable','applied']]);
  assert.equal(result.setupReady,true);
  assert.equal(result.ready,false);
  assert.equal(enableCalls,1);
  setup(provider,'/fixture/apparent',profile,false,archive,digest,{receiver:true,enable:true,hermesExecutable:'/fixture/hermes'});
  assert.equal(enableCalls,1);
 } finally {await rm(job,{recursive:true,force:true});}
});
