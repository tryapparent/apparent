import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {stripVTControlCharacters} from 'node:util';

function fixture(t: any) {
  const root = mkdtempSync('/tmp/apparent-dev-cargo-index-');
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const workflow = readFileSync('.github/workflows/verification-platform.yml', 'utf8');
  const contracts = workflow.indexOf('name: Local Desktop install reuse contracts');
  const preparation = workflow.indexOf('name: Prepare locked native prerequisites before first Cargo');
  assert.ok(contracts >= 0 && preparation > contracts, 'Installation contracts precede the environment export');
  const job = workflow.split('\n  rust:')[1].split('    steps:')[0];
  assert.doesNotMatch(job, /GIT_OPTIONAL_LOCKS/, 'Installation contracts retain their original job environment');
  const setup = workflow.split('      - name: Prepare locked native prerequisites before first Cargo')[1]
    .split('        run: |\n')[1].split('      - name:')[0]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const bin = resolve(root, 'bin'); mkdirSync(bin);
  for (const command of ['npm', 'node']) writeFileSync(resolve(bin, command), '#!/bin/sh\nexit 0\n', {mode: 0o700});
  const environment = resolve(root, 'environment'); writeFileSync(environment, '');
  const setupEnv = {...process.env, PATH: bin + ':' + process.env.PATH, GITHUB_ENV: environment, electron_config_cache: resolve(root, 'downloads')};
  delete setupEnv.GIT_OPTIONAL_LOCKS;
  const prepared = spawnSync('bash', ['-e', '-c', setup], {cwd: root, env: setupEnv, encoding: 'utf8'});
  assert.equal(prepared.status, 0, prepared.stderr);
  const optionalLocks = readFileSync(environment, 'utf8').match(/^GIT_OPTIONAL_LOCKS=([01])$/m)?.[1];
  assert.equal(optionalLocks, '0', 'Native source checks must not refresh Cargo-watched index metadata');
  const env = {...process.env, GIT_OPTIONAL_LOCKS: optionalLocks, CARGO_TARGET_DIR: resolve(root, 'target'),
    CARGO_INCREMENTAL: '1', RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: ''};
  const local = spawnSync('git', ['rev-parse', '--local-env-vars'], {encoding: 'utf8'});
  assert.equal(local.status, 0, local.stderr);
  for (const key of local.stdout.trim().split('\n')) delete env[key];
  env.GIT_OPTIONAL_LOCKS = optionalLocks;
  const run = (command: string, args: string[], overrides = {}) => {
    const result = spawnSync(command, args, {cwd: root, env: {...env, ...overrides}, encoding: 'utf8', timeout: 120_000});
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    return result.stdout + result.stderr;
  };
  const put = (path: string, text: string) => writeFileSync(resolve(root, path), text);
  put('tool.sh', '#!/bin/sh\ntrue\n'); chmodSync(resolve(root, 'tool.sh'), 0o755);
  run('git', ['init', '-q']);
  run('git', ['config', 'user.name', 'Fixture']); run('git', ['config', 'user.email', 'fixture@example.invalid']);
  const commit = () => {
    run('git', ['add', '.']);
    run('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture']);
  };
  return {root, run, put, commit, index: resolve(root, '.git/index'), tool: resolve(root, 'tool.sh')};
}

test('native job source inspection leaves clean index metadata alone but retains explicit writes', t => {
  const f = fixture(t); f.commit();
  const before = readFileSync(f.index), modified = statSync(f.index).mtimeMs;
  chmodSync(f.tool, 0o755); // The installer chmods already executable tracked tools.
  assert.equal(f.run('git', ['status', '--porcelain']), '');
  assert.deepEqual(readFileSync(f.index), before);
  assert.equal(statSync(f.index).mtimeMs, modified);
  f.put('tool.sh', '#!/bin/sh\nfalse\n');
  assert.match(f.run('git', ['status', '--porcelain']), /M tool.sh/);
  f.run('git', ['add', 'tool.sh']);
  assert.notDeepEqual(readFileSync(f.index), before, 'Optional locks do not disable explicit staging');
});

// Cheap contracts do not require Rust. Native CI and the focused local proof opt
// into this dependency-free fixture after their normal compiler/temp admission.
const cargoTest = process.env.APPARENT_CARGO_INDEX_FIXTURE === '1' ? test : test.skip;
cargoTest('real Cargo retains fresh test/dev outputs and invalidates genuine source/index changes', t => {
  const f = fixture(t);
  mkdirSync(resolve(f.root, 'enablement'));
  f.put('enablement/build_version.rs', readFileSync('enablement/build_version.rs', 'utf8'));
  f.put('build.rs', 'mod identity {include!("enablement/build_version.rs");} fn main(){identity::emit();}\n');
  f.put('Cargo.toml', '[package]\nname="identity-probe"\nversion="0.0.0"\nedition="2024"\n[[bin]]\nname="identity-probe"\npath="main.rs"\n');
  f.put('main.rs', 'fn main(){println!("{}",env!("APPARENT_VERSION_LABEL"));} #[test] fn runs(){assert!(!env!("APPARENT_VERSION_LABEL").is_empty());}\n');
  f.put('.gitignore', '/target/\n');
  f.run('cargo', ['generate-lockfile', '--offline']); f.commit();
  // Hosted jobs force Cargo colors; exercise that format while matching its text.
  const cargo = (kind: string) => stripVTControlCharacters(
    f.run('cargo', [kind, '--offline', '-vv'], {CARGO_TERM_COLOR: 'always'}));
  cargo('test'); cargo('build');
  const indexTime = statSync(f.index).mtimeMs;
  chmodSync(f.tool, 0o755);
  assert.equal(f.run('git', ['status', '--porcelain']), '');
  assert.equal(statSync(f.index).mtimeMs, indexTime);
  for (const kind of ['test', 'build']) {
    const log = cargo(kind);
    assert.match(log, /Fresh identity-probe/); assert.doesNotMatch(log, /Dirty identity-probe/);
  }
  // Positive control: the old default rewrites the watched index even for a
  // clean status, and Cargo explains the resulting invalidation.
  chmodSync(f.tool, 0o755);
  assert.equal(f.run('git', ['status', '--porcelain'], {GIT_OPTIONAL_LOCKS: '1'}), '');
  assert.match(cargo('test'), /the file `.git\/index` has changed/);
  f.put('tool.sh', '#!/bin/sh\nfalse\n');
  assert.match(cargo('test'), /cargo:rustc-env=APPARENT_BUILD_MODIFIED=true/);
  f.run('git', ['add', 'tool.sh']);
  f.put('tool.sh', '#!/bin/sh\ntrue\n');
  assert.match(f.run('git', ['status', '--porcelain']), /MM tool.sh/);
  assert.match(cargo('test'), /cargo:rustc-env=APPARENT_BUILD_MODIFIED=true/);
  f.run('git', ['reset', '--mixed', 'HEAD']);
  assert.match(cargo('test'), /cargo:rustc-env=APPARENT_BUILD_MODIFIED=false/);
});
