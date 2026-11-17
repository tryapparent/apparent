import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {copyRunnerSources, finiteCheckPlan, runnerFixture, writeFiniteChecks} from './runner.ts';

function fixture(action: (dir: string) => void): void {
  const dir = mkdtempSync('/tmp/apparent-dev-runner-fixture-');
  try { action(dir); } finally { rmSync(dir, {recursive: true, force: true}); }
}

function put(root: string, path: string, content: string): void {
  const output = join(root, path);
  mkdirSync(dirname(output), {recursive: true});
  writeFileSync(output, content);
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'NODE_TEST_CONTEXT') delete env[key];
  return env;
}

test('fixture source closure follows a new nested import without copying real tests or build output', () => fixture(dir => {
  const source = join(dir, 'source'), target = join(dir, 'fixture');
  mkdirSync(target);
  put(source, 'enablement/local-tests/run.ts', "export {value} from '../ci/new/helper.ts';\n");
  put(source, 'enablement/ci/new/helper.ts', "export {value} from '../../../hermes/enablement/checks.ts';\n");
  put(source, 'hermes/enablement/checks.ts', 'export const value = 42;\n');
  put(source, 'public/enablement/cd/ci/inputs.ts', 'export const publicInput = true;\n');
  for (const path of ['enablement/local-tests/recursive.test.ts', 'enablement/ci/new/recursive.test.ts',
    'enablement/local-tests/node_modules/dependency/index.ts', 'enablement/ci/dist/generated.ts'])
    put(source, path, "throw Error('must not copy');\n");
  copyRunnerSources(target, source);
  const module = pathToFileURL(join(target, 'enablement/local-tests/run.ts')).href;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import {value} from ${JSON.stringify(module)}; if (value !== 42) process.exit(1);`], {env: childEnvironment(), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(target, 'enablement/local-tests/recursive.test.ts')), false);
  assert.equal(existsSync(join(target, 'enablement/ci/new/recursive.test.ts')), false);
  assert.equal(existsSync(join(target, 'enablement/local-tests/node_modules')), false);
  assert.equal(existsSync(join(target, 'enablement/ci/dist')), false);
  rmSync(join(target, 'enablement/ci/new/helper.ts'));
  const broken = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import ${JSON.stringify(module)};`], {env: childEnvironment(), encoding: 'utf8'});
  assert.notEqual(broken.status, 0, 'missing dependencies must still fail closed');
  assert.match(broken.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.throws(() => copyRunnerSources(source, source), /must be separate/);
}));

test('finite checks follow new command inputs and reject unsupported or escaping inputs', () => fixture(dir => {
  const plan = [{argv: ['node', '--experimental-strip-types', '--test', 'new/policy.test.ts'], cwd: 'owner'}];
  writeFiniteChecks(dir, plan);
  const result = spawnSync(process.execPath, plan[0].argv.slice(1), {cwd: join(dir, 'owner'), env: childEnvironment(), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# tests 1/);
  for (const path of ['../../escape.test.ts', '*.test.ts', '--unknown'])
    assert.throws(() => writeFiniteChecks(dir, [{argv: ['node', '--test', path], cwd: '.'}]), /Unsupported|escapes/);
}));

test('materialized canonical runner executes finite contracts and every direct Node suite input', () => fixture(dir => {
  runnerFixture(dir);
  // Bun itself is outside this finite Node contract. Real CI/Bun suites retain
  // their canonical execution; this fixture verifies the runner dispatch only.
  put(dir, 'bin/bun', '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin/bun'), 0o755);
  const env = {...childEnvironment(), PATH: join(dir, 'bin') + ':' + process.env.PATH};
  const contracts = spawnSync(process.execPath, ['--experimental-strip-types', 'enablement/local-tests/run.ts', '--contracts'],
    {cwd: dir, env, encoding: 'utf8'});
  assert.equal(contracts.status, 0, contracts.stderr);
  assert.match(contracts.stdout, /# fail 0/);
  for (const {argv, cwd} of finiteCheckPlan()) {
    if (argv[0] !== 'node' || !argv.includes('--test')) continue;
    const result = spawnSync(process.execPath, argv.slice(1), {cwd: join(dir, cwd), env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# fail 0/);
  }
  assert.match(readFileSync(join(dir, 'enablement/local-tests/run.test.ts'), 'utf8'), /finite hook fixture/);
  assert.equal(existsSync(join(dir, 'enablement/local-tests/fixtures/runner.test.ts')), false);
}));
