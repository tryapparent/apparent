/** Run from a source-bound checkout/archive on an approved macOS or Linux host.
 * No provisioning, provider access, app launch, runtime downloads or publication.
 * node --experimental-strip-types package-proof.ts SOURCE.crate SHA256 NEW_WORK [ROOT_CLI]
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [archiveArg, digest, workArg, rootArg] = process.argv.slice(2);
assert(archiveArg && /^[a-f0-9]{64}$/.test(digest ?? '') && workArg,
  'Usage: package-proof.ts SOURCE.crate SHA256 NEW_WORK [ROOT_CLI]');
assert(['darwin', 'linux'].includes(process.platform), 'Supported hosts: macOS and Linux');
const archive = resolve(archiveArg);
const rootCLI = rootArg ? realpathSync(rootArg) : undefined;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(archive)), digest, 'Source archive digest mismatch');
const work = resolve(workArg);
mkdirSync(work, { mode: 0o700 }); // Refuse reuse: preserve prior failures/evidence.
const evidence: Record<string, unknown> = { schema: 1, archiveSha256: digest,
  platform: process.platform, arch: process.arch, rootCLI: rootCLI ?? null, steps: [], cases: [] };
function save() { writeFileSync(join(work, 'proof.json'), JSON.stringify(evidence, null, 2) + '\n'); }
function command(executable: string, args: string[], label: string, cwd = work, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8',
    timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(work, `${label}.stdout`), result.stdout ?? '');
  writeFileSync(join(work, `${label}.stderr`), result.stderr ?? '');
  (evidence.steps as unknown[]).push({ label, executable, args, status: result.status,
    signal: result.signal, error: result.error?.message ?? null });
  save();
  assert.equal(result.status, 0, `${label} failed; retained logs in ${work}`);
  return result.stdout;
}
try {
  const members = command('tar', ['-tzf', archive], 'inventory').trim().split('\n');
  const prefix = members[0].split('/')[0];
  assert(/^apparent-inspect-[0-9]+\.[0-9]+\.[0-9]+$/.test(prefix));
  assert(members.every(name => name.startsWith(prefix + '/') &&
    !name.split('/').includes('..') && !name.includes('\\')));
  const types = command('tar', ['-tvzf', archive], 'inventory-types').trim().split('\n');
  assert(types.every(line => ['-', 'd'].includes(line[0])), 'Only regular files/directories accepted');
  command('tar', ['-xzf', archive, '-C', work], 'extract');
  const source = join(work, prefix);
  const buildEnv = { ...process.env, CARGO_TARGET_DIR: join(work, 'target') };
  evidence.rustc = command('rustc', ['--version'], 'rustc').trim();
  evidence.cargo = command('cargo', ['--version'], 'cargo').trim();
  // A Cargo source archive already contains Cargo.toml.orig; repackaging it is unsupported.
  for (const operation of ['build', 'test']) {
    command('cargo', [operation, '--locked', '--offline', '--manifest-path', join(source, 'Cargo.toml')],
      operation, work, buildEnv);
  }
  const install = join(work, 'installed');
  command('cargo', ['install', '--debug', '--locked', '--offline', '--path', source, '--root', install],
    'install', work, buildEnv);
  const executable = join(install, 'bin/apparent-inspect');
  evidence.executableSha256 = hash(readFileSync(executable));
  const home = join(work, 'synthetic-home');
  mkdirSync(home, { mode: 0o700 });
  const environment = { ...process.env, HOME: home };
  delete environment.APPARENT_CAPTURES_DIR;
  delete environment.XDG_DATA_HOME;
  const fixtures = join(source, 'tests/fixtures');
  const manifests: { path: string; sha256: string; mtimeMs: number }[] = [];
  const captures = join(home, 'explicit-captures');
  for (const name of ['legacy', 'current']) {
    const directory = join(captures, name + '.apparent');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest = join(directory, 'apparent.json');
    writeFileSync(manifest, readFileSync(join(fixtures, name + '.json')));
    manifests.push({ path: manifest, sha256: hash(readFileSync(manifest)), mtimeMs: statSync(manifest).mtimeMs });
    const variants: [string, string[]][] = [['md', []], ['normalized.json', ['--json']]];
    if (name === 'current') variants.push(['agent.md', ['--experiment', 'agentContext']], ['marks.json', ['--marks', '--json']]);
    for (const [suffix, flags] of variants) {
      const output = command(executable, [directory, ...flags], `${name}-${suffix}`, home, environment);
      assert.equal(output.replaceAll(realpathSync(directory), '@BUNDLE@'),
        readFileSync(join(fixtures, `${name}.${suffix}`), 'utf8'));
      if (rootCLI) assert.equal(command(rootCLI, ['inspect', directory, ...flags],
        `root-${name}-${suffix}`, home, environment), output);
      (evidence.cases as unknown[]).push(`${name}-${suffix}`);
    }
  }
  const defaultCaptures = join(home, process.platform === 'darwin'
    ? 'Library/Application Support/apparent/captures' : '.local/share/apparent/captures');
  mkdirSync(join(defaultCaptures, 'legacy.apparent'), { recursive: true, mode: 0o700 });
  writeFileSync(join(defaultCaptures, 'legacy.apparent/apparent.json'), readFileSync(join(fixtures, 'legacy.json')));
  const latest = (label: string, env = environment) => JSON.parse(command(executable,
    ['latest', '--json'], label, home, env)).id;
  assert.equal(latest('default-lookup'), 'legacy');
  const configPath = join(home, '.config/apparent/config.json');
  mkdirSync(join(home, '.config/apparent'), { recursive: true, mode: 0o700 });
  for (const [label, capturesDir] of [['absolute', captures], ['tilde', '~/explicit-captures']]) {
    const config = JSON.stringify({ capturesDir, unrelated: 'retain' });
    writeFileSync(configPath, config);
    assert.equal(latest(`configured-${label}`), 'current');
    assert.equal(latest(`environment-${label}`, { ...environment, APPARENT_CAPTURES_DIR: defaultCaptures }), 'legacy');
    assert.equal(readFileSync(configPath, 'utf8'), config);
  }
  for (const [label, args, code] of [
    ['missing', ['absent.apparent'], 1],
    ['local-id', ['0123456789abcdef0123456789abcdef'], 1],
    ['argument', ['--unknown-option'], 2],
  ] as [string, string[], number][]) {
    const result = spawnSync(executable, args, { cwd: home, env: environment, encoding: 'utf8', timeout: 10_000 });
    writeFileSync(join(work, `${label}.stderr`), result.stderr ?? '');
    assert.equal(result.status, code, label);
    (evidence.cases as unknown[]).push({ label, code });
  }
  for (const manifest of manifests) {
    assert.equal(hash(readFileSync(manifest.path)), manifest.sha256);
    assert.equal(statSync(manifest.path).mtimeMs, manifest.mtimeMs);
  }
  evidence.manifests = manifests;
  evidence.status = 'passed';
  save();
  console.log(`Archive/build/test/install/installed execution passed: ${join(work, 'proof.json')}`);
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error instanceof Error ? error.message : String(error);
  save();
  throw error;
}
