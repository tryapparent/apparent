import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CaptureClient, CAPTURE_INK_LIMITS } from '@apparent/engine-sdk/capture';
import type { CaptureRequest, CaptureResponse } from '@apparent/engine-sdk/capture';
import { createRecordFixture } from '@apparent/record/fixtures';
import { createDrawingController } from '../../src/record/omarchy/drawing/controller.ts';
import { drawingAction,drawingSnapshot } from '../../src/record/omarchy/drawing/wire.ts';
import { bindDrawingTray,type DrawingMenuItem } from '../../src/record/omarchy/drawing/tray.ts';
import type { NativeInkSourcePort,NativeInkObservation } from '@apparent/native-host/ink';
const tick=()=>new Promise<void>(r=>setImmediate(r));
const cid='1'.repeat(32),rid='2'.repeat(32),pid='3'.repeat(32),owner='4'.repeat(64),token='5'.repeat(64),publicId='original-renderer-uuid';
const host={processEpoch:'native-owner-epoch',revision:2,pid:123,startTicks:'456'};
const ref={id:'display:1',generation:'6'.repeat(32)};
const observation:NativeInkObservation={host,producerId:pid,generation:1,bootId:'original-boot',clock:'linux-clock-monotonic-observation',
 output:{name:'Virtual-1',physical:{x:0,y:0,width:1280,height:800},compositor:{x:0,y:0,width:1280,height:800,scale:1}},
 surfaces:[{surfaceId:'screen-original',transformId:'screen-transform',nativeIncarnation:'native-original',target:'capture-rectangle',pointSpace:'desktop-physical',contentRectangle:{x:0,y:0,width:1280,height:800},plane:{width:1280,height:800}}]};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
