import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, open, chmod, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecordFixture } from '@apparent/record/fixtures';
import { validateCaptureRequest } from '@apparent/engine-sdk/capture';
import { createMicrophonePolicy, speechLaunchResource, SPEECH_MODEL_BYTES, SPEECH_PROFILE } from '../../src/record/omarchy/microphone.ts';
import { microphoneReadiness } from '../../src/record/omarchy/microphone-wire.ts';
const snapshot = () => createRecordFixture().driver.current();
const result = (requestId:string) => ({status:'accepted' as const,requestId,snapshot:snapshot()});
const deferred = <T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};

test('fixed private resource is metadata only; absent/unsafe model never becomes configured voice',async t=>{
  const root=await mkdtemp(join(tmpdir(),'microphone-resource-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await chmod(root,0o700);assert.equal(await speechLaunchResource(root),undefined);
  await mkdir(join(root,'resources'),{mode:0o700});const path=join(root,'resources',SPEECH_PROFILE+'.gguf');
  const file=await open(path,'wx',0o600);t.after(()=>file.close());
  assert.equal(await speechLaunchResource(root),undefined);
  // Sparse synthetic metadata fixture, NOT an accepted model or inference test.
  await file.truncate(SPEECH_MODEL_BYTES);
  assert.deepEqual(await speechLaunchResource(root),{localSpeech:{profile:SPEECH_PROFILE,modelFile:path}});
  await chmod(path,0o664);assert.equal(await speechLaunchResource(root),undefined);await chmod(path,0o600);
  await link(path,join(root,'hardlink'));assert.equal(await speechLaunchResource(root),undefined);await rm(join(root,'hardlink'));
  await rm(path);await symlink('/unknown-model',path);assert.equal(await speechLaunchResource(root),undefined);
});

test('unconfigured or unsupported microphone refuses before provider dispatch without silent fallback',async()=>{
  let queries=0;
  const absent=createMicrophonePolicy({resourceConfigured:false,querySupport:async()=>{queries++;return true;},readRetainedAudio:async()=>undefined});
  assert.deepEqual(await absent.port.read(),{support:'unavailable'});await assert.rejects(absent.port.prepare('mic-request'));assert.equal(queries,0);
  const unsupported=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>false,readRetainedAudio:async()=>undefined});
  await assert.rejects(unsupported.port.prepare('mic-request'));
  assert.equal(unsupported.idle(),true);
});

test('explicit microphone action freezes exact SDK046 audio intent against original public request',async()=>{
  const policy=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>true,readRetainedAudio:async()=>undefined});
  const publicId='817c3f10-872d-42e7-a6ef-e9029dc97e40';await policy.port.prepare(publicId);
  const source={id:'original',generation:'d'.repeat(32),kind:'display' as const,displayId:1,bounds:{x:0,y:0,width:1280,height:800,scale:1}};
  const discovery={state:'available' as const,sources:[source]};
  const returned=await policy.runStart(publicId,async()=>{
    const intent={source:discovery.sources[0],options:{audio:policy.audioFor(publicId),localOnly:true},invocation:{kind:'explicit',invocationId:'f'.repeat(32),observedAtMs:0}};
    assert.equal(intent.options.audio,'microphone');assert.equal(intent.options.localOnly,true);assert.equal(intent.source,source);
    validateCaptureRequest({channel:'capture',protocolVersion:2,clientId:'a'.repeat(32),rpcId:'b'.repeat(32),method:'start',
      captureId:'c'.repeat(32),ownerToken:'e'.repeat(64),bundleId:'original.apparent',bundlePath:'/private/original.apparent',...intent});
    return result(publicId);
  });
  assert.equal(returned.requestId,publicId);assert.equal(policy.idle(),true);assert.throws(()=>policy.audioFor(publicId));
  await policy.runStart('silent-next',async()=>{assert.equal(policy.audioFor('silent-next'),'none');return result('silent-next');});
});

