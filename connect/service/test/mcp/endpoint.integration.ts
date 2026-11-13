import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK} from 'jose';
import {fixture,digest} from '../helpers.mjs';
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
async function upload(f:any,account:any,uploader:any,reader:any,captureId:string,mutate?:(inner:any)=>void) {
  const original=new Map<string,Buffer>([
    ['apparent.json',Buffer.from(JSON.stringify({contactSheet:'contact-sheet.png',keyframes:[{file:'frames/frame-00.png',timeMs:12000}]}))],
    ['summary.md',Buffer.from('PRIVATE TEST PHRASE: why is this in here?\n'.repeat(900))],
    ['contact-sheet.png',png],['frames/frame-00.png',png],['recording.mp4',randomBytes(18000)],
  ]);
  const context={origin:'https://api.example',accountId:account.id,captureId,senderGrantId:uploader.grantId};
  const inner={version:1,context,files:[...original].map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}))};
  mutate?.(inner);
  const cipher=await encryptAge(encodeArchive(inner,[...original.values()]),[reader.key.recipient]);
  const chunk={path:'sealed/part-000000.age',size:cipher.length,sha256:digest(cipher)};
  const signed={version:1,context,chunks:[chunk]};
  const envelope=Buffer.from(JSON.stringify({signed,signature:await signEnvelope(uploader.seed,signed)}));
  const files=[{path:'envelope.json',size:envelope.length,sha256:digest(envelope)},chunk];
  assert.equal((await f.call('/v1/captures/'+captureId,{token:uploader.accessToken,method:'POST',body:{format:'apparent-encrypted-v1',files}})).status,200);
  for(const [file,bytes] of [[files[0],envelope],[chunk,cipher]] as const)assert.equal((await f.call(`/v1/captures/${captureId}/files/${file.path}`,{token:uploader.accessToken,method:'PUT',raw:bytes})).status,200);
  assert.equal((await f.call(`/v1/captures/${captureId}/complete`,{token:uploader.accessToken,method:'POST'})).status,200);
  return original;
}

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
    assert.equal(call.state,'ready');assert.ok(exchanges>5,'exercises multiple range reads');
    for(const [file,bytes] of original)assert.deepEqual(await fs.readFile(path.join(out,file)),bytes);
    await assert.rejects(fetchEndpoint(directory,id,out),/destination_exists/);
    const revoked=await acceptEndpoint(directory,await relayCall(f,await revokeEndpoint(directory)));
    assert.equal(revoked.state,'revoked');
    const peer=await f.call('/v1/encryption/peers',{token:reader.credential.accessToken});assert.equal(peer.status,401);
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

test('sender revocation after local decryption prevents publication; cancel removes only the staged transfer',async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'apparent-dev-mcp-revoked-'));await fs.chmod(root,0o700);
  const f=await fixture();try {
    const account=await f.identity('mcp-revoked'),directory=path.join(root,'reader');
    const reader=await endpoint(f,account,directory),uploader=await sender(f,account),id='f'.repeat(32);
    await upload(f,account,uploader,reader,id);
    const out=path.join(root,'recording.apparent');let call:any=await fetchEndpoint(directory,id,out),stage:string|undefined;
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
