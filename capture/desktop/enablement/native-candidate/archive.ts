import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {closeSync, openSync, readFileSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function download(response: Response, path: string, expected: {sha256: string; bytes: number}) {
  assert.ok(response.body); const hash = createHash('sha256'); let bytes = 0;
  const fd = openSync(path, 'wx', 0o600);
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength; assert.ok(bytes <= expected.bytes, 'Artifact exceeds authenticated size');
      hash.update(chunk); let offset = 0;
      while (offset < chunk.byteLength) offset += writeSync(fd, chunk, offset);
    }
    assert.deepEqual({sha256: hash.digest('hex'), bytes}, expected, 'Downloaded artifact differs from upload');
  } finally { closeSync(fd); }
}
export function unpack(outer: string, directory: string) {
  const members = execFileSync('unzip', ['-Z1', outer], {encoding: 'utf8'}).trim().split('\n').sort();
  const archiveName = 'Apparent-Native-Candidate-x64.zip';
  assert.deepEqual(members, [archiveName, 'candidate.json'].sort(), 'Unexpected outer archive members');
  for (const member of members) {
    const fd = openSync(join(directory, member), 'wx', 0o600);
    try { assert.equal(spawnSync('unzip', ['-p', outer, member], {stdio: ['ignore', fd, 'pipe']}).status, 0); }
    finally { closeSync(fd); }
  }
  const manifestPath = join(directory, 'candidate.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const archive = join(directory, archiveName);
  const paths = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).trim().split('\n');
  for (const path of paths) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'));
    assert.ok(path.startsWith(manifest.app + '/') || path === manifest.app || path.startsWith('__MACOSX/'));
  }
  return {archive, manifestPath, manifest};
}
