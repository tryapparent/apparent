import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createNativeInkRelay, type NativeInkSourcePort, type NativeInkSink, type NativeInkObservation } from '../src/ink.ts';

const cid='1'.repeat(32), pid='2'.repeat(32), rid='3'.repeat(32);
const host={processEpoch:'native-strong-epoch',revision:7,pid:42,startTicks:'999'};
const sourceRef={id:'portal-original',generation:'4'.repeat(32)};
const observation: NativeInkObservation={host,producerId:pid,generation:1,bootId:'boot-original',clock:'linux-clock-monotonic-observation',
  output:{name:'Virtual-1',physical:{x:0,y:0,width:1280,height:800},compositor:{x:0,y:0,width:1280,height:800,scale:1}},
  surfaces:[{surfaceId:'screen-original',transformId:'transform-original',nativeIncarnation:'native-original',target:'capture-rectangle',pointSpace:'desktop-physical',contentRectangle:{x:0,y:0,width:1280,height:800},plane:{width:1280,height:800}}]};
const limits={maxWireBytes:65536,maxBatchJsonBytes:16384,maxPointsPerBatch:256,maxPointsPerGesture:2400,maxBatches:4096,maxSurfaces:8,maxGestures:4096,maxTotalPoints:65536,maxFactBytes:4194304,finishGraceMs:2000};
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function fixture(raw: string[] = []) {
  const actions:string[]=[];let available=raw.length;let acked=0;
  const native:NativeInkSourcePort={
    async readObservation(){actions.push('observe');return {captureId:cid,source:sourceRef,observation:structuredClone(observation)};},
    async readBatch(binding,sequence){assert.equal(binding.captureId,cid);assert.equal(sequence,acked);actions.push('read:'+sequence);
      if(sequence>=available)return {status:'pending'};return {status:'batch',batch:{sequence,eventsJson:raw[sequence],batchSha256:sha(raw[sequence])}};},
    async acknowledgeBatch(binding,batch){assert.equal(batch.sequence,acked);assert.equal(batch.batchSha256,sha(raw[acked]));acked++;actions.push('ack:'+batch.sequence);return {status:'acknowledged',...batch};},
    async sealInputAndDrain(){actions.push('native-seal');available=raw.length;return {finalSequence:raw.length===0?null:raw.length-1,seal:{state:'sealed-and-drained',observedAtNs:'2000000011',nativeRevision:9}};},
  };
  const sink:NativeInkSink={
    async registerInkProducer(input){actions.push('register');assert.equal(input.ownerToken,'private-owner');assert.deepEqual(input.source,sourceRef);return {ingressVersion:1,captureId:cid,producerId:pid,generation:1,registrationId:rid,producerToken:'private-producer',nextSequence:0,clock:{kind:'linux-clock-monotonic-observation',bootId:observation.bootId,admissionMonotonicNs:'2000000000'},limits};},
    async submitInkEvents(input){actions.push('submit:'+input.sequence);assert.equal(input.eventsJson,raw[input.sequence]);assert.equal(input.batchSha256,sha(raw[input.sequence]));return {ingressVersion:1,captureId:cid,registrationId:rid,sequence:input.sequence,batchSha256:input.batchSha256,nextSequence:input.sequence+1,outcome:'accepted'};},
    async finishInkProducer(input){actions.push('engine-finish');assert.equal(input.finalSequence,raw.length===0?null:raw.length-1);return {ingressVersion:1,captureId:cid,registrationId:rid,finalSequence:input.finalSequence,state:'complete'};},
  };
  const relay=createNativeInkRelay({source:native,sink,original:{captureId:cid,source:sourceRef,ownerToken:'private-owner'},ownedHost:host});
  return {relay,native,sink,actions,setAvailable(n:number){available=n;}};
}
const raw='[ {"kind":"points","gestureId":"'+'5'.repeat(32)+'","points":[{"timeNs":"2000000001","x":1.0000000000000002,"y":2.0}]} ]';
test('exact retained JSON survives forwarding and native ACK follows matching Engine receipt',async()=>{
  const f=fixture([raw]);await f.relay.register();assert.equal(await f.relay.forwardNext(),true);await f.relay.finish();
  assert.equal(f.relay.phase(),'complete');assert.deepEqual(f.actions,['observe','register','read:0','submit:0','ack:0','native-seal','engine-finish']);
});
test('native seal/drain queues original retained batches before Engine final completion',async()=>{
  const f=fixture([raw,raw]);f.setAvailable(0);await f.relay.register();assert.equal(await f.relay.forwardNext(),false);await f.relay.finish();
  assert.deepEqual(f.actions.slice(3),['native-seal','read:0','submit:0','ack:0','read:1','submit:1','ack:1','engine-finish']);
});
test('genuine zero-batch seal uses null, never invented empty collected batches',async()=>{
  const f=fixture();await f.relay.register();await f.relay.finish();assert.equal(f.relay.phase(),'complete');assert.ok(!f.actions.some(x=>x.startsWith('submit')));
});
test('foreign native incarnation is refused before registration',async()=>{
  const f=fixture();f.native.readObservation=async()=>({captureId:cid,source:sourceRef,observation:{...observation,host:{...host,startTicks:'1000'}}});
  await assert.rejects(f.relay.register());assert.equal(f.relay.phase(),'unavailable');assert.ok(!f.actions.includes('register'));
});
test('foreign original capture/source and receipt clock/generation cannot rebind',async()=>{
  for(const change of ['source','capture','clock','generation']){
    const f=fixture();if(change==='source'||change==='capture'){const read=f.native.readObservation;f.native.readObservation=async()=>({...await read(),...(change==='source'?{source:{...sourceRef,generation:'6'.repeat(32)}}:{captureId:'7'.repeat(32)})});}
    else {const register=f.sink.registerInkProducer;f.sink.registerInkProducer=async input=>{const r=await register(input);return {...r,...(change==='clock'?{clock:{...r.clock,bootId:'foreign'}}:{generation:2})};};}
    await assert.rejects(f.relay.register());assert.equal(f.relay.phase(),'unavailable');
  }
});
test('digest/sequence/oversize/malformed JSON refused before Engine submission or ACK',async()=>{
  for(const change of ['digest','sequence','oversize','malformed','empty']){
    const f=fixture([raw]);f.native.readBatch=async()=>{let json=change==='oversize'?' '.repeat(16385):change==='malformed'?'[':change==='empty'?'[]':raw;
      return {status:'batch',batch:{sequence:change==='sequence'?1:0,eventsJson:json,batchSha256:change==='digest'?'0'.repeat(64):sha(json)}};};
    await f.relay.register();await assert.rejects(f.relay.forwardNext());assert.equal(f.relay.phase(),'unavailable');assert.ok(!f.actions.some(x=>x.startsWith('submit')||x.startsWith('ack')));
  }
});
test('lost Engine response leaves original native batch retained and refuses automatic retry',async()=>{
  const f=fixture([raw]);f.sink.submitInkEvents=async()=>{throw new Error('lost-reply');};await f.relay.register();await assert.rejects(f.relay.forwardNext(),/lost-reply/);
  await assert.rejects(f.relay.forwardNext());await assert.rejects(f.relay.register());assert.ok(!f.actions.some(x=>x.startsWith('ack')));
});
test('foreign Engine receipt and ambiguous native ACK never advance or finish',async()=>{
  for(const change of ['receipt','ack']){const f=fixture([raw]);if(change==='receipt'){const submit=f.sink.submitInkEvents;f.sink.submitInkEvents=async i=>({...await submit(i),batchSha256:'0'.repeat(64)});}
    else f.native.acknowledgeBatch=async()=>({status:'outcome-unknown'});
    await f.relay.register();await assert.rejects(f.relay.forwardNext());await assert.rejects(f.relay.finish());assert.equal(f.relay.phase(),'unavailable');assert.ok(!f.actions.includes('engine-finish'));}
});
test('pending or inconsistent final sequence cannot become positive drain',async()=>{
  for(const change of ['pending','null','too-many']){const f=fixture([raw]);await f.relay.register();if(change==='null')await f.relay.forwardNext();
    if(change==='pending')f.native.readBatch=async()=>({status:'pending'});
    else f.native.sealInputAndDrain=async()=>({finalSequence:change==='null'?null:4096,seal:{state:'sealed-and-drained',observedAtNs:'2000000011',nativeRevision:9}});
    await assert.rejects(f.relay.finish());assert.equal(f.relay.phase(),'unavailable');assert.ok(!f.actions.includes('engine-finish'));}
});
test('Engine unavailable finish stays unavailable; no implicit clearance',async()=>{
  const f=fixture();f.sink.finishInkProducer=async i=>({ingressVersion:1,captureId:cid,registrationId:rid,finalSequence:i.finalSequence,state:'unavailable'});
  await f.relay.register();await assert.rejects(f.relay.finish());assert.equal(f.relay.phase(),'unavailable');
});
test('concurrent action is refused while original registration remains live',async()=>{
  const f=fixture();let release!:()=>void;const read=f.native.readObservation;f.native.readObservation=async()=>{await new Promise<void>(r=>{release=r;});return read();};
  const registering=f.relay.register();await Promise.resolve();await assert.rejects(f.relay.register());assert.equal(f.relay.phase(),'registering');release();await registering;assert.equal(f.relay.phase(),'ready');
});
test('deadline failure stays latched when the original native read resolves late',async()=>{
  const f=fixture();let release!:()=>void;const read=f.native.readObservation;
  f.native.readObservation=async()=>{await new Promise<void>(r=>{release=r;});return read();};
  await assert.rejects(f.relay.register(),/deadline/);assert.equal(f.relay.phase(),'unavailable');
  release();await new Promise<void>(r=>setImmediate(r));
  assert.equal(f.relay.phase(),'unavailable');assert.ok(!f.actions.includes('register'));
});
