import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {YAML} from 'bun';
const root=new URL('../../../',import.meta.url);
const read=(p:string)=>YAML.parse(readFileSync(new URL(p,root),'utf8'));
const action=read('.github/actions/ubuntu-apt/action.yml');
test('runner mirror transport preserves sources and is idempotent; unsafe targets fail without writes',()=>{
 const job=mkdtempSync('/tmp/apparent-dev-apt-test-');
 try {
  const file=job+'/mirrors';
  const config=job+'/transport';
  const release=job+'/os-release';writeFileSync(release,'ID=ubuntu\nVERSION_CODENAME=noble\n');
  writeFileSync(job+'/curl','#!/bin/sh\nprintf "%s\\n" "$@" > "$PROBE_ARGS"\nexit "$PROBE_STATUS"\n',{mode:0o700});
  const old='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  writeFileSync(file,old);
  // Exercise the shipped shell with only the privileged filesystem seam redirected.
  const script=action.runs.steps[0].run.replace('/etc/apt/apt-mirrors.txt',file).replace('/etc/apt/apt.conf.d/80apparent-transport',config).replace('/etc/os-release',release).replaceAll('sudo install -o root -g root','install');
  const run=(os='Linux',actions='true',probe='0',runner='github-hosted')=>execFileSync('bash',['-c',script],{env:{...process.env,PATH:job+':'+process.env.PATH,RUNNER_OS:os,GITHUB_ACTIONS:actions,RUNNER_ENVIRONMENT:runner,PROBE_STATUS:probe,PROBE_ARGS:job+'/args'},stdio:'pipe'});
  run();const expected='https://mirrors.edge.kernel.org/ubuntu/\tpriority:0\n'+old;
  assert.equal(readFileSync(file,'utf8'),expected);run();assert.equal(readFileSync(file,'utf8'),expected);
  const settings=readFileSync(config,'utf8');
  assert.equal(settings,'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n');
  assert.equal(readFileSync(job+'/args','utf8'),'--fail\n--silent\n--show-error\n--location\n--proto\n=https\n--proto-redir\n=https\n--connect-timeout\n5\n--max-time\n10\n--retry\n0\n--output\n/dev/null\nhttps://mirrors.edge.kernel.org/ubuntu/dists/noble/InRelease\n');
  // Exact observed failure: the preferred host cannot serve InRelease, while
  // hosted fallbacks remain available. Re-running must remove stale promotion.
  run('Linux','true','28');assert.equal(readFileSync(file,'utf8'),old);
  run('Linux','true','22');assert.equal(readFileSync(file,'utf8'),old);
  run();assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run('Linux','false'));assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run('macOS'));assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run('Linux','true','0','self-hosted'));assert.equal(readFileSync(file,'utf8'),expected);
  rmSync(file);assert.throws(()=>run());
  const outside=job+'/outside';writeFileSync(outside,'preserved');symlinkSync(outside,file);
  assert.throws(()=>run());assert.equal(readFileSync(outside,'utf8'),'preserved');
  rmSync(file);writeFileSync(file,old);rmSync(config);symlinkSync(outside,config);
  assert.throws(()=>run());assert.equal(readFileSync(file,'utf8'),old);assert.equal(readFileSync(outside,'utf8'),'preserved');
  assert.doesNotMatch(script,/trusted=yes|allow-unauthenticated|allow-insecure|Signed-By/);
 }finally{rmSync(job,{recursive:true,force:true});}
});
test('each affected hosted dependency consumer prepares transport before installation',()=>{
 for(const workflow of readdirSync(new URL('.github/workflows/',root)).filter(name=>name.endsWith('.yml'))){
  const source=read(`.github/workflows/${workflow}`);
  for(const [name,job] of Object.entries(source.jobs) as [string,any][]){
   const steps=job.steps??[];
   const install=steps.findIndex((s:any)=>/apt-get|install-deps|with-deps|appimage\/dependencies/.test(s.run??''));
   if(install<0)continue;
   const transport=steps.findIndex((s:any)=>s.uses==='./.github/actions/ubuntu-apt' || s.uses==='tryapparent/apparent/.github/actions/ubuntu-apt@24373d9bf2f3bcd3cfbf9a833c9e6dfebf3d16f6');
   assert.ok(transport>=0 && transport<install,`${workflow}/${name}`);
   assert.equal(steps[transport].if,workflow==='release-linux.yml'?"runner.os == 'Linux' && runner.arch == 'X64'":"runner.os == 'Linux'");
  }
 }
});
