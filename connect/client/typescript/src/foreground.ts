// Foreground transfer policy. Native capabilities retain credentials, safe file
// reads and encryption; no job, retry timer or upload intent is persisted here.
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

export type Asset = {path:string; size:number; sha256:string};
export type Upload = {id:string; server:string; format:'plaintext-v1'|'apparent-encrypted-v1'; files:Asset[]; share:boolean};
export type Operation = {operation:'reserve'|'complete'|'verify'|'share'} | {operation:'put'; index:number};
export type Progress = {state:'uploading'|'verifying'|'ready'; uploadedBytes:number; totalBytes:number};
export type Port = {request(operation:Operation):Promise<unknown>; progress(value:Progress):Promise<void>};
const fail = ():never => {throw new Error('upload_failed');};
const object = (v:unknown):Record<string,unknown> => v !== null && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : fail();

function admission(input:Upload):Upload {
  if (!/^[a-f0-9]{32}$/.test(input.id) || !['plaintext-v1','apparent-encrypted-v1'].includes(input.format)
      || typeof input.share!=='boolean' || input.share && input.format!=='plaintext-v1') fail();
  const url = new URL(input.server);
  if (url.origin!==input.server || url.username || url.password || !(url.protocol==='https:' || url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) fail();
  if (!Array.isArray(input.files) || !input.files.length || input.files.length>512) fail();
  let total=0; const names=new Set<string>();
  const files=input.files.map(file=>{
    if (typeof file.path!=='string' || file.path.length>128 || !/^[a-zA-Z0-9./_-]+$/.test(file.path)
      || file.path.split('/').some(p=>!p || p==='.' || p==='..') || names.has(file.path)
      || !Number.isSafeInteger(file.size) || file.size<0 || file.size>90_000_000 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail();
    names.add(file.path); total+=file.size; if(total>500_000_000) fail();
    return {...file};
  });
  return {...input,files};
}

// Adapted from the preserved sender transport: exact completion readback remains
// mandatory, while grouped transfers, durable spool/queue recovery and backoff go.
export async function uploadForeground(raw:Upload, port:Port):Promise<{id:string; url:string|null}> {
  const input=admission(raw), totalBytes=input.files.reduce((n,f)=>n+f.size,0);
  const response=(raw:unknown, status:'pending'|'ready'|null)=>{
    const r=object(raw);
    if(r.id!==input.id || status && r.status!==status || !['pending','ready'].includes(r.status as string)
      || (r.format ?? 'plaintext-v1')!==input.format) fail();
    return r;
  };
  await port.progress({state:'uploading',uploadedBytes:0,totalBytes});
  const reservation=response(await port.request({operation:'reserve'}),null);
  if(reservation.status!=='ready'){
    let uploadedBytes=0;
    for(let index=0;index<input.files.length;index++){
      await port.request({operation:'put',index});
      uploadedBytes+=input.files[index]!.size;
      await port.progress({state:'uploading',uploadedBytes,totalBytes});
    }
    response(await port.request({operation:'complete'}),'ready');
  }
  await port.progress({state:'verifying',uploadedBytes:totalBytes,totalBytes});
  const verified=response(await port.request({operation:'verify'}),'ready');
  const verifiedFiles=verified.files;
  if(!Array.isArray(verifiedFiles) || verifiedFiles.length!==input.files.length) return fail();
  const actual=new Map(verifiedFiles.map((raw:unknown)=>{const f=object(raw);return [f.path,f] as const;}));
  if(actual.size!==input.files.length || input.files.some(f=>actual.get(f.path)?.size!==f.size || actual.get(f.path)?.sha256!==f.sha256)) fail();
  let url:string|null=null;
  if(input.share){
    const shared=object(await port.request({operation:'share'}));
    const prefix=`${input.server}/s/`;
    if(shared.status!=='ready' || typeof shared.url!=='string' || !shared.url.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(shared.url.slice(prefix.length))) return fail();
    url=shared.url;
  }
  await port.progress({state:'ready',uploadedBytes:totalBytes,totalBytes});
  return {id:input.id,url};
}

async function stdio(){
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
  const read=async()=>{const row=await lines.next();if(row.done || Buffer.byteLength(row.value)>2_100_000) fail();return JSON.parse(row.value);};
  const write=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
  const exchange=async(value:unknown)=>{write(value);const reply=object(await read());if(reply.ok!==true)throw new Error('upload_failed');return reply.body;};
  try{
    const input=await read();
    const result=await uploadForeground(input,{request:exchange,progress:async value=>{await exchange({operation:'progress',...value});}});
    write({operation:'done',...result});
  }catch{write({operation:'error'});process.exitCode=1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)void stdio();
