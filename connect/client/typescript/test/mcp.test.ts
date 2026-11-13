import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {initEndpoint,fetchEndpoint} from '../dist/mcp-endpoint.js';
import {publishBundle} from '../dist/mcp-bundle.js';

test('endpoint setup refuses shared state, redirected parents and existing keys without changing permissions',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-paths-'));await fs.chmod(root,0o700);
  try {
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
