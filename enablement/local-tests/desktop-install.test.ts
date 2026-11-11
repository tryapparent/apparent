import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {desktopDependencies, desktopInstallSnapshot, desktopPackage} from './desktop-install.ts';
import {receiptStore} from './receipt.ts';
import {root} from './run.ts';

function fixture(action: (dir: string, env: NodeJS.ProcessEnv, git: (...args: string[]) => string) => void) {
  const dir = realpathSync(mkdtempSync('/tmp/apparent-dev-install-test-'));
  const env = {...process.env};
  for (const name of Object.keys(env)) if (/^(GIT_|NODE_|CI$|GITHUB_ACTIONS$|APPARENT_TIMING_FILE$)/.test(name)) delete env[name];
  env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_NOSYSTEM = '1';
  const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, env, encoding: 'utf8'}).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const frontend = join(dir, desktopPackage);
  mkdirSync(frontend, {recursive: true}); mkdirSync(join(dir, 'shared/ui'), {recursive: true});
  writeFileSync(join(frontend, '.npmrc'), 'install-links=true\n');
  writeFileSync(join(frontend, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(frontend, 'package.json'), JSON.stringify({name: 'desktop-install-fixture', version: '1.0.0', private: true,
    dependencies: {'@apparent/ui': 'file:../../../../shared/ui'}, scripts: {
      test: 'node --experimental-strip-types count.ts unit', 'test:electron': 'node --experimental-strip-types count.ts electron'}}));
  writeFileSync(join(frontend, 'count.ts'), `import {appendFileSync, writeFileSync} from 'node:fs';
    appendFileSync('../../../../.git/checks', process.argv[2] + '\\n');
    // Exercise the real build's installed-output restaging pattern on every check.
    writeFileSync('node_modules/@apparent/ui/generated.txt', 'generated');
    if (process.env.FAIL_DESKTOP_CHECK) throw Error('synthetic check failed');\n`);
  writeFileSync(join(frontend, 'source.ts'), 'export const value = 1;\n');
  writeFileSync(join(dir, 'shared/ui/package.json'), JSON.stringify({name: '@apparent/ui', version: '1.0.0'}));
  writeFileSync(join(dir, 'shared/ui/index.txt'), 'dependency');
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: frontend, env, stdio: 'pipe'});
  git('add', '.'); git('commit', '-qm', 'baseline');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  try { action(dir, env, git); } finally {
    rmSync(receiptStore(frontend), {recursive: true, force: true});
    rmSync(dir, {recursive: true, force: true});
  }
}

const block = () => [
  {cwd: desktopPackage, argv: ['npm', 'ci', '--no-audit', '--no-fund']},
  {cwd: desktopPackage, argv: ['npm', 'test']},
  {cwd: desktopPackage, argv: [...(process.platform === 'linux' ? ['xvfb-run', '-a'] : []), 'npm', 'run', 'test:electron']},
];

test('the shipped Desktop dependency graph qualifies, including optional Darwin install scripts', () => {
  const env = {...process.env};
  for (const name of Object.keys(env)) if (/^(GIT_|NODE_|CI$|GITHUB_ACTIONS$)/.test(name)) delete env[name];
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, env, encoding: 'utf8'}).trim();
  const snapshot = desktopInstallSnapshot(root, env, {base: head, head});
  assert.match(snapshot.inputs.key, /^[a-f0-9]{64}$/);
});

