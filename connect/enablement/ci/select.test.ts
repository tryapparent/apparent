import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {YAML, Glob} from 'bun';
import {suitePlan, routeDecision} from '../../../enablement/ci/routing/consumers.ts';
import {connectPlan} from './select.ts';

const workflow = (name: string) => YAML.parse(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as any;
const matches = (patterns: string[], path: string) => patterns.reduce((match, pattern) =>
  new Glob(pattern.replace(/^!/, '')).match(path) ? !pattern.startsWith('!') : match, false);

test('real selector keeps PR web changes portable and main publication fully verified', () => {
  const cwd = mkdtempSync('/tmp/apparent-dev-connect-selection-');
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
  const cli = new URL('./select.ts', import.meta.url).pathname;
  try {
    git('init','-q'); git('config','user.name','Synthetic'); git('config','user.email','synthetic@example.invalid');
    mkdirSync(join(cwd,'connect/web'), {recursive:true});
    writeFileSync(join(cwd,'connect/web/input.ts'),'before'); git('add','.'); git('commit','-qm','base');
    const base = git('rev-parse','HEAD');
    writeFileSync(join(cwd,'connect/web/input.ts'),'after'); git('add','.'); git('commit','-qm','web');
    const run = (event: string, range = base, admit = true) => {
      const output = join(cwd,'output'); rmSync(output,{force:true});
      const result = spawnSync('bun',[cli,...(admit ? ['--admit'] : [])], {cwd,encoding:'utf8',env:{...process.env,
        BASE_SHA:range,GITHUB_SHA:git('rev-parse','HEAD'),GITHUB_EVENT_NAME:event,
        GITHUB_REF:event === 'push' ? 'refs/heads/main' : 'refs/pull/1/merge',GITHUB_OUTPUT:output}});
      assert.equal(result.status,0,result.stderr);
      return Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>{
        const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)];
      }));
    };
    const pr=run('pull_request'); assert.equal(pr.native,'false'); assert.equal(pr.portable,'true');
    assert.equal(JSON.parse(pr.plan).browser,true); assert.equal(pr.publish,'true');
    for(const event of ['push','workflow_dispatch']) {
      const main=run(event); assert.equal(main.native,'true'); assert.equal(main.portable,'true');
      assert.deepEqual(JSON.parse(main.plan),connectPlan(suitePlan(null)));
    }
    assert.throws(()=>run('pull_request','missing'), /Unknown history/);
    const unknown=run('pull_request','missing',false); assert.equal(unknown.native,'true');
    git('reset','--hard',base);
    mkdirSync(join(cwd,'enablement/timing'),{recursive:true});
    writeFileSync(join(cwd,'enablement/timing/command.ts'),'tooling');
    git('add','enablement'); git('commit','-qm','unrelated tooling');
    const tooling=run('push');
    assert.equal(tooling.native,'false'); assert.equal(tooling.portable,'false'); assert.equal(tooling.publish,'false');
    const checks=workflow('checks.yml');
    assert.equal(checks.jobs.connect,undefined); assert.equal(checks.jobs['native-evidence'],undefined);
    assert.equal(checks.jobs.select.outputs.plan,'${{ steps.paths.outputs.plan }}');
    for(const name of ['linux','macos']) {
      assert.match(workflow('stream-connect.yml').jobs[name].if,/outputs.native == 'true'/);
      assert.doesNotMatch(workflow('stream-connect.yml').jobs[name].if,/shared/);
    }
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

test('Connect automatic entry covers its web, service, native and composed browser inputs', () => {
  const checks = workflow('stream-connect.yml');
  for (const event of ['push', 'pull_request']) {
    const patterns = checks.on[event].paths;
    for (const path of ['connect/web/src/main.tsx', 'public/site/src/App.tsx'])
      assert.equal(matches(patterns, path), true, path);
    for (const path of ['shared/ui/button.tsx', 'composition/main.rs',
      'connect/client/src/lib.rs', 'connect/service/src/worker.ts', 'unknown/file.ts', 'connect/hosted.rs', 'Cargo.toml'])
      assert.equal(matches(patterns, path), true, path);
  }
  assert.equal(checks.jobs.public, undefined);
});

test('Connect retains real native client/service consumers and skips native for web-only edits', () => {
  const web = connectPlan(suitePlan(['connect/web/src/main.tsx']));
  assert.equal(web.browser, true); assert.equal(web.root, false); assert.equal(web.client, false);
  for (const path of ['connect/service/src/worker.ts', 'connect/hosted.rs']) {
    const plan = connectPlan(suitePlan([path]));
    assert.equal(plan.root, true, path); assert.equal(plan.client, true, path);
  }
  assert.equal(connectPlan(suitePlan(['capture/engine/runtime/mod.rs'])).root, false);
  assert.equal(connectPlan(suitePlan(null)).root, true, 'unknown inputs retain integration');
  for(const source of ['connect/client/typescript/src/mcp-wire.ts','connect/client/typescript/contracts.ts','connect/client/typescript/src/transfer/contract.ts'])
    assert.equal(connectPlan(suitePlan([source])).service,true,'the Worker consumes '+source);
});

test('the composed browser proof selects its Connect consumer and publication', () => {
  const plan = connectPlan(suitePlan(['public/enablement/browser-proof/test-hosted-browser.mjs']));
  assert.equal(plan.browser, true);
  assert.equal(plan.root, false);
  assert.equal(plan.client, false);
  for (const path of ['public/enablement/browser-proof/test-hosted-browser.mjs', 'connect/enablement/ci/verify-composition.ts'])
    assert.equal(routeDecision([path]).publicationStreams.connect, true, path);
});

