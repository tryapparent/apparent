import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accepted, covers, reusable, trustedProducer, authenticatedSuites} from './evidence.ts';
import type {Evidence} from './evidence.ts';
import {parsePlan} from './run.ts';
import {suitePlan} from './consumers.ts';
const full = suitePlan(null), web = suitePlan(['connect/web/src/main.tsx']);
const record: Evidence = {schema: 1, tree: 'a'.repeat(40), sha: 'b'.repeat(40), head: 'c'.repeat(40), run: '42', attempt: '2',
  plan: full, macPlan: full, results: Object.fromEntries(['contracts','linux','macos','portable','hermes','hermes-macos'].map(key=>[key,{result:'success'}]))};
const check = (e = record, tree = record.tree, head = record.head, run = record.run, attempt = record.attempt) => reusable(e, tree, head, run, attempt, full, full);
test('only exact-tree, exact-head, current-run-attempt passing suite evidence is reusable', () => {
  assert.ok(Object.values(check()).every(Boolean));
  for (const e of [{...record,schema:2}, {...record,sha:'invalid'}, {...record,results:{contracts:{result:'failure'}}}])
    assert.ok(!Object.values(check(e)).some(Boolean));
  for (const args of [[record,'d'.repeat(40)], [record,record.tree,'d'.repeat(40)], [record,record.tree,record.head,'43'], [record,record.tree,record.head,record.run,'1']] as const)
    assert.ok(!Object.values(check(...args)).some(Boolean));
});
test('failed, absent and skipped suites cannot be reused; successful Linux survives a failed Mac', () => {
  for (const result of ['failure','cancelled','skipped','in_progress']) {
    const value=check({...record,results:{...record.results,macos:{result}}});
    assert.equal(value.linux,true);assert.equal(value.macos,false);
  }
  const value=check({...record,results:{contracts:{result:'success'},linux:{result:'success'}}});
  assert.equal(value.linux,true);assert.equal(value.macos,false);assert.equal(value.portable,false);
});
test('a narrow PR or missing plan fields cannot authorize broader main suites', () => {
  assert.equal(covers(web,full),false);assert.equal(covers(full,web),true);
  assert.equal(covers({} as any,web),false);
  assert.equal(check({...record,plan:web}).linux,false);
  assert.equal(check({...record,macPlan:web}).macos,false);
  const foreground = suitePlan(['connect/client/typescript/src/foreground.ts']);
  assert.equal(covers({...web, foreground:false}, foreground), false,
    'portable evidence without the foreground owner cannot satisfy its new plan');
});
test('missing, malformed, partial and nonboolean plans retain full verification', () => {
  for (const raw of [undefined,'','null','{}','[]','{"root":false}',JSON.stringify({...full,root:'false'}),JSON.stringify({...full,extra:false})]) assert.deepEqual(parsePlan(raw),full);
  assert.deepEqual(parsePlan(JSON.stringify(web)),web);
});
test('main admission rejects failed contracts, unknown selection and missing selected suites', () => {
  const needs={contracts:{result:'success'},select:{result:'success'},linux:{result:'success'}};
  assert.equal(accepted(needs,{linux:true,macos:false},{}),true);
  assert.equal(accepted(needs,{linux:true,portable:true},{}),false);
  for(const result of ['failure','cancelled','skipped','in_progress']) {
    assert.equal(accepted({...needs,linux:{result}},{linux:true},{}),false);
    assert.equal(accepted({...needs,contracts:{result}},{linux:true},{linux:true}),false);
    assert.equal(accepted({...needs,select:{result}},{linux:true},{linux:true}),false);
  }
  assert.equal(accepted({...needs,linux:{result:'skipped'}},{linux:true},{linux:true}),true);
  assert.equal(accepted(needs,{portable:true},{portable:'true'} as any),false);
});

