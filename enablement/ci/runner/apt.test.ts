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
  const old='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  writeFileSync(file,old);
  // Exercise the shipped shell with only the privileged filesystem seam redirected.
  const script=action.runs.steps[0].run.replace('/etc/apt/apt-mirrors.txt',file).replace('sudo install -o root -g root','install');
  const run=(os='Linux',actions='true')=>execFileSync('bash',['-c',script],{env:{...process.env,RUNNER_OS:os,GITHUB_ACTIONS:actions},stdio:'pipe'});
  run();const expected='https://mirrors.edge.kernel.org/ubuntu/\tpriority:0\n'+old;
  assert.equal(readFileSync(file,'utf8'),expected);run();assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run('Linux','false'));assert.equal(readFileSync(file,'utf8'),expected);
  assert.throws(()=>run('macOS'));assert.equal(readFileSync(file,'utf8'),expected);
  rmSync(file);assert.throws(()=>run());
  const outside=job+'/outside';writeFileSync(outside,'preserved');symlinkSync(outside,file);
  assert.throws(()=>run());assert.equal(readFileSync(outside,'utf8'),'preserved');
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
   if(workflow==='hermes.yml' && name==='clean'){
    // Audited Rust-free package proof uses Debian's sources/keyring, not
    // the hosted Ubuntu mirror list. A different image requires re-audit.
    assert.equal(job.container,'node:22.23.0-bookworm-slim');
    assert.ok(!steps.some((s:any)=>(s.uses??'').includes('/ubuntu-apt')));
    continue;
   }
   const transport=steps.findIndex((s:any)=>s.uses==='./.github/actions/ubuntu-apt' || s.uses==='tryapparent/apparent/.github/actions/ubuntu-apt@4beaef83eec4a11ed709b05ee76c881055bfd46b');
   assert.ok(transport>=0 && transport<install,`${workflow}/${name}`);
   assert.equal(steps[transport].if,workflow==='release-linux.yml'?"runner.os == 'Linux' && runner.arch == 'X64'":"runner.os == 'Linux'");
  }
 }
});
