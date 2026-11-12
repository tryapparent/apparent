import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {YAML} from 'bun';
const root=new URL('../../../',import.meta.url);
const read=(p:string)=>YAML.parse(readFileSync(new URL(p,root),'utf8'));
const action=read('.github/actions/ubuntu-apt/action.yml');
function probeFixture(job:string){
 writeFileSync(job+'/apt-helper',[
  '#!/bin/bash','set -euo pipefail',
  'printf "%s\\n" "$@" >> "$PROBE_ARGS"',
  'while [ "$1" = -o ]; do shift 2; done',
  'test "$1" = download-file','url=$2; target=$3',
  'test "$PROBE_ALL_BAD" = false',
  'case "$url" in *archive.ubuntu.com*) test "$PROBE_STATUS" = 0 || exit "$PROBE_STATUS"; if [[ "$url" != */InRelease && "$PROBE_INDEX_BAD" = true ]]; then exit 100; fi;; esac',
  'if [[ "$url" = */InRelease ]]; then',
  '  printf "%064d 1 main/binary-amd64/Packages.xz\\n" 0 > "$target"',
  'else',
  '  [[ "$4" =~ ^SHA256:[0-9a-f]{64}$ ]]',
  '  printf fixture > "$target"',
  'fi','',
 ].join('\n'),{mode:0o700});
 writeFileSync(job+'/timeout',[
  '#!/bin/sh','set -eu','printf "%s\\n" "$@" >> "$TIMEOUT_ARGS"',
  'test "$1" = --signal=TERM','test "$2" = --kill-after=2s','test "$3" = 10s',
  'shift 3','exec "$@"','',
 ].join('\n'),{mode:0o700});
 return {PROBE_ARGS:job+'/args',TIMEOUT_ARGS:job+'/timeout-args',PROBE_STATUS:'0',PROBE_ALL_BAD:'false',PROBE_INDEX_BAD:'false'};
}
function redirectProbe(script:string,job:string){
 return script.replace('sudo timeout','timeout').replaceAll('/usr/lib/apt/apt-helper',job+'/apt-helper');
}
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
  const env={...process.env,...probeFixture(job),APT_CONFIG:job+'/apt.conf',PATH:job+':'+process.env.PATH,RUNNER_OS:'Linux',RUNNER_ARCH:'X64',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'};
  const values=()=>execFileSync('apt-config',['shell','apparentRetries','Acquire::Retries','apparentHttp','Acquire::http::Timeout','apparentHttps','Acquire::https::Timeout'],{env,encoding:'utf8'});
  assert.equal(values(),"apparentRetries='10'\napparentHttp='120'\napparentHttps='120'\n",'Old helper contents do not establish effective limits');
  writeFileSync(job+'/mirrors','https://archive.ubuntu.com/ubuntu/\tpriority:2\n');
  writeFileSync(job+'/os-release','ID=ubuntu\nVERSION_CODENAME=noble\n');
  const source=action.runs.steps[0].run;
  const nativeConfig=source.match(/transport_file=(\/etc\/apt\/apt\.conf\.d\/[^\s]+)/)?.[1];
  assert.ok(nativeConfig);
  const script=redirectProbe(source.replace('/etc/apt/apt-mirrors.txt',job+'/mirrors').replace(nativeConfig,parts+'/'+nativeConfig.split('/').at(-1)).replace('/etc/os-release',job+'/os-release').replaceAll('sudo install -o root -g root','install').replace('sudo apt-config','apt-config'),job);
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
  const old='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  writeFileSync(file,old);
  // Exercise the shipped shell; isolate filesystem, privilege and APT transport.
  const script=redirectProbe(action.runs.steps[0].run.replace('/etc/apt/apt-mirrors.txt',file).replace('/etc/apt/apt.conf.d/zzzz-apparent-transport',config).replace('/etc/os-release',release).replaceAll('sudo install -o root -g root','install').replace('sudo apt-config','apt-config'),job);
  const probe=probeFixture(job);
  const run=(overrides:Record<string,string>={})=>execFileSync('bash',['-c',script],{env:{...process.env,...probe,PATH:job+':'+process.env.PATH,RUNNER_OS:'Linux',RUNNER_ARCH:'X64',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',...overrides},stdio:'pipe'});
  run();const expected='https://archive.ubuntu.com/ubuntu/\tpriority:0\n'+old;
  assert.equal(readFileSync(file,'utf8'),expected);run();assert.equal(readFileSync(file,'utf8'),expected);
  const settings=readFileSync(config,'utf8');
  assert.equal(settings,'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n');
  const args=readFileSync(job+'/args','utf8');
  assert.ok(args.includes('Acquire::Retries=0\n'));
  assert.ok(args.includes('/dists/noble-updates/InRelease\n'));
  assert.ok(args.includes('/main/binary-amd64/by-hash/SHA256/'+'0'.repeat(64)+'\n'));
  assert.ok(args.includes('SHA256:'+'0'.repeat(64)+'\n'));
  assert.ok(readFileSync(job+'/timeout-args','utf8').includes('--signal=TERM\n--kill-after=2s\n10s\nbash\n'));
  const fallback='https://mirrors.edge.kernel.org/ubuntu/\tpriority:0\n'+old;
  run({PROBE_STATUS:'124'});assert.equal(readFileSync(file,'utf8'),fallback);
  run({PROBE_STATUS:'100'});assert.equal(readFileSync(file,'utf8'),fallback);
  // Successful metadata alone must not promote a mirror whose index fails.
  run({PROBE_INDEX_BAD:'true'});assert.equal(readFileSync(file,'utf8'),fallback);
  assert.throws(()=>run({PROBE_ALL_BAD:'true'}));assert.equal(readFileSync(file,'utf8'),fallback);
  run();assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run({GITHUB_ACTIONS:'false'}));assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run({RUNNER_OS:'macOS'}));assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run({RUNNER_ARCH:'ARM64'}));assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run({RUNNER_ENVIRONMENT:'self-hosted'}));assert.equal(readFileSync(file,'utf8'),expected);
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
   const transport=steps.findIndex((s:any)=>s.uses==='./.github/actions/ubuntu-apt' || s.uses==='tryapparent/apparent/.github/actions/ubuntu-apt@22b91130f8b1e8ed98d505e5a64241d34848e6a8');
   assert.ok(transport>=0 && transport<install,`${workflow}/${name}`);
   assert.equal(steps[transport].if,workflow==='release-linux.yml'?"runner.os == 'Linux' && runner.arch == 'X64'":"runner.os == 'Linux'");
  }
 }
});
