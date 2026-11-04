import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { stage } from './renderer-artifact.ts';

const artifact = resolve(process.env.APPARENT_RENDERER_ARTIFACT ?? '');
assert(process.env.APPARENT_RENDERER_ARTIFACT, 'Set APPARENT_RENDERER_ARTIFACT to the real renderer archive produced by npm run renderer:build-artifact');
const bytes = readFileSync(artifact);
const digest = (input: Buffer) => createHash('sha256').update(input).digest('hex');
const archiveHash = digest(bytes);

function tar(directory: string, output: string, members: string[]) {
  const result = spawnSync('tar', ['-czf', output, '-C', directory, ...members]);
  assert.equal(result.status, 0, String(result.stderr));
}

test('stage the authenticated Vite snapshot, preserve exact inventory and refuse replacement', () => {
  const work = mkdtempSync(join(tmpdir(), 'apparent-renderer-stage-'));
  chmodSync(work, 0o700);
  try {
    const destination = join(work, 'renderer');
    const manifest = stage(artifact, archiveHash, destination);
    const actual = manifest.files.map((file: { path: string; sha256: string }) => ({
      path: file.path, sha256: digest(readFileSync(join(destination, 'renderer', ...file.path.split('/')))),
    }));
    assert.deepEqual(actual, manifest.files);
    assert.deepEqual(JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')), manifest);
    assert.throws(() => stage(artifact, archiveHash, destination), /already exists/);
    assert.throws(() => stage(artifact, '0'.repeat(64), join(work, 'wrong-hash')), /digest mismatch/);
    assert(!existsSync(join(work, 'wrong-hash')));

    const payload = join(work, 'payload');
    mkdirSync(join(payload, 'renderer'), { recursive: true });
    writeFileSync(join(payload, 'renderer', 'index.html'), '<html>tampered</html>');
    writeFileSync(join(payload, 'manifest.json'), readFileSync(join(destination, 'manifest.json')));
    const tampered = join(work, 'tampered.tar.gz');
    tar(payload, tampered, ['renderer/index.html', 'manifest.json']);
    const tamperedHash = digest(readFileSync(tampered)); // caller-authenticated bytes still fail manifest inventory
    assert.throws(() => stage(tampered, tamperedHash, join(work, 'tampered-stage')), /inventory|member inventory/);
    assert(!existsSync(join(work, 'tampered-stage')));

    writeFileSync(join(payload, 'unexpected.txt'), 'synthetic');
    const extraMember = join(work, 'extra-member.tar.gz');
    tar(payload, extraMember, ['manifest.json', 'unexpected.txt']);
    assert.throws(() => stage(extraMember, digest(readFileSync(extraMember)), join(work, 'extra-stage')), /Unexpected renderer archive inventory/);
    assert(!existsSync(join(work, 'extra-stage')));

    const linked = join(work, 'linked');
    mkdirSync(join(linked, 'renderer'), { recursive: true });
    symlinkSync('/etc/passwd', join(linked, 'renderer', 'index.html'));
    writeFileSync(join(linked, 'manifest.json'), '{}');
    const linkedArchive = join(work, 'linked.tar.gz');
    tar(linked, linkedArchive, ['renderer/index.html', 'manifest.json']);
    assert.throws(() => stage(linkedArchive, digest(readFileSync(linkedArchive)), join(work, 'linked-stage')), /regular files only/);
    assert(!existsSync(join(work, 'linked-stage')));

    const alias = join(work, 'symlink-parent');
    symlinkSync(work, alias, 'dir');
    assert.throws(() => stage(artifact, archiveHash, join(alias, 'rejected')), /Symlink/);
    assert(!existsSync(join(work, 'rejected')));
  } finally { rmSync(work, { recursive: true, force: true }); }
});
