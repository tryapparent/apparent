import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {YAML} from 'bun';
import {routeDecision, unownedPaths, routingProblems} from './consumers.ts';
import {selectRange} from '../select.ts';
import {selection as localSelection, commands as localCommands} from '../../local-tests/run.ts';
import {affectsStream, currentStream, streamPaths, type Stream} from './streams.ts';

const root = new URL('../../../', import.meta.url);
const workflows = {capture: 'checks.yml', connect: 'stream-connect.yml', public: 'stream-public.yml', hermes: 'hermes.yml'};
test('both automatic events use the reviewed positive directory inventory', () => {
  for (const [stream, file] of Object.entries(workflows)) {
    const workflow = YAML.parse(readFileSync(new URL('.github/workflows/' + file, root), 'utf8'));
    for (const event of ['push', 'pull_request']) assert.deepEqual(workflow.on[event].paths, streamPaths[stream as Stream]);
    if (stream === 'public' || stream === 'connect') {
      const job = workflow.jobs[stream === 'public' ? 'deploy' : 'hosted'];
      assert.equal(job.steps.find((step: any) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
    }
  }
  for (const stream of Object.keys(workflows) as Stream[]) {
    for (const path of ['shared/new/file.ts', 'composition/new/file.ts']) assert.equal(affectsStream(stream, path), true);
    assert.equal(affectsStream(stream, 'unowned/new.ts'), true);
  }
  assert.equal(affectsStream('public', 'capture/desktop/ui/frontend/tests/reference-native.cjs'), false);
  assert.equal(affectsStream('public', 'enablement/prerequisites/mac-picker.test.ts'), false);
  assert.equal(affectsStream('hermes', 'public/site/src/App.tsx'), false);
  assert.equal(affectsStream('capture', 'public/site/src/App.tsx'), false);
  assert.equal(affectsStream('public', 'public/new/file.ts'), true);
  assert.equal(affectsStream('capture', 'capture/desktop/new/file.ts'), true);
  assert.equal(affectsStream('connect', 'connect/new/file.ts'), true);
  assert.equal(affectsStream('hermes', 'hermes/new/file.ts'), true);
});

test('cheap contracts surface new top-level ownership instead of selecting every stream', () => {
  const paths = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const unowned = unownedPaths(paths);
  assert.deepEqual(unowned, [], 'declare new directory ownership and workflow consumers');
});

test('pending exact-candidate delivery survives unrelated main changes, but not affected, rename, deletion or divergent inputs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stream-candidate-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const put = (path: string) => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), 'fixture');};
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    put('public/site/page.ts'); git('add', '.'); git('commit', '-qm', 'candidate'); const candidate = git('rev-parse', 'HEAD');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), true);
    put('capture/desktop/change.ts'); git('add', '.'); git('commit', '-qm', 'unrelated');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), true);
    put('AGENTS.md'); put('capture/desktop/docs/new.md'); git('add', '.'); git('commit', '-qm', 'ordinary guidance');
    // Capture source already changed since candidate; compare with that checkpoint.
    const docsParent = git('rev-parse', 'HEAD^');
    assert.equal(currentStream('capture', docsParent, 'HEAD', cwd), true);
    put('capture/agent/skills/apparent/SKILL.md'); git('add', '.'); git('commit', '-qm', 'embedded instructions');
    assert.equal(currentStream('capture', docsParent, 'HEAD', cwd), false);
    git('mv', 'public/site/page.ts', 'capture/desktop/moved.ts'); git('commit', '-qm', 'rename');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), false);
    git('reset', '--hard', candidate); put('shared/change.ts'); git('add', '.'); git('commit', '-qm', 'shared');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), false);
    assert.throws(() => currentStream('public', git('rev-parse', 'HEAD'), candidate, cwd));
    assert.throws(() => currentStream('public', 'invalid', 'HEAD', cwd));
    git('reset', '--hard', candidate);
    put('connect/client/typescript/src/transport.ts'); git('add', '.'); git('commit', '-qm', 'native client');
    assert.equal(currentStream('connect', candidate, 'HEAD', cwd), true, 'client checks do not change Worker payload');
    assert.equal(currentStream('capture', candidate, 'HEAD', cwd), false, 'the app consumes the native client');
    const withClient = git('rev-parse', 'HEAD');
    put('capture/desktop/ui/frontend/tests/onboarding/account.test.ts'); git('add', '.'); git('commit', '-qm', 'policy test');
    assert.equal(currentStream('capture', withClient, 'HEAD', cwd), true, 'policy-test-only changes do not strand installers');
    put('connect/service/src/worker.ts'); git('add', '.'); git('commit', '-qm', 'Worker payload');
    assert.equal(currentStream('connect', withClient, 'HEAD', cwd), false);

  } finally {rmSync(cwd, {recursive: true, force: true});}
});

