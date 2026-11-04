// Private one-transaction pipe adapter for native callers. No socket, renderer
// endpoint, network or queue access. The TypeScript store owns every disk write.
import { isLosslessNumber } from 'lossless-json';
import { stdin, stdout } from 'node:process';
import { updateConfig, parseJson, stringifyJson, StoreError } from './store.cjs';
import type { Config, Checkpoint } from './store.cjs';

const MAX_FRAME = 32 * 1024 * 1024;
type Frame = Record<string, unknown>;
const object = (v:unknown):v is Frame => v !== null && typeof v === 'object' && !Array.isArray(v);
const owns = (v:object,key:string):boolean => Object.prototype.hasOwnProperty.call(v,key);
function protocol():never { throw new StoreError('invalid-request'); }
function frame(v:unknown,op:string,keys:string[]):Frame {
  if(!object(v) || v.v !== 1 || v.op !== op || Object.keys(v).some(key=>!['v','op',...keys].includes(key))) protocol();
  return v;
}

class Input {
  readonly abort = new AbortController();
  private buffer = Buffer.alloc(0);
  private waiting?: {resolve:(v:unknown)=>void;reject:(e:StoreError)=>void};
  private queued: unknown[] = [];
  private failure?: StoreError;
  constructor() {
    stdin.on('data',(chunk:Buffer)=>{
      if(this.failure) return;
      this.buffer=Buffer.concat([this.buffer,chunk]);
      if(this.buffer.length>MAX_FRAME) {this.stop();return;}
      let end:number;
      while((end=this.buffer.indexOf(10))>=0) {
        const bytes=this.buffer.subarray(0,end);this.buffer=this.buffer.subarray(end+1);
        try {
          const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
          if(this.waiting) {const wait=this.waiting;this.waiting=undefined;wait.resolve(value);}
          else if(this.queued.length===0) this.queued.push(value);
          else {this.stop();return;}
        } catch {this.stop();return;}
      }
    });
    stdin.on('end',()=>this.stop());stdin.on('error',()=>this.stop());
  }
  private stop():void {
    this.failure=new StoreError('cancelled');this.abort.abort();
    const wait=this.waiting;this.waiting=undefined;wait?.reject(this.failure);
  }
  next():Promise<unknown> {
    if(this.failure) return Promise.reject(this.failure);
    if(this.queued.length) return Promise.resolve(this.queued.shift());
    if(this.waiting) return Promise.reject(new StoreError('invalid-request'));
    return new Promise((resolve,reject)=>{this.waiting={resolve,reject};});
  }
}
function send(value:Frame):Promise<void> {
  const data=JSON.stringify(value)+'\n';
  if(Buffer.byteLength(data)>MAX_FRAME) return Promise.reject(new StoreError('invalid-request'));
  return new Promise((resolve,reject)=>stdout.write(data,error=>error?reject(new StoreError('cancelled')):resolve()));
}

// Patches describe the existing trusted native closure's intent, never a stale
// whole-config replacement. Native callers retain their current owner validation;
// direct TypeScript owners use scoped policy/CAS before entering this primitive.
function applyPatches(config:Config,raw:unknown):void {
  if(!Array.isArray(raw)) protocol();
  for(const item of raw) {
    if(!object(item) || Object.keys(item).some(key=>!['path','present','value'].includes(key)) ||
      !Array.isArray(item.path) || item.path.length===0 || item.path.length>128 ||
      !item.path.every((key:unknown)=>typeof key==='string') || typeof item.present!=='boolean' ||
      (item.present ? !owns(item,'value') : owns(item,'value'))) protocol();
    let parent:Frame=config;
    const keys=item.path as string[];
    for(const key of keys.slice(0,-1)) {
      if(!owns(parent,key) || !object(parent[key]) || isLosslessNumber(parent[key])) protocol();
      parent=parent[key] as Frame;
    }
    const key=keys[keys.length-1]!;
    if(item.present) Object.defineProperty(parent,key,{value:item.value,enumerable:true,writable:true,configurable:true});
    else delete parent[key];
  }
}

export async function runConfigRpc():Promise<void> {
  const input=new Input();
  stdout.on('error',()=>input.abort.abort());
  try {
    const first=frame(await input.next(),'begin',['path','guarded']);
    if(!Array.isArray(first.path) || first.path.length===0 || first.path.length>65536 ||
      !first.path.every((byte:unknown)=>Number.isInteger(byte) && (byte as number)>0 && (byte as number)<=255) ||
      typeof first.guarded!=='boolean') protocol();
    const path=Buffer.from(first.path as number[]);
    const admit=async()=>{
      await send({v:1,event:'admit'});
      const response=frame(await input.next(),'admit',['allowed']);
      if(typeof response.allowed!=='boolean') protocol();
      return response.allowed;
    };
    const checkpoint=async(stage:Checkpoint)=>{
      await send({v:1,event:'checkpoint',stage});
      const response=frame(await input.next(),'checkpoint',['continue']);
      if(typeof response.continue!=='boolean') protocol();
      if(!response.continue) throw new StoreError('cancelled');
    };
    await updateConfig(path,async config=>{
      await send({v:1,event:'snapshot',json:stringifyJson(config)});
      const reply=await input.next();
      if(object(reply) && reply.op==='abort') {frame(reply,'abort',[]);throw new StoreError('cancelled');}
      const change=frame(reply,'patch',['json']);
      if(typeof change.json!=='string') protocol();
      applyPatches(config,parseJson(change.json));
    },{signal:input.abort.signal,timeoutMs:first.guarded?3000:null,admit,checkpoint});
    await send({v:1,event:'result',ok:true,published:true});
  } catch(error) {
    const known=error instanceof StoreError ? error : new StoreError('config-write-failed');
    await send({v:1,event:'result',ok:false,code:known.code,published:known.published}).catch(()=>{});
    process.exitCode=1;
  } finally {
    stdin.pause();stdin.destroy();
  }
}

if(require.main===module) void runConfigRpc();
