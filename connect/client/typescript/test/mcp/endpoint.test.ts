import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initEndpoint,fetchEndpoint,acceptEndpoint,nextEndpoint} from '../../dist/mcp-endpoint.js';
import {generateKeyPair,exportJWK} from 'jose';
import {MAX_RELAY_BYTES,RELAY_BYTES} from '../../dist/mcp-wire.js';
import {publishBundle} from '../../dist/mcp-bundle.js';

test('endpoint setup refuses shared state, redirected parents and existing keys without changing permissions',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-paths-'));await fs.chmod(root,0o700);
  try {
    const named=path.join(root,'allow');await fs.mkdir(named,{mode:0o700});
    assert.equal((await initEndpoint(path.join(named,'reader'))).tool,'connect_relay_open',
      'a path name must not be mistaken for a granting macOS ACL entry');
    if(process.platform==='darwin') {
      const acl=path.join(root,'acl');await fs.mkdir(acl,{mode:0o700});
      try {
        execFileSync('/bin/chmod',['+a','everyone allow read',acl]);
        await assert.rejects(initEndpoint(path.join(acl,'reader')),/unsafe_directory_acl/);
        execFileSync('/bin/chmod',['-N',acl]);
        execFileSync('/bin/chmod',['+a','everyone deny delete',acl]);
        assert.equal((await initEndpoint(path.join(acl,'reader'))).tool,'connect_relay_open');
      } finally {execFileSync('/bin/chmod',['-N',acl]);}
    }
    const state=path.join(root,'state');await initEndpoint(state);
    const before=await fs.readFile(path.join(state,'endpoint.json'));
    await assert.rejects(initEndpoint(state),{code:'EEXIST'});
    assert.deepEqual(await fs.readFile(path.join(state,'endpoint.json')),before);
    await fs.chmod(state,0o750);
    await assert.rejects(fetchEndpoint(state,'a'.repeat(32),path.join(root,'capture.apparent')),/private_directory_required/);
    assert.equal((await fs.stat(state)).mode&0o777,0o750);
    await fs.chmod(state,0o700);
    const alias=path.join(root,'alias');await fs.symlink(root,alias);
    await assert.rejects(initEndpoint(path.join(alias,'unexpected')),/unsafe_directory/);
    await assert.rejects(fs.stat(path.join(root,'unexpected')),{code:'ENOENT'});
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('publication cannot replace an existing destination, even an empty directory or symlink',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-publication-'));await fs.chmod(root,0o700);
  try {
    const stage=path.join(root,'stage'),out=path.join(root,'capture.apparent');await fs.mkdir(stage,{mode:0o700});
    await fs.writeFile(path.join(stage,'summary.md'),'verified fixture',{mode:0o600});
    await fs.mkdir(out,{mode:0o700});
    await assert.rejects(publishBundle(stage,out),{code:'EEXIST'});
    await fs.rmdir(out);await fs.symlink(stage,out);
    await assert.rejects(publishBundle(stage,out),{code:'EEXIST'});
    assert.equal(await fs.readFile(path.join(stage,'summary.md'),'utf8'),'verified fixture');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('new readers negotiate bounded ranges and retain the legacy default for old servers',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-negotiate-'));await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const {publicKey}=await generateKeyPair('ECDH-ES',{crv:'P-256',extractable:true}),key=await exportJWK(publicKey);
  for(const [index,maxPartBytes]of [undefined,MAX_RELAY_BYTES,MAX_RELAY_BYTES*2,0,1.5].entries()) {
    const directory=path.join(root,String(index));await initEndpoint(directory);
    const state=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
    const reply={version:1,origin:state.origin,nonce:state.transport.nonce,key,ticket:'synthetic-ticket',expiresAt:Date.now()+300000,...(maxPartBytes===undefined?{}:{maxPartBytes})};
    await assert.rejects(acceptEndpoint(directory,{isError:true,structuredContent:reply}),/relay_tool_failed/);
    if(maxPartBytes===0||maxPartBytes===1.5)await assert.rejects(acceptEndpoint(directory,reply),/invalid_relay_handshake/);
    else {
      await acceptEndpoint(directory,{structuredContent:{content:[{type:'text',text:JSON.stringify(reply)}]}});
      const saved=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
      assert.equal(saved.transport.maxPartBytes,maxPartBytes===undefined?RELAY_BYTES:Math.min(maxPartBytes,MAX_RELAY_BYTES));
      assert.equal(saved.age,state.age,'Negotiation must retain the approved reader identity');
    }
  }
});

test('an existing reader renegotiates an old channel without replacing its identity or pending request',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-upgrade-'));await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'reader');await initEndpoint(directory);
  const file=path.join(directory,'endpoint.json'),state=JSON.parse(await fs.readFile(file,'utf8'));
  state.transport.ticket='synthetic-old-channel';state.transport.key={kty:'EC'};state.transport.expiresAt=Date.now()+300000;
  state.pending={id:'a'.repeat(32),kind:'poll',operation:{operation:'poll',deviceCode:'b'.repeat(64)}};
  await fs.writeFile(file,JSON.stringify(state),{mode:0o600});
  assert.equal((await nextEndpoint(directory)).tool,'connect_relay_open');
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(saved.age,state.age);assert.deepEqual(saved.key,state.key);assert.deepEqual(saved.pending,state.pending);
});
