import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {getPublicKeyAsync} from '@noble/ed25519';
import {generateAgeIdentity,encryptAge,encodeArchive,signEnvelope} from '../dist/index.js';
import {decryptBundle,publishBundle,transportAssets} from '../dist/mcp-bundle.js';

const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
type Variant='valid'|'empty_media'|'reordered_json'|'wrong_group'|'different_sender'|'missing_media'|'truncated_media'|'wrong_recipient';
async function fixture(t:test.TestContext,variant:Variant='valid') {
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-groups-'));await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const spool=path.join(root,'spool');await fs.mkdir(spool,{mode:0o700});
  const reader=await generateAgeIdentity(),writer=await generateAgeIdentity(),other=await generateAgeIdentity();
  const seed=Buffer.alloc(32,9),otherSeed=Buffer.alloc(32,10),id='a'.repeat(32),origin='https://api.example';
  const signing=Buffer.from(await getPublicKeyAsync(seed)).toString('hex'),otherSigning=Buffer.from(await getPublicKeyAsync(otherSeed)).toString('hex');
  const own={version:1 as const,recipient:reader.recipient,signing};
  const peers={accountId:'account',grantId:'reader',scope:'read' as const,devices:[
    {grantId:'reader',scope:'read' as const,key:own},
    {grantId:'writer',scope:'upload' as const,key:{version:1 as const,recipient:writer.recipient,signing}},
    {grantId:'other-writer',scope:'upload' as const,key:{version:1 as const,recipient:other.recipient,signing:otherSigning}},
  ]};
  const original=new Map<string,Buffer>([
    ['apparent.json',Buffer.from(JSON.stringify({contactSheet:'contact-sheet.png',keyframes:[{file:'frames/frame-00.png'}],video:variant==='empty_media'?null:'recording.mp4',audio:variant==='empty_media'?null:'audio.wav'}))],
    ['summary.md',Buffer.from('Synthetic grouped evidence')],['notes.json',Buffer.from('{"version":1}')],
    ['contact-sheet.png',Buffer.from('synthetic sheet')],['frames/frame-00.png',Buffer.from('synthetic frame')],
  ]);
  if(variant!=='empty_media'){original.set('recording.mp4',Buffer.alloc(18000,42));original.set('audio.wav',Buffer.from('synthetic audio'));}
  const files:Array<{path:string;size:number;sha256:string}>=[];
  for(const group of ['evidence','media'] as const) {
    const entries=[...original].filter(([p])=>['recording.mp4','recording.mov','audio.wav'].includes(p)===(group==='media'))
      .filter(([p])=>!(variant==='missing_media'&&p==='recording.mp4'));
    const foreign=variant==='different_sender'&&group==='media';
    const context={origin,accountId:'account',captureId:id,senderGrantId:foreign?'other-writer':'writer',group:variant==='wrong_group'&&group==='media'?'evidence' as const:group};
    const ordinary=entries.map(([path,bytes])=>({path,size:bytes.length,sha256:hash(bytes)}));
    let cipher=await encryptAge(encodeArchive({version:1,context,files:ordinary},entries.map(([,b])=>b)),[variant==='wrong_recipient'&&group==='media'?other.recipient:reader.recipient]);
    if(variant==='truncated_media'&&group==='media')cipher=cipher.subarray(0,cipher.length-1);
    const chunk={path:'sealed/part-000000.age',size:cipher.length,sha256:hash(cipher)};
    const envelopeContext=variant==='reordered_json'?Object.fromEntries(Object.entries(context).reverse()) as typeof context:context;
    const signed={version:1,context:envelopeContext,chunks:[variant==='reordered_json'?{sha256:chunk.sha256,size:chunk.size,path:chunk.path}:chunk]};
    const envelope=Buffer.from(JSON.stringify({signed,signature:await signEnvelope(foreign?otherSeed:seed,signed)}));
    await fs.mkdir(path.join(spool,group,'sealed'),{recursive:true,mode:0o700});
    for(const [name,bytes] of [['envelope.json',envelope],[chunk.path,cipher]] as const) {
      await fs.writeFile(path.join(spool,group,name),bytes,{mode:0o600});
      files.push(variant==='reordered_json'?{sha256:hash(bytes),size:bytes.length,path:group+'/'+name}:{path:group+'/'+name,size:bytes.length,sha256:hash(bytes)});
    }
  }
  return {root,original,options:{spool,files,identity:reader.identity,origin,captureId:id,peers,out:path.join(root,'recording.apparent')}};
}

for(const variant of ['valid','empty_media','reordered_json'] as const)test(`grouped ${variant}: both authenticated streams publish one complete bundle`,async t=>{
  const f=await fixture(t,variant);const prepared=await decryptBundle(f.options);
  await assert.rejects(fs.stat(f.options.out),{code:'ENOENT'});
  await publishBundle(prepared.stage,f.options.out);
  for(const [name,bytes] of f.original)assert.deepEqual(await fs.readFile(path.join(f.options.out,name)),bytes);
});

for(const variant of ['wrong_group','different_sender','missing_media','truncated_media','wrong_recipient'] as const)
test(`grouped ${variant}: no complete or partial plaintext output survives rejection`,async t=>{
  const f=await fixture(t,variant);await assert.rejects(decryptBundle(f.options));
  await assert.rejects(fs.stat(f.options.out),{code:'ENOENT'});
  assert.ok(!(await fs.readdir(f.root)).some(p=>p.startsWith('.apparent-mcp-')));
});

test('transport manifests reject mixed layouts, missing groups and unknown prefixes',async t=>{
  const f=await fixture(t);assert.equal(transportAssets(f.options.files).length,4);
  assert.throws(()=>transportAssets(f.options.files.filter(x=>x.path.startsWith('evidence/'))));
  assert.throws(()=>transportAssets([...f.options.files,{...f.options.files[0]!,path:'envelope.json'}]));
  assert.throws(()=>transportAssets(f.options.files.map(x=>({...x,path:x.path.replace('media/','other/')}))));
});
