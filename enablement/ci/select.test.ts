import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {YAML} from 'bun';
import {select, changedPaths, requiresMac, featureNotesOnly, macDecision, selectRange} from './select.ts';
import {changedPaths as sharedInputPaths, workflowControlPaths} from './inputs.ts';

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

test('main preserves active checks while PR updates supersede them', () => {
  for (const filename of ['checks.yml', 'stream-public.yml']) {
    const concurrency = workflow(filename).concurrency;
    const expression = concurrency['cancel-in-progress'].replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    for (const [event, expected] of [['push', false], ['pull_request', true], ['workflow_dispatch', false]]) {
      assert.equal(Function('github', `return (${expression});`)({event_name: event}), expected, `${filename}: ${event}`);
    }
    // GitHub's default single pending slot replaces older pending runs.
    assert.equal(concurrency.queue, undefined);
    assert.match(concurrency.group, /github.ref/);
  }
});

test('platform admission keeps main full and exempts only selected ready PRs from Mac', () => {
  const ci = workflow('checks.yml');
  const platform = workflow('verification-platform.yml');
  // Evaluate the workflow's actual boolean admission expressions against event
  // fixtures. These expressions use the common GitHub/JavaScript boolean subset.
  const admitted = (expression: string, event: string, draft: boolean, ref: string,
    receipt = false, macos = 'true', result = 'success', cancelled = false) => Function('github', 'inputs', 'needs', 'cancelled',
      `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`)(
      {event_name: event, ref, repository: 'tryapparent/apparent',
        event: {pull_request: {draft}}}, {'release_receipt': receipt}, {
        linux: {result: 'success'}, contracts: {result: 'success'}, hermes: {result: 'success'},
        select: {result, outputs: {macos}}}, () => cancelled);
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
      assert.equal(admitted(job.if, event, draft, ref), expected);
      for (const selection of ['false', 'true', '']) {
        assert.equal(admitted(job.if, event, draft, ref, false, selection),
          expected && !(name === 'macos' && event === 'pull_request' && selection === 'false'));
      }
      if (expected) for (const child of ['rust', 'desktop-ui']) {
        assert.equal(admitted(platform.jobs[child].if, event, draft, ref), true, child);
        assert.equal(platform.jobs[child]['continue-on-error'], undefined);
        assert.equal(platform.jobs[child].steps.find((step: any) => step.uses === 'actions/checkout@v4').with.ref, undefined);
      }
      assert.equal(admitted(platform.jobs['release-ready'].if, event, draft, ref), false);
    }
  }
  assert.deepEqual(ci.jobs.macos.needs, ['linux', 'contracts', 'hermes', 'select']);
  assert.equal(ci.jobs.linux.needs, undefined);
  assert.equal(ci.jobs.select.outputs.macos, '${{ steps.paths.outputs.macos }}');
  const selector = ci.jobs.select.steps.find((step: any) => step.id === 'paths');
  assert.equal(selector.env.BASE_SHA, '${{ github.event.pull_request.base.sha || github.event.before }}');
  assert.equal(selector.run, 'bun enablement/ci/select.ts');
  assert.equal(selector['continue-on-error'], undefined);
  assert.equal(ci.jobs.select.steps.find((step: any) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
  // GitHub adds success() unless the expression contains a status function.
  // Evaluate the actual YAML with that dependency-skip behavior too.
  const macAdmitted = (event: string, result: string, output: string, cancelled = false) =>
    (/\b(always|cancelled|failure|success)\(/.test(ci.jobs.macos.if) || result === 'success') &&
      admitted(ci.jobs.macos.if, event, false, 'refs/heads/main', false, output, result, cancelled);
  for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
    for (const output of ['false', 'true', '', 'garbage']) {
      assert.equal(macAdmitted('pull_request', result, output), result !== 'success' || output !== 'false');
      assert.equal(macAdmitted('push', result, output), true);
      assert.equal(macAdmitted('pull_request', result, output, true), false);
    }
  }
  assert.equal(platform.on.workflow_call.inputs['release_receipt'].default, true);
  assert.equal(admitted(platform.jobs['release-ready'].if, 'workflow_dispatch', false, 'refs/heads/main', true), true);
  assert.equal(admitted(platform.jobs['release-ready'].if, 'pull_request', false, 'refs/pull/7/merge', true), false);
  for (const filename of ['verification.yml', 'verification-mac.yml']) {
    assert.deepEqual(Object.keys(workflow(filename).on), ['workflow_dispatch']);
    assert.equal(workflow(filename).jobs.verify.if, undefined);
    assert.equal(workflow(filename).jobs.verify.uses, './.github/workflows/verification-platform.yml');
  }
  assert.match(ci.concurrency.group, /github.event.pull_request.number/);
  assert.match(ci.concurrency['cancel-in-progress'], /pull_request/);
  assert.equal(ci.permissions.contents, 'read');
});