function fixture(){
 const events:string[]=[],provider=createRecordFixture();let board={nativeRevision:0,open:false,strokeCount:0,activeGesture:false};
 let registration:Promise<void>|undefined,action:Promise<'requested'|'refused'|'outcome-unknown'>|undefined;
 let sequence=0,cancelled=false,sealed=false;const batches:string[]=[];
 const source:NativeInkSourcePort={
  async readObservation(){events.push('observe');return{captureId:cid,source:ref,observation};},
  async activateInput(){events.push('activate');return{status:'active'};},
  async readBatch(_binding,n){return batches[n]?{status:'batch',batch:{sequence:n,eventsJson:batches[n],batchSha256:createHash('sha256').update(batches[n]).digest('hex')}}:{status:'pending'};},
  async acknowledgeBatch(_b,batch){events.push('ack');sequence++;return{status:'acknowledged',...batch};},
  async readBoard(){return {...board};},
  async controlBoard(_b,intent,revision){assert.equal(revision,board.nativeRevision);events.push(intent);if(action)return action;board={...board,nativeRevision:revision+1,open:intent==='open'?true:intent==='close'?false:board.open};return 'requested';},
  async sealInputAndDrain(){events.push('seal');sealed=true;return {finalSequence:batches.length?batches.length-1:null,seal:{state:'sealed-and-drained',observedAtNs:'1000000001',nativeRevision:board.nativeRevision}};},
 };
 const transport={async request(r:CaptureRequest):Promise<CaptureResponse>{
  events.push(r.method);let result:any;
  // Faithful c008 ink_control::handle guard: once cancel_requested is durable,
  // submit/finish reject unavailable even when the native source drains positively.
  if(cancelled&&['finishInkProducer','submitInkEvents'].includes(r.method))return{channel:'capture',protocolVersion:2,rpcId:r.rpcId,error:{code:'unavailable'}} as CaptureResponse;
  if(r.method==='handshake')result={channel:'capture',protocolVersion:2,implementation:'native',readiness:'unavailable',capabilities:Object.fromEntries(['sourceDiscovery','displayCapture','areaCapture','audioCapture','contextFacts','interactionFacts','candidates','transcript','strokes','publication','retainedMaterials'].map(k=>[k,false]))};
  else if(r.method==='inspect')result={captureId:cid,state:cancelled?'cancelled':'recording'};
  else if(r.method==='cancel'){cancelled=true;result={captureId:cid,state:'cancelled'};}
  else if(r.method==='registerInkProducer'){if(registration)await registration;result={ingressVersion:1,captureId:cid,producerId:pid,generation:1,registrationId:rid,producerToken:token,nextSequence:0,clock:{kind:observation.clock,bootId:observation.bootId,admissionMonotonicNs:'1000000000'},limits:CAPTURE_INK_LIMITS};}
  else if(r.method==='submitInkEvents')result={ingressVersion:1,captureId:cid,registrationId:rid,sequence:r.sequence,batchSha256:r.batchSha256,nextSequence:Number(r.sequence)+1,outcome:'accepted'};
  else if(r.method==='finishInkProducer'){assert.equal(sequence,batches.length);result={ingressVersion:1,captureId:cid,registrationId:rid,finalSequence:r.finalSequence,state:'complete'};}
  else throw Error('Unexpected native operation');
  return{channel:'capture',protocolVersion:2,rpcId:r.rpcId,result} as CaptureResponse;
 },async close(){throw Error('No native lifetime operation in fixture');}};
 const capture=new CaptureClient(transport),setup=capture.handshake();
 const mapping={requestId:publicId,captureId:cid,ownerToken:owner,bundleId:'original.apparent',bundlePath:'/private/original.apparent',capture2Intent:JSON.stringify({source:{...ref,kind:'display',displayId:1,bounds:{x:0,y:0,width:1280,height:800,scale:1}},options:{audio:'microphone',localOnly:true},invocation:{kind:'explicit',invocationId:'7'.repeat(32),observedAtMs:1}})};
 const original=structuredClone(mapping);
 const controller=createDrawingController({capture,mapping:async id=>{assert.equal(id,publicId);return mapping;},nativeIdentity:async()=>host,source:()=>source});
 const publish=(phase:'recording'|'saved'|'starting'='recording')=>controller.observe({...provider.driver.current(),captures:[{captureId:publicId,phase,delivery:'unknown',outcomes:[]}]});
 const ready=async()=>{await setup;publish();for(let i=0;i<100;i++){if((await controller.port.read()).phase==='ready')return;await tick();}assert.fail(JSON.stringify(await controller.port.read()));};
 return{nativeSealed:()=>sealed,capture,setup,controller,source,events,mapping,original,ready,publish,provider,setRegistration(p:Promise<void>){registration=p;},setAction(p:typeof action){action=p;},batches};
}
test('actual public SDK046 validates original mapping and Engine ACK precedes source activation, fixed Board control, positive drain',async()=>{
 const f=fixture();f.publish('starting');await tick();assert(!f.events.includes('inspect'));
 await f.ready();assert(f.events.indexOf('registerInkProducer')<f.events.indexOf('activate'));assert.equal(f.controller.localDrain(),'unknown');
 const snapshot=await f.controller.port.read();
 assert.equal(await f.controller.port.act({intent:'open',captureRequestId:publicId,revision:snapshot.revision}), 'requested');
 assert.equal((await f.controller.port.read()).board?.open,true);
 assert.equal(await f.controller.port.act({intent:'clear',captureRequestId:'foreign',revision:snapshot.revision}),'refused');
 assert.equal(await f.controller.port.act({intent:'close',captureRequestId:publicId,revision:snapshot.revision}),'refused');
 await f.controller.finish(publicId);assert.equal((await f.controller.port.read()).phase,'complete');assert.equal(f.controller.localDrain(),'clear');assert.deepEqual(f.mapping,f.original);
 assert.equal(f.events.filter(e=>e==='finishInkProducer').length,1);await f.controller.finish(publicId);assert.equal(f.events.filter(e=>e==='seal').length,1);
});
test('Stop during real registration joins it without late activation or fabricated empty success',async()=>{
 const f=fixture(),gate=deferred<void>();f.setRegistration(gate.promise);await f.setup;f.publish();
 for(let i=0;i<100&&!f.events.includes('registerInkProducer');i++)await tick();assert(f.events.includes('registerInkProducer'));
 const finish=f.controller.finish(publicId);assert.equal(f.controller.beginClose(),false);gate.resolve();await finish;
 assert.equal((await f.controller.port.read()).phase,'unavailable');assert(!f.events.includes('activate'));assert(!f.events.includes('finishInkProducer'));assert.equal(f.controller.localDrain(),'clear');
});
test('unknown native Board result retains input ownership and refuses close; Stop remains separate',async()=>{
 const f=fixture();await f.ready();f.setAction(Promise.resolve('outcome-unknown'));
 const s=await f.controller.port.read();assert.equal(await f.controller.port.act({intent:'open',captureRequestId:publicId,revision:s.revision}),'outcome-unknown');
 assert.equal((await f.controller.port.read()).phase,'unavailable');assert.equal(f.controller.beginClose(),false);assert.equal(f.controller.localDrain(),'unknown');
 await f.controller.finish(publicId);assert.equal((await f.controller.port.read()).phase,'complete');assert.equal((await f.controller.port.read()).controlOutcome,'unknown');
});
test('no source or invalid original mapping cannot manufacture collected input; ordinary nonterminal close can resume',async()=>{
 const f=fixture();await f.setup;f.mapping.capture2Intent='{}';f.publish();await tick();await tick();assert.equal((await f.controller.port.read()).phase,'unavailable');assert(!f.events.includes('activate'));assert(!f.events.includes('finishInkProducer'));
 const g=fixture();assert.equal(g.controller.beginClose(),true);g.controller.settleClose(false,'open');await g.ready();await g.controller.finish(publicId);
 assert.equal(g.controller.beginClose(),true);g.controller.settleClose(false,'closed');const count=g.events.length;g.publish();await tick();assert.equal(g.events.length,count);
});
test('strict renderer shape refuses native authority, points and malformed Board state',()=>{
 const valid={revision:1,phase:'ready',captureRequestId:publicId,board:{open:true,strokeCount:2,activeGesture:false}};
 assert(drawingSnapshot(valid));assert(!drawingSnapshot({...valid,ownerToken:owner}));assert(!drawingSnapshot({...valid,board:{...valid.board,strokeCount:4097}}));assert(!drawingSnapshot({...valid,phase:'invented'}));
 assert(drawingAction({intent:'undo',captureRequestId:publicId,revision:1}));assert(!drawingAction({intent:'undo',captureRequestId:publicId,revision:1,points:[]}));
});
test('stock tray borrows physical Stop and exact public drawing revision, never enables foreign capture or replays unknown',async()=>{
 const f=fixture();let items:DrawingMenuItem[]=[],stops=0;
 const dispose=bindDrawingTray({record:f.provider.client,drawing:f.controller.port,stop(){stops++;},menu(value){items=value;},notice(){}});
 await f.ready();f.provider.driver.publish({...f.provider.driver.current(),revision:f.provider.driver.current().revision+1,captures:[{captureId:publicId,phase:'recording',delivery:'unknown',outcomes:[]}]});
 assert.equal(items[0].enabled,true);items[0].click();items[4].click();await tick();assert.equal(stops,1);assert(f.events.includes('open'));assert.equal(items[3].enabled,true);
 dispose();items[4].click();assert.equal(stops,1);await f.controller.finish(publicId);
});

 test('current Engine post-Cancel unavailable guard cannot be relabelled positive input drain or close',async()=>{
 const f=fixture();await f.ready();
 const status=await f.capture.cancel({captureId:cid,ownerToken:owner});assert.equal(status.state,'cancelled');
 await f.controller.finish(publicId);assert.equal(f.nativeSealed(),true);
 assert.equal((await f.controller.port.read()).phase,'unavailable');assert.equal(f.controller.localDrain(),'unknown');assert.equal(f.controller.beginClose(),false);
 assert(f.events.includes('finishInkProducer'));assert(!f.events.includes('submitInkEvents'));
 });
