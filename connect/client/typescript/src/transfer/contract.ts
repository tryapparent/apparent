/** Connect wire policy. No filesystem, Rust, Electron or crypto dependency. */
export const FILE_FORMAT = 'apparent-encrypted-v2';
export const LEGACY_FORMAT = 'apparent-encrypted-v1';
export type Asset = {path:string;size:number;sha256:string};
export type IndexedAsset = Asset & {object:string};
export type FileIndex = {version:2;context:FileContext;files:IndexedAsset[]};
export type FileContext = {origin:string;accountId:string;captureId:string;senderGrantId:string};
export type FileEnvelope = {signed:{version:2;context:FileContext;chunks:Asset[]};signature:string};
export function requireContract(value:unknown,code='invalid_encryption_manifest'):asserts value {if(!value)throw new Error(code);}
export const ordinaryPath=(p:unknown):p is string=>typeof p==='string' && p.length<=128 && /^(apparent\.json|notes\.json|summary\.md|contact-sheet(?:-full)?\.png|audio\.wav|recording\.(?:mp4|mov)|finish-trace\.json|timeline\.json|frames(?:-full)?\/frame-[0-9]+\.png)$/.test(p);
export const fileObjectPath=(p:unknown):p is string=>typeof p==='string' && /^sealed\/(index|file-[0-9]{6})\.age$/.test(p);
export function validateAssets(value:unknown,allowed:(p:unknown)=>boolean,max=514):Asset[] {
  requireContract(Array.isArray(value)&&value.length>0&&value.length<=max);
  let total=0;const seen=new Set<string>();
  return value.map(f=>{
    requireContract(f && Object.keys(f).sort().join(',')==='path,sha256,size' && allowed(f.path) && !seen.has(f.path) && Number.isSafeInteger(f.size) && f.size>=0 && f.size<=90000000 && typeof f.sha256==='string' && /^[a-f0-9]{64}$/.test(f.sha256));
    seen.add(f.path);total+=f.size;requireContract(total<=500000000,'quota_exceeded');
    return {path:f.path,size:f.size,sha256:f.sha256};
  });
}
export function fileTransport(value:unknown):Asset[] {
  const files=validateAssets(value,p=>p==='envelope.json'||fileObjectPath(p));
  requireContract(files.length>=3 && files.some(f=>f.path==='envelope.json'&&f.size>0&&f.size<=131072) && files.some(f=>f.path==='sealed/index.age'&&f.size>0&&f.size<=262144));
  const data=files.filter(f=>f.path!=='envelope.json'&&f.path!=='sealed/index.age').sort((a,b)=>a.path.localeCompare(b.path));
  data.forEach((f,i)=>requireContract(f.path===`sealed/file-${String(i).padStart(6,'0')}.age`&&f.size>0));
  return files;
}
export function validateIndex(value:unknown,context:FileContext,transport:Asset[]):FileIndex {
  const index=value as FileIndex;
  requireContract(index && Object.keys(index).sort().join(',')==='context,files,version' && index.version===2 && sameContext(index.context,context) && Array.isArray(index.files));
  const ordinary=validateAssets(index.files.map(f=>({path:f.path,size:f.size,sha256:f.sha256})),ordinaryPath,512);
  const objects=new Set<string>();
  for(const f of index.files){requireContract(Object.keys(f).sort().join(',')==='object,path,sha256,size' && /^sealed\/file-[0-9]{6}\.age$/.test(f.object)&&!objects.has(f.object)&&transport.some(t=>t.path===f.object));objects.add(f.object);}
  requireContract(objects.size===transport.length-2);
  for(const name of ['apparent.json','summary.md','contact-sheet.png'])requireContract(ordinary.some(f=>f.path===name),'missing_bundle_asset');
  requireContract(ordinary.find(f=>f.path==='apparent.json')!.size<=131072,'metadata_too_large');
  return index;
}
export function sameContext(a:FileContext,b:FileContext):boolean {
  return !!a && Object.keys(a).sort().join(',')==='accountId,captureId,origin,senderGrantId' && ['origin','accountId','captureId','senderGrantId'].every(k=>a[k as keyof FileContext]===b[k as keyof FileContext]);
}
export function selectedAssets(index:FileIndex,selection?:string[]):IndexedAsset[] {
  if(selection===undefined)return index.files;
  requireContract(selection.length>0&&new Set(selection).size===selection.length&&selection.every(ordinaryPath),'invalid_file_selection');
  const files=selection.map(name=>index.files.find(f=>f.path===name));
  requireContract(files.every(Boolean),'capture_file_not_found');return files as IndexedAsset[];
}
export function indexRequests(files:Asset[]):Asset[]{return ['envelope.json','sealed/index.age'].map(name=>{const file=files.find(f=>f.path===name);requireContract(file);return file;});}
export function signedFileBytes(signed:FileEnvelope['signed']):Uint8Array {
  const {origin,accountId,captureId,senderGrantId}=signed.context;
  return new TextEncoder().encode('apparent-encrypted-v2\0signed-envelope\0'+JSON.stringify({version:2,context:{origin,accountId,captureId,senderGrantId},chunks:signed.chunks.map(({path,size,sha256})=>({path,size,sha256}))}));
}
