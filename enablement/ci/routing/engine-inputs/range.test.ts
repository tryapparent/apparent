import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {YAML} from 'bun';
import {selectRange} from '../../select.ts';
import {engineIndependentRange, independentInputs} from './qualify.ts';
import {selection, commands} from '../../../local-tests/run.ts';
import {currentStream} from '../streams.ts';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
function fixture() {
  const cwd = mkdtempSync('/tmp/apparent-dev-engine-inputs-');
  const git = (...args: string[]) => execFileSync('git', args, {cwd, env, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
  const put = (path: string, text: string) => {mkdirSync(dirname(join(cwd,path)),{recursive:true}); writeFileSync(join(cwd,path),text);};
  git('init','-q'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
  for (const path of independentInputs) put(path,readFileSync(join(root,path),'utf8'));
  // Actual producer/SDK/qualifier and inbound consumer bytes, not invented
  // build inputs. The fixture commits them so every CLI reads Git objects.
  const inputs = execFileSync('git',['ls-files','-z','engine','.github/workflows/stream-engine.yml',
    '.github/workflows/verification-platform.yml','enablement/verification.py',
    'enablement/tests/test_owner_lanes.py','enablement/timing/mac-cache.test.ts',
    'enablement/prerequisites/native.test.ts'],{cwd:root,env,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const path of inputs) put(path,readFileSync(join(root,path),'utf8'));
  const commit = () => {git('add','.'); git('commit','-qm','fixture'); return git('rev-parse','HEAD');};
  return {cwd,git,put,commit, close:()=>rmSync(cwd,{recursive:true,force:true})};
}
function cli(cwd: string, base: string, head: string, engine = false) {
  const output = join(cwd, engine ? 'engine-output' : 'shared-output');
  const text = execFileSync('bun', [join(root, engine ? 'engine/enablement/ci/run.ts' : 'enablement/ci/select.ts'), ...(engine ? ['select'] : ['--admit'])],
    {cwd,env:{...env,BASE_SHA:base,GITHUB_SHA:head,GITHUB_OUTPUT:output,GITHUB_EVENT_NAME:'push'},encoding:'utf8'});
  return engine ? readFileSync(output,'utf8').trim().split('\n')[0] : JSON.parse(text);
}
test('real source commits and both CLIs remove only independent Engine fanout; workflow admission follows', () => {
  const f = fixture();
  try {
    const base=f.commit();
    for (const path of independentInputs) f.put(path,readFileSync(join(root,path),'utf8')+'\n// reviewed executor observation\n');
    const head=f.commit(), decision=cli(f.cwd,base,head);
    assert.equal(decision.plan.engineMedia,false); assert.equal(decision.plan.root,true);
    assert.equal(decision.macos,true); assert.equal(decision.plan.engine,true);
    assert.equal(decision.requiredStreams.engine,false); assert.equal(decision.publicationStreams.engine,false);
    assert.equal(cli(f.cwd,base,head,true),'selected=false');
    assert.equal(currentStream('engine',base,head,f.cwd),true);
    const local = selection(base,head,f.cwd);
    assert.equal(local.plan.engineMedia,false);
    assert.equal(commands(local.selected,base,head,'linux',local.rustChanged,{paths:local.paths,workflowControls:local.workflowControls}).some(command => command.argv.includes('engine/enablement/ci/producer/check.ts')),false);
    const workflow=YAML.parse(readFileSync(join(root,'.github/workflows/stream-engine.yml'),'utf8'));
    for (const name of ['sdk','native']) {
      const expression=workflow.jobs[name].if;
      assert.match(expression,/needs.select.outputs.selected == 'true'/);
      const evaluate=Function('needs','github',`return (${expression});`);
      for (const selected of ['false','true']) assert.equal(evaluate({select:{outputs:{selected}}},
        {event_name:'pull_request',event:{pull_request:{draft:false}}}),selected==='true');
    }
  } finally {f.close();}
});
test('only Engine source, SDK and qualifiers select native production', () => {
  for (const path of ['engine/native/src/main.rs','engine/sdk/src/index.ts','engine/enablement/ci/producer/qualify.ts',
    'engine/enablement/ci/producer/check.ts','.github/workflows/stream-engine.yml','.github/actions/ubuntu-apt/action.yml',
    'enablement/ci/select.ts','enablement/ci/routing/consumers.ts','enablement/ci/runner/new.test.ts']) {
    const f=fixture(); try {
      const base=f.commit(); f.put('enablement/ci/root.ts',readFileSync(join(root,'enablement/ci/root.ts'),'utf8')+'\n// observation\n');
      f.put(path,'// changed input\n'); const head=f.commit();
      assert.equal(selectRange(base,head,f.cwd).plan.engineMedia,path.startsWith('engine/'),path);
      assert.equal(cli(f.cwd,base,head,true),`selected=${path.startsWith('engine/')}`,path);
    } finally {f.close();}
  }
});
test('only changes inside Engine select production despite other conservative fallback', () => {
  for (const kind of ['import','inbound','mode','delete','rename','history']) {
    const f=fixture();try {
      const base=f.commit(); const path='enablement/ci/root.ts';
      f.put(path,readFileSync(join(root,path),'utf8')+'\n// observation\n');
      if(kind==='import') f.put(path,"import './new.ts';\n"+readFileSync(join(root,path),'utf8'));
      if(kind==='inbound') f.put('engine/tools/new.ts',"import '../../enablement/ci/root.ts';\n");
      if(kind==='mode') chmodSync(join(f.cwd,path),0o755);
      if(kind==='delete') f.git('rm','-f',path);
      if(kind==='rename') f.git('mv',path,'enablement/ci/renamed.ts');
      const head=f.commit(); const decision=selectRange(kind==='history'?'missing':base,head,f.cwd);
      assert.equal(decision.plan.engineMedia,kind==='inbound',kind);
      if(kind!=='history') assert.equal(currentStream('engine',base,head,f.cwd),kind!=='inbound',kind);
      if(kind==='inbound') assert.equal(engineIndependentRange(base,head,[path],f.cwd),false);
    } finally {f.close();}
  }
});

test('earlier external imports do not expand Engine automatic triggers', () => {
  for (const edge of ["import '../../enablement/ci/root';","import '@ci/root';","import '../../enablement/ci/routing/native';"]) {
    const f=fixture();try {
      f.put('engine/tools/new.ts',edge); const base=f.commit();
      const path='enablement/ci/root.ts'; f.put(path,readFileSync(join(root,path),'utf8')+'\n// observation\n');
      const head=f.commit();
      assert.equal(selectRange(base,head,f.cwd).plan.engineMedia,false,edge);
      assert.equal(currentStream('engine',base,head,f.cwd),true,edge);
      assert.equal(cli(f.cwd,base,head,true),'selected=false',edge);
    } finally {f.close();}
  }
});
