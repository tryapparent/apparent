/** Compare the actual reprocessed images and baseline-transcript summaries. */
import {accessSync,closeSync,constants,cpSync,existsSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
let binary=join(repository,'target/debug/apparent'),experiment='agentContext',destination:string|undefined;
const bundles:string[]=[];
const args=process.argv.slice(2);
for(let index=0;index<args.length;index++) {
  const arg=args[index];
  if(arg==='--') {bundles.push(...args.slice(index+1));break;}
  if(['--binary','--experiment','--out'].includes(arg)) {
    const value=args[++index]; if(!value||value.startsWith('--'))throw Error(`${arg} needs a value`);
    if(arg==='--binary')binary=resolve(value);
    else if(arg==='--experiment')experiment=value;
    else destination=resolve(value);
  } else if(arg.startsWith('--'))throw Error(`Unknown option: ${arg}`);
  else bundles.push(arg);
}
if(!bundles.length)throw Error('Pass explicit bundle paths; no private capture set is inferred.');
accessSync(binary,constants.X_OK);
const sources=bundles.map(bundle=>realpathSync(bundle));
const names=sources.map(bundle=>basename(bundle,'.apparent'));
if(new Set(names).size!==names.length)throw Error('Bundle names must be distinct in one comparison.');
if(destination) {
  destination=join(realpathSync(dirname(destination)),basename(destination));
  if(existsSync(destination))throw Error('Comparison output must be a fresh directory.');
  if(sources.some(bundle=>destination===bundle||destination!.startsWith(bundle+sep)))throw Error('Comparison output must be outside source bundles.');
}
const job=realpathSync(mkdtempSync('/tmp/apparent-dev-agent-eval-')),work=join(job,'work');
const output=destination||join(job,'report');
mkdirSync(work,{mode:0o700});mkdirSync(output,{mode:0o700});
try {
  let config:Record<string,unknown>={};
  const configSource=process.env.APPARENT_CONFIG||join(homedir(),'.config/apparent/config.json');
  if(existsSync(configSource)) {
    try {config=JSON.parse(readFileSync(configSource,'utf8'));}
    catch {throw Error('Cannot read baseline configuration as JSON.');}
    if(!config||Array.isArray(config)||typeof config!=='object')throw Error('Baseline configuration must be an object.');
  }
  delete config.experiments;
  const configPath=join(work,'config.json');writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  const env={...process.env,APPARENT_CONFIG:configPath};
  const run=(argv:string[],log:string)=>{
    const stdout=log+'.stdout',descriptor=openSync(stdout,'wx',0o600);
    let diagnostic:number|undefined;
    try {
      diagnostic=openSync(log,'wx',0o600);
      const result=spawnSync(binary,argv,{env,stdio:['ignore',descriptor,diagnostic]});
      if(result.error||result.status!==0)throw Error(`CLI failed; private logs: ${log} and ${stdout}`);
    } finally {if(diagnostic!==undefined)closeSync(diagnostic);closeSync(descriptor);}
    return stdout;
  };
  const version=readFileSync(run(['--version'],join(job,'version.log')),'utf8').trim();
  const index=[`# Apparent experiment ${JSON.stringify(experiment)}: before and after`,
    '',`CLI: ${version} (${binary}). Each bundle is reprocessed twice. Both summaries use the baseline transcript.`];
  let failed=false;
  for(const [ordinal,bundle] of sources.entries()) {
    const name=names[ordinal],dest=join(output,name);mkdirSync(dest,{mode:0o700});
    try {
      for(const variant of ['before','after']) {
        const path=join(work,`${ordinal}-${variant}.apparent`),base=join(work,`${ordinal}-before.apparent`);
        run(['reprocess',bundle,'--out',path,...(variant==='after'?['--experiment',experiment]:[])],join(job,`${ordinal}-${variant}.log`));
        const summary=variant==='before'?readFileSync(join(path,'summary.md'),'utf8'):
          readFileSync(run(['inspect',base,'--experiment',experiment],join(job,`${ordinal}-inspect.log`)),'utf8');
        writeFileSync(join(dest,`${variant}.md`),summary.replaceAll(base,bundle),{mode:0o600});
        cpSync(join(path,'contact-sheet.png'),join(dest,`${variant}-contact-sheet.png`));
        cpSync(join(path,'frames'),join(dest,`${variant}-frames`),{recursive:true});
      }
      index.push('',`## ${name}`,'',`Contact sheets: [before](${encodeURIComponent(name)}/before-contact-sheet.png) · [after](${encodeURIComponent(name)}/after-contact-sheet.png)`);
      for(const variant of ['before','after'])index.push('',`${variant}:`,'','```',readFileSync(join(dest,`${variant}.md`),'utf8'),'```');
      console.log(`${name}: compared`);
    } catch(error) {
      failed=true;const detail=error instanceof Error?error.message:String(error);
      index.push('',`## ${name}: comparison failed`,'',detail);console.error(`${name}: ${detail}`);
    }
  }
  const path=join(output,'index.md');writeFileSync(path,index.join('\n')+'\n',{mode:0o600});
  console.log(`Wrote ${path}`);if(failed)process.exitCode=1;
} finally {rmSync(work,{recursive:true,force:true});}
