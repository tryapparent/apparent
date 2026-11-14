import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as age from 'age-encryption';
import {verifyEnvelope, type Asset, type Context, type Signed} from './index.js';
import {captureId, record, transportPath, type PublicKey} from './mcp-wire.js';
import {fileHash, readPrivate, requireValue as check, trustedDirectory} from './mcp-files.js';

export type Peer = {grantId:string;scope:'read'|'upload';key:PublicKey};
export type Peers = {accountId:string;grantId:string;scope:'read';devices:Peer[]};
const equal = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);
function keys(value:unknown, names:string[]): asserts value is Record<string,unknown> {
  check(record(value) && equal(Object.keys(value).sort(),names.sort()),'invalid_encryption_schema');
}
function assets(value:unknown, allowed:(name:string)=>boolean, limit=512, allowEmpty=false): Asset[] {
  check(Array.isArray(value) && (allowEmpty || value.length>0) && value.length<=limit,'invalid_manifest');
  const names = new Set<string>(); let total=0;
  for (const file of value) {
    keys(file,['path','size','sha256']);
    check(typeof file.path==='string' && allowed(file.path) && !names.has(file.path) &&
      Number.isSafeInteger(file.size) && (file.size as number)>=0 && (file.size as number)<=90000000 &&
      typeof file.sha256==='string' && /^[a-f0-9]{64}$/.test(file.sha256),'invalid_manifest');
    names.add(file.path); total+=file.size as number;
    check(total<=500000000,'quota_exceeded');
  }
  return (value as Asset[]).map(({path,size,sha256})=>({path,size,sha256}));
}
function chunks(value:unknown): Asset[] {
  const files = assets(value,p=>/^sealed\/part-[0-9]{6}\.age$/.test(p),16);
  files.forEach((f,i)=>check(f.path===`sealed/part-${String(i).padStart(6,'0')}.age` && f.size>0 &&
    f.size<=33554432 && (i===files.length-1 || f.size===33554432),'invalid_encryption_parts'));
  return files;
}
export function transportAssets(value:unknown): Asset[] {
  const files=assets(value,transportPath,34);
  const grouped=files.some(f=>f.path.startsWith('evidence/')||f.path.startsWith('media/'));
  if(grouped)check(files.every(f=>/^(evidence|media)\//.test(f.path)),'invalid_encryption_manifest');
  for(const group of grouped?['evidence/','media/']:['']) {
    const selected=files.filter(f=>f.path.startsWith(group)).map(f=>({...f,path:f.path.slice(group.length)}));
    const envelope=selected.find(f=>f.path==='envelope.json');
    check(envelope && envelope.size>0 && envelope.size<=131072,'invalid_encryption_manifest');
    chunks(selected.filter(f=>f.path!=='envelope.json').sort((a,b)=>a.path.localeCompare(b.path)));
  }
  return files;
}
export function publicDescriptor(value:unknown): PublicKey {
  keys(value,['version','recipient','signing']);
  check(value.version===1 && typeof value.recipient==='string' && /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(value.recipient) &&
    typeof value.signing==='string' && /^[a-f0-9]{64}$/.test(value.signing),'invalid_encryption_key');
  const encrypter=new age.Encrypter(); encrypter.addRecipient(value.recipient);
  return {version:1,recipient:value.recipient,signing:value.signing};
}
export function readerPeers(value:unknown, grantId:string, key:PublicKey): Peers {
  check(record(value) && typeof value.accountId==='string' && value.accountId.length>0 && value.accountId.length<=256 &&
    !/[\u0000-\u0020]/.test(value.accountId) && value.grantId===grantId && value.scope==='read' &&
    Array.isArray(value.devices) && value.devices.length<=64,'invalid_encryption_authorization');
  const ids=new Set<string>();
  for (const peer of value.devices) {
    check(record(peer) && typeof peer.grantId==='string' && peer.grantId.length>0 && peer.grantId.length<=256 &&
      !/[\u0000-\u0020]/.test(peer.grantId) && !ids.has(peer.grantId) && ['read','upload'].includes(String(peer.scope)),'invalid_encryption_authorization');
    ids.add(peer.grantId); publicDescriptor(peer.key);
  }
  const own=value.devices.find(p=>p.grantId===grantId);
  check(own && own.scope==='read' && equal(publicDescriptor(own.key),publicDescriptor(key)),'encryption_key_binding_mismatch');
  return value as unknown as Peers;
}
const assetPath=(p:string)=>p.length<=128 && /^(apparent\.json|notes\.json|summary\.md|contact-sheet(?:-full)?\.png|audio\.wav|recording\.(?:mp4|mov)|finish-trace\.json|timeline\.json|frames(?:-full)?\/frame-[0-9]+\.png)$/.test(p);
const mediaPath=(p:string)=>['recording.mp4','recording.mov','audio.wav'].includes(p);

/** Constant-space cursor over authenticated age plaintext. */
class Cursor {
  reader:ReadableStreamDefaultReader<Uint8Array>; pending:Uint8Array=new Uint8Array(); offset=0;
  constructor(stream:ReadableStream<Uint8Array>) { this.reader=stream.getReader(); }
  async take(max:number):Promise<Uint8Array> {
    while(this.offset===this.pending.length) {
      const result=await this.reader.read();
      if(result.done)return new Uint8Array();
      this.pending=result.value;this.offset=0;
    }
    const end=Math.min(this.offset+max,this.pending.length),value=this.pending.subarray(this.offset,end);
    this.offset=end;return value;
  }
  async exact(size:number):Promise<Uint8Array> {
    const bytes=new Uint8Array(size);let offset=0;
    while(offset<size) {const part=await this.take(size-offset);check(part.length,'truncated_archive');bytes.set(part,offset);offset+=part.length;}
    return bytes;
  }
}
function context(value:unknown, expected:{origin:string;accountId:string;captureId:string;group?:Context['group']}): Context {
  keys(value,['origin','accountId','captureId','senderGrantId',...(expected.group===undefined?[]:['group'])]);
  check(value.origin===expected.origin && value.accountId===expected.accountId && value.captureId===expected.captureId &&
    value.group===expected.group &&
    captureId(value.captureId) && typeof value.senderGrantId==='string' && value.senderGrantId.length>0 &&
    value.senderGrantId.length<=256 && !/[\u0000-\u0020]/.test(value.senderGrantId),'encryption_context_mismatch');
  return {origin:expected.origin,accountId:expected.accountId,captureId:expected.captureId,
    senderGrantId:value.senderGrantId as string,...(expected.group===undefined?{}:{group:expected.group})};
}
type DecryptOptions={spool:string;files:Asset[];identity:string;origin:string;captureId:string;peers:Peers;out:string};
export async function decryptBundle(options:DecryptOptions):Promise<{stage:string;sender:Peer}> {
  const files=transportAssets(options.files),grouped=files.some(f=>f.path.startsWith('evidence/'));
  let stage:string|undefined,sender:Peer|undefined;const ordinary:Asset[]=[];
  try {
    for(const group of grouped?['evidence','media'] as const:[undefined]) {
      const prefix=group?group+'/':'';
      const decoded=await decryptGroup({...options,group,stage,spool:group?path.join(options.spool,group):options.spool,
        files:files.filter(f=>f.path.startsWith(prefix)).map(f=>({...f,path:f.path.slice(prefix.length)}))});
      stage=decoded.stage;
      check(!sender || (sender.grantId===decoded.sender.grantId && sender.key.signing===decoded.sender.key.signing && sender.key.recipient===decoded.sender.key.recipient),'encryption_sender_mismatch');
      sender=decoded.sender;ordinary.push(...decoded.files);
    }
    check(stage && sender,'invalid_encryption_manifest');
    assets(ordinary,assetPath);await validateReferences(stage,ordinary);
    return {stage,sender};
  } catch(error){if(stage)await fs.rm(stage,{recursive:true,force:true});throw error;}
}
async function decryptGroup(options:DecryptOptions & {group?:Context['group'];stage?:string}):Promise<{stage:string;sender:Peer;files:Asset[]}> {
  const {spool,files,identity,origin,peers,out}=options;
  await trustedDirectory(spool,true);await trustedDirectory(path.dirname(out));
  for(const file of transportAssets(files)) {
    const stat=await fs.lstat(path.join(spool,file.path));
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1 && stat.size===file.size &&
      await fileHash(path.join(spool,file.path))===file.sha256,'encrypted_transport_integrity_mismatch');
  }
  const envelope=JSON.parse((await readPrivate(path.join(spool,'envelope.json'))).toString('utf8'));
  keys(envelope,['signed','signature']);keys(envelope.signed,['version','context','chunks']);
  check(envelope.signed.version===1,'unsupported_encryption_format');
  const expected=context(envelope.signed.context,{origin,accountId:peers.accountId,captureId:options.captureId,group:options.group});
  const parts=chunks(envelope.signed.chunks);
  check(equal([...parts].sort((a,b)=>a.path.localeCompare(b.path)),files.filter(f=>f.path!=='envelope.json').sort((a,b)=>a.path.localeCompare(b.path))),'encryption_manifest_mismatch');
  const sender=peers.devices.find(p=>p.grantId===expected.senderGrantId && p.scope==='upload');
  check(sender && await verifyEnvelope(Buffer.from(sender.key.signing,'hex'),envelope.signed as Signed,envelope.signature as string),'encryption_signature_invalid');
  // Match the native bounded-header gate before invoking the age parser.
  const first=await fs.open(path.join(spool,parts[0]!.path),'r');
  const header=Buffer.alloc(32768);let read;
  try {read=await first.read(header,0,header.length,0);} finally {await first.close();}
  const lines=header.subarray(0,read.bytesRead).toString('ascii').split('\n');
  check(lines.shift()==='age-encryption.org/v1','invalid_encryption_header');
  let native=0,grease=0,ended=false;
  for(const line of lines) {
    check(line.length<=1024,'invalid_encryption_header');
    if(line.startsWith('--- ')){ended=true;break;}
    if(line.startsWith('-> X25519 '))native++;
    else if(line.startsWith('-> ')){check(/^-> [^ ]+-grease(?: |$)/.test(line),'unsupported_encryption_header');grease++;}
    check(native<=64 && grease<=1,'invalid_encryption_header');
  }
  check(ended && native>0,'invalid_encryption_header');
  const source=(async function*(){for(const part of parts)for await(const bytes of createReadStream(path.join(spool,part.path)))yield new Uint8Array(bytes);})();
  const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const r=await source.next();if(r.done)controller.close();else controller.enqueue(r.value);}catch(error){controller.error(error);}},async cancel(){await source.return(undefined);}});
  const decrypter=new age.Decrypter();decrypter.addIdentity(identity);
  const cursor=new Cursor(await decrypter.decrypt(stream));
  let stage=options.stage;
  try {
    const size=new DataView((await cursor.exact(4)).buffer).getUint32(0,false);
    check(size>0 && size<=131072,'invalid_archive_descriptor');
    const inner=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await cursor.exact(size)));
    keys(inner,['version','context','files']);check(inner.version===1,'unsupported_encryption_format');
    check(equal(context(inner.context,expected),expected),'encryption_context_mismatch');
    const ordinary=assets(inner.files,p=>assetPath(p)&&(options.group===undefined || mediaPath(p)===(options.group==='media')),512,options.group==='media');
    if(options.group!=='media') {
      for(const required of ['apparent.json','summary.md','contact-sheet.png'])check(ordinary.some(f=>f.path===required),'missing_bundle_asset');
      check(ordinary.find(f=>f.path==='apparent.json')!.size<=131072,'metadata_too_large');
    }
    if(!stage){stage=await fs.mkdtemp(path.join(path.dirname(out),'.apparent-mcp-'));await fs.chmod(stage,0o700);}
    for(const file of ordinary) {
      const destination=path.join(stage,file.path);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
      const handle=await fs.open(destination,'wx',0o600),digest=createHash('sha256');let remaining=file.size;
      try {while(remaining){const part=await cursor.take(remaining);check(part.length,'truncated_archive');digest.update(part);await handle.writeFile(part);remaining-=part.length;}await handle.sync();}finally{await handle.close();}
      check(digest.digest('hex')===file.sha256,'plaintext_integrity_mismatch');
    }
    check(!(await cursor.take(1)).length,'archive_trailing_data'); // Forces authenticated FINAL and EOF.
    for(const directory of new Set(ordinary.map(file=>path.dirname(path.join(stage!,file.path))))) {
      const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}
    }
    return {stage,sender,files:ordinary};
  } catch(error) {if(stage)await fs.rm(stage,{recursive:true,force:true});throw error;}
  finally {await cursor.reader.cancel().catch(()=>{});}
}

