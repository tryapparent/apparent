import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigPublicationUncertain, StoreError, parseJson, stringifyJson, updateConfig } from '../dist/store.cjs';
import { openAt, tryLock, unlock } from '../dist/native.cjs';

const run=promisify(execFile);
async function fixture(t:import('node:test').TestContext) {
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'config-store-'));
  await fsp.chmod(root,0o700);
  const config=path.join(root,'config.json');
  t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  return {root,config};
}
const lockedFd=(root:string)=>{
  const dirfd=fs.openSync(root,fs.constants.O_RDONLY|(fs.constants.O_DIRECTORY??0));
  try { return openAt(dirfd,'config.json.lock',fs.constants.O_RDWR|fs.constants.O_CREAT|(fs.constants.O_NONBLOCK??0),0o600); }
  finally { fs.closeSync(dirfd); }
};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('lossless JSON keeps large integers, exact decimals, duplicate-key last wins and __proto__ as data',()=>{
  const parsed=parseJson('{"u64":18446744073709551615,"ratio":0.10000000000000000001,"dup":1,"dup":2,"__proto__":{"safe":true}}') as Record<string,unknown>;
  assert.equal(stringifyJson(parsed),'{"u64":18446744073709551615,"ratio":0.10000000000000000001,"dup":2,"__proto__":{"safe":true}}');
  assert.equal(Object.getPrototypeOf(parsed),null);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed,'__proto__'),true);
  assert.equal(({} as Record<string,unknown>).safe,undefined);
});

test('updates preserve nested unknown secrets/null and distinguish explicit deletion',async t=>{
  const f=await fixture(t);
  await fsp.writeFile(f.config,'{"secret":"keep","huge":18446744073709551615,"nested":{"unknown":true,"nullValue":null},"removeMe":1,"presentNull":null}\n',{mode:0o600});
  await updateConfig(f.config,config=>{
    assert.equal(Object.hasOwn(config,'presentNull'),true);
    delete config.removeMe;
    config.presentNull=null;
    config.addedNull=null;
    (config.nested as Record<string,unknown>).known=false;
  });
  const raw=await fsp.readFile(f.config,'utf8');
  const parsed=parseJson(raw) as Record<string,unknown>;
  assert.equal(parsed.secret,'keep');
  assert.equal(raw.includes('18446744073709551615'),true);
  assert.equal(Object.hasOwn(parsed,'removeMe'),false);
  assert.equal(Object.hasOwn(parsed,'presentNull'),true);assert.equal(parsed.presentNull,null);
  assert.equal(parsed.addedNull,null);
  assert.equal(stringifyJson(parsed.nested),'{"unknown":true,"nullValue":null,"known":false}');
  assert.equal(fs.statSync(f.config).mode&0o777,0o600);
});

test('missing config becomes an object, malformed config remains byte-for-byte untouched',async t=>{
  const f=await fixture(t);
  await updateConfig(f.config,config=>{config.created=true;});
  assert.equal(stringifyJson(parseJson(await fsp.readFile(f.config,'utf8'))),'{"created":true}');
  const bad=path.join(f.root,'malformed.json'),body='{"secret":"keep",';
  await fsp.writeFile(bad,body,{mode:0o600});
  await assert.rejects(updateConfig(bad,config=>{config.changed=true;}),(error:unknown)=>error instanceof StoreError&&error.code==='invalid-json');
  assert.equal(await fsp.readFile(bad,'utf8'),body);
});

test('symlink and hardlink lock sidecars fail closed',async t=>{
  const f=await fixture(t),lock=`${f.config}.lock`;
  await fsp.writeFile(path.join(f.root,'target'),'',{mode:0o600});
  await fsp.symlink(path.join(f.root,'target'),lock);
  await assert.rejects(updateConfig(f.config,()=>{}),(error:unknown)=>error instanceof StoreError);
  await fsp.unlink(lock);
  await fsp.writeFile(lock,'',{mode:0o600});
  await fsp.link(lock,path.join(f.root,'lock-alias'));
  await assert.rejects(updateConfig(f.config,()=>{}),(error:unknown)=>error instanceof StoreError&&error.code==='unsafe-lock');
});

test('lock contention times out and cancellation releases the pending writer without changing config',async t=>{
  const f=await fixture(t);
  await fsp.writeFile(f.config,'{"stable":true}',{mode:0o600});
  let fd=lockedFd(f.root);
  assert.equal(tryLock(fd),true);
  await assert.rejects(updateConfig(f.config,config=>{config.bad=true;},{timeoutMs:80}),
    (error:unknown)=>error instanceof StoreError&&error.code==='lock-timeout');
  const controller=new AbortController();
  const pending=updateConfig(f.config,config=>{config.bad=true;},{timeoutMs:null,signal:controller.signal});
  setTimeout(()=>controller.abort(),40);
  await assert.rejects(pending,(error:unknown)=>error instanceof StoreError&&error.code==='cancelled');
  assert.equal(await fsp.readFile(f.config,'utf8'),'{"stable":true}');
  unlock(fd);fs.closeSync(fd);
});