test('Public and updater retain their previous automatic input coverage', () => {
  for (const path of ['public/site/src/page.ts', 'shared/ui/button.ts', 'shared/analytics/index.ts',
    'shared/assets/logo.svg', '.github/workflows/stream-public.yml', 'capture/desktop/docs/linux/linux.md']) {
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

test('every automatic Mac entrypoint waits for successful Linux verification and cheap checks', () => {
  const ci = workflow('checks.yml');
  const ancestors = (name: string): string[] => {
    const needs = ci.jobs[name].needs ?? [];
    return [needs].flat().flatMap((parent: string) => [parent, ...ancestors(parent)]);
  };
  const macJobs = Object.entries(ci.jobs).filter(([, job]: any) => {
    const runners = [job.with?.runner, job['runs-on'], ...Object.values(job.strategy?.matrix ?? {}).flat()];
    return runners.some(runner => typeof runner === 'string' && runner.startsWith('macos-'));
  });
  assert.ok(macJobs.length > 0, 'must inspect the actual Mac job inventory');
  for (const [name, job] of macJobs as [string, any][]) {
    const prerequisites = ancestors(name);
    for (const required of ['linux', 'contracts', 'hermes']) {
      assert.ok(prerequisites.includes(required), `${name} must wait for ${required}`);
    }
    // Ordinary prerequisites keep implicit success(). Only the platform caller
    // may override it, and the actual expression must then preserve all three
    // success requirements (exercised below, not assumed by the evaluator).
    for (const entry of [name, ...prerequisites]) {
      if (entry !== 'macos') assert.doesNotMatch(ci.jobs[entry].if ?? '', /\b(always|failure|cancelled)\s*\(/, entry);
      else assert.doesNotMatch(ci.jobs[entry].if ?? '', /\b(always|failure)\s*\(/, entry);
      assert.equal(ci.jobs[entry]['continue-on-error'], undefined, entry);
    }
  }
  const admitted = (name: string, results: Record<string, string>, macos: string,
    event = 'pull_request', cancelled = false) => {
    const expression = ci.jobs[name].if.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    const implicitSuccess = !cancelled && ancestors(name).every(parent => (results[parent] ?? 'success') === 'success');
    if (!/\b(always|failure|cancelled|success)\s*\(/.test(expression) && !implicitSuccess) return false;
    const needs: Record<string, {result: string; outputs?: {macos: string}}> =
      Object.fromEntries(ancestors(name).map(parent => [parent, {result: results[parent] ?? 'success'}]));
    needs.select = {...needs.select, outputs: {macos}};
    return Function('github', 'needs', 'cancelled', `return (${expression});`)(
      {event_name: event, event: {pull_request: {draft: false}}}, needs, () => cancelled);
  };
  for (const name of ['macos', 'hermes-macos']) {
    for (const parent of ['linux', 'contracts', 'hermes']) {
      for (const result of ['failure', 'skipped', 'cancelled', '', 'unknown']) {
        for (const selected of ['true', 'false', '']) {
          for (const event of ['pull_request', 'push']) {
            for (const selection of ['success', 'failure', 'skipped', 'cancelled']) {
              assert.equal(admitted(name, {[parent]: result, select: selection}, selected, event), false,
                `${name} on ${event} with ${parent} ${result}, selector ${selection}, selected ${selected}`);
            }
          }
        }
      }
    }
    assert.equal(admitted(name, {}, 'true', 'push'), true);
    assert.equal(admitted(name, {}, 'true', 'pull_request', true), false);
  }
  assert.equal(admitted('macos', {}, 'false'), false);
  assert.equal(admitted('macos', {}, 'true'), true);
  assert.equal(admitted('macos', {select: 'failure'}, 'true'), true, 'selector failure alone cannot suppress Mac');
  assert.equal(admitted('macos', {select: 'failure'}, 'false'), true, 'failed partial output cannot exempt Mac');
  assert.equal(admitted('hermes-macos', {}, 'false'), true);
  assert.equal(ci.jobs.hermes['runs-on'], 'ubuntu-24.04');
  assert.equal(ci.jobs.hermes.needs, undefined, 'cheap inspection must not wait for full suites');
});

test('Mac inspection preserves its checks but runs only for ready PRs and main pushes', () => {
  const ci = workflow('checks.yml');
  const inspection = ci.jobs['hermes-macos'];
  assert.ok(inspection);
  assert.equal(inspection['runs-on'], 'macos-15-intel');
  assert.deepEqual(inspection.steps, ci.jobs.hermes.steps);
  // The Settings exemption applies to the platform workflow; Hermes keeps
  // main's own event admission and Linux-first checks.
  assert.equal(inspection.if, ci.jobs.linux.if);
});

// Isolate the entire synchronous scope: production helpers also spawn Git.
// cwd alone cannot protect the caller's index/config from inherited hook vars.
function repository(action: (git: (...args: string[]) => string, dir: string) => void) {
  const dir = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/apparent-dev-ci-fixture-`);
  const previous = process.cwd();
  const inherited: Record<string, string> = {};
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) {
    inherited[key] = process.env[key]!;
    delete process.env[key];
  }
  try {
    process.chdir(dir);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git('init', '-qb', 'main');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@example.invalid');
    action(git, dir);
  } finally {
    process.chdir(previous);
    Object.assign(process.env, inherited);
    rmSync(dir, {recursive: true, force: true});
  }
}

function runSelector(base: string, head: string, dir: string) {
  const output = dir + '/.git/selection.txt';
  writeFileSync(output, '');
  const stdout = execFileSync(process.execPath, [new URL('enablement/ci/select.ts', root).pathname], {
    env: {...process.env, BASE_SHA: base, GITHUB_SHA: head, GITHUB_OUTPUT: output}, encoding: 'utf8',
  });
  const decision = JSON.parse(stdout);
  const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
  assert.deepEqual(outputs, {public: String(decision.public), updater: String(decision.updater), macos: String(decision.macos)});
  return decision as ReturnType<typeof selectRange>;
}

test('unknown history runs all checks and git deltas include deleted and renamed owner paths', () => repository((git, dir) => {
  assert.equal(changedPaths('', ''), null);
  assert.equal(changedPaths('0'.repeat(40), 'a'.repeat(40)), null);
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
    assert.deepEqual(changedPaths(base, git('rev-parse', 'HEAD'), true), ['outside.txt', 'public/site/old.txt']);
    assert.equal(requiresMac(paths, changedPaths(base, git('rev-parse', 'HEAD'), true)), true);
    assert.equal(changedPaths('a'.repeat(40), git('rev-parse', 'HEAD')), null);
    const card = 'capture/desktop/ui/frontend/src/storage.tsx';
    mkdirSync('capture/desktop/ui/frontend/src', {recursive: true});
    const beforeAdd = git('rev-parse', 'HEAD');
    writeFileSync(card, 'before');
    git('add', card); git('commit', '-qm', 'add card');
    assert.equal(runSelector(beforeAdd, git('rev-parse', 'HEAD'), dir).macos, true);
    const beforeEdit = git('rev-parse', 'HEAD');
    writeFileSync(card, 'after');
    git('add', card); git('commit', '-qm', 'edit card');
    assert.deepEqual(runSelector(beforeEdit, git('rev-parse', 'HEAD'), dir),
      {public: false, updater: false, macos: false, reasons: [`linux:reviewed-settings:${card}`]});
    const beforeType = git('rev-parse', 'HEAD');
    unlinkSync(card); symlinkSync('retention.tsx', card);
    git('add', card); git('commit', '-qm', 'change card type');
    assert.equal(runSelector(beforeType, git('rev-parse', 'HEAD'), dir).macos, true);
    const beforeDelete = git('rev-parse', 'HEAD');
    git('rm', card); git('commit', '-qm', 'remove card');
    assert.equal(runSelector(beforeDelete, git('rev-parse', 'HEAD'), dir).macos, true);
}));

test('Mac exemption is exact, nonempty, modification-only and fails closed', () => {
  const prefix = 'capture/desktop/ui/frontend/';
  const allowed = ['storage', 'retention', 'connect-settings', 'error-reporting', 'reference']
    .map(name => prefix + 'src/' + name + '.tsx');
  assert.equal(requiresMac(allowed), false);
  for (const path of allowed) {
    assert.equal(requiresMac([path]), false);
    assert.equal(requiresMac([path], [path]), true);
  }
  for (const path of ['src/new.tsx', 'src/style.css', 'src/settings.tsx', 'src/bridge.ts',
    'src/notes/index.tsx', 'src/onboarding/onboarding.tsx', 'electron/main.cjs',
    'electron/preload.cjs', 'package-lock.json', 'tests/storage-smoke.cjs']) {
    assert.equal(requiresMac([...allowed, prefix + path]), true, path);
  }
  for (const path of ['shared/ui/src/button.tsx', 'capture/desktop/mod.rs',
    '.github/workflows/checks.yml', 'enablement/ci/select.ts', 'README.md']) {
    assert.equal(requiresMac([...allowed, path]), true, path);
  }
  assert.equal(requiresMac(null), true);
  assert.equal(requiresMac([]), true);
  assert.equal(requiresMac(allowed, null), true);
});

const portal = 'capture/desktop/linux/capture/portal.rs';
const linuxDoc = 'capture/desktop/docs/linux/linux.md';
const featureMap = 'public/site/src/features.json';
const metadata = () => JSON.parse(readFileSync(new URL(featureMap, root), 'utf8'));

test('feature metadata exemption changes only direct note strings in the known schema', () => {
  const before = metadata();
  const after = structuredClone(before);
  after.features[0].note = 'Arbitrary documentation, independent of platform words.';
  assert.equal(featureNotesOnly(JSON.stringify(before), JSON.stringify(after)), true);
  assert.equal(featureNotesOnly(JSON.stringify(after), JSON.stringify(before)), true);
  after.features[0].note = 'Another note';
  assert.equal(featureNotesOnly(JSON.stringify(before), JSON.stringify(after)), true);
  for (const [field, value] of Object.entries({platforms: ['linux'], status: 'experiment:future', flag: 'new-flag',
    config: [{key: 'newRuntime', value: 'true', does: 'new behavior'}], docs: ['missing.md'],
    shortcuts: [{keys: 'Super+S', does: 'record'}], id: 'new-id', name: 'New name', added: '2027-01-01',
    says: 'Different promise', pr: 999, group: 'unknown', runtime: true, note: null})) {
    const changed = structuredClone(after);
    changed.features[0][field] = value;
    assert.equal(featureNotesOnly(JSON.stringify(before), JSON.stringify(changed)), false, field);
  }
  for (const mutate of [
    (map: any) => map.features.push({...map.features[0], id: 'new-feature'}),
    (map: any) => map.features.pop(),
    (map: any) => map.features.reverse(),
    (map: any) => map.groups[0].title = 'Different title',
    (map: any) => map.flow[0].detail = 'Different flow',
    (map: any) => map.futureContract = true,
    (map: any) => map.features[0].config = [{key: 'runtime', value: 'x', does: 'x', unknown: true}],
  ]) {
    const changed = structuredClone(before); mutate(changed);
    assert.equal(featureNotesOnly(JSON.stringify(before), JSON.stringify(changed)), false);
  }
  // Unknown contracts on both sides must not be grandfathered into the exemption.
  for (const mutate of [
    (map: any) => map.runtime = true,
    (map: any) => map.features[0].runtime = true,
    (map: any) => map.groups[0].runtime = true,
    (map: any) => map.features[0].shortcuts = [{keys: 'x', does: 'x', runtime: true}],
    (map: any) => map.features[0].id = map.features[1].id,
    (map: any) => map.features[0].platforms = 'linux',
    (map: any) => map.features[0].platforms = ['unknown-platform'],
    (map: any) => map.features[0].status = 'unknown-status',
    (map: any) => map.features[0].docs = [42],
    (map: any) => map.features[0].config = [{key: 'x', value: true, does: 'x'}],
    (map: any) => map.features[0].shortcuts = [{keys: 42, does: 'x'}],
    (map: any) => map.features[0].pr = 'unknown',
    (map: any) => map.groups[0].title = 42,
    (map: any) => map.features[0].id = 'Not Kebab',
    (map: any) => map.features[0].name = '',
    (map: any) => map.features[0].says = '',
    (map: any) => map.features[0].added = 'tomorrow',
  ]) {
    const unknown = structuredClone(before); mutate(unknown);
    const changed = structuredClone(unknown); changed.features[0].note = 'new';
    assert.equal(featureNotesOnly(JSON.stringify(unknown), JSON.stringify(changed)), false);
  }
  for (const invalid of ['{', 'null', '[]', '{"features": {}}']) {
    assert.equal(featureNotesOnly(invalid, JSON.stringify(after)), false);
    assert.equal(featureNotesOnly(JSON.stringify(before), invalid), false);
  }
  assert.equal(requiresMac([featureMap]), true, 'paths alone cannot establish a note-only change');
});

function linuxFixture(action: (git: (...args: string[]) => string, dir: string, base: string) => void) {
  repository((git, dir) => {
    for (const path of [portal, linuxDoc, featureMap, 'capture/desktop/ui/frontend/src/storage.tsx']) {
      mkdirSync(path.slice(0, path.lastIndexOf('/')), {recursive: true});
      writeFileSync(path, readFileSync(new URL(path, root)));
    }
    git('add', '.'); git('commit', '-qm', 'audited inputs');
    action(git, dir, git('rev-parse', 'HEAD'));
  });
}

test('production Git/CLI selects Linux and Public for the portal, guide and feature note delta', () => linuxFixture((git, dir, base) => {
  // The same three-file shape as the portal source-type fix, with no PR/SHA or
  // English-prose matching. Use real source and feature-map inputs.
  appendFile(portal, '\nfn selected_source_type(source_type: Option<u32>) -> bool { source_type != Some(2) }\n');
  appendFile(linuxDoc, '\nA documented portal scope restriction.\n');
  const map = metadata(); map.features[0].note = 'Synthetic portal caveat.';
  writeFileSync(featureMap, JSON.stringify(map));
  git('add', '.'); git('commit', '-qm', 'portal restriction and documentation');
  const head = git('rev-parse', 'HEAD');
  assert.deepEqual(changedPaths(base, head), [linuxDoc, portal, featureMap]);
  assert.deepEqual(changedPaths(base, head), sharedInputPaths(base, head, process.cwd()));
  const expected = {public: true, updater: false, macos: false, reasons: [
    `linux:reviewed-portal-input:${linuxDoc}`, `linux:reviewed-portal-input:${portal}`, `linux:feature-notes-only:${featureMap}`,
  ]};
  assert.deepEqual(selectRange(base, head), expected);
  assert.deepEqual(runSelector(base, head, dir), expected);
  // Read committed blobs, not the checkout's later working contents.
  writeFileSync(featureMap, '{broken working file');
  assert.deepEqual(runSelector(base, head, dir), expected);
}));

function appendFile(path: string, text: string) {
  writeFileSync(path, readFileSync(path, 'utf8') + text);
}

test('malformed UTF-8 in committed metadata cannot qualify as a note-only change', () => linuxFixture((git, dir, base) => {
  const map = metadata(); map.features[0].note = 'invalid-byte';
  const text = JSON.stringify(map);
  const at = text.indexOf('invalid-byte');
  writeFileSync(featureMap, Buffer.concat([Buffer.from(text.slice(0, at)), Buffer.from([0xff]), Buffer.from(text.slice(at + 12))]));
  git('add', '.'); git('commit', '-qm', 'invalid note encoding');
  const head = git('rev-parse', 'HEAD');
  const invalid = runSelector(base, head, dir);
  assert.equal(invalid.public, true);
  assert.equal(invalid.macos, true);
  // An invalid base is no more trustworthy than an invalid candidate.
  writeFileSync(featureMap, text); git('add', '.'); git('commit', '-qm', 'valid note encoding');
  assert.equal(runSelector(head, git('rev-parse', 'HEAD'), dir).macos, true);
}));

test('proved concurrency-only local input never exempts hosted Mac verification', () => repository((git, dir) => {
  const path = '.github/workflows/checks.yml';
  mkdirSync('.github/workflows', {recursive: true});
  const before = readFileSync(new URL(path, root), 'utf8');
  writeFileSync(path, before); git('add', '.'); git('commit', '-qm', 'orchestrator base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(path, before.replace(/  cancel-in-progress: .*/, '  cancel-in-progress: false'));
  git('add', '.'); git('commit', '-qm', 'concurrency control');
  const head = git('rev-parse', 'HEAD');
  assert.deepEqual(workflowControlPaths(base, head, sharedInputPaths(base, head, dir), dir), [path]);
  assert.deepEqual(runSelector(base, head, dir), {public: true, updater: true, macos: true,
    reasons: [`mac:unproven-input:${path}`]});
}));

test('Linux-only source/docs and metadata-only notes qualify independently and compose with Settings', () => linuxFixture((git, dir, base) => {
  for (const path of [portal, linuxDoc, featureMap, 'capture/desktop/ui/frontend/src/storage.tsx']) {
    git('checkout', '--detach', base);
    if (path === featureMap) {
      const map = metadata(); map.features[0].note = 'Documentation only';
      writeFileSync(path, JSON.stringify(map));
    } else appendFile(path, '\n// synthetic edit\n');
    git('add', '.'); git('commit', '-qm', 'reviewed modification');
    const result = runSelector(base, git('rev-parse', 'HEAD'), dir);
    assert.equal(result.macos, false, path);
    assert.equal(result.public, path === featureMap || path === linuxDoc, path);
  }
  appendFile(portal, '\n// portal edit\n'); git('add', portal); git('commit', '-qm', 'compose portal and Settings');
  assert.equal(runSelector(base, git('rev-parse', 'HEAD'), dir).macos, false);
}));

test('mixed shared, Mac, ABI, dependencies, packaging, CI and unknown inputs retain Mac', () => linuxFixture((git, dir, base) => {
  for (const path of ['shared/model.rs', 'capture/desktop/native/Settings.swift', 'capture/desktop/mod.rs',
    'capture/desktop/linux/capture/mod.rs', 'capture/desktop/ui/frontend/src/bridge.ts',
    'build.rs', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'capture/desktop/ui/frontend/package-lock.json',
    'capture/desktop/scripts/packaging/build-mac-preview.sh', '.github/workflows/checks.yml', 'unknown.md']) {
    git('checkout', '--detach', base);
    appendFile(portal, '\n// portal edit\n');
    mkdirSync(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.', {recursive: true});
    writeFileSync(path, 'Unreviewed input');
    git('add', '.'); git('commit', '-qm', 'mixed delta');
    const result = runSelector(base, git('rev-parse', 'HEAD'), dir);
    assert.equal(result.macos, true, path);
    assert.ok(result.reasons.includes(`mac:unsupported-change:${path}`));
    const modificationBase = git('rev-parse', 'HEAD');
    appendFile(path, '\nModified existing unreviewed input\n');
    appendFile(portal, '\n// another portal edit\n');
    git('add', '.'); git('commit', '-qm', 'mixed modifications');
    const modified = runSelector(modificationBase, git('rev-parse', 'HEAD'), dir);
    assert.equal(modified.macos, true, path);
    assert.ok(modified.reasons.includes(`mac:unproven-input:${path}`));
  }
  for (const mutate of [
    (map: any) => map.features[0].platforms = ['linux'],
    (map: any) => map.features[0].config = [{key: 'newKey'}],
    (map: any) => map.features[0].status = 'experiment:future',
    (map: any) => map.features[0].futureContract = true,
  ]) {
    git('checkout', '--detach', base);
    appendFile(portal, '\n// portal edit\n');
    const map = metadata(); mutate(map); writeFileSync(featureMap, JSON.stringify(map));
    git('add', '.'); git('commit', '-qm', 'semantic metadata');
    assert.equal(runSelector(base, git('rev-parse', 'HEAD'), dir).macos, true);
  }
}));

test('real Git additions, deletions, both rename sides, executable modes and symlinks fail closed', () => linuxFixture((git, dir, base) => {
  const card = 'capture/desktop/ui/frontend/src/storage.tsx';
  for (const path of [portal, linuxDoc, featureMap, card]) {
    for (const operation of ['add', 'delete', 'rename-out', 'rename-in', 'chmod', 'symlink', 'edit-symlink']) {
      git('checkout', '--detach', base);
      if (operation === 'add' || operation === 'rename-in') {
        git('mv', path, 'outside.txt'); git('commit', '-qam', 'before addition or move');
      } else if (operation === 'edit-symlink') {
        unlinkSync(path); symlinkSync('first-target', path);
        git('add', '.'); git('commit', '-qm', 'symlink base');
      }
      const from = git('rev-parse', 'HEAD');
      if (operation === 'add') writeFileSync(path, 'new input');
      if (operation === 'delete') git('rm', path);
      if (operation === 'rename-out') git('mv', path, 'outside.txt');
      if (operation === 'rename-in') git('mv', 'outside.txt', path);
      if (operation === 'chmod') chmodSync(path, 0o755);
      if (operation === 'symlink' || operation === 'edit-symlink') { unlinkSync(path); symlinkSync('second-target', path); }
      git('add', '.'); git('commit', '-qm', 'unsupported change');
      const head = git('rev-parse', 'HEAD');
      const result = runSelector(from, head, dir);
      assert.equal(result.macos, true, `${path}: ${operation}`);
      assert.ok(changedPaths(from, head, true)!.includes(path), `${path}: ${operation}`);
      if (operation.startsWith('rename-')) assert.deepEqual(changedPaths(from, head)!.sort(), [path, 'outside.txt'].sort());
    }
  }
}));

test('full merge delta carries earlier unverified changes; missing, divergent and shallow history retain coverage', () => linuxFixture((git, dir, base) => {
  writeFileSync('shared-contract.rs', 'earlier unverified change');
  git('add', '.'); git('commit', '-qm', 'earlier shared change');
  const earlier = git('rev-parse', 'HEAD');
  appendFile(linuxDoc, '\nLater documentation\n'); git('add', '.'); git('commit', '-qm', 'later docs');
  const head = git('rev-parse', 'HEAD');
  assert.equal(runSelector(earlier, head, dir).macos, false, 'latest-commit comparison would lose coverage');
  git('checkout', '-qb', 'base-advance', base);
  writeFileSync('base-only.txt', 'new main'); git('add', '.'); git('commit', '-qm', 'advance main');
  const currentBase = git('rev-parse', 'HEAD');
  git('merge', '--no-ff', '-qm', 'proposed PR merge', head);
  const merge = git('rev-parse', 'HEAD');
  const result = runSelector(currentBase, merge, dir);
  assert.equal(result.macos, true);
  assert.ok(result.reasons.includes('mac:unsupported-change:shared-contract.rs'));
  for (const [from, to] of [['', ''], ['0'.repeat(40), head], ['a'.repeat(40), head], [currentBase, head], [base, base]]) {
    const decision = runSelector(from, to, dir);
    assert.equal(decision.macos, true);
    if (from !== to || !from) assert.deepEqual(selectRange(from, to),
      {public: true, updater: true, macos: true, reasons: ['mac:unknown-history']});
  }
  git('clone', '--quiet', '--no-local', '--depth=2', dir, dir + '/shallow');
  process.chdir(dir + '/shallow');
  assert.deepEqual(runSelector(currentBase, merge, dir + '/shallow'),
    {public: true, updater: true, macos: true, reasons: ['mac:unknown-history']});
}));

test('audited consumers keep full Linux commands, portable contracts, metadata web checks and Mac release admission', () => {
  const source = (path: string) => readFileSync(new URL(path, root), 'utf8');
  assert.match(source('capture/desktop/mod.rs'), /#\[cfg\(target_os = "linux"\)\]\s*pub\(crate\) mod linux;/);
  assert.match(source('capture/desktop/linux/mod.rs'), /pub\(crate\) mod capture;/);
  assert.match(source('capture/desktop/linux/capture/mod.rs'), /pub\(crate\) mod portal;/);
  assert.match(source('composition/mod.rs'), /#\[cfg\(test\)\]\s*pub\(crate\) mod feature_map;/);
  assert.match(source('composition/feature_map.rs'), /fn the_feature_map_covers_every_config_key_and_experiment/);
  assert.match(source('public/site/src/features.ts'), /import data from "\.\/features.json"/);
  assert.deepEqual(select([featureMap]), {public: true, updater: false});
  assert.ok(metadata().features.some((feature: any) => feature.docs?.some((doc: string) => doc.startsWith(linuxDoc + '#'))),
    'Public feature audit reads the Linux guide to resolve referenced headings');
  assert.deepEqual(select([linuxDoc]), {public: true, updater: false});
  const platform = workflow('verification-platform.yml');
  const steps = platform.jobs.select.steps;
  assert.match(steps.find((step: any) => step.id === 'plan').run, /git hash-object -t tree \/dev\/null/);
  assert.ok(steps.some((step: any) => step.run?.includes('--execution portable') && !step.if));
  assert.equal(platform.jobs.rust.needs, 'select');
  assert.equal(platform.jobs['desktop-ui'].needs, 'select');
  assert.ok(platform.jobs.rust.steps.some((step: any) => step.run?.includes('--execution platform')));
  assert.ok(platform.jobs['desktop-ui'].steps.some((step: any) => step.run === 'npm test' && !step.if));
  assert.ok(platform.jobs['desktop-ui'].steps.some((step: any) => step.run?.includes('xvfb-run -a npm run test:electron') && !step.if));
  assert.match(source('.github/workflows/release-mac-preview.yml'), /enablement\/release_gate.py --platform macos --sha "\$GITHUB_SHA"/);
  assert.equal(macDecision([portal, linuxDoc]).macos, false);
  assert.equal(macDecision([portal], ['unknown-input']).macos, true);
});