test('concurrent public replay joins one immutable audio choice; later microphone preparation cannot steal it',async()=>{
  const lookup=deferred<'none'|undefined>();let dispatches=0;
  const policy=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>true,readRetainedAudio:()=>lookup.promise});
  const first=policy.runStart('same-id',async()=>{dispatches++;assert.equal(policy.audioFor('same-id'),'none');return result('same-id');});
  const second=policy.runStart('same-id',async()=>{throw Error('duplicate dispatch');});assert.equal(first,second);assert.equal(policy.idle(),false);
  await assert.rejects(policy.port.prepare('same-id'));lookup.resolve(undefined);await first;assert.equal(dispatches,1);
});

test('original retained microphone intent survives caller replay; existing silent request cannot be upgraded',async()=>{
  const policy=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>true,readRetainedAudio:async id=>id==='original-mic'?'microphone':'none'});
  await policy.runStart('original-mic',async()=>{assert.equal(policy.audioFor('original-mic'),'microphone');return result('original-mic');});
  await assert.rejects(policy.port.prepare('original-silent'),/conflict/);
});

test('lost/failed dispatch never falls back to silent or retries; local admission closes irreversibly',async()=>{
  const policy=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>true,readRetainedAudio:async()=>undefined});
  await policy.port.prepare('original');let starts=0;
  await assert.rejects(policy.runStart('original',async()=>{starts++;assert.equal(policy.audioFor('original'),'microphone');throw Error('reply unknown');}));
  assert.equal(starts,1);assert.equal(policy.idle(),true);policy.closeAdmission();
  await assert.rejects(policy.port.prepare('new'));assert.throws(()=>policy.runStart('new',async()=>result('new')));
});

test('pending real-peer support is a close borrower; revocation cannot leave a late prepared action',async()=>{
  const query=deferred<boolean>();const policy=createMicrophonePolicy({resourceConfigured:true,querySupport:()=>query.promise,readRetainedAudio:async()=>undefined});
  const pending=policy.port.prepare('pending');assert.equal(policy.idle(),false);policy.closeAdmission();query.resolve(true);
  await assert.rejects(pending);assert.equal(policy.idle(),true);
});

test('renderer readiness is a bounded support DTO, never model/path/secret authority',()=>{
  assert.deepEqual(microphoneReadiness({support:'available'}),{support:'available'});
  for(const bad of [{support:true},{support:'available',modelFile:'/model'},{support:'collected'},null,{support:'available',ownerToken:'secret'}])assert.equal(microphoneReadiness(bad),undefined);
});

test('close inspection seals preparation until positive nonterminal refusal, never after terminal or unknown close',async()=>{
  const policy=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>true,readRetainedAudio:async()=>undefined});
  const decision=deferred<boolean>();let checks=0;
  const close=policy.canClose(()=>{checks++;return decision.promise;},()=> 'open');
  assert.equal(policy.canClose(async()=>true,()=> 'closed'),close);
  await assert.rejects(policy.port.prepare('during-close'));
  decision.resolve(false);assert.equal(await close,false);assert.equal(checks,1);
  assert.deepEqual(await policy.port.read(),{support:'available'});
  await policy.port.prepare('after-refused-close');
  await policy.runStart('after-refused-close',async()=>{assert.equal(policy.audioFor('after-refused-close'),'microphone');return result('after-refused-close');});
  assert.equal(await policy.canClose(async()=>false,()=> 'closed'),false);
  await assert.rejects(policy.port.prepare('after-terminal'));
  assert.equal(await policy.canClose(async()=>true,()=> 'open'),false,'terminal refusal cannot reopen or rerun shutdown');
  const unknown=createMicrophonePolicy({resourceConfigured:true,querySupport:async()=>true,readRetainedAudio:async()=>undefined});
  assert.equal(await unknown.canClose(async()=>{throw Error('unknown');},()=> 'open'),false);
  await assert.rejects(unknown.port.prepare('unknown-close'));
});
