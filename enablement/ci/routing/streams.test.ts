import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {YAML} from 'bun';
import {routeDecision, unownedPaths, routingProblems} from './consumers.ts';
import {selectRange, requiresMacRustRange} from '../select.ts';
import {selection as localSelection, commands as localCommands, onboardingCommands} from '../../local-tests/run.ts';
import {affectsStream, currentStream, streamPaths, type Stream} from './streams.ts';

const root = new URL('../../../', import.meta.url);
const workflows = {capture: 'checks.yml', connect: 'stream-connect.yml', public: 'stream-public.yml', hermes: 'hermes.yml', engine: 'stream-engine.yml'};
test('Connect consent dependencies add onboarding proof without dropping native consumers', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'onboarding-connect-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const frontend = 'capture/desktop/ui/frontend/';
  const inputs = ['src/connect/consent.ts', 'src/connect/protocol.ts', 'src/connect/session.ts',
    'src/connect/flow.ts', 'src/bridge.ts', 'tests/connect/flow.test.ts',
    'tests/connect/session.test.ts', 'tests/connect/flow-hook.test.ts'];
  const put = (path: string, text: string) => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), text);};
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    for (const path of inputs) put(frontend + path, 'export const value = 1;');
    git('add', '.'); git('commit', '-qm', 'baseline'); const base = git('rev-parse', 'HEAD');
    for (const path of inputs) {
      assert.deepEqual(routeDecision([frontend + path]).selected, ['capture', 'desktop', 'onboarding'], path);
      git('reset', '--hard', base); put(frontend + path, "import type {Contract} from './provider';\nexport const value = 2;");
      git('add', '.'); git('commit', '-qm', 'candidate'); const head = git('rev-parse', 'HEAD');
      const hosted = selectRange(base, head, cwd), local = localSelection(base, head, cwd);
      assert.deepEqual(local.plan, hosted.plan); assert.deepEqual(local.reasons, hosted.reasons);
      assert.equal(hosted.plan.onboarding, true, path); assert.equal(hosted.plan.desktop, true, path);
      assert.equal(hosted.plan.root, true, 'real transport and persistence integration remain selected');
      assert.equal(hosted.macos, true); assert.equal(requiresMacRustRange(base, head, cwd), true);
      assert.equal(hosted.plan.public, false); assert.equal(hosted.plan.hermes, false);
    }
    git('reset', '--hard', base); put(frontend + 'src/connect/unknown.ts', 'export const value = 1;');
    git('add', '.'); git('commit', '-qm', 'new boundary');
    const boundary = selectRange(base, git('rev-parse', 'HEAD'), cwd);
    assert.equal(boundary.plan.root, true); assert.equal(boundary.macos, true);
    git('reset', '--hard', base); git('rm', frontend + inputs[0]); symlinkSync('/tmp/not-a-provider', join(cwd, frontend + inputs[0]));
    git('add', '.'); git('commit', '-qm', 'unsafe mode');
    const unsafe = selectRange(base, git('rev-parse', 'HEAD'), cwd);
    assert.equal(unsafe.plan.root, true); assert.equal(unsafe.macos, true); assert.equal(unsafe.plan.onboarding, true);
  } finally {rmSync(cwd, {recursive: true, force: true});}
});

test('one onboarding inventory keeps source tests before installation and synthetic hooks after the compiler', () => {
  const commands = onboardingCommands();
  assert.deepEqual(commands.map(command => command.argv), [
    ['npm', 'run', 'test:onboarding-policy'],
    ['npm', 'ci', '--prefix', 'tests/onboarding', '--ignore-scripts', '--no-audit', '--no-fund'],
    ['npm', '--prefix', 'tests/onboarding', 'run', 'typecheck'],
    ['node', '--experimental-strip-types', '--test', 'tests/connect/flow-hook.test.ts'],
  ]);
  assert.ok(commands.every(command => command.cwd === 'capture/desktop/ui/frontend'));
  const script = JSON.parse(readFileSync(new URL('capture/desktop/ui/frontend/package.json', root), 'utf8')).scripts['test:onboarding-policy'];
  assert.ok(script.includes('tests/connect/flow.test.ts')); assert.ok(script.includes('tests/connect/session.test.ts'));
  assert.ok(!script.includes('flow-hook.test.ts'), 'source-first checks must not load the compiler');
});
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
    for (const path of ['shared/new/file.ts', 'composition/new/file.ts']) assert.equal(affectsStream(stream, path), stream !== 'engine');
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

