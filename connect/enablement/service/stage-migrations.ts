/** Preserve Wrangler/D1 ledger filenames while keeping source directories bounded. */
import {readdir,lstat,mkdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../service/',import.meta.url)),source=path.join(root,'migrations'),output=path.join(root,'.generated/migrations');
await mkdir(path.dirname(output),{recursive:true});
const parent=await lstat(path.dirname(output));if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('Unsafe migration build parent');
const stat=await lstat(output).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error('Unsafe migration build output');
const files=new Map<string,string>();
for(const directory of [source,path.join(source,'baseline')])for(const name of await readdir(directory)){
  if(directory===source&&name==='baseline')continue;
  const file=path.join(directory,name),entry=await lstat(file);
  if(!/^\d{4}\.sql$/.test(name)||!entry.isFile()||entry.isSymbolicLink()||files.has(name))throw Error('Invalid migration source');
  files.set(name,file);
}
if(!files.size)throw Error('Missing migrations');
await rm(output,{recursive:true,force:true});await mkdir(output,{mode:0o700});
for(const [name,file] of [...files].sort(([a],[b])=>a.localeCompare(b)))await copyFile(file,path.join(output,name));