test('real GitHub lookup authenticates the merged PR/run/artifact and falls back on stale or unavailable evidence', async () => {
  const {execFileSync} = await import('node:child_process');
  const {mkdtempSync,writeFileSync,readFileSync,rmSync} = await import('node:fs');
  const {reuse} = await import('./evidence.ts');
  const dir=mkdtempSync('/tmp/apparent-dev-ci-evidence-test-');
  const env={...process.env}, originalFetch=globalThis.fetch;
  const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
  try {
    Object.assign(process.env,{GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'test/repo',GITHUB_SHA:'d'.repeat(40),GH_TOKEN:'synthetic',VERIFICATION_PLAN:JSON.stringify(full),MAC_VERIFICATION_PLAN:JSON.stringify(full)});
    let mode='valid', calls=0;
    globalThis.fetch=(async (url: any, options: any) => {
      calls++;
      assert.equal(options.headers.Authorization,'Bearer synthetic');
      const path=String(url).replace('https://api.github.com/repos/test/repo/','');
      if(mode==='denied')return new Response('{}',{status:403});
      let value: any;
      if(path==='git/commits/'+process.env.GITHUB_SHA)value={tree:{sha:tree},parents:[{sha:'e'.repeat(40)}]};
      else if(path==='git/commits/'+'e'.repeat(40))value={tree:{sha:'base-tree'}};
      else if(path.startsWith('git/trees/'))value={truncated:mode==='truncated',tree:[{path:'enablement/ci/routing/evidence.ts',mode:'100644',type:'blob',sha:mode==='forged-producer'&&path.includes(tree)?'different':'same'}]};
      else if(path==='git/commits/'+record.sha)value={tree:{sha:mode==='false-commit'?'wrong':tree}};
      else if(path.includes('/attempts/'))value={total_count:10,jobs:['contracts','select','tree-evidence','linux / select','linux / rust (ubuntu-24.04)','linux / desktop-ui (ubuntu-24.04)','linux / connect-client (ubuntu-24.04)','macos / select','macos / rust (macos-15-intel)','macos / desktop-ui (macos-15-intel)','macos / connect-client (macos-15-intel)','portable','Hermes inspection (ubuntu-24.04)','Hermes inspection (macos-15-intel)'].map(name=>({name,status:'completed',conclusion:mode==='forged-results'?'skipped':'success'}))};
      else if(path.includes('/pulls?'))value=[{merged_at:'now',merge_commit_sha:process.env.GITHUB_SHA,number:1,base:{repo:{full_name:'test/repo'}},head:{sha:record.head,repo:{full_name:mode==='fork'?'other/repo':'test/repo'}}}];
      else if(path.includes('/runs?'))value={workflow_runs:[{id:42,run_attempt:2,path:'.github/workflows/checks.yml',event:'pull_request',head_sha:record.head,head_repository:{full_name:'test/repo'},repository:{full_name:'test/repo'},status:'completed',conclusion:mode==='cancelled'?'cancelled':'success'}]};
      else if(path.includes('/artifacts?'))value={artifacts:[{id:5,name:'ci-tree-evidence-2',expired:mode==='expired',size_in_bytes:1000}]};
      else if(path==='actions/artifacts/5/zip') {
        writeFileSync(dir+'/verified-tree.json',JSON.stringify({...record,tree:mode==='tree-changed'?'f'.repeat(40):tree}));
        rmSync(dir+'/evidence.zip',{force:true});
        execFileSync('zip',['-qj',dir+'/evidence.zip',dir+'/verified-tree.json']);
        return new Response(readFileSync(dir+'/evidence.zip'));
      } else throw Error('Unexpected lookup '+path);
      return new Response(JSON.stringify(value));
    }) as typeof fetch;
    assert.ok(Object.values(await reuse()).every(Boolean));
    for(mode of ['denied','fork','cancelled','expired','tree-changed','forged-producer','forged-results','truncated','false-commit'])assert.ok(!Object.values(await reuse()).some(Boolean),mode);
    process.env.GITHUB_EVENT_NAME='pull_request';calls=0;
    assert.ok(!Object.values(await reuse()).some(Boolean));assert.equal(calls,0,'PRs never look up main reuse evidence');
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];
    Object.assign(process.env,env);rmSync(dir,{recursive:true,force:true});
  }
});


test('verification code cannot authenticate its own modification, removal, mode change or unbounded tree', () => {
  const entry={path:'enablement/ci/routing/evidence.ts',mode:'100644',type:'blob',sha:'trusted'};
  const base={tree:[entry]};
  assert.equal(trustedProducer(base,base),true);
  assert.equal(trustedProducer(base,{tree:[entry,{path:'capture/engine/runtime/new.rs',mode:'100644',type:'blob',sha:'product-change'}]}),true);
  for(const candidate of [{tree:[]},{truncated:true,tree:[entry]},{tree:[{...entry,sha:'changed'}]},{tree:[{...entry,mode:'120000'}]},{tree:[entry,{...entry,path:'public/site/package.json'}]}])assert.equal(trustedProducer(base,candidate),false);
});
test('GitHub job conclusions independently reject artifact claims for skipped or failed native suites', () => {
  const names=['contracts','select','tree-evidence','linux / select','linux / rust (ubuntu-24.04)','linux / desktop-ui (ubuntu-24.04)','linux / connect-client (ubuntu-24.04)'];
  const jobs=names.map(name=>({name,status:'completed',conclusion:'success'}));
  assert.equal(authenticatedSuites(jobs,full,full).linux,true);
  for(const name of names)for(const conclusion of ['skipped','cancelled','failure'])assert.equal(authenticatedSuites(jobs.map(job=>job.name===name?{...job,conclusion}:job),full,full).linux,false);
  assert.equal(authenticatedSuites(jobs,full,full).macos,false);
});
