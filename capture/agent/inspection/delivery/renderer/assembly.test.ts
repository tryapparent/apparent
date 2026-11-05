/** Real renderer/root consumer proof. Set inputs from retained build artifacts. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { admitRoot, assemble, packageApplication } from '../composition.ts';
import { stageRendererArchive } from './assembly.ts';

const root = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
assert(process.env.APPARENT_ROOT_DIRECTORY && process.env.APPARENT_ROOT_RECEIPT &&
  process.env.APPARENT_ROOT_RECEIPT_SHA256 && process.env.APPARENT_INSPECTOR_ARTIFACT &&
  process.env.APPARENT_INSPECTOR_ARTIFACT_SHA256 && process.env.APPARENT_RENDERER_ARTIFACT &&
  process.env.APPARENT_RENDERER_ARTIFACT_SHA256,
  'Set artifact paths and caller-provided SHA-256 values for the sealed root receipt, inspector and renderer');
const rootDirectory = resolve(process.env.APPARENT_ROOT_DIRECTORY);
const rootReceipt = resolve(process.env.APPARENT_ROOT_RECEIPT);
const inspectorArchive = resolve(process.env.APPARENT_INSPECTOR_ARTIFACT);
const rendererArchive = resolve(process.env.APPARENT_RENDERER_ARTIFACT);
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const rootReceiptSha256 = process.env.APPARENT_ROOT_RECEIPT_SHA256;
const inspectorSha256 = process.env.APPARENT_INSPECTOR_ARTIFACT_SHA256;
const rendererSha256 = process.env.APPARENT_RENDERER_ARTIFACT_SHA256;
assert.equal(sha256(readFileSync(rootReceipt)), rootReceiptSha256, 'Root receipt input digest mismatch');
assert.equal(sha256(readFileSync(inspectorArchive)), inspectorSha256, 'Inspector archive input digest mismatch');
assert.equal(sha256(readFileSync(rendererArchive)), rendererSha256, 'Renderer archive input digest mismatch');

function command(cmd: string, args: string[], cwd = root) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${cmd} ${args.join(' ')}: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

function clone(rootPath: string, destination: string) {
  command('git', ['clone', '--local', '--shared', '--no-checkout', rootPath, destination]);
  command('git', ['checkout', '--detach', 'HEAD'], destination);
  command('git', ['config', 'user.name', 'Renderer assembly proof'], destination);
  command('git', ['config', 'user.email', 'proof@example.invalid'], destination);
}

function commitChange(work: string, path: string, content: string) {
  writeFileSync(join(work, path), content);
  command('git', ['add', path], work);
  command('git', ['commit', '-m', `proof: change ${path}`], work);
}

function copyAndAppend(work: string, path: string, suffix: string) {
  const source = join(root, path);
  mkdirSync(join(work, path, '..'), { recursive: true });
  writeFileSync(join(work, path), readFileSync(source, 'utf8') + suffix);
}

function seedElectronConsumer(app: string, distEntries: string[], host: string[]) {
  const dist = join(app, 'dist');
  const electron = join(app, 'electron');
  for (const name of distEntries) {
    const path = join(dist, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '<html>previously staged product renderer</html>');
  }
  for (const name of host) {
    const path = join(electron, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '// previously staged product Electron host\n');
  }
}

function localRendererFixture(sourceArchive: string, destination: string) {
  const payload = join(destination, 'renderer-fixture');
  mkdirSync(payload);
  command('tar', ['-xzf', sourceArchive, '-C', payload]);
  const manifestPath = join(payload, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const page of ['index.html', 'settings.html']) {
    const path = join(payload, 'renderer', page);
    const changed = readFileSync(path, 'utf8').replace('</title>', ' [LOCAL ROUTE FIXTURE]</title>');
    assert.notEqual(changed, readFileSync(path, 'utf8'), `Expected ${page} title in local route fixture`);
    writeFileSync(path, changed);
    manifest.files.find((file: { path: string }) => file.path === page).sha256 = sha256(changed);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const archive = join(destination, 'apparent-local-renderer-route-fixture.tar.gz');
  command('tar', ['-czf', archive, '-C', payload,
    ...manifest.files.map((file: { path: string }) => `renderer/${file.path}`),
    ...manifest.hostFiles.map((file: { path: string }) => `electron/${file.path}`), 'manifest.json']);
  return archive;
}

test('compose the authenticated renderer with the retained root while Cargo is unavailable', () => {
  const receipt = JSON.parse(readFileSync(rootReceipt, 'utf8'));
  const admitted = admitRoot(rootDirectory, rootReceipt, rootReceiptSha256);
  assert.equal(admitted.sourceSha, receipt.sourceSha);
  const originalRoot = new Map(receipt.files.map((file: { name: string; sha256: string }) =>
    [file.name, sha256(readFileSync(join(rootDirectory, file.name)))]));
  const work = mkdtempSync(join(tmpdir(), 'renderer-root-compose-'));
  chmodSync(work, 0o700);
  const blocker = join(work, 'bin');
  mkdirSync(blocker);
  writeFileSync(join(blocker, 'cargo'), '#!/bin/sh\necho "unexpected cargo invocation" >&2\nexit 93\n', { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${blocker}:${previousPath}`;
  try {
    const binary = join(work, 'AppDir/usr/bin');
    mkdirSync(binary, { recursive: true, mode: 0o755 });
    const settingsApp = join(work, 'AppDir/usr/share/apparent/settings/app');
    const noteUi = join(work, 'AppDir/usr/lib/apparent/note-ui');
    seedElectronConsumer(settingsApp, ['settings.html', 'onboarding.html', 'pill/index.html'],
      ['main.cjs', 'preload.cjs', 'settings.cjs', 'pill/main.cjs', 'pill/preload.cjs']);
    seedElectronConsumer(noteUi, ['index.html', 'settings.html', 'onboarding.html', 'pill/index.html'],
      ['runtime.cjs', 'notes/main.cjs', 'notes/preload.cjs', 'notes/protocol.cjs']);
    assert(!existsSync(join(settingsApp, 'dist/index.html')),
      'the ordinary Settings staging tree does not include the foundation index page');
    const assembled = join(work, 'assembled');
    const composition = assemble(rootDirectory, rootReceipt, rootReceiptSha256,
      inspectorArchive, inspectorSha256, assembled);
    assert.equal(composition.rootRebuilt, false);
    assert.equal(composition.root.files[0].sha256, originalRoot.get('apparent'));
    for (const file of receipt.files) {
      copyFileSync(join(rootDirectory, file.name), join(binary, file.name));
      chmodSync(join(binary, file.name), 0o755);
    }
    const oldReuse = process.env.APPARENT_INSPECTION_REUSE;
    const routeFixture = localRendererFixture(rendererArchive, work);
    const routeFixtureSha = sha256(readFileSync(routeFixture));
    const oldRenderer = process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE;
    const oldRendererSha = process.env.APPARENT_DESKTOP_RENDERER_SHA256;
    const oldRendererSource = process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA;
    process.env.APPARENT_INSPECTION_REUSE = 'proof';
    process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE = routeFixture;
    process.env.APPARENT_DESKTOP_RENDERER_SHA256 = routeFixtureSha;
    process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA = JSON.parse(
      command('tar', ['-xOzf', routeFixture, 'manifest.json'])).source.gitHead;
    try { packageApplication(assembled, binary, []); }
    finally {
      if (oldReuse === undefined) delete process.env.APPARENT_INSPECTION_REUSE;
      else process.env.APPARENT_INSPECTION_REUSE = oldReuse;
      if (oldRenderer === undefined) delete process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE;
      else process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE = oldRenderer;
      if (oldRendererSha === undefined) delete process.env.APPARENT_DESKTOP_RENDERER_SHA256;
      else process.env.APPARENT_DESKTOP_RENDERER_SHA256 = oldRendererSha;
      if (oldRendererSource === undefined) delete process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA;
      else process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA = oldRendererSource;
    }
    const packagedHelp = command(join(binary, 'apparent'), ['--help'], work);
    assert.match(packagedHelp, /Usage: apparent/);
    const manifest = JSON.parse(command('tar', ['-xOzf', routeFixture, 'manifest.json']));
    const result = { fileCount: manifest.files.length,
      archiveSha256: routeFixtureSha };
    assert.equal(result.fileCount, 20);
    assert.equal(result.archiveSha256, routeFixtureSha);
    const installedReceipt = JSON.parse(readFileSync(join(binary, 'inspection-composition.json'), 'utf8'));
    assert.equal(installedReceipt.root.sourceSha, receipt.sourceSha);
    assert.equal(installedReceipt.compositionSource, command('git', ['rev-parse', 'HEAD']));
    assert.notEqual(installedReceipt.root.sourceSha, installedReceipt.compositionSource);
    assert.equal(installedReceipt.root.files[0].sha256, originalRoot.get('apparent'));
    for (const file of manifest.files) {
      for (const app of [settingsApp, noteUi]) {
        const path = join(app, 'dist', ...file.path.split('/'));
        assert.equal(sha256(readFileSync(path)), file.sha256);
        assert.equal(lstatSync(path).mode & 0o777, 0o644);
      }
    }
    for (const entry of manifest.entries) for (const app of [settingsApp, noteUi]) {
      assert(lstatSync(join(app, 'dist', entry)).isFile());
    }
    for (const app of [settingsApp, noteUi]) {
      for (const page of ['index.html', 'settings.html']) {
        assert.match(readFileSync(join(app, 'dist', page), 'utf8'), /\[LOCAL ROUTE FIXTURE\]/,
          `${app}/${page} must consume the changed renderer artifact`);
      }
    }
    for (const file of manifest.hostFiles) {
      const path = join(settingsApp, 'electron', ...file.path.split('/'));
      assert.equal(sha256(readFileSync(path)), file.sha256);
    }
    for (const name of ['runtime.cjs', 'notes/main.cjs', 'notes/preload.cjs', 'notes/protocol.cjs']) {
      const file = manifest.hostFiles.find((entry: { path: string }) => entry.path === name);
      assert(file, `source-bound host inventory is missing ${name}`);
      assert.equal(sha256(readFileSync(join(noteUi, 'electron', ...name.split('/')))), file.sha256);
    }
    assert.match(readFileSync(join(settingsApp, 'electron/main.cjs'), 'utf8'), /\.\.\/dist\/settings\.html/);
    assert.match(readFileSync(join(settingsApp, 'electron/pill/main.cjs'), 'utf8'), /\.\.\/\.\.\/dist\/pill\/index\.html/);
    assert.match(readFileSync(join(noteUi, 'electron/notes/main.cjs'), 'utf8'), /\.\.\/\.\.\/dist\/index\.html/);
    assert.deepEqual(installedReceipt.renderer.consumers, ['settings/app', 'note-ui']);
    assert(!existsSync(join(work, 'AppDir/usr/share/apparent/desktop-ui')), 'do not stage an unconsumed renderer directory');
    const directories = [settingsApp, join(settingsApp, 'dist'), noteUi, join(noteUi, 'dist')];
    for (const file of manifest.files) {
      const parts = file.path.split('/').slice(0, -1);
      for (const app of [settingsApp, noteUi]) for (let i = 1; i <= parts.length; i++) {
        directories.push(join(app, 'dist', ...parts.slice(0, i)));
      }
    }
    for (const directory of new Set(directories)) assert.equal(lstatSync(directory).mode & 0o777, 0o755);
    for (const [name, expected] of originalRoot) assert.equal(sha256(readFileSync(join(rootDirectory, name))), expected);
    for (const [name, expected] of originalRoot) assert.equal(sha256(readFileSync(join(binary, name))), expected);
    assert.equal(admitRoot(rootDirectory, rootReceipt, rootReceiptSha256).sourceSha, receipt.sourceSha);
    console.log(JSON.stringify({ rootSourceSha: receipt.sourceSha, rootFiles: originalRoot.size,
      rootUnchanged: true, cargoAvailable: false, rendererSourceGitHead: manifest.source.gitHead,
      rendererArchiveSha256: routeFixtureSha, installedResources: manifest.files.length,
      installedProductConsumers: ['settings/app', 'note-ui'], hostElectronFiles: manifest.hostFiles.length,
      rendererDirectoriesWorldTraversable: true, packagedAppExecutesOutsideCheckout: true,
      proofKind: 'non-GUI AppDir assembly with synthetic local renderer fixture; no producer provenance claim' }));
  } finally {
    process.env.PATH = previousPath;
    rmSync(work, { recursive: true });
  }
});

test('reject wrong renderer digest and altered inventory without publishing resources', () => {
  const work = mkdtempSync(join(tmpdir(), 'renderer-negative-'));
  chmodSync(work, 0o700);
  try {
    const wrongDigest = join(work, 'wrong-digest');
    assert.throws(() => stageRendererArchive(rendererArchive, '0'.repeat(64), wrongDigest), /digest mismatch/);
    assert.throws(() => lstatSync(wrongDigest), { code: 'ENOENT' });

    const payload = join(work, 'payload');
    mkdirSync(payload);
    command('tar', ['-xzf', rendererArchive, '-C', payload]);
    writeFileSync(join(payload, 'renderer/index.html'), '<html>tampered</html>');
    const altered = join(work, 'altered.tar.gz');
    const entries = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8')).files
      .map((file: { path: string }) => `renderer/${file.path}`);
    command('tar', ['-czf', altered, '-C', payload, ...entries, 'manifest.json']);
    const rejected = join(work, 'altered-stage');
    assert.throws(() => stageRendererArchive(altered, sha256(readFileSync(altered)), rejected), /inventory|digest mismatch/);
    assert.throws(() => lstatSync(rejected), { code: 'ENOENT' });
  } finally { rmSync(work, { recursive: true }); }
});

test('renderer edits retain the root; shared ABI and native source changes reject reuse', () => {
  const work = mkdtempSync(join(tmpdir(), 'renderer-input-closure-'));
  const originalCwd = process.cwd();
  try {
    const baseline = join(work, 'renderer-only');
    clone(root, baseline);
    const rendererReadme = 'capture/desktop/ui/frontend/README.md';
    copyAndAppend(baseline, rendererReadme, '\n<!-- renderer-only proof change -->\n');
    commitChange(baseline, rendererReadme, readFileSync(join(baseline, rendererReadme), 'utf8'));
    process.chdir(baseline);
    assert.equal(admitRoot(rootDirectory, rootReceipt, rootReceiptSha256).sourceSha,
      JSON.parse(readFileSync(rootReceipt, 'utf8')).sourceSha);

    for (const [label, path, suffix] of [
      ['shared ABI', 'shared/model.rs', '\npub struct RendererAssemblySharedProbe;\n'],
      ['Desktop bridge ABI', 'capture/desktop/workflow/electron/mod.rs', '\npub(crate) const RENDERER_ASSEMBLY_PROBE: bool = true;\n'],
      ['native source', 'capture/engine/native/LiveTranscribe.swift', '\n// Renderer assembly native closure probe.\n'],
    ]) {
      const candidate = join(work, label.replaceAll(' ', '-'));
      clone(root, candidate);
      copyAndAppend(candidate, path, suffix);
      commitChange(candidate, path, readFileSync(join(candidate, path), 'utf8'));
      process.chdir(candidate);
      assert.throws(() => admitRoot(rootDirectory, rootReceipt, rootReceiptSha256),
        /Root input closure changed|Root input inventory changed/, `${label} change must refuse reuse`);
    }
  } finally {
    process.chdir(originalCwd);
    rmSync(work, { recursive: true });
  }
});
