import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
function fixture(t: any) {
  const dir=mkdtempSync('/tmp/apparent-dev-hook-setup-');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const git=(...args: string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  const put=(name: string,text: string)=>{mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),text);};
  git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
  const run=(script: string,...args: string[])=>spawnSync(process.execPath,['--experimental-strip-types',path.join(here,script),...args],{cwd:dir,encoding:'utf8'});
  return {dir,git,put,run};
}
test('LOC matches staged physical line contract, root lock exemption and binary probe',t=>{
  const f=fixture(t);
  f.put('a.txt','x\n'.repeat(2000));f.git('add','-A');assert.equal(f.run('lines.ts').status,0);
  f.put('a.txt','x\n'.repeat(2000)+'x');f.git('add','-A');f.put('a.txt','unstaged short');assert.match(f.run('lines.ts').stderr,/2001 lines/);
  f.git('rm','-f','a.txt');f.put('Cargo.lock','x\n'.repeat(2001));f.git('add','-A');assert.equal(f.run('lines.ts').status,0);
  f.put('nested/Cargo.lock','x\n'.repeat(2001));f.git('add','-A');assert.match(f.run('lines.ts').stderr,/2001 lines/);
  f.git('rm','-f','nested/Cargo.lock');f.put('binary.dat','\0'+'x\n'.repeat(2001));f.git('add','-A');assert.equal(f.run('lines.ts').status,0);
  f.put('late-null.dat','x\n'.repeat(5000)+'\0');f.git('add','-A');assert.match(f.run('lines.ts').stderr,/5001 lines/);
});
test('prepared hooks preserve prior precommit, prepush bytes/mode and config; propagate failures',t=>{
  const f=fixture(t);
  f.put('old-hooks/pre-commit','#!/bin/sh\nprintf old >> order\n');
  f.put('old-hooks/pre-push','#!/bin/sh\ncat > push-input\nexit 7\n');
  f.put('.githooks/pre-commit','#!/bin/sh\nprintf new >> order\n');
  for(const name of ['old-hooks/pre-commit','old-hooks/pre-push','.githooks/pre-commit']) chmodSync(path.join(f.dir,name),0o755);
  f.git('config','core.hooksPath','old-hooks');
  const candidate=path.join(f.dir,"prepared ' hooks");
  const result=f.run('prepare.ts','--output',candidate);assert.equal(result.status,0,result.stderr);
  assert.equal(f.git('config','--get','core.hooksPath'),'old-hooks');
  assert.equal(readFileSync(path.join(candidate,'pre-push'),'utf8'),readFileSync(path.join(f.dir,'old-hooks/pre-push'),'utf8'));
  assert.equal(spawnSync(path.join(candidate,'pre-commit'),[],{cwd:f.dir}).status,0);
  assert.equal(readFileSync(path.join(f.dir,'order'),'utf8'),'oldnew');
  const push=spawnSync(path.join(candidate,'pre-push'),['origin','synthetic'],{cwd:f.dir,input:'refs payload\n'});
  assert.equal(push.status,7);assert.equal(readFileSync(path.join(f.dir,'push-input'),'utf8'),'refs payload\n');
  writeFileSync(path.join(candidate,'preserved-pre-commit'),'#!/bin/sh\nexit 9\n');
  assert.equal(spawnSync(path.join(candidate,'pre-commit'),[],{cwd:f.dir}).status,9);
  assert.equal(readFileSync(path.join(f.dir,'order'),'utf8'),'oldnew');
  assert.notEqual(f.run('prepare.ts','--output',candidate).status,0);
});
test('default Git hook directory can be prepared without explicit config',t=>{
  const f=fixture(t);f.put('.githooks/pre-commit','#!/bin/sh\nexit 0\n');
  chmodSync(path.join(f.dir,'.githooks/pre-commit'),0o755);
  assert.equal(f.run('prepare.ts','--output',path.join(f.dir,'candidate')).status,0);
  assert.equal(spawnSync('git',['config','--get','core.hooksPath'],{cwd:f.dir}).status,1);
});
