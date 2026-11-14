// Consumer-owned provisioning from immutable published artifacts, never Engine source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(readFileSync(join(root, 'engine.json'), 'utf8'));
const key = `${process.platform}-${process.arch}`;
const runtimePin = pin.runtimes[key];
if (!runtimePin) throw Error('Record media supports Linux/macOS x64/arm64');
const args = process.argv.slice(2);
assert.equal(args.length, 2); assert.equal(args[0], '--out');
const out = resolve(args[1]);
if (existsSync(out)) {
  assert(lstatSync(out).isDirectory() && !lstatSync(out).isSymbolicLink(), 'Refusing an unsafe staging destination');
  const marker = JSON.parse(readFileSync(join(out, 'record-media-staging.json'), 'utf8'));
  assert.equal(marker.owner, 'record-media/1', 'Refusing to replace an unowned staging directory');
}
const checksum = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sdk = join(root, 'node_modules/@apparent/engine-sdk');
for (const [file, expected] of Object.entries(pin.sdkFiles)) {
  assert(lstatSync(join(sdk, file)).isFile());
  assert.equal(checksum(join(sdk, file)), expected, `Pinned SDK differs: ${file}`);
}
for (const file of ['worker.js', 'policy.js']) assert(lstatSync(join(root, 'dist', file)).isFile());
const temporary = mkdtempSync(join(tmpdir(), 'apparent-dev-record-media-'));
try {
  const base = `engine-media-${key}`;
  const archive = join(temporary, base + '.tar.gz');
  const cached = join(out, 'native');
  const names = ['LICENSE', 'apparent-engine-media', 'manifest.json'];
  if (process.platform === 'darwin') names.push('apparent-engine-probe');
  const verify = (directory: string) => {
    assert.deepEqual(readdirSync(directory).sort(), names.slice().sort());
    for (const name of names) {
      assert(lstatSync(join(directory, name)).isFile());
      assert.equal(checksum(join(directory, name)), runtimePin.files[name], `Pinned runtime differs: ${name}`);
    }
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.sourceCommit, pin.commit); assert.equal(manifest.sourceDirty, false);
    assert.equal(manifest.platform, process.platform); assert.equal(manifest.arch, process.arch);
    assert.equal(manifest.capability, 'movie-probe/1'); assert.equal(manifest.sdkVersion, '0.1.0');
    assert.deepEqual(manifest.files.map((entry: {path: string}) => entry.path).sort(), names.filter(n => n !== 'manifest.json').sort());
    for (const entry of manifest.files) {
      assert.equal(basename(entry.path), entry.path);
      const file = join(directory, entry.path), stat = lstatSync(file);
      assert(stat.isFile()); assert.equal(stat.mode & 0o777, entry.mode);
      assert.equal(checksum(file), entry.sha256);
    }
  };
  let native: string;
  try { verify(cached); native = cached; }
  catch {
    const url = `https://github.com/tryapparent/apparent/releases/download/engine-media-${pin.commit}/${base}.tar.gz`;
    const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
    assert(response.ok && response.body, 'Pinned Engine runtime unavailable');
    const chunks: Uint8Array[] = []; let total = 0;
    for await (const chunk of response.body) {
      total += chunk.byteLength; assert(total <= 32 * 1024 * 1024, 'Engine artifact too large'); chunks.push(chunk);
    }
    writeFileSync(archive, Buffer.concat(chunks)); assert.equal(checksum(archive), runtimePin.archiveSha256);
    const entries = execFileSync('tar', ['-tzf', archive], {encoding: 'utf8'}).trim().split('\n');
    assert.deepEqual(entries.slice().sort(), [base + '/', ...names.map(n => base + '/' + n)].sort());
    const types = execFileSync('tar', ['-tvzf', archive], {encoding: 'utf8'}).trim().split('\n');
    assert(types.every(line => /^[-d]/.test(line)), 'Unexpected Engine archive member');
    execFileSync('tar', ['-xzf', archive, '-C', temporary]);
    native = join(temporary, base); verify(native);
  }
  const prepared = join(temporary, 'prepared'); mkdirSync(prepared, {mode: 0o700});
  cpSync(native, join(prepared, 'native'), {recursive: true});
  for (const file of ['worker.js', 'policy.js']) cpSync(join(root, 'dist', file), join(prepared, file));
  mkdirSync(join(prepared, 'node_modules/@apparent'), {recursive: true});
  cpSync(sdk, join(prepared, 'node_modules/@apparent/engine-sdk'), {recursive: true});
  writeFileSync(join(prepared, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(prepared, 'record-media-staging.json'), JSON.stringify({owner: 'record-media/1', engine: pin.commit}));
  if (existsSync(out)) {
    assert(lstatSync(out).isDirectory() && !lstatSync(out).isSymbolicLink());
    const marker = JSON.parse(readFileSync(join(out, 'record-media-staging.json'), 'utf8'));
    assert.equal(marker.owner, 'record-media/1', 'Refusing to replace an unowned staging directory');
    rmSync(out, {recursive: true});
  }
  mkdirSync(dirname(out), {recursive: true});
  // Build output only; the installed app is staged/signed separately, never hot-updated.
  cpSync(prepared, out, {recursive: true});
  console.log(`Staged Record media with pinned Engine ${pin.commit} (${key})`);
} finally { rmSync(temporary, {recursive: true, force: true}); }
