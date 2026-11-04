/** Owner-local binary production/staging. Publication and app routing are separate gates. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishValidatedDirectory } from '../../../../shared/packaging/transaction.ts';

const targets = ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'x86_64-apple-darwin', 'aarch64-apple-darwin'];
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const validHash = (hash: string) => /^[a-f0-9]{64}$/.test(hash);
function run(executable: string, args: string[], cwd?: string, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${executable} failed: ${result.stderr ?? result.error?.message}`);
  return result.stdout;
}
function binaryTarget(bytes: Buffer) {
  if (bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    assert(bytes[4] === 2 && bytes[5] === 1, 'Expected 64-bit little-endian ELF');
    const architecture = ({ 62: 'x86_64', 183: 'aarch64' })[bytes.readUInt16LE(18)];
    assert(architecture, 'Unsupported ELF architecture');
    return architecture + '-unknown-linux-gnu';
  }
  assert(bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf, 'Expected ELF or thin 64-bit Mach-O');
  const architecture = ({ 0x1000007: 'x86_64', 0x100000c: 'aarch64' })[bytes.readUInt32LE(4)];
  assert(architecture, 'Unsupported Mach-O architecture');
  return architecture + '-apple-darwin';
}

/** Build/install using the existing Agent Cargo convention, then seal the tested bytes. */
export function build(archive: string, expectedHash: string, destination: string) {
  assert(validHash(expectedHash), 'Expected source archive SHA256 required');
  assert.equal(sha256(readFileSync(archive)), expectedHash, 'Source archive digest mismatch');
  const output = resolve(destination);
  mkdirSync(output, { mode: 0o700 }); // Never overwrite a candidate or prior failed evidence.
  const proof = join(output, 'proof');
  const runner = fileURLToPath(new URL('../tests/package-proof.ts', import.meta.url));
  run(process.execPath, ['--experimental-strip-types', runner, resolve(archive), expectedHash, proof]);
  const result = JSON.parse(readFileSync(join(proof, 'proof.json'), 'utf8'));
  assert(result.status === 'passed' && result.archiveSha256 === expectedHash, 'Package proof failed');
  const source = readdirSync(proof).filter(name => /^apparent-inspect-[0-9]+\.[0-9]+\.[0-9]+$/.test(name));
  assert.equal(source.length, 1, 'Ambiguous Cargo source');
  const vcs = JSON.parse(readFileSync(join(proof, source[0], '.cargo_vcs_info.json'), 'utf8'));
  assert((vcs.git?.dirty === undefined || vcs.git?.dirty === false) && /^[a-f0-9]{40}$/.test(vcs.git?.sha1 ?? '') &&
    vcs.path_in_vcs === 'capture/agent/inspection', 'A clean canonical Cargo source archive is required');
  const debug = join(proof, 'installed/bin/apparent-inspect');
  assert.equal(sha256(readFileSync(debug)), result.executableSha256, 'Installed proof executable changed');
  const release = join(output, 'release-install');
  run('cargo', ['install', '--locked', '--offline', '--config', 'profile.release.strip="symbols"', '--path', join(proof, source[0]), '--root', release], output);
  const executable = join(release, 'bin/apparent-inspect');
  const home = realpathSync(join(proof, 'synthetic-home'));
  const environment = { ...process.env, HOME: home, APPARENT_CAPTURES_DIR: join(home, 'explicit-captures') };
  for (const name of ['legacy', 'current']) {
    const variants = name === 'legacy' ? [[], ['--json']] : [[], ['--json'], ['--marks', '--json'], ['--experiment', 'agentContext']];
    for (const flags of variants) {
      const args = [join(home, 'explicit-captures', name + '.apparent'), ...flags];
      assert.equal(run(executable, args, home, environment), run(debug, args, home, environment), 'Release/debug inspection output mismatch');
    }
  }
  const bytes = readFileSync(executable);
  const manifest = { schema: 1, protocol: 1, executable: 'apparent-inspect',
    sourceSha: vcs.git.sha1, sourceArchiveSha256: expectedHash, version: source[0].slice('apparent-inspect-'.length),
    target: binaryTarget(bytes), profile: 'release-stripped', rustc: run('rustc', ['-vV']).trim(), sha256: sha256(bytes) };
  const payload = join(output, 'payload');
  mkdirSync(payload, { mode: 0o700 });
  writeFileSync(join(payload, manifest.executable), bytes, { mode: 0o755, flag: 'wx' });
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const artifact = join(output, `apparent-inspect-${manifest.sourceSha}-${manifest.target}.tar.gz`);
  run('tar', ['-czf', artifact, '-C', payload, manifest.executable, 'manifest.json']);
  const archiveSha256 = sha256(readFileSync(artifact));
  writeFileSync(artifact + '.sha256', `${archiveSha256}  ${artifact.split('/').at(-1)}\n`, { flag: 'wx' });
  return { artifact, archiveSha256, manifest };
}