test('real npm install is reused across source-only commits; all checks rerun and changed inputs/output reinstall', () => fixture((dir, env, git) => {
  let installs = 0;
  const frontend = join(dir, desktopPackage), checks = join(dir, '.git/checks');
  const run = (command: {argv: string[]; cwd: string}, environment = env) => {
    if (command.argv[1] === 'ci') installs++;
    execFileSync(command.argv[0], command.argv.slice(1), {cwd: join(dir, command.cwd), env: environment, stdio: 'pipe'});
  };
  const check = (environment = env) => assert.equal(desktopDependencies(block(), dir, environment,
    {base: git('rev-parse', 'origin/main'), head: git('rev-parse', 'HEAD')}, run), true);
  check(); assert.equal(installs, 1);
  writeFileSync(join(frontend, 'source.ts'), 'export const value = 2;\n');
  git('add', '.'); git('commit', '-qm', 'source only');
  check(); assert.equal(installs, 1, 'source-only commit must not reinstall');
  assert.equal(readFileSync(checks, 'utf8'), 'unit\nelectron\nunit\nelectron\n');
  writeFileSync(join(frontend, 'node_modules/@apparent/ui/index.txt'), 'damaged');
  check(); assert.equal(installs, 2, 'installed bytes are checked');
  chmodSync(join(frontend, 'node_modules/@apparent/ui/index.txt'), 0o755);
  check(); assert.equal(installs, 3, 'installed modes are checked');
  rmSync(join(frontend, 'node_modules/@apparent/ui/index.txt'));
  check(); assert.equal(installs, 4, 'missing installed files reinstall');
  writeFileSync(join(dir, 'shared/ui/index.txt'), 'updated local dependency');
  check(); assert.equal(installs, 5, 'local file dependencies are install inputs');
  assert.equal(readFileSync(join(frontend, 'node_modules/@apparent/ui/index.txt'), 'utf8'), 'updated local dependency');
  appendFileSync(join(frontend, 'package-lock.json'), '\n');
  check(); assert.equal(installs, 6, 'lockfile bytes are bound');
  const pkg = JSON.parse(readFileSync(join(frontend, 'package.json'), 'utf8'));
  pkg.description = 'changed manifest'; writeFileSync(join(frontend, 'package.json'), JSON.stringify(pkg));
  check(); assert.equal(installs, 7, 'manifest bytes are bound');
  appendFileSync(join(frontend, '.npmrc'), 'color=false\n');
  check(); assert.equal(installs, 8, 'npm project configuration is bound');
  check({...env, INSTALL_SEMANTIC_INPUT: 'new'}); assert.equal(installs, 9, 'install environment is bound');
  assert.equal(readFileSync(checks, 'utf8').trim().split('\n').length, 20, 'both suites still run on every call');
}));

test('CI and unsupported command/lifecycle modes stay fresh; failed checks never publish install evidence', () => fixture((dir, env, git) => {
  const admission = {base: git('rev-parse', 'HEAD'), head: git('rev-parse', 'HEAD')};
  const path = join(dir, desktopPackage), saved = join(receiptStore(path), 'success.json');
  const unexpected = () => assert.fail('unrecognized block must stay in the original runner');
  for (const environment of [{...env, CI: 'true'}, {...env, NODE_OPTIONS: '--inspect'}]) {
    const invoked: string[][] = [];
    assert.equal(desktopDependencies(block(), dir, environment, admission, command => {invoked.push(command.argv);}), true);
    assert.deepEqual(invoked, block().map(command => command.argv), 'CI/overrides retain every original command');
    assert.equal(existsSync(saved), false);
  }
  assert.equal(desktopDependencies(block().slice(0, 2), dir, env, admission, unexpected), false);
  const run = (command: {argv: string[]; cwd: string}, environment = {...env, FAIL_DESKTOP_CHECK: '1'}) =>
    execFileSync(command.argv[0], command.argv.slice(1), {cwd: join(dir, command.cwd), env: environment, stdio: 'pipe'});
  assert.throws(() => desktopDependencies(block(), dir, {...env, FAIL_DESKTOP_CHECK: '1'}, admission, run));
  assert.equal(existsSync(saved), false);
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  pkg.scripts.prepare = 'node --version'; writeFileSync(join(path, 'package.json'), JSON.stringify(pkg));
  assert.throws(() => desktopInstallSnapshot(dir, env, admission), /unreviewed package install lifecycle/);
}));

test('actual installed pre-push hook and production runner perform one install across two source-only pushes', () => fixture((dir, env, git) => {
  const helpers = ['service.ts', 'receipt.ts', 'desktop-install.ts'];
  mkdirSync(join(dir, 'enablement/local-tests'), {recursive: true});
  for (const name of helpers) copyFileSync(join(root, 'enablement/local-tests', name), join(dir, 'enablement/local-tests', name));
  copyFileSync(join(root, 'enablement/local-tests/run.ts'), join(dir, 'enablement/local-tests/runner.ts'));
  mkdirSync(join(dir, 'enablement/ci/routing'), {recursive: true});
  for (const name of ['inputs.ts', 'workflow-controls.ts']) copyFileSync(join(root, 'enablement/ci', name), join(dir, 'enablement/ci', name));
  copyFileSync(join(root, 'enablement/ci/routing/consumers.ts'), join(dir, 'enablement/ci/routing/consumers.ts'));
  writeFileSync(join(dir, 'enablement/local-tests/run.ts'), `import {execFileSync} from 'node:child_process';
    import {execute} from './runner.ts';
    const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
    execute(${JSON.stringify(block())}, process.cwd(), {base:value('--base'), head:value('--head')});\n`);
  const hooks = join(dir, '.git/hooks');
  copyFileSync(join(root, '.githooks/pre-push'), join(hooks, 'pre-push')); git('config', 'core.hooksPath', hooks);
  git('add', '.'); git('commit', '-qm', 'installed runner');
  const remote = join(dir, '.git/remote.git'); git('init', '--bare', '-q', remote); git('remote', 'add', 'origin', remote);
  const push = (name: string) => spawnSync('git', ['push', 'origin', `HEAD:refs/heads/${name}`], {cwd: dir, env, encoding: 'utf8'});
  const first = push('first'); assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /npm ci --no-audit --no-fund/);
  writeFileSync(join(dir, desktopPackage, 'source.ts'), 'export const value = 3;\n');
  git('add', '.'); git('commit', '-qm', 'source change');
  const second = push('second'); assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stderr, /npm ci --no-audit --no-fund/);
  assert.match(second.stderr, /reused Desktop dependencies/);
  assert.equal(readFileSync(join(dir, '.git/checks'), 'utf8'), 'unit\nelectron\nunit\nelectron\n');
}));

