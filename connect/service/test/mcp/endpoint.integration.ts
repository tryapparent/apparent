import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK} from 'jose';
import {fixture,digest} from '../../../enablement/verification/service/helpers.mjs';
import {initEndpoint,acceptEndpoint,nextEndpoint,fetchEndpoint,revokeEndpoint,cancelEndpoint} from '../../../client/typescript/dist/mcp-endpoint.js';
import {generateAgeIdentity,encryptAge,encodeArchive,signEnvelope} from '../../../client/typescript/dist/index.js';
import {getPublicKeyAsync} from '../../../client/typescript/node_modules/@noble/ed25519/index.js';

async function rpc(f:any,name:string,args:unknown) {
  const r=await f.call('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
    body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
  assert.equal(r.status,200);const result=(await r.json()).result;
  assert.ok(result && !result.isError,JSON.stringify(result));return result;
}
async function relayCall(f:any,call:any) {assert.ok(call.tool);return rpc(f,call.tool,call.arguments);}
async function endpoint(f:any,account:any,directory:string) {
  const open=await initEndpoint(directory,'https://api.example');
  const start=await acceptEndpoint(directory,await relayCall(f,open));
  const approval=await acceptEndpoint(directory,await relayCall(f,start));
  assert.equal(approval.state,'approval_required');
  const userCode=new URL(approval.verificationUri as string).searchParams.get('code');
  assert.equal((await f.call('/v1/device/approve',{...account,method:'POST',body:{userCode}})).status,200);
  const accepted=await acceptEndpoint(directory,await relayCall(f,await nextEndpoint(directory)));
  assert.deepEqual(accepted,{state:'approved'});
  return JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
}
async function sender(f:any,account:any) {
  const identity=await generateAgeIdentity(),seed=randomBytes(32);
  const key={version:1,recipient:identity.recipient,signing:Buffer.from(await getPublicKeyAsync(seed)).toString('hex')};
  const start=await (await f.call('/v1/device/start',{method:'POST',body:{scope:'upload',encryptionKey:key}})).json();
  assert.equal((await f.call('/v1/device/approve',{...account,method:'POST',body:{userCode:start.userCode}})).status,200);
  const granted=await (await f.call('/v1/device/poll',{method:'POST',body:{deviceCode:start.deviceCode}})).json();
  assert.equal(granted.scope,'upload');return {...granted,seed,key};
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/p0AAAAASUVORK5CYII=','base64');
async function upload(f:any,account:any,uploader:any,reader:any,captureId:string,mutate?:(inner:any)=>void,grouped=false,mediaBytes=18000) {
  const original=new Map<string,Buffer>([
    ['apparent.json',Buffer.from(JSON.stringify({contactSheet:'contact-sheet.png',keyframes:[{file:'frames/frame-00.png',timeMs:12000}],video:'recording.mp4',audio:null}))],
    ['summary.md',Buffer.from('PRIVATE TEST PHRASE: why is this in here?\n'.repeat(900))],
    ['notes.json',Buffer.from('{"version":1,"notes":[]}')],
    ['contact-sheet.png',png],['frames/frame-00.png',png],['recording.mp4',randomBytes(mediaBytes)],
  ]);
  const data:Array<[{path:string;size:number;sha256:string},Uint8Array]>=[];
  for(const group of grouped?['evidence','media'] as const:[undefined]) {
    const context={origin:'https://api.example',accountId:account.id,captureId,senderGrantId:uploader.grantId,...(group?{group}:{})};
    const entries=[...original].filter(([p])=>!group || ['recording.mp4','recording.mov','audio.wav'].includes(p)===(group==='media'));
    const inner={version:1,context,files:entries.map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}))};
    mutate?.(inner);
    const cipher=await encryptAge(encodeArchive(inner,entries.map(([,b])=>b)),[reader.key.recipient]);
    const parts:Array<[{path:string;size:number;sha256:string},Uint8Array]>=[];
    for(let offset=0;offset<cipher.length;offset+=33554432){const bytes=cipher.subarray(offset,offset+33554432);parts.push([{path:`sealed/part-${String(parts.length).padStart(6,'0')}.age`,size:bytes.length,sha256:digest(bytes)},bytes]);}
    const signed={version:1,context,chunks:parts.map(([file])=>file)};
    const envelope=Buffer.from(JSON.stringify({signed,signature:await signEnvelope(uploader.seed,signed)})),prefix=group?group+'/':'';
    data.push([{path:prefix+'envelope.json',size:envelope.length,sha256:digest(envelope)},envelope],...parts.map(([file,bytes])=>[{...file,path:prefix+file.path},bytes] as [typeof file,Uint8Array]));
  }
  const files=data.map(([file])=>file);
  if(grouped) {
    // The deployed preview already writes this layout. Seed its existing stored
    // contract here; this slice does not add grouped uploads to main's native API.
    const now=Date.now();
    await f.db.prepare("INSERT INTO captures(id,account_id,status,expires_at,pending_until,manifest,bytes,format) VALUES(?,?,'ready',?,?,?,?,'apparent-encrypted-v1')")
      .bind(captureId,account.id,now+86400000,now+86400000,JSON.stringify(files),files.reduce((n,x)=>n+x.size,0)).run();
    for(const [file,bytes] of data) {
      const key='synthetic-mcp/'+captureId+'/'+file.path;await f.bucket.put(key,bytes);
      await f.db.prepare('INSERT INTO files(capture_id,path,size,sha256,object_key) VALUES(?,?,?,?,?)').bind(captureId,file.path,file.size,file.sha256,key).run();
    }
    return original;
  }
  assert.equal((await f.call('/v1/captures/'+captureId,{token:uploader.accessToken,method:'POST',body:{format:'apparent-encrypted-v1',files}})).status,200);
  for(const [file,bytes] of data)assert.equal((await f.call(`/v1/captures/${captureId}/files/${file.path}`,{token:uploader.accessToken,method:'PUT',raw:bytes})).status,200);
  assert.equal((await f.call(`/v1/captures/${captureId}/complete`,{token:uploader.accessToken,method:'POST'})).status,200);
  return original;
}

