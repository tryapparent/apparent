import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stage } from './package.ts';

const artifact = resolve(process.env.APPARENT_INSPECTION_ARTIFACT ?? '');
assert(process.env.APPARENT_INSPECTION_ARTIFACT, 'Set APPARENT_INSPECTION_ARTIFACT to a real produced component archive');
const bytes = readFileSync(artifact);
const hash = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(spawnSync('tar', ['-xOf', artifact, 'manifest.json'], { encoding: 'utf8' }).stdout);

test('stage verified byte snapshot, execute real installed component, refuse replacement/tampering', () => {
  const work = mkdtempSync(join(tmpdir(), 'inspection-stage-test-'));
  chmodSync(work, 0o700);
  try {
    const dest = join(work, 'inspection');
    assert.deepEqual(stage(artifact, hash, manifest.target, dest), manifest);
    const exe = join(dest, 'apparent-inspect');
    assert.equal(createHash('sha256').update(readFileSync(exe)).digest('hex'), manifest.sha256);
    const fixture = fileURLToPath(new URL('../tests/fixtures/legacy.json', import.meta.url));
    const bundle = join(work, 'legacy.apparent');
    mkdirSync(bundle);
    writeFileSync(join(bundle, 'apparent.json'), readFileSync(fixture));
    const output = spawnSync(exe, [bundle, '--json'], { cwd: work, encoding: 'utf8',
      env: { ...process.env, HOME: work, APPARENT_CAPTURES_DIR: work } });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(JSON.parse(output.stdout).id, 'legacy');
    assert.throws(() => stage(artifact, hash, manifest.target, dest), /exist/i);
    assert.equal(createHash('sha256').update(readFileSync(exe)).digest('hex'), manifest.sha256);
    const rejected = join(work, 'rejected');
    assert.throws(() => stage(artifact, '0'.repeat(64), manifest.target, rejected), /digest mismatch/);
    const other = manifest.target.startsWith('x86_64') ? manifest.target.replace('x86_64', 'aarch64') : manifest.target.replace('aarch64', 'x86_64');
    assert.throws(() => stage(artifact, hash, other, rejected), /manifest/);
    const corrupt = join(work, 'corrupt.tar.gz');
    writeFileSync(corrupt, Buffer.concat([bytes, Buffer.from('changed')]));
    assert.throws(() => stage(corrupt, hash, manifest.target, rejected), /digest mismatch/);
    assert(!existsSync(rejected));
    // A valid expected archive digest still cannot authorize an unexpected member.
    writeFileSync(join(work, 'unexpected'), 'synthetic');
    const extra = join(work, 'extra.tar.gz');
    assert.equal(spawnSync('tar', ['-czf', extra, '-C', work, 'unexpected']).status, 0);
    const extraHash = createHash('sha256').update(readFileSync(extra)).digest('hex');
    assert.throws(() => stage(extra, extraHash, manifest.target, rejected), /inventory/);
    assert(!existsSync(rejected));
  } finally { rmSync(work, { recursive: true }); }
});
