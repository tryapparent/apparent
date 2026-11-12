// One package writer; Hermes retains activation and dependency consent.
import {lstat, readFile, mkdir, writeFile, open, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
async function safe(directory: string) {
  const parts=path.resolve(directory).split(path.sep).filter(Boolean);
  let current=path.parse(directory).root;
  for(const part of parts) {
    current=path.join(current,part);
    await mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const info=await lstat(current);
    if ((info.uid !== process.getuid!() && info.uid !== 0) || ((info.mode & 0o022) && !(info.uid === 0 && (info.mode & 0o1000)))) throw Error('Refusing untrusted writable ancestor');
    if(!info.isDirectory() || info.isSymbolicLink())throw Error('Refusing unsafe profile/package directory');
  }
}
async function nofollow(file:string) {const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{return await handle.readFile();}finally{await handle.close();}}
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
export async function install(source: string, profile: string) {
  if(!path.isAbsolute(profile))throw Error('Profile must be absolute');
  const manifest=await readFile(path.join(source,'package-files.json'));
  const files=JSON.parse(manifest.toString()) as Record<string,string>;
  // macOS exposes its OS-owned temporary root through /tmp -> /private/tmp.
  if(process.platform==='darwin' && profile.startsWith('/tmp/'))profile=path.join(await realpath('/tmp'),profile.slice(5));
  const target=path.join(profile,'plugins/apparent');
  await safe(target);
  const pending:{name:string;data:Buffer}[]=[];
  // Validate every existing owned file before filling any missing file.
  for(const [name,digest] of Object.entries(files)) {
    if(!name || name.split('/').some(part=>!part || part==='.' || part==='..') || path.isAbsolute(name) || name.includes('\\'))throw Error('Unsafe package path');
    const data=await readFile(path.join(source,name));
    if(hash(data)!==digest)throw Error('Package checksum mismatch: '+name);
    await safe(path.dirname(path.join(target,name)));
    try {
      const info=await lstat(path.join(target,name));
      if(!info.isFile() || info.isSymbolicLink() || hash(await nofollow(path.join(target,name)))!==digest)throw Error('Existing modified package file: '+name);
    } catch(error) {if(error.code!=='ENOENT')throw error;pending.push({name,data});}
  }
  for(const {name,data} of pending) {
    await safe(path.dirname(path.join(target,name)));
    const handle=await open(path.join(target,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(data);}finally{await handle.close();}
  }
  // Manifest is informative; installation decisions always use the verified source.
  await writeFile(path.join(target,'package-files.json'),manifest,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  return target;
}
if(process.argv.includes('--profile')) {
 const profile=process.argv[process.argv.indexOf('--profile')+1];
 if(!profile)throw Error('Usage: node install.cjs --profile /absolute/profile');
 install(path.join(path.dirname(path.resolve(process.argv[1])),'apparent'),profile).then(console.log).catch(error=>{console.error(error.message);process.exitCode=1;});
}
