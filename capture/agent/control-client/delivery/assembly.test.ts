import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pack } from './package.ts';
import { stageAgentControlClient, validateAgentControlClientAdmission } from '../../inspection/delivery/composition.ts';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const git = (...args: string[]) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('production admission is protocol-bound and accepts only the existing verifier producer', () => {
  const value = { archive: '/artifact/capture-client.tar.gz', archiveSha256: 'a'.repeat(64),
    sourceSha: 'b'.repeat(40), protocol: 1 };
  assert.deepEqual(validateAgentControlClientAdmission(value), value);
  assert.throws(() => validateAgentControlClientAdmission({ ...value, protocol: 2 }), /Invalid Agent control-client admission/);
  assert.throws(() => validateAgentControlClientAdmission({ ...value, signerWorkflow: 'release-linux.yml' }),
    /Invalid Agent control-client admission/);
  assert.throws(() => validateAgentControlClientAdmission({ ...value, archiveSha256: 'not-a-digest' }),
    /Invalid Agent control-client admission/);
  assert.throws(() => validateAgentControlClientAdmission({ ...value, sourceSha: 'not-a-source' }),
    /Invalid Agent control-client admission/);
});

test('stage the real capture client inside one app candidate with separate source identities', () => {
  const executable = process.env.APPARENT_CAPTURE_CLIENT;
  assert(executable, 'APPARENT_CAPTURE_CLIENT must name the verified standalone binary');
  const sourceSha = git('rev-parse', 'HEAD');
  const target = `${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-${process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu'}`;
  const root = mkdtempSync(join(tmpdir(), 'agent-control-assembly-'));
  const previousMask = process.umask(0o077);
  try {
    chmodSync(root, 0o700);
    const app = join(root, 'app');
    mkdirSync(app, { mode: 0o700 });
    writeFileSync(join(app, 'apparent'), 'root binary remains unchanged', { mode: 0o755 });
    const produced = pack(executable, sourceSha, target, join(root, 'producer'));
    const assembly = stageAgentControlClient(produced.archive, produced.digest, sourceSha, target,
      join(app, 'agent-control-client'), sourceSha);

    assert.deepEqual(readdirSync(app).sort(), ['agent-control-client', 'apparent']);
    assert.equal(readFileSync(join(app, 'apparent'), 'utf8'), 'root binary remains unchanged');
    const directory = join(app, 'agent-control-client');
    assert.deepEqual(readdirSync(directory).sort(), ['apparent-capture', 'composition.json', 'manifest.json']);
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    const receipt = JSON.parse(readFileSync(join(directory, 'composition.json'), 'utf8'));
    assert.equal(manifest.protocol, 1);
    assert.equal(manifest.sourceSha, sourceSha);
    assert.equal(manifest.target, target);
    assert.equal(hash(readFileSync(join(directory, 'apparent-capture'))), manifest.executableSha256);
    assert.equal(assembly.kind, 'agent-control-client-assembly');
    assert.equal(assembly.compositionSource, sourceSha);
    assert.equal(receipt.sourceSha, sourceSha);
    assert.equal(receipt.archiveSha256, produced.digest);
    assert.equal(receipt.protocol, 1);
    assert.equal(lstatSync(directory).mode & 0o777, 0o755);
    assert.equal(lstatSync(join(directory, 'apparent-capture')).mode & 0o777, 0o755);
    assert.equal(lstatSync(join(directory, 'manifest.json')).mode & 0o777, 0o644);
    assert.equal(lstatSync(join(directory, 'composition.json')).mode & 0o777, 0o644);

    const occupied = join(app, 'occupied');
    mkdirSync(occupied, { mode: 0o700 });
    writeFileSync(join(occupied, 'sentinel'), 'preserve');
    assert.throws(() => stageAgentControlClient(produced.archive, produced.digest, sourceSha, target, occupied), /already exists/);
    assert.equal(readFileSync(join(occupied, 'sentinel'), 'utf8'), 'preserve');

    const wrongSource = join(app, 'wrong-source');
    assert.throws(() => stageAgentControlClient(produced.archive, produced.digest, '0'.repeat(40), target, wrongSource), /source identity mismatch/);
    assert.throws(() => lstatSync(wrongSource), { code: 'ENOENT' });
    const wrongDigest = join(app, 'wrong-digest');
    assert.throws(() => stageAgentControlClient(produced.archive, '0'.repeat(64), sourceSha, target, wrongDigest), /archive digest mismatch/);
    assert.throws(() => lstatSync(wrongDigest), { code: 'ENOENT' });
    const wrongTarget = join(app, 'wrong-target');
    const alternateTarget = target === 'x86_64-unknown-linux-gnu' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
    assert.throws(() => stageAgentControlClient(produced.archive, produced.digest, sourceSha, alternateTarget, wrongTarget), /target mismatch/);
    assert.throws(() => lstatSync(wrongTarget), { code: 'ENOENT' });
    assert.equal(assembly.sourceSha, sourceSha, 'The component source stays distinct from root receipt identity');
  } finally {
    process.umask(previousMask);
    rmSync(root, { recursive: true, force: true });
  }
});