test('cancellation at snapshot and before rename leaves original bytes intact',async t=>{
  const f=await fixture(t),body='{"keep":true}\n';
  await fsp.writeFile(f.config,body,{mode:0o600});
  const atSnapshot=new AbortController();
  await assert.rejects(updateConfig(f.config,config=>{config.changed=true;},{signal:atSnapshot.signal,
    checkpoint:stage=>{if(stage==='snapshot')atSnapshot.abort();}}),
    (error:unknown)=>error instanceof StoreError&&error.code==='cancelled');
  const beforePublish=new AbortController();
  await assert.rejects(updateConfig(f.config,config=>{config.changed=true;},{signal:beforePublish.signal,
    checkpoint:stage=>{if(stage==='beforePublish')beforePublish.abort();}}),
    (error:unknown)=>error instanceof StoreError&&error.code==='cancelled');
  assert.equal(await fsp.readFile(f.config,'utf8'),body);
});

test('parent path rename during callback cannot redirect the pinned publication',async t=>{
  const f=await fixture(t),moved=path.join(path.dirname(f.root),`${path.basename(f.root)}-moved`);
  t.after(()=>fsp.rm(moved,{recursive:true,force:true}));
  await fsp.writeFile(f.config,'{"before":true}',{mode:0o600});
  await updateConfig(f.config,config=>{config.after=true;},{checkpoint:async stage=>{
    if(stage==='snapshot') { await fsp.rename(f.root,moved); await fsp.mkdir(f.root,{mode:0o700}); }
  }});
  assert.equal(stringifyJson(parseJson(await fsp.readFile(path.join(moved,'config.json'),'utf8'))),'{"before":true,"after":true}');
  await assert.rejects(fsp.access(f.config));
  await fsp.rm(f.root,{recursive:true,force:true});
});

test('Buffer paths preserve non-UTF-8 parent and filename bytes through anchored publication',async t=>{
  const f=await fixture(t);
  const parent=Buffer.concat([Buffer.from(f.root),Buffer.from([0x2f,0x64,0x69,0x72,0xff])]);
  fs.mkdirSync(parent,{mode:0o700});
  const filename=Buffer.concat([Buffer.from('config-'),Buffer.from([0xfe]),Buffer.from('.json')]);
  const configPath=Buffer.concat([parent,Buffer.from([0x2f]),filename]);
  await fsp.writeFile(configPath,'{"private":"kept"}',{mode:0o600});
  await updateConfig(configPath,config=>{config.updated=true;});
  const names=fs.readdirSync(parent,{encoding:'buffer'}) as Buffer[];
  assert.equal(names.some(name=>name.equals(filename)),true);
  assert.equal(names.some(name=>name.includes(Buffer.from('\ufffd'))),false);
  const parsed=parseJson(await fsp.readFile(configPath,'utf8')) as Record<string,unknown>;
  assert.equal(parsed.private,'kept');assert.equal(parsed.updated,true);
  assert.equal(names.some(name=>name.equals(Buffer.concat([filename,Buffer.from('.lock')]))),true);
});

test('post-rename directory-sync failure is uncertain even when values are unchanged',async t=>{
  const f=await fixture(t);
  await fsp.writeFile(f.config,'{"same":true}\n',{mode:0o600});
  await assert.rejects(updateConfig(f.config,config=>{config.same=true;},{checkpoint:stage=>{
    if(stage==='beforeDirectorySync') throw new Error('synthetic private failure');
  }}),(error:unknown)=>error instanceof ConfigPublicationUncertain&&error.published&&error.code==='outcome-unknown');
  assert.equal(stringifyJson(parseJson(await fsp.readFile(f.config,'utf8'))),'{"same":true}');
});

test('two processes serialize read-modify-write and do not lose either update',async t=>{
  const f=await fixture(t);
  await fsp.writeFile(f.config,'{"base":true}',{mode:0o600});
  const modulePath=fileURLToPath(new URL('../dist/store.cjs',import.meta.url));
  const script=`const {updateConfig}=require(${JSON.stringify(modulePath)});const p=process.env.TEST_CONFIG;updateConfig(p,async c=>{await new Promise(r=>setTimeout(r,80));c[process.env.TEST_KEY]=true}).catch(e=>{process.stderr.write(e.code);process.exitCode=1})`;
  await Promise.all(['writerA','writerB'].map(key=>run(process.execPath,['-e',script],{env:{...process.env,TEST_CONFIG:f.config,TEST_KEY:key}})));
  const result=parseJson(await fsp.readFile(f.config,'utf8')) as Record<string,unknown>;
  assert.equal(result.base,true);assert.equal(result.writerA,true);assert.equal(result.writerB,true);
});
