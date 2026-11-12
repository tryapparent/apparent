import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {YAML, Glob} from 'bun';
import {suitePlan} from './consumers.ts';
import {connectPlan} from './connect.ts';

const workflow = (name: string) => YAML.parse(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as any;
const matches = (patterns: string[], path: string) => patterns.reduce((match, pattern) =>
  new Glob(pattern.replace(/^!/, '')).match(path) ? !pattern.startsWith('!') : match, false);

test('stream-only deltas do not allocate default CD; mixed, shared, unknown and native Public inputs do', () => {
  const checks = workflow('checks.yml');
  for (const event of ['push', 'pull_request']) {
    const patterns = checks.on[event].paths;
    for (const path of ['connect/web/src/main.tsx', 'connect/service/src/worker.ts',
      'public/site/src/App.tsx', 'public/site/package.json',
      'public/site/scripts/pages/prepare-pages.mjs', 'README.md']) assert.equal(matches(patterns, path), false, path);
    for (const path of ['shared/ui/button.tsx', 'unknown/file.ts', 'capture/engine/runtime/mod.rs',
      'public/site/video-demo/src/main.rs', 'public/site/src/unexpected.rs',
      'connect/client/src/lib.rs', 'connect/client/typescript/src/shares.ts',
      'connect/hosted.rs', 'connect/unknown.swift', 'connect/unknown.ts',
      'connect/skills/example/SKILL.md', 'connect/client/src/CLAUDE.md',
      'public/site/src/SKILL.md', 'public/site/src/CLAUDE.md', 'public/site/src/GEMINI.md',
      'public/site/src/skill.md', 'public/site/src/claude.md', 'public/site/src/gemini.md',
      'public/site/src/agents.md', 'public/site/src/sKiLl.md', 'connect/web/src/gEmInI.md',
      'public/site/src/fixture/example.md', 'public/site/new-root.ts', 'public/site/public/assets/brand/apparent-wordmark.svg',
      'public/site/scripts/browser-proof/test-hosted-browser.mjs',
      'capture/agent/skills/apparent/SKILL.md']) assert.equal(matches(patterns, path), true, path);
    // GitHub evaluates every changed path, including both sides of a rename.
    assert.equal(['connect/web/old.ts', 'capture/desktop/new.ts'].some(p => matches(patterns, p)), true);
    assert.equal(['public/site/src/deleted.ts', 'shared/new.ts'].some(p => matches(patterns, p)), true);
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