// Model-free host bridge: only opaque requests and progress leave the reader;
// complete, recording-sized MCP replies go directly into its stdin.
async function pipeTransfer(t:test.TestContext,f:any,directory:string,id:string,out:string,inspection:boolean,files?:string[]) {
  const started=performance.now();
  const child=spawn(process.execPath,['--experimental-strip-types','--import',fileURLToPath(new URL('./no-network.ts',import.meta.url)),fileURLToPath(new URL('../../../client/typescript/dist/mcp-cli.js',import.meta.url)),'run','--state',directory,'--id',id,'--out',out,'--mode',files?'files':inspection?'inspection':'bundle',...(files?.flatMap(name=>['--file',name])??[])],{stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const lines=createInterface({input:child.stdout});let terminal:any,calls=0,maxReplyBytes=0,bytesTotal=0;
  try {
    for await(const line of lines) {
      const call=JSON.parse(line);
      if(!call.tool){terminal=call;continue;}
      assert.ok(++calls<=50,'Recording-sized transfer must not require hundreds of tool calls');
      if(call.progress)bytesTotal=call.progress.bytesTotal;
      if(inspection) {
        const state=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
        if(state.pending?.operation.operation==='part'){
          if(state.capture.format==='apparent-encrypted-v2'){
            const asset=state.capture.fileIndex?.files.find((e:any)=>e.object===state.pending.operation.path);
            if(asset)assert.ok(!['recording.mp4','recording.mov','audio.wav'].includes(asset.path),'V2 inspection must not request media');
          }else assert.ok(state.pending.operation.path.startsWith('evidence/'),'Inspection must not request media');
        }
      }
      const reply=JSON.stringify(await relayCall(f,call));maxReplyBytes=Math.max(maxReplyBytes,Buffer.byteLength(reply));
      await new Promise<void>((resolve,reject)=>child.stdin.write(reply+'\n',error=>error?reject(error):resolve()));
    }
    assert.equal(await exited,0,stderr);assert.match(stderr,/Reader network guard active/);assert.ok(terminal,'Reader must report terminal output');
    const metrics={calls,maxReplyBytes,bytesTotal,elapsedMs:Math.round(performance.now()-started)};
    t.diagnostic(JSON.stringify({inspection,...metrics}));return {terminal,...metrics};
  } finally {lines.close();child.stdin.destroy();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
}

for(const grouped of [false,true])test(`recording-sized ${grouped?'grouped':'legacy'} transfer: 33 MiB via lossless CLI pipe, with images first when independently encrypted`,async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-large-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-large-'+grouped),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='9'.repeat(32);
    const original=await upload(f,account,uploader,reader,id,undefined,grouped,33*1024*1024);
    if(grouped) {
      await f.db.prepare("UPDATE captures SET status='pending' WHERE id=?").bind(id).run();
      await f.db.prepare("UPDATE files SET object_key=NULL WHERE capture_id=? AND path LIKE 'media/%'").bind(id).run();
      const out=path.join(root,'images');const inspected=await pipeTransfer(t,f,directory,id,out,true);
      assert.equal(inspected.terminal.state,'inspection_ready');assert.equal(inspected.terminal.mediaDownloaded,false);
      assert.ok(inspected.calls<=6);assert.ok(inspected.bytesTotal<100000,'Movie size must not affect evidence transfer');
      assert.deepEqual(await fs.readFile(path.join(out,'contact-sheet.png')),png);
      assert.deepEqual(await fs.readFile(path.join(out,'frames/frame-00.png')),png);
      await assert.rejects(fs.stat(path.join(out,'recording.mp4')),{code:'ENOENT'});
      await f.db.prepare("UPDATE captures SET status='ready' WHERE id=?").bind(id).run();
      await f.db.prepare("UPDATE files SET object_key='synthetic-mcp/' || capture_id || '/' || path WHERE capture_id=? AND path LIKE 'media/%'").bind(id).run();
    }
    const out=path.join(root,'complete.apparent'),result=await pipeTransfer(t,f,directory,id,out,false);
    assert.equal(result.terminal.state,'ready');assert.ok(result.calls<=42);
    assert.ok(result.maxReplyBytes>300000,'Exercise the formerly failing reply-file/stdio size boundary');
    for(const [name,bytes] of original)assert.deepEqual(await fs.readFile(path.join(out,name)),bytes);
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

test('real Worker relay: browser read approval, ciphertext ranges, offline decryption, final authorization and revocation',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-roundtrip-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-roundtrip'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account);
    const id='a'.repeat(32),original=await upload(f,account,uploader,reader,id),out=path.join(root,'recording.apparent');
    let call:any=await fetchEndpoint(directory,id,out),exchanges=0;
    while(call.tool) {
      const result=await relayCall(f,call),visible=JSON.stringify(result);
      for(const secret of [reader.age,reader.credential.accessToken,reader.credential.refreshToken,'PRIVATE TEST PHRASE'])assert.ok(!visible.includes(secret));
      if(exchanges++===0) {
        const body=JSON.parse(result.content[0].text),damaged=body.sealed.slice(0,-3)+'AAA';
        await assert.rejects(acceptEndpoint(directory,{sealed:damaged}));
        await assert.rejects(fs.stat(out),{code:'ENOENT'});
      }
      call=await acceptEndpoint(directory,result);
      assert.ok(exchanges<40,'bounded synthetic transfer');
    }
    assert.equal(call.state,'ready');assert.ok(exchanges>=5&&exchanges<=6,'small recordings must complete in a few exchanges; recording-sized cases exercise multiple ranges');
    for(const [file,bytes] of original)assert.deepEqual(await fs.readFile(path.join(out,file)),bytes);
    await assert.rejects(fetchEndpoint(directory,id,out),/destination_exists/);
    const revoked=await acceptEndpoint(directory,await relayCall(f,await revokeEndpoint(directory)));
    assert.equal(revoked.state,'revoked');
    const peer=await f.call('/v1/encryption/peers',{token:reader.credential.accessToken});assert.equal(peer.status,401);
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

test('deployed grouped layout relays both streams and preserves notes, frames and media in one verified output',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-grouped-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-grouped'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='1'.repeat(32);
    const original=await upload(f,account,uploader,reader,id,undefined,true),out=path.join(root,'recording.apparent');
    let call:any=await fetchEndpoint(directory,id,out),calls=0;
    while(call.tool){call=await acceptEndpoint(directory,await relayCall(f,call));assert.ok(++calls<40);}
    assert.equal(call.state,'ready',JSON.stringify(call));
    for(const [file,bytes] of original)assert.deepEqual(await fs.readFile(path.join(out,file)),bytes);
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

test('decrypted archive paths are validated before publication and never escape staging',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-malicious-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-malicious'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='b'.repeat(32);
    await upload(f,account,uploader,reader,id,inner=>{inner.files[0].path='../escape';});
    const out=path.join(root,'recording.apparent');let call:any=await fetchEndpoint(directory,id,out),rejected=false;
    for(let i=0;i<40 && call.tool;i++) {
      try {call=await acceptEndpoint(directory,await relayCall(f,call));}
      catch(error){assert.match(String(error),/invalid_manifest/);rejected=true;break;}
    }
    assert.ok(rejected);await assert.rejects(fs.stat(out),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(root,'escape')),{code:'ENOENT'});
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

test('sealed channel rejects upload authority, other accounts, plaintext captures and altered tickets',async()=>{
  const f=await fixture();try {
    const account=await f.identity('mcp-scopes'),other=await f.identity('mcp-other');
    const keys=await generateKeyPair('ECDH-ES',{crv:'P-256',extractable:true});
    const opened=JSON.parse((await rpc(f,'connect_relay_open',{recipient:await exportJWK(keys.publicKey),nonce:'c'.repeat(32)})).content[0].text);
    const request=async(operation:any)=>{
      const sealed=await new CompactEncrypt(Buffer.from(JSON.stringify({id:'d'.repeat(32),...operation}))).setProtectedHeader({alg:'ECDH-ES',enc:'A256GCM',typ:'apparent-mcp-request+jwe'}).encrypt(await importJWK(opened.key,'ECDH-ES'));
      const result=JSON.parse((await rpc(f,'connect_relay',{ticket:opened.ticket,sealed})).content[0].text);
      return JSON.parse(Buffer.from((await compactDecrypt(result.sealed,keys.privateKey)).plaintext).toString('utf8'));
    };
    assert.equal((await request({operation:'peers',accessToken:account.token})).status,403);
    const pending=await(await f.call('/v1/device/start',{method:'POST',body:{scope:'upload'}})).json();
    assert.equal((await request({operation:'poll',deviceCode:pending.deviceCode})).status,401);
    const id='e'.repeat(32),data=Buffer.from('private legacy plaintext');
    assert.equal((await f.call('/v1/captures/'+id,{token:account.token,method:'POST',body:{files:[{path:'summary.md',size:data.length,sha256:digest(data)}]}})).status,200);
    assert.equal((await request({operation:'manifest',accessToken:account.read,captureId:id})).status,409);
    assert.equal((await request({operation:'manifest',accessToken:other.read,captureId:id})).status,404);
    assert.equal((await request({operation:'part',accessToken:account.read,captureId:'../escape',path:'envelope.json',offset:0})).status,400);
    const bad=await f.call('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'connect_relay',arguments:{ticket:opened.ticket+'X',sealed:'x'.repeat(40)}}}});
    assert.ok((await bad.json()).result.isError);
  } finally {await f.close();}
});

test('range negotiation preserves old readers and rejects invalid or oversized requests',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-ranges-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-ranges'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='8'.repeat(32);
    await upload(f,account,uploader,reader,id,undefined,false,2*1024*1024);
    const keys=await generateKeyPair('ECDH-ES',{crv:'P-256',extractable:true});
    const opened=JSON.parse((await rpc(f,'connect_relay_open',{recipient:await exportJWK(keys.publicKey),nonce:'a'.repeat(32)})).content[0].text);
    assert.equal(opened.maxPartBytes,1024*1024);
    const request=async(length?:unknown)=>{
      const value={id:'b'.repeat(32),operation:'part',accessToken:reader.credential.accessToken,captureId:id,path:'sealed/part-000000.age',offset:0,...(length===undefined?{}:{length})};
      const sealed=await new CompactEncrypt(Buffer.from(JSON.stringify(value))).setProtectedHeader({alg:'ECDH-ES',enc:'A256GCM',typ:'apparent-mcp-request+jwe'}).encrypt(await importJWK(opened.key,'ECDH-ES'));
      const result=JSON.parse((await rpc(f,'connect_relay',{ticket:opened.ticket,sealed})).content[0].text);
      return JSON.parse(Buffer.from((await compactDecrypt(result.sealed,keys.privateKey)).plaintext).toString());
    };
    const legacy=await request(),large=await request(1024*1024);
    assert.equal(legacy.status,200);assert.equal(Buffer.from(legacy.body.data,'base64').length,16384);
    assert.equal(large.status,200);assert.equal(Buffer.from(large.body.data,'base64').length,1024*1024);
    assert.equal(digest(Buffer.from(legacy.body.data,'base64')),digest(Buffer.from(large.body.data,'base64').subarray(0,16384)));
    for(const length of [0,-1,1.5,1024*1024+1,'1048576'])assert.equal((await request(length)).status,400);
    await f.call('/v1/token/revoke',{token:reader.credential.accessToken,method:'POST'});
    assert.equal((await request(1024*1024)).status,401);
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

for(const inspection of [false,true])test(`${inspection?'inspection':'full'} sender revocation after local decryption prevents publication; cancel removes only the staged transfer`,async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-revoked-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-revoked'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='f'.repeat(32);
    await upload(f,account,uploader,reader,id,undefined,inspection);
    const out=path.join(root,'recording.apparent');let call:any=await fetchEndpoint(directory,id,out,inspection),stage:string|undefined;
    for(let i=0;i<40;i++) {
      const state=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
      if(state.pending.kind==='final'){stage=state.capture.stage;break;}
      call=await acceptEndpoint(directory,await relayCall(f,call));
    }
    assert.ok(stage);assert.equal((await f.call('/v1/token/revoke',{token:uploader.accessToken,method:'POST'})).status,200);
    await assert.rejects(acceptEndpoint(directory,await relayCall(f,call)),/sender_revoked_or_unapproved/);
    await assert.rejects(fs.stat(out),{code:'ENOENT'});
    assert.equal((await cancelEndpoint(directory)).state,'cancelled');
    await assert.rejects(fs.stat(stage!),{code:'ENOENT'});
    const remaining=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
    assert.equal(remaining.age,reader.age);assert.equal(remaining.credential.grantId,reader.credential.grantId);assert.equal(remaining.capture,undefined);
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

test('waitlisted readers receive eligibility guidance rather than credentials or a false approval',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-waitlist-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-waitlist','waitlist'),directory=path.join(root,'reader');
    const opening=await initEndpoint(directory,'https://api.example');
    const handshake=await relayCall(f,opening);
    const malformed=JSON.parse(handshake.content[0].text);malformed.key.extra='not a public key field';
    await assert.rejects(acceptEndpoint(directory,malformed),/invalid_relay_handshake/);
    const start=await acceptEndpoint(directory,handshake);
    const approval=await acceptEndpoint(directory,await relayCall(f,start));
    const userCode=new URL(approval.verificationUri as string).searchParams.get('code');
    assert.equal((await f.call('/v1/device/waitlist',{...account,method:'POST',body:{userCode}})).status,200);
    const result=await acceptEndpoint(directory,await relayCall(f,await nextEndpoint(directory)));
    assert.equal(result.state,'waitlisted');
    const state=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
    assert.equal(state.credential,undefined);assert.equal(state.failure,'beta_required');
  } finally {await f.close();await fs.rm(root,{recursive:true,force:true});}
});

test('v2 MCP selectively retrieves transcript and image; listing and extraction never read video',async t=>{
  const {signedFileBytes}=await import('../../../client/typescript/dist/transfer/contract.js');
  const {signAsync}=await import('../../../client/typescript/node_modules/@noble/ed25519/index.js');
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-files-'));await fs.chmod(root,0o700);
  const observed=await build({stdin:{resolveDir:process.cwd(),contents:`
   import worker from './src/worker.ts';const gets=[];
   export default {fetch(request,env,context){
    if(new URL(request.url).pathname==='/_observed_reads')return Response.json(gets);
    const BUCKET=new Proxy(env.BUCKET,{get(target,key){const value=target[key];return typeof value==='function'?function(...args){if(key==='get')gets.push(args[0]);return value.apply(target,args);}:value;}});
    return worker.fetch(request,{...env,BUCKET},context);
   }};`},bundle:true,format:'esm',platform:'browser',conditions:['workerd'],external:['node:*'],write:false});
  const f=await fixture({}, {scriptPath:undefined,script:observed.outputFiles[0].text});try{
    const account=await f.identity('mcp-files'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='2'.repeat(32);
    const original=new Map<string,Buffer>([['apparent.json',Buffer.from(JSON.stringify({contactSheet:'contact-sheet.png',video:'recording.mp4',transcript:{text:'Synthetic spoken feedback'}}))],['summary.md',Buffer.from('Synthetic summary')],['contact-sheet.png',png],['recording.mp4',randomBytes(2*1024*1024+37)]]);
    const context={origin:'https://api.example',accountId:account.id,captureId:id,senderGrantId:uploader.grantId};
    const entries:any[]=[],data=new Map<string,Uint8Array>();let i=0;
    for(const [name,bytes] of original){const object=`sealed/file-${String(i++).padStart(6,'0')}.age`;entries.push({path:name,size:bytes.length,sha256:digest(bytes),object});data.set(object,await encryptAge(bytes,[reader.key.recipient]));}
    data.set('sealed/index.age',await encryptAge(Buffer.from(JSON.stringify({version:2,context,files:entries})),[reader.key.recipient]));
    const chunks=[...data].map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)})).sort((a,b)=>a.path.localeCompare(b.path));
    const signed={version:2 as const,context,chunks},signature=Buffer.from(await signAsync(signedFileBytes(signed),uploader.seed)).toString('hex');
    data.set('envelope.json',Buffer.from(JSON.stringify({signed,signature})));
    const files=[...data].map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}));
    assert.equal((await f.call('/v1/captures/'+id,{token:uploader.accessToken,method:'POST',body:{format:'apparent-encrypted-v2',files}})).status,200);
    for(const [name,bytes] of data)assert.equal((await f.call(`/v1/captures/${id}/files/${name}`,{token:uploader.accessToken,method:'PUT',raw:bytes})).status,200);
    assert.equal((await f.call(`/v1/captures/${id}/complete`,{token:uploader.accessToken,method:'POST'})).status,200);
    const drive=async(call:any)=>{for(let n=0;call.tool;n++){assert.ok(n<30);call=await acceptEndpoint(directory,await relayCall(f,call));}return call;};
    const stored=(await f.db.prepare('SELECT path,object_key FROM files WHERE capture_id=?').bind(id).all()).results;
    const names=new Map(stored.map((row:any)=>[row.object_key,row.path]));
    const reads=async()=>(await(await f.call('/_observed_reads')).json()).map((key:string)=>{assert.ok(names.has(key));return names.get(key);});
    const descriptors=['envelope.json','sealed/index.age'];
    const objects=(paths:string[])=>paths.map(name=>entries.find(e=>e.path===name).object);
    const before=(await reads()).length;
    const listing=await drive(await fetchEndpoint(directory,id,path.join(root,'unused'),{listOnly:true}));
    assert.equal(listing.state,'listed');assert.equal(listing.files.length,4);
    assert.deepEqual((await reads()).slice(before).sort(),[...descriptors].sort(),'listing reads only envelope and encrypted index');
    const out=path.join(root,'evidence'),extracted=(await pipeTransfer(t,f,directory,id,out,false,['apparent.json','contact-sheet.png'])).terminal;
    assert.equal(extracted.state,'ready');assert.equal(extracted.completeBundle,false);assert.equal(extracted.bundle,undefined);
    assert.deepEqual((await reads()).slice(before+2).sort(),[...descriptors,...objects(['apparent.json','contact-sheet.png'])].sort(),'extraction reads exactly the descriptors and requested files');
    for(const name of ['apparent.json','contact-sheet.png'])assert.deepEqual(await fs.readFile(path.join(out,name)),original.get(name));
    assert.deepEqual((await fs.readdir(out)).sort(),['.connect-extraction.json','apparent.json','contact-sheet.png']);
    const inspectionBefore=(await reads()).length;
    const inspectedOut=path.join(root,'inspection'),inspected=await pipeTransfer(t,f,directory,id,inspectedOut,true);
    assert.equal(inspected.terminal.state,'inspection_ready');assert.equal(inspected.terminal.mediaDownloaded,false);
    assert.deepEqual((await reads()).slice(inspectionBefore).sort(),[...descriptors,...objects(['apparent.json','summary.md','contact-sheet.png'])].sort(),'inspection reads only descriptors and evidence, never video');
    assert.ok((await f.db.prepare('SELECT b_used FROM r2_budget').first()).b_used>=(await reads()).length,'provider calls were prepaid');
    assert.equal(JSON.parse(await fs.readFile(path.join(inspectedOut,'inspection.json'),'utf8')).completeRecording,false);
    await assert.rejects(fs.stat(path.join(inspectedOut,'recording.mp4')),{code:'ENOENT'});
    const full=path.join(root,'full.apparent'),completed=await pipeTransfer(t,f,directory,id,full,false);
    assert.equal(completed.terminal.state,'ready');assert.ok(completed.maxReplyBytes>300000,'v2 full transfer uses negotiated ranges through lossless stdio');
    for(const [name,bytes] of original)assert.deepEqual(await fs.readFile(path.join(full,name)),bytes);
    // Existing public capabilities must continue refusing every encrypted format.
    assert.equal((await f.call(`/v1/captures/${id}/share`,{token:uploader.accessToken,method:'POST'})).status,409);
    const refused=path.join(root,'revoked-selection');let call:any=await fetchEndpoint(directory,id,refused,{selection:['contact-sheet.png']}),stage:string|undefined;
    for(let n=0;n<30;n++){
      const state=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));
      if(state.pending?.kind==='final'){stage=state.capture.stage;break;}
      call=await acceptEndpoint(directory,await relayCall(f,call));
    }
    assert.ok(stage);assert.equal((await f.call('/v1/token/revoke',{token:uploader.accessToken,method:'POST'})).status,200);
    await assert.rejects(acceptEndpoint(directory,await relayCall(f,call)),/sender_revoked_or_unapproved/);
    await assert.rejects(fs.stat(refused),{code:'ENOENT'});
    assert.equal((await cancelEndpoint(directory)).state,'cancelled');await assert.rejects(fs.stat(stage!),{code:'ENOENT'});

  }finally{await f.close();await fs.rm(root,{recursive:true,force:true});}
});
