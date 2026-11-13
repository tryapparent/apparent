import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {startConnect, type ConnectBridge} from '../../src/connect/consent.ts';
import type {ConnectAction, ConnectSettings, ConnectView} from '../../src/connect/protocol.ts';

// Synthetic hook scheduling only: this is not React renderer or native proof.
// Resolve the existing minimal locked compiler, not frontend dependencies.
const require=createRequire(new URL('../onboarding/package.json',import.meta.url));
const ts=require('typescript');
const code=ts.transpileModule(readFileSync(new URL('../../src/connect/flow.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const disconnected:ConnectSettings={status:'disconnected'};
const consent:ConnectSettings={status:'connected',view:{title:'apparent',status:'',detail:'',note:'',server:null,userCode:null,verificationUri:null,phase:'consent',buttons:[{command:'allow',title:'Allow',enabled:true}]}};
const approval:ConnectSettings={...consent,view:{...consent.view,phase:'approval',buttons:[],verificationUri:'https://synthetic.example/connect/device?code=ABC'}};
function deferred<T>(){
  let resolve!:(value:T)=>void, reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});
  return {promise,resolve,reject};
}
type Flow={result:ConnectSettings;view:ConnectView|undefined;busy:boolean;browserFailed:boolean;request:(action:ConnectAction)=>Promise<ConnectSettings|undefined>};
function harness(bridge:ConnectBridge){
  const slots:unknown[]=[];
  const effects=new Map<number,{deps:unknown[];cleanup?:()=>void}>();
  const queued:(()=>void)[]=[];
  const timers=new Set<()=>void>();
  let cursor=0,dirty=true,mounted=true;
  const react={
    useState<T>(initial:T){const slot=cursor++;if(!(slot in slots))slots[slot]=initial;return [slots[slot],(next:T)=>{slots[slot]=next;dirty=true}];},
    useRef<T>(initial:T){const slot=cursor++;if(!(slot in slots))slots[slot]={current:initial};return slots[slot];},
    useEffect(effect:()=>void|(()=>void),deps:unknown[]){
      const slot=cursor++,previous=effects.get(slot);
      if(previous&&deps.length===previous.deps.length&&deps.every((dep,i)=>Object.is(dep,previous.deps[i])))return;
      queued.push(()=>{previous?.cleanup?.();effects.set(slot,{deps,cleanup:effect()??undefined});});
    },
  };
  const exports:{useConnectFlow?:(bridge:ConnectBridge)=>Flow}={};
  runInNewContext(code,{exports,require:(name:string)=>{
    if(name==='react')return react;
    if(name==='./consent.ts')return {startConnect}; // real extracted implementation
    throw Error(`Unexpected hook dependency: ${name}`);
  },setInterval:(callback:()=>void)=>{timers.add(callback);return callback},clearInterval:(callback:()=>void)=>timers.delete(callback)});
  let flow:Flow;
  function render(){if(!mounted||!dirty)return;dirty=false;cursor=0;flow=exports.useConnectFlow!(bridge);while(queued.length)queued.shift()!();}
  render();
  return {
    get flow(){return flow},
    async flush(){for(let i=0;i<20;i++){await Promise.resolve();render();}},
    tick(){for(const callback of timers)callback()},
    get timerCount(){return timers.size},
    unmount(){mounted=false;for(const effect of effects.values())effect.cleanup?.();},
  };
}

test('mount opens once, polling reads, and unmount closes without enrollment',async()=>{
  const calls:string[]=[];let current! :()=>boolean;
  const h=harness({open:async active=>{calls.push('open');current=active;return disconnected},read:async()=>{calls.push('read');return disconnected},command:async action=>{calls.push(action);return consent},close:()=>{calls.push('close')}});
  assert.equal(h.flow.busy,true);await h.flush();assert.equal(h.flow.busy,false);
  assert.equal(current(),true);h.tick();await h.flush();h.unmount();
  assert.equal(current(),false);assert.equal(h.timerCount,0);assert.deepEqual(calls,['open','read','close']);
});
test('command waits for pending initial read, blocks duplicate actions and polls, then admits once',async()=>{
  const read=deferred<ConnectSettings>(),allow=deferred<ConnectSettings>();const calls:string[]=[];
  const h=harness({read:()=>{calls.push('read');return read.promise},command:async action=>{calls.push(action);return action==='connect'?consent:allow.promise}});
  const pending=h.flow.request('connect');await h.flush();assert.equal(h.flow.busy,true);
  assert.equal(await h.flow.request('connect'),undefined);h.tick();await h.flush();assert.deepEqual(calls,['read']);
  read.resolve(disconnected);await h.flush();assert.deepEqual(calls,['read','connect','allow']);assert.equal(h.flow.busy,true);
  allow.resolve(disconnected);assert.equal(await pending,disconnected);await h.flush();assert.equal(h.flow.busy,false);h.unmount();
});
test('unmount during read prevents a waiting command and during connect prevents allow',async()=>{
  for(const stage of ['read','connect']){
    const wait=deferred<ConnectSettings>(),calls:string[]=[];
    const h=harness({read:async()=>{calls.push('read');return stage==='read'?wait.promise:disconnected},command:async action=>{calls.push(action);return wait.promise}});
    if(stage==='connect')await h.flush();
    const pending=h.flow.request('connect');await h.flush();h.unmount();wait.resolve(consent);await pending;await h.flush();
    assert.deepEqual(calls,stage==='read'?['read']:['read','connect']);
  }
});
test('read and command rejection report error and release busy without replay',async()=>{
  const calls:string[]=[];
  const h=harness({read:async()=>{calls.push('read');throw Error('read')},command:async action=>{calls.push(action);throw Error('command')}});
  await h.flush();assert.equal(h.flow.result.status,'error');assert.equal(h.flow.busy,false);
  await h.flow.request('connect');await h.flush();assert.equal(h.flow.result.status,'error');assert.equal(h.flow.busy,false);
  assert.deepEqual(calls,['read','connect']);h.unmount();
});
test('passive approval never opens browser; owned approval opens once with explicit recovery',async()=>{
  const calls:string[]=[];let browserAttempts=0;
  const h=harness({read:async()=>approval,command:async action=>{
    calls.push(action);
    if(action==='connect')return consent;
    if(action==='open-browser'&&++browserAttempts===1)return {status:'error'};
    return approval;
  }});
  await h.flush();h.tick();await h.flush();assert.deepEqual(calls,[]);
  const connecting=h.flow.request('connect');await h.flush();await connecting;await h.flush();
  assert.deepEqual(calls,['connect','allow','open-browser']);assert.equal(h.flow.browserFailed,true);assert.equal(h.flow.busy,false);
  h.tick();await h.flush();assert.deepEqual(calls,['connect','allow','open-browser']);
  await h.flow.request('open-browser');await h.flush();assert.equal(h.flow.browserFailed,false);
  h.tick();await h.flush();assert.deepEqual(calls,['connect','allow','open-browser','open-browser']);h.unmount();
});
test('disable relinquishes browser ownership and rejected browser opening requires explicit retry',async()=>{
  const calls:string[]=[];
  const h=harness({read:async()=>approval,command:async action=>{calls.push(action);if(action==='connect')return consent;if(action==='open-browser')throw Error('browser');return approval}});
  await h.flush();const connecting=h.flow.request('connect');await h.flush();await connecting;await h.flush();assert.equal(h.flow.browserFailed,true);
  await h.flow.request('disable');await h.flush();h.tick();await h.flush();
  assert.deepEqual(calls,['connect','allow','open-browser','disable']);assert.equal(h.flow.busy,false);h.unmount();
});