test('Connect publication requires successful stream-owned gates on canonical main', () => {
  const connect = workflow('stream-connect.yml');
  assert.deepEqual(Object.keys(connect.on), ['pull_request', 'push', 'workflow_dispatch']);
  const guard = connect.jobs.admit.if;
  assert.deepEqual(connect.jobs.admit.needs, ['select','contracts','portable','linux']);
  const evaluate = (event: string, overrides: any = {}, repo = 'tryapparent/apparent', ref = 'refs/heads/main', enabled = 'true') => {
    const needs = {select: {result: 'success', outputs: {native: 'true'}}, contracts: {result: 'success'},
      portable: {result: 'success'}, linux: {result: 'success'}, ...overrides};
    return Function('github','needs','cancelled','vars',`return (${guard})`)(
      {event_name: event, repository: repo, ref}, needs, () => false, {HOSTED_CD_ENABLED: enabled});
  };
  for (const event of ['push','workflow_dispatch']) {
    assert.equal(evaluate(event), true);
    for (const result of ['failure','cancelled','skipped','queued'])
      assert.equal(evaluate(event, {macos: {result}}), true, `${event}:optional Mac ${result}`);
    assert.equal(evaluate(event, {select: {result: 'success', outputs: {native: 'false'}}, linux: {result: 'skipped'}}), true);
    assert.equal(evaluate(event, {select: {result: 'success', outputs: {native: 'true', publish: 'false'}}}), false);
    for (const name of ['select','contracts','portable','linux']) for (const result of ['failure','cancelled','skipped'])
      assert.equal(evaluate(event, {[name]: {result, outputs: {native: 'true'}}}), false, `${event}:${name}:${result}`);
  }
  assert.equal(evaluate('pull_request'), false);
  assert.equal(evaluate('push', {}, undefined, undefined, 'false'), false);
  assert.equal(evaluate('push', {}, undefined, undefined, ''), false);
  assert.equal(evaluate('push', {}, 'fork/apparent'), false);
  assert.equal(evaluate('push', {}, undefined, 'refs/heads/other'), false);
  assert.equal(workflow('stream-connect.yml').jobs.hosted.environment.name, 'hosted-production');
  assert.match(workflow('stream-connect.yml').jobs.hosted.if, /vars.HOSTED_CD_ENABLED == 'true'/);
});

test('Connect allocates Mac only for explicitly requested manual diagnostics', () => {
  const {macos, linux} = workflow('stream-connect.yml').jobs;
  assert.deepEqual(linux.needs, ['select', 'contracts']);
  assert.doesNotMatch(linux.if, /needs\.portable/);
  assert.equal(workflow('stream-connect.yml').on.workflow_dispatch.inputs.macos_diagnostics.default, false);
  const needs = {select: {result: 'success', outputs: {native: 'true'}}, contracts: {result: 'success'},
    portable: {result: 'success'}};
  const evaluate = (job: any, event: string, requested = false, state: any = needs, cancelled = false) =>
    Function('github','inputs','needs','cancelled',`return (${job.if})`)(
      {event_name: event, event: {pull_request: {draft: false}}}, {macos_diagnostics: requested}, state, () => cancelled);
  for (const event of ['pull_request','push']) for (const requested of [false,true]) {
    assert.equal(evaluate(macos,event,requested),false);
    assert.equal(evaluate(linux,event,requested),true);
  }
  assert.equal(evaluate(macos,'workflow_dispatch'),false);
  assert.equal(evaluate(macos,'workflow_dispatch',true),true);
  assert.equal(evaluate(macos,'workflow_dispatch',true,needs,true),false);
  for (const job of [macos,linux]) for (const name of ['select','contracts'])
    for (const result of ['failure','cancelled','skipped'])
      assert.equal(evaluate(job,'workflow_dispatch',true,{...needs,[name]: {...needs[name as 'select'],result}}),false);
  assert.equal(macos.with.runner,'macos-15-intel');
  assert.equal(linux.with.runner,'ubuntu-24.04');
});

test('publication survives skipped native ancestors but refuses failed admission, verification and cancellation', () => {
  const {verify,hosted}=workflow('stream-connect.yml').jobs;
  // Preserve explicit cancellation checks through transitive dependencies.
  for(const job of [verify,hosted])assert.match(job.if,/!cancelled\(\)/);
  const needs={admit:{result:'success',outputs:{sha:'a'.repeat(40)}},verify:{result:'success'},
    linux:{result:'skipped'},macos:{result:'skipped'}};
  const github={repository:'tryapparent/apparent',event_name:'push',ref:'refs/heads/main'};
  const evaluate=(job:any,state:any=needs,cancelled=false,context:any=github,enabled='true')=>
    Function('needs','cancelled','github','vars',`return (${job.if})`)(state,()=>cancelled,context,{HOSTED_CD_ENABLED:enabled});
  for(const job of [verify,hosted]){
    assert.equal(evaluate(job),true);
    assert.equal(evaluate(job,needs,true),false);
    assert.equal(evaluate(job,{...needs,admit:{result:'success',outputs:{sha:''}}}),false);
    for(const result of ['failure','cancelled','skipped'])assert.equal(evaluate(job,{...needs,admit:{...needs.admit,result}}),false);
  }
  for(const result of ['failure','cancelled','skipped'])assert.equal(evaluate(hosted,{...needs,verify:{result}}),false);
  for(const context of [{...github,repository:'fork/apparent'},{...github,ref:'refs/heads/feature'},
    {...github,event_name:'pull_request'}])assert.equal(evaluate(hosted,needs,false,context),false);
  assert.equal(evaluate(hosted,needs,false,github,'false'),false);
});
