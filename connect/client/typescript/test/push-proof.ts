// Opt-in execution proof, not a recursive member of npm test. Never pushes to
// GitHub: both the checkout and bare remote are isolated synthetic Git fixtures.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const source=fileURLToPath(new URL('../../../../',import.meta.url));
const job=mkdtempSync('/tmp/apparent-dev-fgp-');
const work=join(job,'work'),remote=join(job,'remote.git');
mkdirSync(work,{mode:0o700});
const env:NodeJS.ProcessEnv={...process.env,TMPDIR:job};
// A fixture must not inherit its caller's Git repository or nested test guard.
for(const key of Object.keys(env))if(key.startsWith('GIT_') || key==='NODE_TEST_CONTEXT')delete env[key];
function run(command:string,args:string[],cwd=work,extra:NodeJS.ProcessEnv={},input?:Buffer){
  const r=spawnSync(command,args,{cwd,env:{...env,...extra},input,encoding:'utf8',maxBuffer:64*1024*1024,timeout:600_000});
  if(r.error)throw r.error;
  assert.equal(r.status,0,`${command} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}
const sourceSha=run('git',['rev-parse','HEAD'],source);
const archive=spawnSync('git',['archive',sourceSha],{cwd:source,env,maxBuffer:512*1024*1024});
assert.equal(archive.status,0);
run('tar',['-xf','-'],work,{},archive.stdout);
run('git',['init','-q','-b','main']);
run('git',['config','user.name','Foreground push fixture']);
run('git',['config','user.email','fixture@example.invalid']);
run('git',['config','commit.gpgsign','false']);
run('git',['add','.']);
// Bootstrap the accepted fixture base before installing the real hook. No
// candidate verification is bypassed: both subsequent feature pushes use it.
run('git',['commit','-qm','Synthetic accepted implementation base']);
const base=run('git',['rev-parse','HEAD']);
run('git',['init','--bare','-q',remote]);
run('git',['remote','add','origin',remote]);
run('git',['push','-q','origin','main']);
run('git',['fetch','-q','origin','main']);
run('git',['config','core.hooksPath','.githooks']);
run('git',['checkout','-qb','policy-proof']);

const policy='connect/client/typescript/src/foreground.ts';
const original=readFileSync(join(work,policy),'utf8');
assert.equal((original.match(/\badmission\b/g)??[]).length,2);
// Real behavior-preserving policy refactor; no bridge or verification edits.
writeFileSync(join(work,policy),original.replace(/\badmission\b/g,'validateUpload'));
run('git',['add',policy]);run('git',['commit','-qm','Name foreground input validation explicitly']);
const good=run('git',['rev-parse','HEAD']);
assert.equal(run('git',['diff','--name-only',base,good]),policy);
const local=JSON.parse(run(process.execPath,['--experimental-strip-types','enablement/local-tests/run.ts','--base',base,'--head',good]));
const hosted=JSON.parse(run(process.execPath,['--experimental-strip-types','enablement/ci/select.ts'],work,
  {BASE_SHA:base,GITHUB_SHA:good,GITHUB_OUTPUT:join(job,'hosted-output')}));
assert.deepEqual(local.selected,['client-foreground']);
assert.equal(hosted.plan.foreground,true);
for(const [key,value] of Object.entries(hosted.plan))if(key!=='foreground')assert.equal(value,false,key);
const packageCommands=local.commands.filter((c:{cwd:string})=>c.cwd==='connect/client/typescript');
assert.deepEqual(packageCommands.map((c:{argv:string[]})=>c.argv),[
  ['npm','ci','--no-audit','--no-fund'],['npm','test'],['npm','run','typecheck'],['npm','run','build'],
]);
assert.ok(local.commands.every((c:{cwd:string;argv:string[]})=>c.cwd==='connect/client/typescript'
  || c.cwd==='.' && c.argv.includes('--pr')),'no unrelated package/native suites');

const deny=join(job,'deny'),denied=join(job,'forbidden-tools');mkdirSync(deny);
for(const name of ['cargo','rustc','electron'])writeFileSync(join(deny,name),
  '#!/bin/sh\nprintf "%s\\n" "$0" >> "$FOREGROUND_DENIED"\nexit 97\n',{mode:0o700});
const pushEnv={...env,PATH:deny+':'+env.PATH,FOREGROUND_DENIED:denied};
function push(label:string){
  const started=performance.now();
  const r=spawnSync('git',['push','origin','HEAD:refs/heads/policy-proof'],{cwd:work,env:pushEnv,encoding:'utf8',maxBuffer:64*1024*1024,timeout:600_000});
  writeFileSync(join(job,label+'.log'),r.stdout+'\n'+r.stderr);
  if(r.error)throw r.error;
  return {status:r.status,elapsedMs:Math.round(performance.now()-started),output:r.stdout+r.stderr};
}
const accepted=push('accepted');assert.equal(accepted.status,0,accepted.output);
assert.match(accepted.output,/> @apparent\/connect-crypto@.* test/);
assert.match(accepted.output,/# tests 21\b/,'the real package test inventory ran');
assert.match(accepted.output,/> tsc --noEmit/,'the real typechecker ran');
assert.equal(run('git',['--git-dir='+remote,'rev-parse','refs/heads/policy-proof']),good);
const test='connect/client/typescript/test/foreground.test.ts';
writeFileSync(join(work,test),readFileSync(join(work,test),'utf8')+
  "\ntest('foreground proof rejects a failing policy test',()=>{assert.fail('foreground-proof-intentional-failure');});\n");
run('git',['add',test]);run('git',['commit','-qm','Synthetic failing policy regression']);
const rejected=push('rejected');assert.notEqual(rejected.status,0,rejected.output);
assert.match(rejected.output,/foreground-proof-intentional-failure/);
assert.match(rejected.output,/pre-push: verification failed/);
assert.doesNotMatch(rejected.output,/pre-push: \[connect\/client\/typescript\] npm run typecheck/,'failure stops later package checks');
assert.equal(run('git',['--git-dir='+remote,'rev-parse','refs/heads/policy-proof']),good,'failed push never updates remote');
assert.ok(!existsSync(denied),'no forbidden PATH command was observed');
const report={sourceSha,base,acceptedHead:good,localSelected:local.selected,hostedPlan:hosted.plan,
  packageCommands,acceptedMs:accepted.elapsedMs,rejectedMs:rejected.elapsedMs,rejectedRemoteUnchanged:true,
  forbiddenPathCommandObserved:false,scope:'isolated local Git push; synthetic accepted base; PATH guard only; no hosted CI or live portable-only PR proof',job:resolve(job)};
writeFileSync(join(job,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