test('tracked transitive consumers are reachable through the same workflow inventory', () => {
  const paths = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  for (const path of paths) {
    const decision = routeDecision([path]);
    for (const [stream, required] of Object.entries(decision.requiredStreams))
      if (required) assert.equal(affectsStream(stream as Stream, path), true, `${stream} excludes ${path}`);
  }
});

test('real Git deltas give local and hosted onboarding the same suites, native boundaries and fallback', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'onboarding-plan-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const put = (path: string, text = 'export const value = 1;') => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), text);};
  const frontend = 'capture/desktop/ui/frontend/';
  const policy = frontend + 'electron/onboarding/account.ts', renderer = frontend + 'src/onboarding/account.tsx';
  const bridge = frontend + 'electron/onboarding-protocol.cjs', receipt = frontend + 'src/onboarding/pen/save.ts';
  const sourceTest = frontend + 'tests/onboarding/account.test.ts';
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    for (const path of [policy, renderer, bridge, receipt, sourceTest, 'connect/service/src/auth.ts']) put(path);
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    const decision = () => {
      const head = git('rev-parse', 'HEAD'), local = localSelection(base, head, cwd), hosted = selectRange(base, head, cwd);
      assert.deepEqual(local.plan, hosted.plan); assert.deepEqual(local.suites, hosted.suites); assert.deepEqual(local.reasons, hosted.reasons);
      return {local, hosted, commands: localCommands(local.selected, base, head, 'linux', local.rustChanged, {paths: local.paths})};
    };
    const change = (paths: string[], text?: string) => {git('reset', '--hard', base); for (const path of paths) put(path, text ?? 'export const value = 2;'); git('add', '.'); git('commit', '-qm', 'candidate'); return decision();};
    for (const paths of [[policy, sourceTest], [renderer]]) {
      const result = change(paths);
      assert.equal(result.hosted.plan.desktop, true); assert.equal(result.hosted.plan.onboarding, true);
      for (const suite of ['root','engine','client','browser','service','tools','public','hermes']) assert.equal(result.hosted.plan[suite as keyof typeof result.hosted.plan], false, suite);
      assert.ok(result.commands.some(command => command.argv.includes('test:onboarding-policy')));
      assert.ok(result.commands.some(command => command.argv.includes('test:electron')));
      assert.ok(!result.commands.some(command => command.argv.includes('cargo') || command.argv.includes('--run') || /^(connect|public|hermes)\//.test(command.cwd)));
    }
    assert.equal(change([sourceTest]).hosted.plan.desktop, false);
    const manifests = change([frontend + 'tests/onboarding/package.json', frontend + 'tests/onboarding/package-lock.json'], '{}');
    assert.equal(manifests.hosted.historyKnown, true); assert.equal(manifests.hosted.inputProofKnown, true);
    assert.equal(manifests.hosted.plan.onboarding, true); assert.equal(manifests.hosted.plan.desktop, false);
    assert.deepEqual(routingProblems(manifests.hosted), []);
    rmSync(join(cwd, frontend + 'tests/onboarding/package.json')); rmSync(join(cwd, frontend + 'tests/onboarding/package-lock.json'));

    for (const path of [bridge, receipt]) assert.equal(change([path]).hosted.plan.root, true);
    const mixed = change([policy, 'connect/service/src/auth.ts']);
    assert.equal(mixed.hosted.plan.client, true); assert.equal(mixed.hosted.plan.service, true); assert.equal(mixed.hosted.plan.onboarding, true);
    assert.equal(change([policy], "import {execFile} from 'node:child_process';").hosted.plan.hermes, true, 'new pure-policy imports fail broad');
    const newPolicy = change([frontend + 'electron/onboarding/selection.ts'], "import {execFile} from 'node:child_process';\nexport const choice = 1;");
    assert.equal(newPolicy.hosted.plan.public, true, 'unexpected imports in a new audited policy path keep the conservative fallback');
    const newNativeBoundary = change([frontend + 'electron/onboarding/new.rs']);
    assert.equal(newNativeBoundary.hosted.plan.hermes, true, 'new native boundary inputs keep the conservative fallback');
    git('reset', '--hard', base); git('mv', policy, frontend + 'electron/moved.ts'); git('commit', '-qm', 'rename');
    assert.equal(decision().hosted.plan.root, true); assert.equal(decision().hosted.plan.public, false);
    assert.equal(decision().hosted.historyKnown, true); assert.equal(decision().hosted.inputProofKnown, true);
    assert.deepEqual(routingProblems(decision().hosted), [], 'the source deletion and ordinary frontend addition have proven consumers');
    git('reset', '--hard', base); git('rm', policy); git('commit', '-qm', 'delete');
    const deletedPolicy = decision().hosted;
    assert.equal(deletedPolicy.plan.desktop, true); assert.equal(deletedPolicy.plan.onboarding, true);
    assert.equal(deletedPolicy.plan.root, false); assert.equal(deletedPolicy.plan.public, false);
    assert.equal(deletedPolicy.macos, true, 'deleting a renderer-consumed policy file keeps the Mac boundary');
    assert.equal(deletedPolicy.inputProofKnown, true); assert.deepEqual(routingProblems(deletedPolicy), []);
    git('reset', '--hard', base); git('rm', policy);
    put('capture/desktop/settings/onboarding/account.rs'); git('add', '.'); git('commit', '-qm', 'native ownership baseline');
    const nativeBase = git('rev-parse', 'HEAD');
    git('rm', 'capture/desktop/settings/onboarding/account.rs'); git('commit', '-qm', 'remove legacy native account policy');
    const deletedNative = selectRange(nativeBase, git('rev-parse', 'HEAD'), cwd);
    assert.equal(deletedNative.plan.desktop, true); assert.equal(deletedNative.plan.onboarding, true);
    assert.equal(deletedNative.plan.public, false); assert.equal(deletedNative.plan.hermes, false);
    assert.equal(deletedNative.macos, true, 'native deletion remains a Mac acceptance boundary');
    assert.equal(deletedNative.inputProofKnown, true); assert.deepEqual(routingProblems(deletedNative), []);
    const missingLocal = localSelection('missing', 'HEAD', cwd), missingHosted = selectRange('missing', 'HEAD', cwd);
    assert.deepEqual(missingLocal.plan, missingHosted.plan); assert.equal(missingHosted.plan.public, true);
    assert.ok(missingHosted.reasons.some(reason => reason.startsWith('fallback:')));
  } finally {rmSync(cwd, {recursive: true, force: true});}
});

