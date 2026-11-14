import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Readable,Writable} from 'node:stream';
import {initEndpoint,nextEndpoint} from '../../dist/mcp-endpoint.js';
import {runEndpoint} from '../../dist/mcp-stdio.js';
import {MAX_RELAY_REPLY_BYTES} from '../../dist/mcp-wire.js';

for(const [name,input,code]of [
  ['EOF',Buffer.alloc(0),'relay_reply_required'],
  ['oversized',Buffer.alloc(MAX_RELAY_REPLY_BYTES+1,65),'invalid_reply_file'],
  ['invalid JSON',Buffer.from('synthetic-sensitive-input\n'),'endpoint_operation_failed'],
  ['invalid UTF-8',Buffer.from([0xc3,0x28,10]),'endpoint_operation_failed'],
] as const)test(`stdio ${name} fails safely while retaining reader keys`,async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-stdio-'));await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'reader');await initEndpoint(directory);
  const file=path.join(directory,'endpoint.json'),before=JSON.parse(await fs.readFile(file,'utf8'));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../dist/mcp-cli.js',import.meta.url)),'run','--state',directory],{input,encoding:'utf8',maxBuffer:65536});
  assert.equal(result.status,1);assert.ok(result.stderr.includes(`(${code})`),result.stderr);
  assert.ok(!result.stderr.includes('synthetic-sensitive-input'));
  const printed=JSON.parse(result.stdout.trim());assert.equal(printed.tool,'connect_relay_open');
  const after=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(after.age,before.age);assert.deepEqual(after.key,before.key);
  assert.deepEqual((await fs.readdir(directory)).sort(),['endpoint.json']);
});

test('stdio output failure rejects without waiting for a reply or leaking an unhandled stream error',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-sink-'));await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'reader');await initEndpoint(directory);
  const sink=new Writable({write(_chunk,_encoding,callback){callback(new Error('synthetic_output_closed'));}});
  await assert.rejects(runEndpoint(directory,await nextEndpoint(directory),Readable.from([]),sink),/synthetic_output_closed/);
});