async function validateReferences(stage:string,ordinary:Asset[]):Promise<void> {
  const metadata=JSON.parse((await readPrivate(path.join(stage,'apparent.json'))).toString('utf8'));
  check(record(metadata),'invalid_bundle_metadata');
  const names=new Set(ordinary.map(f=>f.path));
  const reference=(v:unknown)=>check(v===null || (typeof v==='string' && assetPath(v) && names.has(v)),'invalid_bundle_reference');
  for(const field of ['contactSheet','contact_sheet','video','audio'])if(field in metadata)reference(metadata[field]);
  if('keyframes' in metadata){check(Array.isArray(metadata.keyframes),'invalid_bundle_metadata');for(const frame of metadata.keyframes){check(record(frame) && 'file' in frame,'invalid_bundle_reference');reference(frame.file);}}
  if(metadata.autocrop!==null && metadata.autocrop!==undefined) {
    check(record(metadata.autocrop),'invalid_bundle_metadata');
    for(const field of ['fullContactSheet','full_contact_sheet'])if(field in metadata.autocrop)reference(metadata.autocrop[field]);
    for(const field of ['fullFrames','full_frames'])if(field in metadata.autocrop)check(metadata.autocrop[field]==='frames-full','invalid_bundle_reference');
  }
}

export async function publishBundle(stage:string,out:string):Promise<void> {
  await trustedDirectory(path.dirname(out));await trustedDirectory(stage,true);
  // Exclusive reservation rejects existing paths atomically, including empty directories.
  await fs.mkdir(out,{mode:0o700});
  try {await fs.rename(stage,out);}catch(error){await fs.rmdir(out);throw error;}
  const parent=await fs.open(path.dirname(out),'r');try{await parent.sync();}finally{await parent.close();}
}
