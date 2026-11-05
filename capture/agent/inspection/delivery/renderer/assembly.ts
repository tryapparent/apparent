/** Compose an independently built Desktop renderer beside the admitted root application. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shippingDirectory } from '../../../../../shared/packaging/transaction.ts';

const root = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const producer = join(root, 'capture/desktop/ui/frontend/scripts/renderer-artifact.ts');

/** Stage via the producer contract; its manifest is payload metadata, never trust. */
export function stageRendererArchive(archive: string, expectedSha256: string, destination: string) {
  assert(archive && /^[a-f0-9]{64}$/.test(expectedSha256),
    'Authenticated renderer archive and expected SHA-256 are required');
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', producer, 'stage', resolve(archive), expectedSha256, resolve(destination)],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Renderer staging failed');

  const output = resolve(destination);
  const renderer = join(output, 'renderer');
  const rendererStat = lstatSync(renderer);
  const manifestStat = lstatSync(join(output, 'manifest.json'));
  assert(rendererStat.isDirectory() && !rendererStat.isSymbolicLink(), 'Staged renderer is unsafe');
  assert(manifestStat.isFile() && !manifestStat.isSymbolicLink(), 'Staged renderer manifest is unsafe');
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  assert(manifest.schema === 1 && manifest.protocol === 2 && manifest.kind === 'apparent-desktop-renderer' &&
    Array.isArray(manifest.files) && manifest.files.length > 0 &&
    Array.isArray(manifest.hostFiles) && manifest.hostFiles.length > 0,
    'Staged renderer and Electron host contract is invalid');

  // The producer keeps this nested tree private. Normalize for ordinary app
  // resources before the containing app candidate is signed or published.
  normalize(renderer);
  const host = join(output, 'electron');
  const hostStat = lstatSync(host);
  assert(hostStat.isDirectory() && !hostStat.isSymbolicLink(), 'Staged Electron host is unsafe');
  normalize(host);
  shippingDirectory(renderer);
  shippingDirectory(host);
  assert.equal(lstatSync(renderer).mode & 0o777, 0o755, 'Renderer directory must be traversable by package users');
  assert.equal(lstatSync(join(output, 'manifest.json')).mode & 0o777, 0o644,
    'Renderer manifest must be readable by package users');
  for (const file of manifest.files) {
    const path = join(renderer, ...file.path.split('/'));
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Invalid packaged renderer file: ${file.path}`);
    assert.equal(stat.mode & 0o777, 0o644, `Renderer file is not readable by package users: ${file.path}`);
  }
  for (const file of manifest.hostFiles) {
    const path = join(host, ...file.path.split('/'));
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Invalid packaged Electron host file: ${file.path}`);
    assert.equal(stat.mode & 0o777, 0o644, `Electron host file is not readable by package users: ${file.path}`);
  }
  for (const entry of manifest.entries) assert(lstatSync(join(renderer, entry)).isFile(), `Missing renderer entry: ${entry}`);
  return { sourceGitHead: manifest.source.gitHead, archiveSha256: expectedSha256,
    inputInventorySha256: manifest.source.inputInventory.sha256,
    fileCount: manifest.files.length, hostFileCount: manifest.hostFiles.length };
}

function normalize(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Renderer package contains a symlink: ${path}`);
    if (entry.isDirectory()) {
      normalize(path);
      chmodSync(path, 0o755);
    } else {
      assert(entry.isFile(), `Renderer package contains a nonregular entry: ${path}`);
      chmodSync(path, 0o644);
    }
  }
}
