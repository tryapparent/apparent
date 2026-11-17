// Agent provisions an immutable published capability, never Engine source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(readFileSync(join(root, 'engine.json'), 'utf8'));
const key = `${process.platform}-${process.arch}`, runtime = pin.runtimes[key];
if (!runtime) throw Error('Agent media supports Linux/macOS x64/arm64');
const args = process.argv.slice(2);
assert.equal(args.length, 2); assert.equal(args[0], '--out');
const out = resolve(args[1]), marker = 'agent-media-staging.json';
const ownedOutput = () => {
  let stat;
  try { stat = lstatSync(out); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe Agent staging destination');
  assert.equal(JSON.parse(readFileSync(join(out, marker), 'utf8')).owner, 'agent-media/1', 'Unowned Agent staging destination');
  return true;
};
ownedOutput();
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sdk = join(root, 'node_modules/@apparent/engine-sdk');
for (const [name, expected] of Object.entries(pin.sdkFiles)) {
  assert(lstatSync(join(sdk, name)).isFile()); assert.equal(hash(join(sdk, name)), expected, `Pinned SDK differs: ${name}`);
}
for (const name of ['worker.js', 'policy.js', 'range-worker.js', 'range-policy.js']) assert(lstatSync(join(root, 'dist', name)).isFile());
const names = ['LICENSE', 'apparent-engine-media', 'apparent-engine-frames', 'manifest.json'];
const selected = ['LICENSE', 'apparent-engine-frames'];
if (process.platform === 'darwin') {
  names.push('apparent-engine-probe', 'apparent-engine-frames-native'); selected.push('apparent-engine-frames-native');
}
const verifyManifest = (path: string) => {
  assert(lstatSync(path).isFile()); assert.equal(hash(path), runtime.files['manifest.json']);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(manifest.sourceCommit, pin.commit); assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.platform + '-' + manifest.arch, key); assert.equal(manifest.sdkVersion, pin.sdkVersion);
  assert(manifest.capabilities.includes(pin.capability));
  assert.deepEqual(manifest.files.map((f: {path: string}) => f.path).sort(), names.filter(n => n !== 'manifest.json').sort());
  return manifest;
};
const verifyFiles = (directory: string, expected: string[]) => {
  assert.deepEqual(readdirSync(directory).sort(), expected.slice().sort());
  for (const name of expected) {
    const file = join(directory, name), stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(hash(file), runtime.files[name]);
    assert.equal(stat.mode & 0o777, name === 'LICENSE' || name === 'manifest.json' ? 0o644 : 0o755);
  }
};
const temporary = mkdtempSync(join(tmpdir(), 'apparent-dev-agent-media-'));
try {
  let native: string, manifest: string;
  try {
    native = join(out, 'native'); manifest = join(out, 'engine-source-manifest.json');
    verifyManifest(manifest); verifyFiles(native, selected);
  } catch {
    const base = 'engine-media-' + key, archive = join(temporary, base + '.tar.gz');
    const response = await fetch(`https://github.com/tryapparent/apparent/releases/download/engine-media-${pin.commit}/${base}.tar.gz`, {signal: AbortSignal.timeout(60_000)});
    assert(response.ok && response.body, 'Pinned Engine frame runtime unavailable');
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.byteLength; assert(length <= 32 * 1024 * 1024); chunks.push(chunk); }
    writeFileSync(archive, Buffer.concat(chunks)); assert.equal(hash(archive), runtime.archiveSha256);
    assert.deepEqual(execFileSync('tar', ['-tzf', archive], {encoding: 'utf8'}).trim().split('\n').sort(),
      [base + '/', ...names.map(n => base + '/' + n)].sort());
    assert(execFileSync('tar', ['-tvzf', archive], {encoding: 'utf8'}).trim().split('\n').every(line => /^[-d]/.test(line)));
    execFileSync('tar', ['-xzf', archive, '-C', temporary]); native = join(temporary, base);
    manifest = join(native, 'manifest.json'); const facts = verifyManifest(manifest); verifyFiles(native, names);
    for (const file of facts.files) {
      assert.equal(basename(file.path), file.path); assert.equal(hash(join(native, file.path)), file.sha256);
      assert.equal(lstatSync(join(native, file.path)).mode & 0o777, file.mode);
    }
  }
  const prepared = join(temporary, 'prepared'); mkdirSync(join(prepared, 'native'), {recursive: true, mode: 0o755});
  for (const name of selected) cpSync(join(native, name), join(prepared, 'native', name));
  // The original distribution manifest is provenance, not an installed inventory:
  // unused metadata readers are omitted; app signing/bundling seals installed bytes.
  cpSync(manifest, join(prepared, 'engine-source-manifest.json'));
  for (const name of ['worker.js', 'policy.js', 'range-worker.js', 'range-policy.js']) cpSync(join(root, 'dist', name), join(prepared, name));
  mkdirSync(join(prepared, 'node_modules/@apparent'), {recursive: true});
  cpSync(sdk, join(prepared, 'node_modules/@apparent/engine-sdk'), {recursive: true});
  writeFileSync(join(prepared, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(prepared, marker), JSON.stringify({owner: 'agent-media/1', engine: pin.commit, capability: pin.capability}));
  if (ownedOutput()) rmSync(out, {recursive: true});
  mkdirSync(dirname(out), {recursive: true}); cpSync(prepared, out, {recursive: true});
  // cp creates destination directories using the caller's umask, rather than
  // preserving the prepared mode. Installed native resources must not be writable by a group.
  chmodSync(join(out, 'native'), 0o755);
  console.log(`Staged Agent frames from pinned Engine ${pin.commit} (${key})`);
} finally { rmSync(temporary, {recursive: true, force: true}); }
