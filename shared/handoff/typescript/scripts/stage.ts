// Stage the prebuilt-only config executor into the existing Settings runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const platformPackage=`@koromix/koffi-${process.platform}-${process.arch}`;

export async function stagePrepared(destination:string):Promise<void> {
  if(!['linux','darwin'].includes(process.platform)||!['x64','arm64'].includes(process.arch)) throw Error('Unsupported config runtime platform');
  if(await fs.lstat(destination).catch(()=>undefined)) throw Error('Config staging destination must not exist');
  const nativeRoot=path.dirname(require.resolve(platformPackage+'/package.json'));
  const nativeMeta=JSON.parse(await fs.readFile(path.join(nativeRoot,'package.json'),'utf8'));
  if(nativeMeta.version!=='3.3.4'||nativeMeta.name!==platformPackage) throw Error('Config native dependency does not match its lock');
  const losslessRoot=path.resolve(path.dirname(require.resolve('lossless-json')),'../..');
  const koffiRoot=path.dirname(require.resolve('koffi'));
  const dist=path.join(root,'dist');
  for(const entry of ['native.cjs','store.cjs','rpc.cjs']) if(!(await fs.stat(path.join(dist,entry))).isFile()) throw Error('Config executor has not been built');
  await fs.mkdir(destination,{recursive:true});
  await fs.cp(dist,destination,{recursive:true});
  const modules=path.join(destination,'node_modules');
  await fs.mkdir(path.join(modules,'@koromix'),{recursive:true});
  await fs.cp(nativeRoot,path.join(modules,platformPackage),{recursive:true});
  await fs.cp(losslessRoot,path.join(modules,'lossless-json'),{recursive:true});
  // Koffi's main loader/source builder is deliberately absent from deployment.
  // The executor loads only the exact platform's prebuilt Node-API binding.
  await fs.mkdir(path.join(destination,'licenses'),{recursive:true});
  await fs.copyFile(path.join(koffiRoot,'LICENSE.txt'),path.join(destination,'licenses/Koffi.txt'));
  await fs.writeFile(path.join(destination,'package.json'),JSON.stringify({private:true,type:'commonjs'})+'\n');
  const hash=createHash('sha256');
  for(const name of [...(await fs.readdir(path.join(root,'src'))).filter(name=>name.endsWith('.cts')).sort(), '../package-lock.json']) {
    hash.update(name);hash.update(await fs.readFile(path.join(root,'src',name)));
  }
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({schema:1,platform:process.platform,architecture:process.arch,
    nodeApi:8,dependency:'koffi@3.3.4',source:hash.digest('hex')})+'\n');
}

export async function prepare(offline=false):Promise<void> {
  const install=['ci','--ignore-scripts','--no-audit','--no-fund'];
  if(offline) install.push('--offline');
  execFileSync('npm',install,{cwd:root,stdio:'inherit'});
  execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const destination=process.argv[2];
  if(!destination) throw Error('Usage: stage.ts <new-destination>');
  await prepare();await stagePrepared(path.resolve(destination));
}
