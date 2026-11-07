import { createNativeInkRelay, type NativeInkSourcePort, type NativeInkObservation, type NativeInkSink } from '@apparent/native-host/ink';
import type { CapabilitySnapshot } from '@apparent/record/capabilities';
import type { SqliteCaptureMappingStore } from '@apparent/record/host';
import { validateCaptureRequest, type CaptureClient } from '@apparent/engine-sdk/capture';
import type { DrawingAction, DrawingHostPort, DrawingSnapshot } from './wire.ts';

type Relay=ReturnType<typeof createNativeInkRelay>;
type Scope='none'|'unconfirmed'|'drained';
const clone=<T>(value:T):T=>structuredClone(value);
async function before<T>(work:Promise<T>,deadline:number):Promise<T>{
  const remaining=deadline-performance.now();if(remaining<=0)throw Error('Drawing drain deadline');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const value=await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Drawing drain deadline')),remaining);})]);
    if(performance.now()>=deadline)throw Error('Drawing drain deadline');return value;
  }finally{if(timer)clearTimeout(timer);}
}

/** One local borrower over the SAME original public Record mapping and owning
 * SDK. This owns input relay only, never recording/output policy or a journal. */
export function createDrawingController(options:{
  capture:Pick<CaptureClient,'inspect'>&NativeInkSink;
  mapping:SqliteCaptureMappingStore['getByRequestId'];
  nativeIdentity():Promise<NativeInkObservation['host']>;
  source(original:{captureId:string;source:{id:string;generation:string}},host:NativeInkObservation['host']):NativeInkSourcePort;
}){
  let current:DrawingSnapshot={phase:'idle',revision:0};
  let admission:'open'|'checking-close'|'closed'='open';
  let scope:Scope='none',relay:Relay|undefined;
  let beginFlight:Promise<void>|undefined,loopFlight:Promise<void>|undefined,finishFlight:Promise<void>|undefined,actionFlight:Promise<unknown>|undefined;
  const listeners=new Set<(snapshot:DrawingSnapshot)=>void>();
  const publish=(update:Partial<DrawingSnapshot>)=>{
    const next={...current,...update};
    if(Object.keys(update).length&&JSON.stringify({...next,revision:0})===JSON.stringify({...current,revision:0}))return;
    current={...next,revision:current.revision+1};
    for(const fn of [...listeners]){try{fn(clone(current));}catch{listeners.delete(fn);}}};
  const unavailable=()=>publish({phase:'unavailable'});
  const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
  const refreshBoard=async()=>{
    const observed=await relay!.readBoard();
    publish({board:{open:observed.open,strokeCount:observed.strokeCount,activeGesture:observed.activeGesture}});
  };
  async function begin(requestId:string){
    if(admission!=='open'||scope==='unconfirmed'||!['idle','complete','unavailable'].includes(current.phase))return;
    scope='none';relay=undefined;finishFlight=undefined;
    current={phase:'preparing',revision:current.revision+1,captureRequestId:requestId};publish({});
    const work=(async()=>{
      const mapping=await options.mapping(requestId);if(!mapping?.capture2Intent)throw Error('Original mapping unavailable');
      const intent=JSON.parse(mapping.capture2Intent);
      validateCaptureRequest({channel:'capture',protocolVersion:2,clientId:'a'.repeat(32),rpcId:'b'.repeat(32),method:'start',
        captureId:mapping.captureId,ownerToken:mapping.ownerToken,bundleId:mapping.bundleId,bundlePath:mapping.bundlePath,
        source:intent.source,options:intent.options,invocation:intent.invocation});
      const status=await options.capture.inspect({captureId:mapping.captureId,ownerToken:mapping.ownerToken},2000);
      if(status.captureId!==mapping.captureId||status.state!=='recording'||current.phase!=='preparing')throw Error('Original capture not recording');
      const host=await options.nativeIdentity();
      if(current.phase!=='preparing')throw Error('Drawing admission sealed');
      const original={captureId:mapping.captureId,source:{id:intent.source.id,generation:intent.source.generation}};
      const native=options.source(original,host);
      const source:NativeInkSourcePort={...native,activateInput(...args){if(current.phase!=='preparing')throw Error('Drawing admission sealed before input dispatch');scope='unconfirmed';return native.activateInput(...args);}};
      relay=createNativeInkRelay({source,sink:options.capture,original:{...original,ownerToken:mapping.ownerToken},ownedHost:host});
      await relay.register();
      if(current.phase!=='preparing')return;
      await refreshBoard();publish({phase:'ready'});
      loopFlight=(async()=>{
        while(current.phase==='ready'){
          const forwarded=await relay!.forwardNext();
          if(forwarded&&current.phase==='ready')await refreshBoard();
          if(current.phase==='ready')await sleep(25);
        }
      })().catch(unavailable).finally(()=>{loopFlight=undefined;});
    })();
    beginFlight=work.catch(()=>{if(current.phase!=='draining')unavailable();}).finally(()=>{beginFlight=undefined;});
    await beginFlight;
  }
  function finish(requestId:string):Promise<void>{
    if(requestId!==current.captureRequestId)return Promise.resolve();
    if(finishFlight)return finishFlight;
    if(current.phase==='complete'||current.phase==='idle')return Promise.resolve();
    const deadline=performance.now()+2000;publish({phase:'draining'});
    finishFlight=(async()=>{
      if(beginFlight)await before(beginFlight,deadline);
      if(actionFlight)await before(actionFlight,deadline);
      if(loopFlight)await before(loopFlight,deadline);
      if(!relay||relay.phase()!=='ready')throw Error('Original drawing registration unavailable');
      await before(relay.finish(Math.max(1,Math.floor(deadline-performance.now()))),deadline);
      scope='drained';publish({phase:'complete',...(current.board?{board:{...current.board,open:false,activeGesture:false}}:{})});
    })().catch(unavailable);
    return finishFlight;
  }
  const port:DrawingHostPort={
    async read(){return clone(current);},
    observe(fn){listeners.add(fn);fn(clone(current));return()=>listeners.delete(fn);},
    async act(action:DrawingAction){
      if(admission!=='open'||current.phase!=='ready'||actionFlight||action.captureRequestId!==current.captureRequestId||action.revision!==current.revision)return 'refused';
      const work:Promise<'requested'|'refused'|'outcome-unknown'>=(async()=>{try{
        const request=relay!.controlBoard(action.intent);
        const outcome=await request;
        if(outcome==='outcome-unknown'){publish({controlOutcome:'unknown'});if(current.phase==='ready')unavailable();}
        else if(outcome==='requested'&&current.phase==='ready'){
          try{await refreshBoard();}catch{unavailable();}
        }
        return outcome;
      }catch{publish({controlOutcome:'unknown'});if(current.phase==='ready')unavailable();return 'outcome-unknown';}
      })();actionFlight=work;
      try{return await work;}finally{actionFlight=undefined;}
    },
  };
  return {port,finish,
    observe(snapshot:CapabilitySnapshot){
      const active=snapshot.captures.filter(c=>c.phase==='recording');
      if(active.length===1&&active[0].captureId!==current.captureRequestId)void begin(active[0].captureId);
      const owned=snapshot.captures.find(c=>c.captureId===current.captureRequestId);
      if(owned&&!['starting','recording'].includes(owned.phase))void finish(owned.captureId);
    },
    localDrain(){return current.phase!=='draining'&&!beginFlight&&!loopFlight&&!actionFlight&&scope!=='unconfirmed'?'clear' as const:'unknown' as const;},
    beginClose(){if(current.phase==='draining'||beginFlight||loopFlight||actionFlight||scope==='unconfirmed')return false;if(admission==='checking-close')return false;if(admission==='open')admission='checking-close';return true;},
    settleClose(clear:boolean,recordAdmission:'open'|'closed'){admission=!clear&&recordAdmission==='open'?'open':'closed';},
  };
}
