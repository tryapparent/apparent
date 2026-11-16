import {test, expect} from 'bun:test';
import {readFileSync, mkdirSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import path from 'node:path';
import {context, identity, revision} from './validator.ts';
import {snapshot} from '../distribution/cache/downloads.ts';

test('workflow uses one private PM root, fresh destinations and the real admission commands', () => {
  const w = Bun.YAML.parse(readFileSync('.github/workflows/hermes.yml', 'utf8')) as any;
  const steps = w.jobs.verify.steps;
  const step = (name: string) => steps.find((s: any) => s.name === name);
  expect(w.jobs.verify.strategy.matrix.os).toEqual(['ubuntu-24.04', 'macos-15-intel']);
  expect(step('Prepare pinned Hermes validator and download identity').run).toContain(`origin ${revision}`);
  expect(step('Prepare pinned Hermes validator and download identity').run).toContain('validator.ts prepare "$job"');
  expect(step('Install supported Hermes validator').run).toContain('validator.ts install "$JOB"');
  expect(step('Install supported Hermes validator').run).toContain('test ! -e "$JOB/runtime/.venv"');
  expect(step('Snapshot downloaded PyPI wheels only').run).toContain('snapshot "$JOB/profile/cache/uv" "$JOB/downloads"');
  const validate = step('Validate installed package in an isolated profile');
  expect(validate.if).toBeUndefined();
  for (const command of ['export HERMES_HOME="$JOB/profile"', 'test ! -e "$HERMES_HOME/plugins"',
    'shasum -a 256 -c ./*.sha256', 'node "$job/extracted/install.cjs" --profile "$HERMES_HOME"',
    'hermes plugins validate "$HERMES_HOME/plugins/apparent" --install-deps',
    'hermes plugins doctor "$HERMES_HOME/plugins/apparent" --ci', 'validator.ts check "$JOB"']) expect(validate.run).toContain(command);
});

// Opt-in real producer proof, run through t3-build. The job contains a freshly
// fetched exact upstream and cold PM tools from validator.ts prepare. It is
// never evidence of macOS execution or candidate admission.
test.skipIf(!process.env.HERMES_NATIVE_PROOF_JOB)('real PM: one source build, two fresh venvs, cold/failure boundaries', async () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const options = context(job);
  expect(execFileSync('git', ['rev-parse', 'HEAD'], options).trim()).toBe(revision);
  const before = identity(job);
  console.log('native proof input identity', before);
  // Use the exact producer's sdist URL and hash, rather than a fabricated uv
  // cache entry or a locally authored backend that mirrors the consumer.
  const sdist = JSON.parse(execFileSync('python3', ['-c',
    'import json,tomllib; print(json.dumps(next(p["sdist"] for p in tomllib.load(open("uv.lock","rb"))["package"] if p["name"]=="cryptography")))'], options));
  const source = path.join(job, 'native-source');
  mkdirSync(source);
  writeFileSync(path.join(source, 'pyproject.toml'), `[project]\nname="native-cache-proof"\nversion="0.0.0"\nrequires-python=">=3.14"\ndependencies=["cryptography @ ${sdist.url}#${sdist.hash.replace(':', '=')}"]\n`);
  execFileSync('python3', ['-m', 'pm.build_env', '--source', source, '--lock-only'], {...options, stdio: 'inherit'});
  function build(name: string, offline: boolean, extra: string[] = []) {
    const out = path.join(job, name);
    expect(existsSync(out)).toBe(false);
    const result = spawnSync('python3', ['-m', 'pm.build_env', '--source', source, '--out', out, ...(offline ? ['--offline'] : []), ...extra],
      {...options, env: {...options.env, HERMES_VERBOSE: '1'}, timeout: 600_000});
    writeFileSync(path.join(job, `${name}.log`), `${result.stdout || ''}${result.stderr || ''}`);
    return {out, result, log: `${result.stdout || ''}${result.stderr || ''}`};
  }
  const first = build('native-first', false);
  expect(first.result.status, first.log).toBe(0);
  expect((first.log.match(/Building cryptography/g) || []).length).toBe(1);
  const second = build('native-second', true);
  expect(second.result.status, second.log).toBe(0);
  expect((second.log.match(/Building cryptography/g) || []).length).toBe(0);
  for (const out of [first.out, second.out]) expect(execFileSync(path.join(out, 'bin/python'), ['-c',
    'from cryptography.hazmat.primitives import hashes; h=hashes.Hash(hashes.SHA256()); h.update(b"native proof"); print(len(h.finalize()))'], {encoding: 'utf8'}).trim()).toBe('32');
  expect(identity(job)).toBe(before);
  // An existing environment is rejected; failure must never count as fresh proof.
  const old = spawnSync('python3', ['-m', 'pm.build_env', '--source', source, '--out', second.out], options);
  expect(old.status).not.toBe(0);
  const missingCache = path.join(job, 'empty-cache');
  const failed = build('native-failed', true, ['--cache', missingCache]);
  expect(failed.result.status).not.toBe(0);
  expect(existsSync(failed.out)).toBe(false);
  // A changed dependency cannot be satisfied from a previous built wheel.
  writeFileSync(path.join(source, 'pyproject.toml'), '[project]\nname="native-cache-proof"\nversion="0.0.0"\nrequires-python=">=3.14"\ndependencies=["apparent-deliberately-missing-cache-proof==0.0.0"]\n');
  const incompatible = spawnSync('python3', ['-m', 'pm.build_env', '--source', source, '--lock-only', '--offline'], options);
  expect(incompatible.status).not.toBe(0);
}, 900_000);

