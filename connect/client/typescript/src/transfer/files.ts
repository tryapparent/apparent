/** Endpoint filesystem/crypto adapter for the portable Connect transfer contract. */
import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as age from 'age-encryption';
import {verifyAsync,Point} from '@noble/ed25519';
import {fileTransport,validateIndex,signedFileBytes,sameContext,requireContract as check,type Asset,type FileIndex,type FileEnvelope,type FileContext,type IndexedAsset} from './contract.js';
import {readPrivate,fileHash,trustedDirectory,writePrivate} from '../mcp-files.js';
import {Cursor,validateReferences,type Peer,type Peers} from '../mcp-bundle.js';

async function plaintext(spool:string,asset:Asset,identity:string):Promise<Cursor>{
  const name=path.join(spool,asset.path);
  const stat=await fs.lstat(name);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size===asset.size&&await fileHash(name)===asset.sha256,'encrypted_transport_integrity_mismatch');
  const handle=await fs.open(name,'r');const header=Buffer.alloc(32768);let length;
  try{length=(await handle.read(header,0,header.length,0)).bytesRead;}finally{await handle.close();}
  const lines=header.subarray(0,length).toString('ascii').split('\n');check(lines.shift()==='age-encryption.org/v1','invalid_encryption_header');
  let native=0,grease=0,ended=false;
  for(const line of lines){check(line.length<=1024,'invalid_encryption_header');if(line.startsWith('--- ')){ended=true;break;}if(line.startsWith('-> X25519 '))native++;else if(line.startsWith('-> ')){check(/^-> [^ ]+-grease(?: |$)/.test(line),'unsupported_encryption_header');grease++;}check(native<=64&&grease<=1,'invalid_encryption_header');}
  check(ended&&native>0,'invalid_encryption_header');
  const source=createReadStream(name);const iterator=source[Symbol.asyncIterator]();
  const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const r=await iterator.next();if(r.done)controller.close();else controller.enqueue(new Uint8Array(r.value));}catch(e){controller.error(e);}},async cancel(){source.destroy();}});
  const decrypter=new age.Decrypter();decrypter.addIdentity(identity);return new Cursor(await decrypter.decrypt(stream));
}
export async function openFileIndex(options:{spool:string;files:Asset[];identity:string;origin:string;captureId:string;peers:Peers}):Promise<{index:FileIndex;sender:Peer}>{
  const {spool,identity,peers}=options;await trustedDirectory(spool,true);const files=fileTransport(options.files);
  const expectedEnvelope=files.find(f=>f.path==='envelope.json')!;
  check((await fs.stat(path.join(spool,'envelope.json'))).size===expectedEnvelope.size&&await fileHash(path.join(spool,'envelope.json'))===expectedEnvelope.sha256,'encrypted_transport_integrity_mismatch');
  const envelope=JSON.parse((await readPrivate(path.join(spool,'envelope.json'))).toString()) as FileEnvelope;
  check(envelope&&Object.keys(envelope).sort().join(',')==='signature,signed'&&envelope.signed&&Object.keys(envelope.signed).sort().join(',')==='chunks,context,version'&&envelope.signed.version===2,'invalid_encryption_envelope');
  const context=envelope.signed.context,expected:FileContext={origin:options.origin,accountId:peers.accountId,captureId:options.captureId,senderGrantId:context?.senderGrantId};
  check(sameContext(context,expected)&&typeof context.senderGrantId==='string'&&context.senderGrantId.length>0&&context.senderGrantId.length<=256&&!/[\u0000-\u0020]/.test(context.senderGrantId),'encryption_context_mismatch');
  const sender=peers.devices.find(p=>p.scope==='upload'&&p.grantId===context.senderGrantId);check(sender,'encryption_sender_revoked_or_unapproved');
  const chunks=files.filter(f=>f.path!=='envelope.json').sort((a,b)=>a.path.localeCompare(b.path));
  check(JSON.stringify(envelope.signed.chunks)===JSON.stringify(chunks),'encryption_manifest_mismatch');
  check(typeof envelope.signature==='string'&&/^[a-f0-9]{128}$/.test(envelope.signature)&&!Point.fromBytes(Buffer.from(sender.key.signing,'hex'),false).isSmallOrder()&&!Point.fromBytes(Buffer.from(envelope.signature.slice(0,64),'hex'),false).isSmallOrder()&&await verifyAsync(Buffer.from(envelope.signature,'hex'),signedFileBytes(envelope.signed),Buffer.from(sender.key.signing,'hex'),{zip215:false}),'encryption_signature_invalid');
  const cursor=await plaintext(spool,chunks.find(f=>f.path==='sealed/index.age')!,identity);
  try{
    const parts:Uint8Array[]=[];let size=0;
    for(;;){const bytes=await cursor.take(131073-size);if(!bytes.length)break;size+=bytes.length;check(size<=131072,'invalid_archive_descriptor');parts.push(bytes);}
    const index=validateIndex(JSON.parse(Buffer.concat(parts).toString('utf8')),context,files);return {index,sender};
  }finally{await cursor.reader.cancel().catch(()=>{});}
}
export async function decryptSelectedFiles(options:{spool:string;files:Asset[];identity:string;index:FileIndex;selected:IndexedAsset[];out:string;partial:boolean;inspection?:boolean}):Promise<string>{
  await trustedDirectory(path.dirname(options.out));
  if(options.partial)check(path.extname(options.out)!=='.apparent','selected_evidence_requires_extraction_directory');
  const stage=await fs.mkdtemp(path.join(path.dirname(options.out),'.apparent-mcp-'));await fs.chmod(stage,0o700);
  try{
    for(const entry of options.selected){
      const asset=options.files.find(f=>f.path===entry.object);check(asset,'invalid_encryption_manifest');
      const cursor=await plaintext(options.spool,asset,options.identity),destination=path.join(stage,entry.path);
      await fs.mkdir(path.dirname(destination),{mode:0o700,recursive:true});const file=await fs.open(destination,'wx',0o600);const hash=createHash('sha256');let size=0;
      try{for(;;){const bytes=await cursor.take(Math.min(65536,entry.size-size+1));if(!bytes.length)break;size+=bytes.length;check(size<=entry.size,'plaintext_integrity_mismatch');hash.update(bytes);await file.writeFile(bytes);}await file.sync();}finally{await file.close();await cursor.reader.cancel().catch(()=>{});}
      check(size===entry.size&&hash.digest('hex')===entry.sha256,'plaintext_integrity_mismatch');
    }
    if(options.partial){const file=await fs.open(path.join(stage,'.connect-extraction.json'),'wx',0o600);try{await file.writeFile(JSON.stringify({format:'apparent-extraction-v1',captureId:options.index.context.captureId,completeBundle:false,files:options.selected}));await file.sync();}finally{await file.close();}}
    else await validateReferences(stage,options.selected);
    if(options.inspection){
      await validateReferences(stage,options.selected,true);
      await writePrivate(path.join(stage,'inspection.json'),{version:1,kind:'apparent-mcp-inspection',captureId:options.index.context.captureId,mediaDownloaded:false,completeRecording:false});
    }
    for(const directory of new Set([stage,...options.selected.map(e=>path.dirname(path.join(stage,e.path)))])){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
    return stage;
  }catch(error){await fs.rm(stage,{recursive:true,force:true});throw error;}
}
