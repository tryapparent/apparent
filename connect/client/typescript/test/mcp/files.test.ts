import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileTransport,validateIndex,selectedAssets} from '../../dist/transfer/contract.js';
import {openFileIndex,decryptSelectedFiles} from '../../dist/transfer/files.js';
import {generateAgeIdentity} from '../../dist/index.js';

async function nativeFixture(t:test.TestContext){
  const vector=JSON.parse(await fs.readFile(new URL('../fixtures/rust-v2.json',import.meta.url),'utf8'));
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-files-'));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const spool=path.join(root,'spool');await fs.mkdir(path.join(spool,'sealed'),{recursive:true,mode:0o700});
  const files=fileTransport(vector.transport.map(({path,size,sha256}:any)=>({path,size,sha256})));
  // Deliberately stage only the envelope and index. No media is available.
  for(const f of vector.transport.filter((f:any)=>['envelope.json','sealed/index.age'].includes(f.path)))await fs.writeFile(path.join(spool,f.path),Buffer.from(f.hex,'hex'),{mode:0o600});
  const options={spool,files,identity:vector.syntheticReaderIdentity.age,origin:vector.context.origin,captureId:vector.context.captureId,peers:{accountId:vector.context.accountId,grantId:'reader-grant',scope:'read' as const,devices:[vector.reader,vector.sender]}};
  return {root,spool,vector,files,options};
}
test('TypeScript reads the native v2 producer index and extracts one asset without any media bytes',async t=>{
  const f=await nativeFixture(t),opened=await openFileIndex(f.options),selected=selectedAssets(opened.index,['contact-sheet.png']);
  const original=f.vector.transport.find((v:any)=>v.path===selected[0]!.object);
  await fs.writeFile(path.join(f.spool,original.path),Buffer.from(original.hex,'hex'),{mode:0o600});
  const stage=await decryptSelectedFiles({...f.options,index:opened.index,selected,out:path.join(f.root,'evidence'),partial:true});
  assert.equal((await fs.readFile(path.join(stage,'contact-sheet.png'))).toString('hex'),f.vector.expected.find((e:any)=>e.path==='contact-sheet.png').hex);
  assert.deepEqual((await fs.readdir(stage)).sort(),['.connect-extraction.json','contact-sheet.png']);
  assert.equal(JSON.parse(await fs.readFile(path.join(stage,'.connect-extraction.json'),'utf8')).completeBundle,false);
  await assert.rejects(decryptSelectedFiles({...f.options,index:opened.index,selected,out:path.join(f.root,'partial.apparent'),partial:true}));
});
test('v2 verifies native signatures, context, recipient and index mappings before selection',async t=>{
  const f=await nativeFixture(t),opened=await openFileIndex(f.options);
  assert.throws(()=>selectedAssets(opened.index,['../escape']));assert.throws(()=>selectedAssets(opened.index,['missing.png']));assert.throws(()=>selectedAssets(opened.index,['summary.md','summary.md']));
  const invalid=structuredClone(opened.index);invalid.files[0]!.object=invalid.files[1]!.object;
  assert.throws(()=>validateIndex(invalid,opened.index.context,f.files));
  await assert.rejects(openFileIndex({...f.options,captureId:'a'.repeat(32)}));
  await assert.rejects(openFileIndex({...f.options,identity:(await generateAgeIdentity()).identity}));
  const envelope=JSON.parse(await fs.readFile(path.join(f.spool,'envelope.json'),'utf8'));envelope.signature='00'.repeat(64);
  await fs.writeFile(path.join(f.spool,'envelope.json'),JSON.stringify(envelope),{mode:0o600});
  await assert.rejects(openFileIndex(f.options));
});
test('selected native ciphertext cannot be truncated, altered, or swapped with another asset',async t=>{
  const f=await nativeFixture(t),opened=await openFileIndex(f.options),selected=selectedAssets(opened.index,['summary.md']);
  const original=f.vector.transport.find((v:any)=>v.path===selected[0]!.object),bytes=Buffer.from(original.hex,'hex');
  for(const damaged of [bytes.subarray(0,-1),Buffer.alloc(bytes.length),Buffer.from(f.vector.transport.find((v:any)=>v.path==='sealed/index.age').hex,'hex')]){
    await fs.writeFile(path.join(f.spool,original.path),damaged,{mode:0o600});
    await assert.rejects(decryptSelectedFiles({...f.options,index:opened.index,selected,out:path.join(f.root,'evidence'),partial:true}));
    assert.deepEqual((await fs.readdir(f.root)).sort(),['spool']);
  }
});
