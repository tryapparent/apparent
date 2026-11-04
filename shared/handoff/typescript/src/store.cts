import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse as parseLossless, stringify as stringifyLossless, isLosslessNumber } from 'lossless-json';
import { openAt, renameAt, unlinkAt, tryLock, unlock } from './native.cjs';

export type Config = Record<string, unknown>;
export type Checkpoint = 'snapshot'|'beforePublish'|'beforeDirectorySync';
export type UpdateOptions = {
  signal?: AbortSignal;
  timeoutMs?: number|null;
  admit?: () => boolean|Promise<boolean>;
  checkpoint?: (stage:Checkpoint) => void|Promise<void>;
};

export class StoreError extends Error {
  constructor(readonly code:string, readonly published=false) {
    super(code); this.name='StoreError';
  }
}
export class ConfigPublicationUncertain extends StoreError {
  constructor() { super('outcome-unknown',true); this.name='ConfigPublicationUncertain'; }
}

const C=fs.constants;
const modeOf=(stat:fs.BigIntStats)=>Number(stat.mode & 0o7777n);
const fail=(code:string):never=>{throw new StoreError(code);};

function safeValue(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(safeValue);
  if(value && typeof value==='object') {
    if(isLosslessNumber(value)) return value;
    const result=Object.create(null) as Record<string,unknown>;
    for(const key of Object.keys(value)) Object.defineProperty(result,key,{value:safeValue((value as Record<string,unknown>)[key]),enumerable:true,writable:true,configurable:true});
    return result;
  }
  return value;
}

export function parseJson(raw:string):unknown {
  try {
    return safeValue(parseLossless(raw,undefined,{onDuplicateKey:({newValue})=>newValue}));
  } catch { throw new StoreError('invalid-json'); }
}

export function stringifyJson(value:unknown,pretty=false):string {
  try {
    const result=stringifyLossless(value,undefined,pretty?2:undefined);
    if(result===undefined) throw new Error();
    return result;
  }
  catch { throw new StoreError('invalid-json-value'); }
}

function objectConfig(value:unknown):Config {
  if(value===null || typeof value!=='object' || Array.isArray(value) || isLosslessNumber(value)) fail('invalid-config');
  return value as Config;
}

function stat(fd:number):fs.BigIntStats {
  try { return fs.fstatSync(fd,{bigint:true}); }
  catch { return fail('config-read-failed'); }
}
function closeFd(fd:number|undefined):void {
  if(fd===undefined) return;
  try { fs.closeSync(fd); } catch { /* release best-effort during unwind */ }
}
function nativeCode(error:unknown):string|undefined {
  if(error && typeof error==='object' && 'code' in error && typeof error.code==='string') return error.code;
  return undefined;
}
function ioError(error:unknown,phase:'path'|'lock'|'read'|'write'):StoreError {
  const code=nativeCode(error);
  if(phase==='path') return new StoreError('unsafe-path');
  if(phase==='lock') return new StoreError(code==='ETIMEDOUT'?'lock-timeout':'lock-failed');
  if(phase==='read') return new StoreError(code==='ENOENT'?'config-read-failed':'config-read-failed');
  return new StoreError('config-write-failed');
}
function trustedDir(fd:number,privateAncestor:boolean,euid:bigint):{privateAncestor:boolean;final:boolean} {
  const s=stat(fd), mode=modeOf(s), uid=s.uid;
  if((uid!==0n && uid!==euid) || ((mode&0o022)!==0 && (mode&0o1000)===0 && !privateAncestor)) fail('unsafe-path');
  return {privateAncestor:privateAncestor || (mode&0o077)===0,final:false};
}
function pathParts(input:string|Buffer):{parent:string|Buffer;name:string|Buffer} {
  if(typeof input==='string') {
    if(input.length===0 || input.includes('\0')) fail('unsafe-path');
    const name=path.basename(input);
    if(!name || name==='.' || name==='..') fail('unsafe-path');
    return {parent:path.dirname(input)||'.',name};
  }
  if(input.length===0 || input.includes(0)) fail('unsafe-path');
  let end=input.length;
  while(end>1 && input[end-1]===0x2f) end--;
  const normalized=input.subarray(0,end);
  const slash=normalized.lastIndexOf(0x2f);
  const name=slash<0?normalized:normalized.subarray(slash+1);
  if(name.length===0 || name.equals(Buffer.from('.')) || name.equals(Buffer.from('..'))) fail('unsafe-path');
  const parent=slash<0?Buffer.from('.'):(slash===0?Buffer.from('/'):normalized.subarray(0,slash));
  return {parent,name};
}

function openPinnedParent(parent:string|Buffer):number {
  let fd:number|undefined;
  try {
    // The JS realpath implementation decodes Buffer paths and corrupts invalid
    // UTF-8 names; the native syscall implementation preserves POSIX bytes.
    const canonical=fs.realpathSync.native(parent,{encoding:'buffer'});
    // Open the root explicitly, then walk only canonical single components with
    // openat so final publication stays pinned to the resolved directory inode.
    if(canonical.length===0 || canonical[0]!==0x2f || canonical.includes(0)) fail('unsafe-path');
    fd=fs.openSync(Buffer.from('/'),C.O_RDONLY|(C.O_DIRECTORY??0)|(C.O_NOFOLLOW??0));
    const euid=BigInt(process.geteuid!());
    let privateAncestor=false;
    const components:Buffer[]=[];
    let start=1;
    for(let index=1;index<=canonical.length;index++) {
      if(index===canonical.length || canonical[index]===0x2f) {
        if(index>start) components.push(canonical.subarray(start,index));
        start=index+1;
      }
    }
    for(const component of components) {
      const next=openAt(fd,component,C.O_RDONLY|(C.O_DIRECTORY??0));
      let trust:{privateAncestor:boolean;final:boolean};
      try { trust=trustedDir(next,privateAncestor,euid); }
      catch(error) { closeFd(next); throw error; }
      privateAncestor=trust.privateAncestor;
      closeFd(fd); fd=next;
    }
    const s=stat(fd),mode=modeOf(s);
    if(s.uid!==euid || ((mode&0o022)!==0 && !privateAncestor)) fail('unsafe-path');
    return fd;
  } catch(error) {
    closeFd(fd);
    if(error instanceof StoreError) throw error;
    throw ioError(error,'path');
  }
}

