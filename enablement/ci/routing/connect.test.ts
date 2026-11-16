import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {YAML, Glob} from 'bun';
import {suitePlan, routeDecision} from './consumers.ts';
import {connectPlan} from './connect.ts';

const workflow = (name: string) => YAML.parse(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as any;
const matches = (patterns: string[], path: string) => patterns.reduce((match, pattern) =>
  new Glob(pattern.replace(/^!/, '')).match(path) ? !pattern.startsWith('!') : match, false);

test('automatic entry covers the union of Capture and standalone Connect triggers', () => {
  const checks = workflow('checks.yml');
  for (const event of ['push', 'pull_request']) {
    const patterns = checks.on[event].paths;
    for (const path of ['connect/web/src/main.tsx', 'public/site/src/App.tsx'])
      assert.equal(matches(patterns, path), true, path);
    for (const path of ['capture/engine/runtime/mod.rs', 'shared/ui/button.tsx', 'composition/main.rs',
      'connect/client/src/lib.rs', 'connect/service/src/worker.ts', 'unknown/file.ts', 'connect/hosted.rs', 'record/storage/src/config.ts', 'Cargo.toml'])
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
  assert.equal(routeDecision(['public/enablement/browser-proof/test-hosted-browser.mjs']).publicationStreams.connect, true);
});

test('Connect publication requires successful stream-owned gates on canonical main', () => {
  const connect = workflow('stream-connect.yml');
  assert.deepEqual(Object.keys(connect.on), ['workflow_dispatch', 'workflow_call']);
  const guard = connect.jobs.admit.if;
  const evaluate = (event: string, overrides: any = {}, repo = 'tryapparent/apparent', ref = 'refs/heads/main', enabled = 'true') => {
    const needs = {select: {result: 'success', outputs: {native: 'true'}}, contracts: {result: 'success'},
      portable: {result: 'success'}, linux: {result: 'success'}, macos: {result: 'success'}, ...overrides};
    return Function('github','needs','cancelled','vars',`return (${guard})`)(
      {event_name: event, repository: repo, ref}, needs, () => false, {HOSTED_CD_ENABLED: enabled});
  };
  for (const event of ['push','workflow_dispatch']) {
    assert.equal(evaluate(event), true);
    for (const name of ['select','contracts','portable','linux','macos']) for (const result of ['failure','cancelled','skipped'])
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

test('publication survives skipped native ancestors but refuses failed admission, verification and cancellation', () => {
  const {verify,hosted}=workflow('stream-connect.yml').jobs;
  // GitHub otherwise adds success(), which propagates skipped ancestors even
  // when admit succeeded using the caller's checked native receipt.
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
