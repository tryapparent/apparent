import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {YAML, Glob} from 'bun';
import {suitePlan, routeDecision} from './consumers.ts';
import {connectPlan} from './connect.ts';

const workflow = (name: string) => YAML.parse(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as any;
const matches = (patterns: string[], path: string) => patterns.reduce((match, pattern) =>
  new Glob(pattern.replace(/^!/, '')).match(path) ? !pattern.startsWith('!') : match, false);

test('native Capture entry is bounded by owner directories and explicit consumers', () => {
  const checks = workflow('checks.yml');
  for (const event of ['push', 'pull_request']) {
    const patterns = checks.on[event].paths;
    for (const path of ['connect/web/src/main.tsx', 'public/site/src/App.tsx'])
      assert.equal(matches(patterns, path), false, path);
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
  assert.equal(connectPlan(suitePlan(['connect/client/typescript/src/mcp-wire.ts'])).service,true,
    'the Worker consumes the endpoint wire contract');
});

test('the composed browser proof selects its Connect consumer and publication', () => {
  const plan = connectPlan(suitePlan(['public/site/scripts/browser-proof/test-hosted-browser.mjs']));
  assert.equal(plan.browser, true);
  assert.equal(plan.root, false);
  assert.equal(plan.client, false);
  assert.equal(routeDecision(['public/site/scripts/browser-proof/test-hosted-browser.mjs']).publicationStreams.connect, true);
});

test('Connect publication requires successful stream-owned gates on canonical main', () => {
  const connect = workflow('stream-connect.yml');
  assert.deepEqual(Object.keys(connect.on), ['pull_request', 'push', 'workflow_dispatch']);
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
