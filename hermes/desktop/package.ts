// Generate a complete release outside Git; never resolve Desktop build dependencies.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination) || !destination.startsWith('/tmp/apparent-dev-')) throw Error('Use an absolute per-job /tmp/apparent-dev-… package directory');
const { build } = createRequire(import.meta.url)('esbuild');
await mkdir(destination, { recursive: false, mode: 0o700 });
const target = path.join(destination, 'apparent');
await mkdir(target);
for (const entry of ['__init__.py','adapter.py','process.py','evidence.py','plugin.yaml','skills','README.md']) await cp(path.join(root,entry),path.join(target,entry),{recursive:true});
const version = (await readFile(path.join(root,'plugin.yaml'),'utf8')).match(/^version: "(\d+\.\d+\.\d+)"$/m)?.[1];
if (!version) throw Error('Missing semantic plugin version');
await build({ entryPoints: [path.join(root, 'desktop/plugin.ts')], bundle: true, format: 'esm', platform: 'browser', external: ['@hermes/plugin-sdk', 'react/jsx-runtime'], outfile: path.join(target, 'desktop/plugin.js') });
await build({entryPoints:[path.join(root,'distribution/install.ts')],bundle:true,format:'cjs',platform:'node',outfile:path.join(destination,'install.cjs')});
await writeFile(path.join(target,'compatibility.json'), JSON.stringify({schema:1,plugin:'apparent',version,hermes: '>=0.23.0',platforms:['linux','darwin'],nodeInstaller:'>=22.23.0',apparent:{required:'installed full native app with apparent://hermes URL handler, capture handoff signed loopback bridge and inspect/fetch CLI',autoInstall:false},desktopSDK:['focusedSessionOwner','focusedSessionId','profileRoutes','requestProfile','retainProfile','composer.actions'],revision:process.env.HERMES_REVISION || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()},null,2)+'\n');
const files: Record<string,string> = {};
async function inventory(directory: string, prefix='') {
 for(const item of await readdir(directory,{withFileTypes:true})) {
  const name=prefix+item.name;
  if(item.isDirectory())await inventory(path.join(directory,item.name),name+'/');
  else files[name]=createHash('sha256').update(await readFile(path.join(directory,item.name))).digest('hex');
 }
}
await inventory(target);
await writeFile(path.join(target,'package-files.json'),JSON.stringify(files,null,2)+'\n');
const name = `apparent-hermes-${version}.tar.gz`;
execFileSync('tar',['-czf',path.join(destination,name),'-C',destination,'apparent','install.cjs']);
const checksum=createHash('sha256').update(await readFile(path.join(destination,name))).digest('hex');
await writeFile(path.join(destination,`${name}.sha256`),`${checksum}  ${name}\n`);
console.log(name);