test('complete install/check block excludes another writer on misses, hits and CI fallbacks', () => fixture((dir, env, git) => {
  const admission = {base: git('rev-parse', 'HEAD'), head: git('rev-parse', 'HEAD')};
  const lock = join(dir, '.git/apparent-desktop-install.lock');
  const run = (command: {argv: string[]; cwd: string}, environment = env) => {
    // A second canonical/fresh invocation must not replace modules during checks.
    assert.throws(() => desktopDependencies(block(), dir, {...env, CI: 'true'}, admission,
      () => assert.fail('second writer executed')), /Desktop dependency operation locked/);
    execFileSync(command.argv[0], command.argv.slice(1), {cwd: join(dir, command.cwd), env: environment, stdio: 'pipe'});
  };
  desktopDependencies(block(), dir, env, admission, run);
  desktopDependencies(block(), dir, env, admission, run);
  desktopDependencies(block(), dir, {...env, CI: 'true'}, admission, run);
  assert.equal(existsSync(lock), false, 'normal exit releases the runtime mutex');
  assert.throws(() => desktopDependencies(block(), dir, env, admission, () => {throw Error('failed checks');}), /failed checks/);
  assert.equal(existsSync(lock), false, 'failed checks release the runtime mutex');
  mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), 'interrupted owner');
  assert.throws(() => desktopDependencies(block(), dir, env, admission, () => assert.fail()), /owner verification/);
  assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), 'interrupted owner', 'unknown ownership is preserved');
}));

test('changing installation inputs during successful checks cannot publish a receipt', () => fixture((dir, env, git) => {
  const admission = {base: git('rev-parse', 'HEAD'), head: git('rev-parse', 'HEAD')};
  const path = join(dir, desktopPackage);
  const run = (command: {argv: string[]; cwd: string}, environment = env) => {
    execFileSync(command.argv[0], command.argv.slice(1), {cwd: join(dir, command.cwd), env: environment, stdio: 'pipe'});
    if (command.argv[1] === 'ci') appendFileSync(join(path, '.npmrc'), 'color=false\n');
  };
  desktopDependencies(block(), dir, env, admission, run);
  assert.equal(existsSync(join(receiptStore(path), 'success.json')), false);
}));

test('npm ci lifecycle hooks remain fresh after source-only commits', () => fixture((dir, env, git) => {
  const path = join(dir, desktopPackage), pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  pkg.scripts.postprepare = 'node --experimental-strip-types prepare.ts';
  writeFileSync(join(path, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(path, 'prepare.ts'), `import {appendFileSync, readFileSync} from 'node:fs';
    appendFileSync('../../../../.git/prepared', readFileSync('source.ts', 'utf8'));\n`);
  git('add', '.'); git('commit', '-qm', 'install lifecycle');
  const run = (command: {argv: string[]; cwd: string}, environment = env) =>
    execFileSync(command.argv[0], command.argv.slice(1), {cwd: join(dir, command.cwd), env: environment, stdio: 'pipe'});
  const check = () => desktopDependencies(block(), dir, env, {base: git('rev-parse', 'origin/main'), head: git('rev-parse', 'HEAD')}, run);
  check();
  writeFileSync(join(path, 'source.ts'), 'export const value = 2;\n'); git('add', '.'); git('commit', '-qm', 'source only');
  check();
  assert.equal(readFileSync(join(dir, '.git/prepared'), 'utf8'), 'export const value = 1;\nexport const value = 2;\n');
  assert.equal(existsSync(join(receiptStore(path), 'success.json')), false);
}));
