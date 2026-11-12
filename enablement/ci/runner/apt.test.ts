import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {YAML} from 'bun';
const root=new URL('../../../',import.meta.url);
const read=(p:string)=>YAML.parse(readFileSync(new URL(p,root),'utf8'));
const action=read('.github/actions/ubuntu-apt/action.yml');
test('effective acquisition limits survive hosted APT configuration precedence',{
 skip:spawnSync('apt-config',['--version'],{stdio:'ignore'}).status!==0,
},()=>{
 const job=mkdtempSync('/tmp/apparent-dev-apt-merge-');
 try{
  const parts=job+'/parts';mkdirSync(parts);
  const expected="apparentRetries='1'\napparentHttp='15'\napparentHttps='15'\n";
  const overridden='Acquire::Retries "10";\nAcquire::http::Timeout "120";\nAcquire::https::Timeout "120";\n';
  writeFileSync(parts+'/80apparent-transport','Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n');
  writeFileSync(parts+'/99-hosted',overridden);
  writeFileSync(job+'/apt.conf',`Dir::Etc::parts "${parts}";\nDir::Etc::main "${job}/absent";\n`);
  const env={...process.env,APT_CONFIG:job+'/apt.conf',PATH:job+':'+process.env.PATH,RUNNER_OS:'Linux',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'};
  const values=()=>execFileSync('apt-config',['shell','apparentRetries','Acquire::Retries','apparentHttp','Acquire::http::Timeout','apparentHttps','Acquire::https::Timeout'],{env,encoding:'utf8'});
  assert.equal(values(),"apparentRetries='10'\napparentHttp='120'\napparentHttps='120'\n",'Old helper contents do not establish effective limits');
  writeFileSync(job+'/mirrors','https://archive.ubuntu.com/ubuntu/\tpriority:2\n');
  writeFileSync(job+'/os-release','ID=ubuntu\nVERSION_CODENAME=noble\n');
  writeFileSync(job+'/curl','#!/bin/sh\nexit 0\n',{mode:0o700});
  const source=action.runs.steps[0].run;
  const nativeConfig=source.match(/transport_file=(\/etc\/apt\/apt\.conf\.d\/[^\s]+)/)?.[1];
  assert.ok(nativeConfig);
  const script=source.replace('/etc/apt/apt-mirrors.txt',job+'/mirrors').replace(nativeConfig,parts+'/'+nativeConfig.split('/').at(-1)).replace('/etc/os-release',job+'/os-release').replaceAll('sudo install -o root -g root','install').replace('sudo apt-config','apt-config');
  const run=()=>execFileSync('bash',['-c',script],{env,stdio:'pipe'});
  run();assert.equal(values(),expected);run();assert.equal(values(),expected);
  // Unknown future fragments must fail closed, never silently discard limits.
  writeFileSync(parts+'/zzzzzz-hosted',overridden);
  const mirrors=readFileSync(job+'/mirrors','utf8');
  assert.throws(run);assert.equal(readFileSync(job+'/mirrors','utf8'),mirrors);
 }finally{rmSync(job,{recursive:true,force:true});}
});
test('runner mirror transport preserves sources and is idempotent; unsafe targets fail without writes',()=>{
 const job=mkdtempSync('/tmp/apparent-dev-apt-test-');
 try {
  const file=job+'/mirrors';
  const config=job+'/transport';
  writeFileSync(job+'/apt-config',"#!/bin/sh\nprintf \"apparentRetries='1'\\napparentHttp='15'\\napparentHttps='15'\\n\"\n",{mode:0o700});
  const release=job+'/os-release';writeFileSync(release,'ID=ubuntu\nVERSION_CODENAME=noble\n');
  writeFileSync(job+'/curl','#!/bin/sh\nprintf "%s\\n" "$@" > "$PROBE_ARGS"\nexit "$PROBE_STATUS"\n',{mode:0o700});
  const old='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  writeFileSync(file,old);
  // Exercise the shipped shell with only the privileged filesystem seam redirected.
  const script=action.runs.steps[0].run.replace('/etc/apt/apt-mirrors.txt',file).replace('/etc/apt/apt.conf.d/zzzz-apparent-transport',config).replace('/etc/os-release',release).replaceAll('sudo install -o root -g root','install').replace('sudo apt-config','apt-config');
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
