import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {YAML} from 'bun';
const root=new URL('../../../',import.meta.url);
type Step = {if?: string; uses?: string; run?: string};
const read=(p:string)=>YAML.parse(readFileSync(new URL(p,root),'utf8'));
const runner='enablement/ci/runner/ubuntu-apt.ts';
const localAction='./.github/actions/ubuntu-apt';
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
function fixture(job:string, transport=job+'/transport') {
 const paths={mirrors:job+'/mirrors',transport,osRelease:job+'/os-release',aptHelper:job+'/apt-helper',temporaryRoot:job};
 const old='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
 writeFileSync(paths.mirrors,old);
 writeFileSync(paths.osRelease,'ID=ubuntu\nVERSION_CODENAME=noble\n');
 writeFileSync(job+'/sudo',[
  '#!/bin/sh','set -eu',
  'if [ "$1" = install ]; then shift 5; exec install "$@"; fi',
  'exec "$@"','',
 ].join('\n'),{mode:0o700});
 const env={...process.env,...probeFixture(job),PATH:job+':'+process.env.PATH,
  RUNNER_OS:'Linux',RUNNER_ARCH:'X64',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'};
 const run=(overrides:Record<string,string>={})=>execFileSync('node',[
  '--experimental-strip-types','--input-type=module','-e',
  `import {prepareHostedUbuntuApt} from ${JSON.stringify(new URL(runner,root).href)};prepareHostedUbuntuApt(${JSON.stringify(paths)});`,
 ],{env:{...env,...overrides},encoding:'utf8',stdio:'pipe'});
 return {old,paths,run};
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
  const {paths,run:prepare}=fixture(job,parts+'/zzzz-apparent-transport');
  const run=()=>prepare({APT_CONFIG:job+'/apt.conf'});
  const values=()=>execFileSync('apt-config',['shell','apparentRetries','Acquire::Retries','apparentHttp','Acquire::http::Timeout','apparentHttps','Acquire::https::Timeout'],{env:{...process.env,APT_CONFIG:job+'/apt.conf'},encoding:'utf8'});
  assert.equal(values(),"apparentRetries='10'\napparentHttp='120'\napparentHttps='120'\n",'Old helper contents do not establish effective limits');
  run();assert.equal(values(),expected);run();assert.equal(values(),expected);
  // Unknown future fragments must fail closed, never silently discard limits.
  writeFileSync(parts+'/zzzzzz-hosted',overridden);
  const mirrors=readFileSync(paths.mirrors,'utf8');
  assert.throws(run);assert.equal(readFileSync(paths.mirrors,'utf8'),mirrors);
 }finally{rmSync(job,{recursive:true,force:true});}
});
test('runner mirror transport preserves sources and is idempotent; unsafe targets fail without writes',()=>{
 const job=mkdtempSync('/tmp/apparent-dev-apt-test-');
 try {
  const {old,paths,run}=fixture(job);
  const {mirrors:file,transport:config}=paths;
  writeFileSync(job+'/apt-config',"#!/bin/sh\nprintf \"apparentRetries='1'\\napparentHttp='15'\\napparentHttps='15'\\n\"\n",{mode:0o700});
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
  writeFileSync(file,old);
  assert.match(run({PROBE_ALL_BAD:'true'}),/Continuing with the runner mirror list/);
  assert.equal(readFileSync(file,'utf8'),old);
  assert.equal(readFileSync(config,'utf8'),settings);
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
  assert.doesNotMatch(readFileSync(new URL(runner,root),'utf8'),/trusted=yes|allow-unauthenticated|allow-insecure|Signed-By/);
 }finally{rmSync(job,{recursive:true,force:true});}
});
// A plugin's --install-deps flag installs Python packages, not OS packages.
const installsApt=(command:string)=>/apt-get|(?<!-)install-deps|with-deps|appimage\/dependencies/.test(command);
test('APT inventory distinguishes OS provisioning from plugin Python dependencies',()=>{
 for(const command of ['sudo apt-get update', 'npx --no-install playwright install-deps chromium',
  './node_modules/.bin/playwright-core install --with-deps chromium', './capture/desktop/scripts/linux/appimage/dependencies.sh'])
  assert.equal(installsApt(command),true,command);
 assert.equal(installsApt('hermes plugins validate "$PACKAGE" --install-deps'),false);
});
test('each affected hosted dependency consumer prepares transport before installation',()=>{
 assert.equal(action.runs.steps[0].uses,'actions/setup-node@v4');
 assert.equal(action.runs.steps[1].run,'node --experimental-strip-types '+runner);
 for(const workflow of readdirSync(new URL('.github/workflows/',root)).filter(name=>name.endsWith('.yml'))){
  const source=read(`.github/workflows/${workflow}`);
  for(const [name,job] of Object.entries(source.jobs) as [string,any][]){
   const steps=job.steps??[];
   const install=steps.findIndex((s:Step)=>installsApt(s.run??''));
   if(install<0)continue;
   if(workflow==='hermes.yml' && name==='clean'){
    // Audited Rust-free package proof uses Debian's sources/keyring, not
    // the hosted Ubuntu mirror list. A different image requires re-audit.
    assert.equal(job.container,'node:22.23.0-bookworm-slim');
    assert.ok(!steps.some((s:Step)=>(s.uses??'').includes('/ubuntu-apt')));
    continue;
   }
   const transport=steps.findIndex((s:Step)=>s.uses===localAction || s.uses==='tryapparent/apparent/.github/actions/ubuntu-apt@22b91130f8b1e8ed98d505e5a64241d34848e6a8');
   assert.ok(transport>=0 && transport<install,`${workflow}/${name}`);
   // Both native delivery matrices include ARM, whose signed Ubuntu ports
   // use a different archive layout from the x64-only mirror helper.
   const dualArch=workflow==='release-linux.yml' || workflow==='stream-engine.yml';
   assert.equal(steps[transport].if,dualArch?"runner.os == 'Linux' && runner.arch == 'X64'":"runner.os == 'Linux'");
  }
 }
});
test('cold plan output needs only Node and preserves complete and fallback inventories',()=>{
 const job=mkdtempSync('/tmp/apparent-dev-plan-output-');
 try {
  const node=execFileSync('node',['-p','process.execPath'],{encoding:'utf8'}).trim();
  const output=job+'/output';
  const emit=(raw:string)=>{
   writeFileSync(output,'');
   execFileSync(node,['--experimental-strip-types','enablement/ci/routing/run.ts','--outputs'],{
    cwd:root,env:{PATH:job,TMPDIR:job,VERIFICATION_PLAN:raw,GITHUB_OUTPUT:output},stdio:'pipe',
   });
   return readFileSync(output,'utf8');
  };
  const full=Object.fromEntries(emit('').trim().split('\n').map(line=>{
   const [key,value]=line.split('=');
   assert.equal(value, key === 'engineMedia' ? 'false' : 'true');
   return [key,value === 'true'];
  }));
  assert.ok(Object.keys(full).length>0);
  const empty=Object.fromEntries(Object.keys(full).map(key=>[key,false]));
  const plans=[full,empty,...Object.keys(full).map(key=>({...empty,[key]:true}))];
  const cases=[...plans.map(plan=>({raw:JSON.stringify(plan),expected:plan})),
   ...['','{','null','{}',JSON.stringify({...full,root:'false'}),JSON.stringify({...full,extra:true})]
    .map(raw=>({raw,expected:full}))];
  for(const {raw,expected} of cases) {
   assert.equal(emit(raw),Object.entries(expected).map(([key,value])=>`${key}=${value}\n`).join(''));
  }
 }finally{rmSync(job,{recursive:true,force:true});}
});
test('Linux desktop smoke provisions the native window visibility observer',()=>{
 const steps=read('.github/workflows/verification-platform.yml').jobs['desktop-ui'].steps;
 const setup=steps.findIndex((s:Step)=>/apt-get install[^\n]*\bx11-utils\b/.test(s.run??''));
 const smoke=steps.findIndex((s:Step)=>/npm run test:electron/.test(s.run??''));
 assert.ok(setup>=0 && setup<smoke);
 assert.equal(steps[setup].if,"runner.os == 'Linux'");
 const notes=readFileSync(new URL('capture/desktop/ui/frontend/tests/notes/smoke.cjs',root),'utf8');
 assert.match(notes,/execFileSync\('xwininfo'/);
 assert.match(notes,/Map State: IsViewable/);
});
