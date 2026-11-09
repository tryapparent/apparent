import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {YAML} from 'bun';
import {select, changedPaths, documentationOnlyPath, needsPlatform} from './select.ts';

const root = new URL('../../', import.meta.url);
const workflow = (name: string) => YAML.parse(readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8')) as any;

test('only one automatic workflow; manual diagnostics and reporter retirement are preserved', () => {
  const automatic = readdirSync(new URL('.github/workflows/', root)).filter(name => {
    const events = Object.keys(workflow(name).on);
    return events.some(event => !['workflow_dispatch', 'workflow_call'].includes(event));
  });
  assert.deepEqual(automatic, ['checks.yml']);
  const ci = workflow('checks.yml');
  assert.deepEqual(Object.keys(ci.on), ['pull_request', 'push']);
  assert.deepEqual(ci.on.pull_request, {branches: ['main'],
    types: ['opened', 'reopened', 'synchronize', 'ready_for_review', 'converted_to_draft']});
  assert.deepEqual(ci.on.push, {branches: ['main']});
  assert.equal(ci.jobs['verification-status'], undefined);
  assert.equal(ci.on.workflow_run, undefined);
  assert.equal(ci.on.pull_request_target, undefined);
  assert.equal(readdirSync(new URL('enablement/', root)).includes('verification-status'), false);
  assert.equal(ci.permissions.contents, 'read');
  assert.equal(ci.jobs.public.uses, './.github/workflows/stream-public.yml');
  assert.equal(ci.jobs.public.if, "needs.select.outputs.public == 'true'");
  assert.equal(ci.jobs.updater.uses, './.github/workflows/linux-updater-harness.yml');
  assert.equal(ci.jobs.updater.if, "github.event_name == 'push' && needs.select.outputs.updater == 'true'");
  assert.match(workflow('stream-public.yml').jobs.deploy.if, /github.event_name == 'workflow_dispatch'/);
});

test('ready PRs and main pushes execute both full platform jobs; drafts and other events cannot', () => {
  const ci = workflow('checks.yml');
  const platform = workflow('verification-platform.yml');
  // Evaluate the workflow's actual boolean admission expressions against event
  // fixtures. These expressions use the common GitHub/JavaScript boolean subset.
  const admitted = (expression: string, event: string, draft: boolean, ref: string,
    receipt = false) => Function('github', 'inputs', 'needs', `return (${expression});`)(
      {event_name: event, ref, repository: 'tryapparent/apparent',
        event: {pull_request: {draft}}}, {'release_receipt': receipt}, {select: {outputs: {platform: 'true'}}});
  for (const [name, runner] of [['linux', 'ubuntu-24.04'], ['macos', 'macos-15-intel']]) {
    const job = ci.jobs[name];
    assert.equal(job.uses, './.github/workflows/verification-platform.yml');
    assert.deepEqual(job.with, {runner, 'release_receipt': false});
    assert.equal(job['continue-on-error'], undefined);
    for (const [event, draft, ref, expected] of [
      ['pull_request', false, 'refs/pull/7/merge', true],
      ['pull_request', true, 'refs/pull/7/merge', false],
      ['push', false, 'refs/heads/main', true],
      ['workflow_run', false, 'refs/heads/main', false],
      ['pull_request_target', false, 'refs/heads/main', false],
    ] as const) {
      assert.equal(job.needs, 'select');
      assert.equal(admitted(job.if, event, draft, ref), expected);
      assert.equal(admitted(job.if.replaceAll("needs.select.outputs.platform == 'true'", 'false'), event, draft, ref), false);
      if (expected) for (const child of ['rust', 'desktop-ui']) {
        assert.equal(admitted(platform.jobs[child].if, event, draft, ref), true, child);
        assert.equal(platform.jobs[child]['continue-on-error'], undefined);
        assert.equal(platform.jobs[child].steps.find((step: any) => step.uses === 'actions/checkout@v4').with.ref, undefined);
      }
      assert.equal(admitted(platform.jobs['release-ready'].if, event, draft, ref), false);
    }
  }
  assert.equal(platform.on.workflow_call.inputs['release_receipt'].default, true);
  assert.equal(admitted(platform.jobs['release-ready'].if, 'workflow_dispatch', false, 'refs/heads/main', true), true);
  assert.equal(admitted(platform.jobs['release-ready'].if, 'pull_request', false, 'refs/pull/7/merge', true), false);
  for (const filename of ['verification.yml', 'verification-mac.yml']) {
    assert.deepEqual(Object.keys(workflow(filename).on), ['workflow_dispatch']);
  }
  assert.match(ci.concurrency.group, /github.event.pull_request.number/);
  assert.equal(ci.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.match(ci.concurrency.group, /github.sha/);
  assert.equal(ci.permissions.contents, 'read');
});

test('Public and updater retain their previous automatic input coverage', () => {
  for (const path of ['public/site/src/page.ts', 'shared/ui/button.ts', 'shared/analytics/index.ts',
    'shared/assets/logo.svg', '.github/workflows/stream-public.yml']) {
    assert.deepEqual(select([path]), {public: true, updater: false}, path);
  }
  for (const path of ['capture/desktop/scripts/linux/gui/gui-vm.py',
    'capture/desktop/scripts/linux/updater/updater-fixture.py', 'capture/desktop/linux/update.rs',
    'capture/desktop/settings/settings.rs', 'capture/desktop/settings/settings_window.rs',
    '.github/workflows/linux-updater-harness.yml']) {
    assert.deepEqual(select([path]), {public: false, updater: true}, path);
  }
  assert.deepEqual(select(['README.md']), {public: false, updater: false});
  assert.deepEqual(select([]), {public: false, updater: false});
  for (const paths of [null, ['.github/workflows/checks.yml'], ['enablement/ci/select.ts']]) {
    assert.deepEqual(select(paths), {public: true, updater: true});
  }
});

test('unknown history runs all checks and git deltas include deleted and renamed owner paths', () => {
  assert.equal(changedPaths('', ''), null);
  assert.equal(changedPaths('0'.repeat(40), 'a'.repeat(40)), null);
  const dir = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/apparent-dev-ci-fixture-`);
  const previous = process.cwd();
  try {
    process.chdir(dir);
    const git = (...args: string[]) => execFileSync('git', args, {encoding: 'utf8'}).trim();
    git('init', '-q');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@example.invalid');
    // Synthetic commits only; no repository hooks or user identity changes.
    mkdirSync('public/site', {recursive: true});
    writeFileSync('public/site/old.txt', 'fixture');
    git('add', '.'); git('commit', '-qm', 'before');
    const base = git('rev-parse', 'HEAD');
    git('mv', 'public/site/old.txt', 'outside.txt');
    git('commit', '-qm', 'after');
    const paths = changedPaths(base, git('rev-parse', 'HEAD'))!;
    assert.deepEqual(paths.sort(), ['outside.txt', 'public/site/old.txt']);
    assert.equal(select(paths).public, true);
    assert.equal(changedPaths('a'.repeat(40), git('rev-parse', 'HEAD')), null);
  } finally {
    process.chdir(previous);
    rmSync(dir, {recursive: true, force: true});
  }
});


test('ordinary prose skips heavy CI; instructions, shipped text and unknown inputs retain coverage', () => {
  for (const path of ['capture/desktop/docs/linux/linux.md', 'enablement/docs/continuous-delivery.md',
    'public/site/docs/feature-grid.md', 'capture/engine/README.md', 'enablement/refactor.md']) {
    assert.equal(documentationOnlyPath(path), true, path);
    assert.equal(needsPlatform([path]), false, path);
    assert.deepEqual(select([path]), {public: false, updater: false}, path);
  }
  for (const path of ['AGENTS.md', 'capture/AGENTS.md', 'README.md', 'capture/agent/skills/apparent/SKILL.md',
    'hermes/skills/recordings/SKILL.md', 'capture/agent/instructions/context.md',
    'public/site/src/copy.md', 'capture/engine/tests/fixtures/summary.md', 'unknown.md',
    'public/site/src/docs/copy.md', 'public/site/public/assets/docs/help.md',
    'unknown/docs/input.md', 'unknown/README.md', 'public/site/src/README.md']) {
    assert.equal(needsPlatform([path]), true, path);
  }
  assert.equal(needsPlatform(null), true);
  assert.equal(needsPlatform([]), true);
  assert.equal(needsPlatform(['capture/engine/docs/capture.md', 'capture/engine/runtime/mod.rs']), true);
  assert.equal(select(['public/site/docs/guide.md', 'public/site/src/main.tsx']).public, true);
});