/** Consume an already-authenticated expected archive digest; do not download or execute it. */
export function stage(archive: string, expectedHash: string, target: string, destination: string) {
  assert(validHash(expectedHash) && targets.includes(target), 'Expected archive digest and supported target required');
  // Hash the same byte snapshot that tar will consume, not a mutable input pathname.
  const snapshot = readFileSync(archive);
  assert.equal(sha256(snapshot), expectedHash, 'Binary archive digest mismatch');
  const dest = resolve(destination);
  const parent = lstatSync(dirname(dest));
  assert(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o022) === 0 &&
    (process.getuid === undefined || parent.uid === process.getuid()), 'Trusted exclusive assembly directory required');
  const temporary = mkdtempSync(join(dirname(dest), '.inspection-stage-'));
  try {
    const input = join(temporary, 'input.tar.gz');
    writeFileSync(input, snapshot, { mode: 0o600, flag: 'wx' });
    const names = run('tar', ['-tzf', input]).trim().split('\n').sort();
    assert.deepEqual(names, ['apparent-inspect', 'manifest.json'], 'Unexpected archive inventory');
    assert(run('tar', ['-tvzf', input]).trim().split('\n').every(line => line.startsWith('-')), 'Only regular files accepted');
    run('tar', ['-xzf', input, '-C', temporary]);
    const bytes = readFileSync(join(temporary, 'apparent-inspect'));
    const manifestBytes = readFileSync(join(temporary, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString());
    assert(manifest.schema === 1 && manifest.protocol === 1 && manifest.executable === 'apparent-inspect' &&
      manifest.target === target && /^[a-f0-9]{40}$/.test(manifest.sourceSha) &&
      validHash(manifest.sourceArchiveSha256) && /^\d+\.\d+\.\d+$/.test(manifest.version), 'Invalid component manifest');
    assert.equal(binaryTarget(bytes), target, 'Binary architecture mismatch');
    assert.equal(sha256(bytes), manifest.sha256, 'Executable digest mismatch');
    const shipping = join(temporary, 'shipping');
    mkdirSync(shipping, { mode: 0o700 });
    writeFileSync(join(shipping, manifest.executable), bytes, { mode: 0o755, flag: 'wx' });
    writeFileSync(join(shipping, 'manifest.json'), manifestBytes, { mode: 0o644, flag: 'wx' });
    publishValidatedDirectory(shipping, dest);
    return manifest;
  } finally { rmSync(temporary, { recursive: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, archive, hash, arg, destination] = process.argv.slice(2);
  if (operation === 'build' && archive && hash && arg && !destination) console.log(JSON.stringify(build(archive, hash, arg)));
  else if (operation === 'stage' && archive && hash && arg && destination) console.log(JSON.stringify(stage(archive, hash, arg, destination)));
  else throw new Error('Usage: package.ts build SOURCE.crate SHA256 NEW_OUTPUT | stage BINARY.tar.gz SHA256 TARGET NEW_DESTINATION');
}