async function admitted(options:UpdateOptions):Promise<void> {
  if(options.signal?.aborted) throw new StoreError('cancelled');
  if(options.admit && !await options.admit()) throw new StoreError('cancelled');
  if(options.signal?.aborted) throw new StoreError('cancelled');
}
async function pause(ms:number,signal?:AbortSignal):Promise<void> {
  if(signal?.aborted) throw new StoreError('cancelled');
  await new Promise<void>((resolve,reject)=>{
    const finish=(error?:StoreError)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(new StoreError('cancelled'));
    const timer=setTimeout(()=>finish(),ms);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted) abort();
  });
}
async function checkpoint(options:UpdateOptions,stage:Checkpoint):Promise<void> {
  try { await options.checkpoint?.(stage); }
  catch(error) { if(error instanceof StoreError) throw error; throw new StoreError('config-write-failed'); }
}
function readConfig(dirfd:number,name:string|Buffer):Config {
  let fd:number|undefined;
  try {
    fd=openAt(dirfd,name,C.O_RDONLY|(C.O_NONBLOCK??0));
    const s=stat(fd);
    if(!s.isFile()) fail('invalid-config');
    const bytes=fs.readFileSync(fd);
    let raw:string;
    try { raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
    catch { fail('invalid-config'); }
    return objectConfig(parseJson(raw!));
  } catch(error) {
    if(error instanceof StoreError) throw error;
    if(nativeCode(error)==='ENOENT') return Object.create(null) as Config;
    throw ioError(error,'read');
  } finally { closeFd(fd); }
}

export async function updateConfig(pathValue:string|Buffer,edit:(config:Config)=>void|Promise<void>,options:UpdateOptions={}):Promise<void> {
  let dirfd:number|undefined,lockfd:number|undefined,tmpfd:number|undefined;
  let tmpName:string|undefined,published=false,locked=false;
  const timeout=options.timeoutMs===undefined?3000:options.timeoutMs;
  if(timeout!==null && (!Number.isFinite(timeout)||timeout<0)) throw new StoreError('invalid-request');
  try {
    const {parent,name}=pathParts(pathValue);
    try { fs.mkdirSync(parent,{recursive:true,mode:0o700}); }
    catch(error) { throw ioError(error,'path'); }
    dirfd=openPinnedParent(parent);
    const lockName=Buffer.concat([Buffer.isBuffer(name)?name:Buffer.from(name),Buffer.from('.lock')]);
    lockfd=openAt(dirfd,lockName,C.O_RDWR|C.O_CREAT|(C.O_NONBLOCK??0),0o600);
    const first=stat(lockfd);
    if(!first.isFile() || first.uid!==BigInt(process.geteuid!()) || (modeOf(first)&0o077)!==0 || first.nlink!==1n) fail('unsafe-lock');
    const deadline=timeout===null?Infinity:performance.now()+timeout;
    while(true) {
      await admitted(options);
      try {
        if(tryLock(lockfd)) { locked=true; break; }
      } catch(error) { throw ioError(error,'lock'); }
      if(performance.now()>=deadline) throw new StoreError('lock-timeout');
      await pause(20,options.signal);
    }
    const currentfd=openAt(dirfd,lockName,C.O_RDONLY|(C.O_NONBLOCK??0));
    try {
      const current=stat(currentfd),held=stat(lockfd);
      if(current.dev!==first.dev || current.ino!==first.ino || held.dev!==first.dev || held.ino!==first.ino ||
        current.nlink!==1n || held.nlink!==1n) fail('unsafe-lock');
    } finally { closeFd(currentfd); }

    const config=readConfig(dirfd,name);
    await checkpoint(options,'snapshot');
    await admitted(options);
    await edit(config);
    objectConfig(config);
    const bytes=Buffer.from(stringifyJson(config,true)+'\n','utf8');
    tmpName=`.config-${randomUUID()}.tmp`;
    tmpfd=openAt(dirfd,tmpName,C.O_WRONLY|C.O_CREAT|C.O_EXCL,0o600);
    let offset=0;
    while(offset<bytes.length) {
      const written=fs.writeSync(tmpfd,bytes,offset,bytes.length-offset,null);
      if(written<=0) throw new StoreError('config-write-failed');
      offset+=written;
    }
    fs.fsyncSync(tmpfd);
    await checkpoint(options,'beforePublish');
    await admitted(options);
    renameAt(dirfd,tmpName,name);
    published=true; tmpName=undefined;
    await checkpoint(options,'beforeDirectorySync');
    fs.fsyncSync(dirfd);
  } catch(error) {
    if(published) throw new ConfigPublicationUncertain();
    if(error instanceof StoreError) throw error;
    throw ioError(error,dirfd===undefined?'path':lockfd===undefined?'lock':'write');
  } finally {
    if(tmpName!==undefined && dirfd!==undefined) { try { unlinkAt(dirfd,tmpName); } catch { /* cleanup is best-effort */ } }
    if(locked && lockfd!==undefined) { try { unlock(lockfd); } catch { /* closing also releases the lock */ } }
    closeFd(tmpfd); closeFd(lockfd); closeFd(dirfd);
  }
}