test('foreground modifications share the portable plan; adoption, imports, protocol and native deltas keep native consumers', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'foreground-plan-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const put = (path: string, text: string) => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), text);};
  const source = 'connect/client/typescript/src/foreground.ts', testPath = 'connect/client/typescript/test/foreground.test.ts';
  const policy = `import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
export type Asset = {};
export type Upload = {};
export type Operation = {operation:'reserve'};
export type Progress = {};
export type Port = {};
const fail = () => {};
const privateValue = 1;
export async function uploadForeground(raw:Upload, port:Port):Promise<void> {
  const value = privateValue;
}
async function stdio(){return 1;}
if(import.meta.url) void stdio();
`;
  const tests = `import assert from 'node:assert/strict';
import {test} from 'node:test';
import {uploadForeground} from '../src/foreground.ts';
`;
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    put('README.md', 'fixture'); git('add', '.'); git('commit', '-qm', 'base'); const empty = git('rev-parse', 'HEAD');
    put(source, policy); put(testPath, tests); git('add', '.'); git('commit', '-qm', 'adoption'); const base = git('rev-parse', 'HEAD');
    const adoption = selectRange(empty, base, cwd);
    assert.equal(adoption.plan.foreground, true); assert.equal(adoption.plan.root, true); assert.equal(adoption.plan.client, true);
    const change = (file: string, value: string) => {
      git('reset', '--hard', base); put(file, value); git('add', '.'); git('commit', '-qm', 'candidate'); const head = git('rev-parse', 'HEAD');
      const local = localSelection(base, head, cwd), hosted = selectRange(base, head, cwd);
      assert.deepEqual(local.plan, hosted.plan); assert.deepEqual(local.reasons, hosted.reasons);
      return {local, hosted, commands: localCommands(local.selected, base, head, 'linux', local.rustChanged, {paths: local.paths})};
    };
    for (const [file, value] of [[source, policy.replace('privateValue = 1', 'privateValue = 2')], [testPath, tests + '// test edit\n']]) {
      const result = change(file, value);
      assert.equal(result.hosted.plan.foreground, true);
      for (const suite of ['root','engine','desktop','client','browser','service','tools','public','hermes','onboarding']) assert.equal(result.hosted.plan[suite as keyof typeof result.hosted.plan], false, suite);
      assert.equal(result.commands.filter(command => command.cwd === 'connect/client/typescript').length, 4);
      assert.ok(!result.commands.some(command => command.argv.includes('--run') || command.argv.includes('cargo') || command.argv.includes('test:electron')));
      assert.deepEqual(routingProblems(result.hosted), []);
      assert.equal(result.hosted.installer, file === source, 'only shipped source changes the app payload');
    }
    for (const value of [policy + "import {readFile} from 'node:fs';\n", policy.replace("operation:'reserve'", "operation:'changed'")]) {
      const result = change(source, value);
      assert.equal(result.hosted.plan.root, true); assert.equal(result.hosted.plan.client, true);
      assert.ok(result.hosted.reasons.some(reason => reason.startsWith('foreground:native-boundary:')));
    }
    for (const file of ['connect/client/typescript/src/shares.ts', 'connect/client/typescript/package.json', 'connect/client/src/foreground.rs']) {
      const result = change(file, '{}');
      assert.equal(result.hosted.plan.root, true); assert.equal(result.hosted.plan.client, true);
    }
    git('reset', '--hard', base); git('rm', source); git('commit', '-qm', 'delete');
    assert.equal(selectRange(base, git('rev-parse', 'HEAD'), cwd).plan.client, true);
    git('reset', '--hard', base); git('mv', source, 'connect/client/typescript/src/moved.ts'); git('commit', '-qm', 'move');
    assert.equal(selectRange(base, git('rev-parse', 'HEAD'), cwd).plan.client, true);
    git('reset', '--hard', base); rmSync(join(cwd, source)); symlinkSync('../test/foreground.test.ts', join(cwd, source)); git('add', '.'); git('commit', '-qm', 'symlink');
    const unsafe = selectRange(base, git('rev-parse', 'HEAD'), cwd);
    assert.equal(unsafe.plan.root, true); assert.equal(unsafe.inputProofKnown, false);
    assert.ok(routingProblems(unsafe).length > 0);
  } finally {rmSync(cwd, {recursive: true, force: true});}
});
