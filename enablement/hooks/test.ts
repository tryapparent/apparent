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
  const env = {...process.env};
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  env.GIT_CONFIG_GLOBAL='/dev/null'; env.GIT_CONFIG_NOSYSTEM='1';
  const git=(...args: string[])=>execFileSync('git',args,{cwd:dir,env,encoding:'utf8'}).trim();
  const put=(name: string,text: string)=>{mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),text);};
  git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
  const run=(script: string,...args: string[])=>spawnSync(process.execPath,['--experimental-strip-types',path.join(here,script),...args],{cwd:dir,env,encoding:'utf8'});
  return {dir,git,put,run};
}
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
test('retirement refuses customized guards without preparing a candidate',t=>{
  const f=fixture(t);
  f.put('old-hooks/pre-commit','#!/bin/sh\nexit 0\n');
  f.git('config','core.hooksPath','old-hooks');
  const result=f.run('prepare.ts','--output',path.join(f.dir,'candidate'),'--retire-verified-line-guard');
  assert.notEqual(result.status,0);assert.match(result.stderr,/does not match/);
});

test('exact verified guard retires with backup and provenance; prepush stays active',t=>{
  const f=fixture(t);
  f.put('old-hooks/pre-commit',Buffer.from('IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwoiIiJSZWplY3QgY2hhbmdlZCBzdGFnZWQgdGV4dCBmaWxlcyBsb25nZXIgdGhhbiAyLDAwMCBwaHlzaWNhbCBsaW5lcy4iIiIKCmltcG9ydCBzdWJwcm9jZXNzCmltcG9ydCBzeXMKCgpNQVhfTElORVMgPSAyMDAwCgoKZGVmIGdpdCgqYXJncyk6CiAgICByZXR1cm4gc3VicHJvY2Vzcy5jaGVja19vdXRwdXQoWyJnaXQiLCAqYXJnc10pCgoKZGVmIG1haW4oKToKICAgICMgUmF3IHJlY29yZHMgc3VwcGx5IGluZGV4IGJsb2IgSURzLCBzbyBwYXJ0aWFsIHN0YWdpbmcgYW5kIG9kZCBmaWxlbmFtZXMKICAgICMgbmV2ZXIgY2F1c2UgdXMgdG8gaW5zcGVjdCBhIGRpZmZlcmVudCB3b3JraW5nLXRyZWUgZmlsZS4gRGlzYWJsaW5nIHJlbmFtZQogICAgIyBkZXRlY3Rpb24gdHJlYXRzIGEgcmVuYW1lL2NvcHkgZGVzdGluYXRpb24gYXMgYW4gYWRkaXRpb24uCiAgICByZWNvcmRzID0gZ2l0KCJkaWZmIiwgIi0tY2FjaGVkIiwgIi0tcmF3IiwgIi16IiwgIi0tbm8tYWJicmV2IiwKICAgICAgICAgICAgICAgICAgIi0tbm8tcmVuYW1lcyIsICItLWRpZmYtZmlsdGVyPUFNIikuc3BsaXQoYiJcMCIpCiAgICB2aW9sYXRpb25zID0gW10KICAgIGZvciBpbmRleCBpbiByYW5nZSgwLCBsZW4ocmVjb3JkcykgLSAxLCAyKToKICAgICAgICBtZXRhZGF0YSwgcGF0aCA9IHJlY29yZHNbaW5kZXg6aW5kZXggKyAyXQogICAgICAgIF8sIG1vZGUsIF8sIGJsb2IsIF8gPSBtZXRhZGF0YS5zcGxpdCgpCiAgICAgICAgaWYgbW9kZSBub3QgaW4gKGIiMTAwNjQ0IiwgYiIxMDA3NTUiKToKICAgICAgICAgICAgY29udGludWUgICMgU3ltbGlua3MgYW5kIHN1Ym1vZHVsZXMgYXJlIG5vdCBzb3VyY2UgdGV4dC4KICAgICAgICBpZiBwYXRoID09IGIiQ2FyZ28ubG9jayI6CiAgICAgICAgICAgIGNvbnRpbnVlICAjIFJvb3QgbWFjaGluZS1nZW5lcmF0ZWQgbG9ja2ZpbGU7IFNpbW9uLWFwcHJvdmVkIGV4Y2VwdGlvbi4KICAgICAgICBjb250ZW50ID0gZ2l0KCJjYXQtZmlsZSIsICJibG9iIiwgYmxvYi5kZWNvZGUoImFzY2lpIikpCiAgICAgICAgaWYgYiJcMCIgaW4gY29udGVudFs6ODAwMF06CiAgICAgICAgICAgIGNvbnRpbnVlICAjIEdpdC1zdHlsZSBiaW5hcnkgZGV0ZWN0aW9uOyBubyBleHRlbnNpb24gYWxsb3dsaXN0LgogICAgICAgIGxpbmVzID0gY29udGVudC5jb3VudChiIlxuIikgKyBpbnQoYm9vbChjb250ZW50KSBhbmQgbm90IGNvbnRlbnQuZW5kc3dpdGgoYiJcbiIpKQogICAgICAgIGlmIGxpbmVzID4gTUFYX0xJTkVTOgogICAgICAgICAgICB2aW9sYXRpb25zLmFwcGVuZCgocGF0aCwgbGluZXMpKQogICAgaWYgdmlvbGF0aW9uczoKICAgICAgICBwcmludChmInByZS1jb21taXQ6IHRleHQgZmlsZXMgbXVzdCBjb250YWluIGF0IG1vc3Qge01BWF9MSU5FU30gbGluZXMgIgogICAgICAgICAgICAgICIoaW5jbHVkaW5nIGNvbW1lbnRzIGFuZCBibGFuayBsaW5lcykuIiwgZmlsZT1zeXMuc3RkZXJyKQogICAgICAgIGZvciBwYXRoLCBsaW5lcyBpbiB2aW9sYXRpb25zOgogICAgICAgICAgICBwcmludChmIiAge3BhdGguZGVjb2RlKCd1dGYtOCcsIGVycm9ycz0nYmFja3NsYXNocmVwbGFjZScpIXJ9OiB7bGluZXN9IGxpbmVzIiwKICAgICAgICAgICAgICAgICAgZmlsZT1zeXMuc3RkZXJyKQogICAgICAgIHByaW50KCJTcGxpdCB0aGUgc3RhZ2VkIGZpbGVzIGludG8gc21hbGxlciBjb2hlc2l2ZSBtb2R1bGVzLCB0aGVuIHN0YWdlIGFuZCByZXRyeS4gIgogICAgICAgICAgICAgICJPbmx5IGFkZGVkIG9yIGNoYW5nZWQgZmlsZXMgYXJlIGNoZWNrZWQ7IG5vIGZpbGVzIHdlcmUgbW9kaWZpZWQuIiwKICAgICAgICAgICAgICBmaWxlPXN5cy5zdGRlcnIpCiAgICAgICAgcmV0dXJuIDEKICAgIHJldHVybiAwCgoKaWYgX19uYW1lX18gPT0gIl9fbWFpbl9fIjoKICAgIHRyeToKICAgICAgICBzeXMuZXhpdChtYWluKCkpCiAgICBleGNlcHQgKE9TRXJyb3IsIHN1YnByb2Nlc3MuQ2FsbGVkUHJvY2Vzc0Vycm9yKSBhcyBlcnJvcjoKICAgICAgICBwcmludChmInByZS1jb21taXQ6IGNvdWxkIG5vdCBjaGVjayBzdGFnZWQgbGluZSBsaW1pdHM6IHtlcnJvcn0iLCBmaWxlPXN5cy5zdGRlcnIpCiAgICAgICAgc3lzLmV4aXQoMSkK','base64').toString());
  f.put('old-hooks/pre-push','#!/bin/sh\nexit 7\n');
  f.put('.githooks/pre-commit','#!/bin/sh\nexit 0\n');
  for(const name of ['old-hooks/pre-commit','old-hooks/pre-push','.githooks/pre-commit']) chmodSync(path.join(f.dir,name),0o755);
  f.git('config','core.hooksPath','old-hooks');
  const candidate=path.join(f.dir,'candidate');
  const result=f.run('prepare.ts','--output',candidate,'--retire-verified-line-guard');
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(path.join(candidate,'preserved-pre-commit'),'utf8'),readFileSync(path.join(f.dir,'old-hooks/pre-commit'),'utf8'));
  assert.equal(JSON.parse(readFileSync(path.join(candidate,'provenance.json'),'utf8')).retiredLegacyLineGuard,true);
  f.put('long.txt','x\n'.repeat(2001));f.git('add','long.txt');
  assert.equal(spawnSync(path.join(candidate,'pre-commit'),[],{cwd:f.dir}).status,0);
  assert.equal(spawnSync(path.join(candidate,'pre-push'),[],{cwd:f.dir}).status,7);
  assert.equal(f.git('config','--get','core.hooksPath'),'old-hooks');
});
test('preparation refuses reserved active entries rather than overwriting a hook backup',t=>{
  const f=fixture(t);f.put('old-hooks/preserved-pre-commit','#!/bin/sh\nexit 9\n');
  f.git('config','core.hooksPath','old-hooks');
  const result=f.run('prepare.ts','--output',path.join(f.dir,'candidate'));
  assert.notEqual(result.status,0);assert.match(result.stderr,/Reserved preparation entry/);
});