test.skipIf(!process.env.HERMES_NATIVE_PROOF_JOB)('real pinned uv downloaded-only export after native builds', async () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const downloads = path.join(job, 'native-downloads-v7');
  await snapshot(path.join(job, 'profile/cache/uv'), downloads);
  expect(existsSync(path.join(downloads, 'sdists-v10'))).toBe(false);
  expect(existsSync(path.join(downloads, 'builds-v0'))).toBe(false);
  // Removing one venv cannot turn the other into an old-environment proof.
  rmSync(path.join(job, 'native-first'), {recursive: true});
  expect(execFileSync(path.join(job, 'native-second/bin/python'), ['-c', 'import cryptography; print(cryptography.__version__)'], {encoding: 'utf8'}).trim()).toBe('50.0.2');
}, 900_000);

test.skipIf(!process.env.HERMES_NATIVE_PROOF_JOB)('real input guard accepts the validator PATH and rejects changed native flags', () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const args = ['--experimental-strip-types', 'hermes/verification/validator.ts', 'check', job];
  const env = {...process.env, PATH: path.join(job, 'runtime/.venv/bin') + ':' + process.env.PATH};
  expect(spawnSync('node', args, {env}).status).toBe(0);
  expect(spawnSync('node', args, {env: {...env, CFLAGS: '-DAPPARENT_INCOMPATIBLE_BUILD=1'}}).status).not.toBe(0);
});

test.skipIf(!process.env.HERMES_NATIVE_PROOF_JOB)('real frozen validator retains producer lock bytes and excludes dev tooling', () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const options = context(job);
  execFileSync('git', ['diff', '--exit-code', '--', 'uv.lock', 'pyproject.toml'], options);
  execFileSync(path.join(job, 'runtime/.venv/bin/python'), ['-c', `
import importlib.metadata, tomllib
assert tomllib.load(open("pyproject.toml", "rb"))["tool"]["uv"]["default-groups"] == []
for name in ("pytest", "ruff", "debugpy"):
    try: importlib.metadata.distribution(name)
    except importlib.metadata.PackageNotFoundError: pass
    else: raise AssertionError("unexpected dev dependency: " + name)
`], options);
});
