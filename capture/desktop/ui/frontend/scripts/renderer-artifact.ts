/** Owner-local Vite renderer production and authenticated staging. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishValidatedDirectory } from '../../../../../shared/packaging/transaction.ts';

const root = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const frontend = join(root, 'capture/desktop/ui/frontend');
const outputEntries = ['index.html', 'settings.html', 'onboarding.html', 'pill/index.html'];
const electronVersion = JSON.parse(readFileSync(join(frontend, 'package.json'), 'utf8')).devDependencies?.electron as string;
const electronMajor = Number(/^\^?(\d+)/.exec(electronVersion)?.[1]);
assert(Number.isSafeInteger(electronMajor) && electronMajor > 0, 'Cannot determine Electron runtime major');
const runtimeCompatibility = { renderer: 'vite-static-multipage', electronMajor, assetBase: './', nodeIntegration: false };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const validHash = (hash: unknown): hash is string => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);

function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr ?? result.error?.message}`);
  return result.stdout;
}

function runBytes(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr?.toString() ?? result.error?.message}`);
  return result.stdout as Buffer;
}

function filesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in renderer input tree: ${absolute}`);
    if (entry.isDirectory()) files.push(...filesUnder(absolute));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error(`Unsupported renderer input: ${absolute}`);
  }
  return files;
}

export function inputInventory() {
  // Only versioned inputs belong to the source identity; ignored build/test caches do not.
  const paths = runBytes('git', ['ls-files', '-z', '--', relative(root, frontend), 'shared/ui'])
    .toString().split('\0').filter(Boolean).sort(compare);
  const files = paths.map(path => {
    const absolute = join(root, path);
    const metadata = lstatSync(absolute);
    assert(metadata.isFile() && !metadata.isSymbolicLink(), `Unsupported renderer source input: ${path}`);
    return { path: path.split(sep).join('/'), sha256: sha256(readFileSync(absolute)) };
  });
  return { files, sha256: sha256(JSON.stringify(files)) };
}

function treeInventory(directory: string) {
  return filesUnder(directory).map(absolute => ({
    path: relative(directory, absolute).split(sep).join('/'), sha256: sha256(readFileSync(absolute)),
  })).sort((a, b) => compare(a.path, b.path));
}

/** Run the real frontend build, then seal the produced Vite dist as a separate artifact. */
export function build(destination: string) {
  const dest = resolve(destination);
  mkdirSync(dest, { mode: 0o700 }); // Exclusive output; retain failed evidence.
  run('npm', ['run', 'build'], frontend);
  const dist = join(frontend, 'dist');
  const inventory = treeInventory(dist);
  assert(outputEntries.every(entry => inventory.some(file => file.path === entry)), 'Vite output is missing a declared renderer entry');
  const manifest = {
    schema: 1,
    protocol: 1,
    kind: 'apparent-desktop-renderer',
    source: { gitHead: run('git', ['rev-parse', 'HEAD']).trim(), gitDirty: Boolean(run('git', ['status', '--porcelain', '--', 'capture/desktop/ui/frontend', 'shared/ui']).trim()), inputInventory: inputInventory() },
    target: 'any',
    runtimeCompatibility,
    entries: outputEntries,
    files: inventory,
  };
  const payload = join(dest, 'payload');
  mkdirSync(payload, { mode: 0o700 });
  const renderer = join(payload, 'renderer');
  mkdirSync(renderer, { mode: 0o755 });
  for (const file of inventory) {
    const source = join(dist, ...file.path.split('/'));
    const target = join(renderer, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source), { flag: 'wx', mode: 0o644 });
  }
  writeFileSync(join(payload, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  const sourceSha = manifest.source.inputInventory.sha256.slice(0, 16);
  const artifact = join(dest, `apparent-desktop-renderer-${sourceSha}.tar.gz`);
  run('tar', ['-czf', artifact, '-C', payload,
    ...inventory.map(file => `renderer/${file.path}`), 'manifest.json'], dest);
  return { artifact, archiveSha256: sha256(readFileSync(artifact)), manifest };
}

/** Stage the exact byte snapshot authenticated by the caller's expected SHA-256. */
export function stage(archive: string, expectedHash: string, destination: string) {
  assert(validHash(expectedHash), 'Expected authenticated renderer archive SHA256 required');
  const snapshot = readFileSync(archive);
  assert.equal(sha256(snapshot), expectedHash, 'Renderer archive digest mismatch');
  const dest = resolve(destination);
  for (let ancestor = dest;; ancestor = dirname(ancestor)) {
    try { assert(!lstatSync(ancestor).isSymbolicLink(), 'Symlink in renderer staging destination'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(ancestor) === ancestor) break;
  }
  try { lstatSync(dest); throw new Error('Renderer staging destination already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const parent = lstatSync(dirname(dest));
  assert(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o022) === 0 &&
    (process.getuid === undefined || parent.uid === process.getuid()), 'Trusted private renderer assembly directory required');
  const temporary = mkdtempSync(join(dirname(dest), '.renderer-stage-'));
  chmodSync(temporary, 0o700);
  try {
    const input = join(temporary, 'input.tar.gz');
    writeFileSync(input, snapshot, { flag: 'wx', mode: 0o600 });
    const names = run('tar', ['-tzf', input]).trim().split('\n').sort();
    const listedFiles = names.filter(name => name.startsWith('renderer/'));
    assert.deepEqual(names, ['manifest.json', ...listedFiles].sort(), 'Unexpected renderer archive inventory');
    assert(run('tar', ['-tvzf', input]).trim().split('\n').every(line => line.startsWith('-')), 'Renderer archive may contain regular files only');
    assert(listedFiles.every(name => {
      const parts = name.slice('renderer/'.length).split('/');
      return parts.length > 0 && parts.every(part => part !== '' && part !== '.' && part !== '..' && !part.includes('\\'));
    }), 'Unsafe renderer archive path');
    assert(names.includes('renderer/index.html') && names.includes('renderer/settings.html') &&
      names.includes('renderer/onboarding.html') && names.includes('renderer/pill/index.html'), 'Renderer entry inventory incomplete');
    const manifestBytes = runBytes('tar', ['-xOzf', input, '--', 'manifest.json']);
    const manifest = JSON.parse(manifestBytes.toString());
    const inputFiles = manifest.source?.inputInventory?.files;
    const inputPaths = Array.isArray(inputFiles) ? inputFiles.map((file: { path: string }) => file.path) : [];
    assert(manifest.schema === 1 && manifest.protocol === 1 && manifest.kind === 'apparent-desktop-renderer' &&
      manifest.target === 'any' && JSON.stringify(manifest.runtimeCompatibility) === JSON.stringify(runtimeCompatibility) &&
      /^[a-f0-9]{40}$/.test(manifest.source?.gitHead) && typeof manifest.source?.gitDirty === 'boolean' && validHash(manifest.source?.inputInventory?.sha256) &&
      Array.isArray(inputFiles) && inputFiles.length > 0 && inputFiles.every((file: { path: string; sha256: string }) =>
        typeof file.path === 'string' && (file.path.startsWith('capture/desktop/ui/frontend/') || file.path.startsWith('shared/ui/')) &&
        !file.path.includes('\\') && !file.path.includes('\0') &&
        !file.path.split('/').some((part: string) => part === '' || part === '.' || part === '..') && validHash(file.sha256)) &&
      new Set(inputPaths).size === inputPaths.length &&
      sha256(JSON.stringify(inputFiles)) === manifest.source.inputInventory.sha256 && Array.isArray(manifest.files), 'Invalid renderer manifest');
    assert.deepEqual(manifest.entries, outputEntries, 'Renderer entry contract mismatch');
    assert.deepEqual(listedFiles, manifest.files.map((file: { path: string }) => `renderer/${file.path}`).sort(), 'Archive member inventory mismatch');
    const extracted = join(temporary, 'renderer');
    mkdirSync(extracted, { mode: 0o700 });
    for (const name of listedFiles) {
      const file = name.slice('renderer/'.length);
      const target = join(extracted, ...file.split('/'));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, runBytes('tar', ['-xOzf', input, '--', name]), { flag: 'wx', mode: 0o600 });
    }
    const actual = treeInventory(extracted);
    assert.deepEqual(actual, manifest.files, 'Renderer staged inventory or digest mismatch');
    const candidate = join(temporary, 'candidate');
    mkdirSync(join(candidate, 'renderer'), { recursive: true, mode: 0o700 });
    for (const file of actual) {
      const source = join(temporary, 'renderer', ...file.path.split('/'));
      const target = join(candidate, 'renderer', ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(source), { flag: 'wx', mode: 0o644 });
    }
    writeFileSync(join(candidate, 'manifest.json'), manifestBytes, { flag: 'wx', mode: 0o644 });
    publishValidatedDirectory(candidate, dest);
    return manifest;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, first, second, third] = process.argv.slice(2);
  if (operation === 'build' && first && !second) {
    const result = build(first);
    console.log(JSON.stringify({ artifact: result.artifact, archiveSha256: result.archiveSha256,
      sourceInputSha256: result.manifest.source.inputInventory.sha256, sourceInputFiles: result.manifest.source.inputInventory.files.length,
      rendererFiles: result.manifest.files.length, runtimeCompatibility: result.manifest.runtimeCompatibility }));
  } else if (operation === 'stage' && first && second && third) {
    const manifest = stage(first, second, third);
    console.log(JSON.stringify({ staged: resolve(third), sourceGitHead: manifest.source.gitHead,
      sourceInputSha256: manifest.source.inputInventory.sha256, rendererFiles: manifest.files.length }));
  }
  else throw new Error('Usage: node --experimental-strip-types scripts/renderer-artifact.ts build NEW_OUTPUT | stage ARCHIVE EXPECTED_SHA256 NEW_DESTINATION');
}