test('Engine producer inputs select their real owner without acquiring legacy app or product builds', () => {
  for (const path of ['engine/native/src/main.rs', 'engine/native/macos/Probe.swift',
    'engine/sdk/src/index.ts', 'engine/tools/check.ts', '.github/workflows/stream-engine.yml']) {
    const decision = routeDecision([path]);
    assert.deepEqual(decision.selected, ['engine-media']);
    assert.equal(decision.plan.engineMedia, true);
    assert.equal(decision.plan.root, false);
    assert.equal(decision.plan.engine, false, 'staged legacy Engine is not the new producer');
    assert.deepEqual(routingProblems({paths: [path], historyKnown: true, ...decision}), []);
    for (const stream of ['capture', 'connect', 'public', 'hermes'] as const)
      assert.equal(affectsStream(stream, path), false, `${stream} must not start for ${path}`);
    const commands = localCommands(decision.selected, 'base', 'head');
    assert.ok(commands.some(command => command.argv.includes('engine/tools/check.ts')));
    assert.ok(!commands.some(command => command.argv.includes('cargo') || command.argv.includes('--run') || /^(capture|connect|public|hermes)\//.test(command.cwd)));
  }
  assert.deepEqual(routeDecision(['engine/README.md']).selected, []);
  for (const path of ['enablement/ci/routing/consumers.ts', 'enablement/local-tests/run.ts']) {
    assert.equal(routeDecision([path]).plan.engineMedia, true, 'shared execution inputs retain Engine');
    assert.equal(affectsStream('engine', path), true);
  }
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

test('renderer test tooling additions and unsafe nearby Git changes preserve shared/local routing parity', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'onboarding-renderer-routing-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const frontend = 'capture/desktop/ui/frontend/tests/onboarding/renderer/';
  const paths = [frontend + 'window-coach.smoke.ts', frontend + 'tsconfig.json'];
  const put = (path: string, text = 'export {};') => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), text);};
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    put('capture/desktop/ui/frontend/tests/onboarding/account.test.ts'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    const check = (expectedUnsafe: boolean, expectedAllBroad = expectedUnsafe, from = base) => {
      const head = git('rev-parse', 'HEAD'), local = localSelection(from, head, cwd), hosted = selectRange(from, head, cwd);
      assert.deepEqual(local.plan, hosted.plan); assert.deepEqual(local.reasons, hosted.reasons);
      assert.equal(hosted.historyKnown, true); assert.equal(hosted.inputProofKnown, !expectedUnsafe);
      assert.equal(hosted.plan.desktop, true, JSON.stringify({from, paths: hosted.paths, plan: hosted.plan}));
      assert.equal(hosted.plan.onboarding, true, JSON.stringify({from, paths: hosted.paths, plan: hosted.plan}));
      for (const suite of ['root','engine','client','browser','service','tools','public','hermes','tooling'])
        if (expectedAllBroad) assert.equal(hosted.plan[suite as keyof typeof hosted.plan], true, suite);
      if (!expectedUnsafe) assert.deepEqual(routingProblems(hosted), []);
      return hosted;
    };
    for (const path of paths) put(path, path.endsWith('.json') ? '{"extends":"../../tsconfig.json"}' : 'export const smoke = true;');
    git('add', '.'); git('commit', '-qm', 'approved renderer test additions'); const addition = git('rev-parse', 'HEAD'); check(false);

    put(paths[0], 'export const smoke = false;'); git('add', '.'); git('commit', '-qm', 'regular renderer test modification'); check(false, false, addition);

    git('reset', '--hard', base); put(paths[0]); put(frontend + 'window-coach.unknown.ts');
    git('add', '.'); git('commit', '-qm', 'unknown nearby test'); check(true);

    git('reset', '--hard', base); put(paths[0]); git('add', '.'); git('commit', '-qm', 'renderer test');
    const unsafeAddition = git('rev-parse', 'HEAD'); execFileSync('chmod', ['755', paths[0]], {cwd}); git('add', '.'); git('commit', '-qm', 'unsafe renderer test mode');
    const unsafe = selectRange(base, git('rev-parse', 'HEAD'), cwd);
    assert.equal(unsafe.inputProofKnown, false); assert.equal(unsafe.plan.root, true); assert.equal(unsafe.plan.public, true);

    git('reset', '--hard', unsafeAddition); git('mv', paths[0], frontend + 'renamed.ts'); git('commit', '-qm', 'renderer test move');
    assert.equal(selectRange(base, git('rev-parse', 'HEAD'), cwd).inputProofKnown, false);

    git('reset', '--hard', unsafeAddition); put('capture/engine/src/selection.rs'); git('add', '.'); git('commit', '-qm', 'mixed native change');
    const mixed = check(false, false, base); assert.equal(mixed.plan.engine, true); assert.equal(mixed.plan.root, false);
    assert.equal(mixed.macos, true); assert.equal(requiresMacRustRange(base, git('rev-parse', 'HEAD')), true);
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
