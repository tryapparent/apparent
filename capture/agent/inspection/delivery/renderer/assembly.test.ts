/** Real renderer/root consumer proof. Set inputs from retained build artifacts. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    mkdirSync(join(work, 'AppDir/usr/share/apparent'), { recursive: true, mode: 0o755 });
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
    const oldRenderer = process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE;
    const oldRendererSha = process.env.APPARENT_DESKTOP_RENDERER_SHA256;
    const oldRendererSource = process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA;
    process.env.APPARENT_INSPECTION_REUSE = 'proof';
    process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE = rendererArchive;
    process.env.APPARENT_DESKTOP_RENDERER_SHA256 = rendererSha256;
    process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA = JSON.parse(
      command('tar', ['-xOzf', rendererArchive, 'manifest.json'])).source.gitHead;
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
    const resourceDirectory = join(work, 'AppDir/usr/share/apparent/desktop-ui');
    const packagedHelp = command(join(binary, 'apparent'), ['--help'], work);
    assert.match(packagedHelp, /Usage: apparent/);
    const result = { fileCount: JSON.parse(readFileSync(join(resourceDirectory, 'manifest.json'), 'utf8')).files.length,
      archiveSha256: rendererSha256 };
    assert.equal(result.fileCount, 20);
    assert.equal(result.archiveSha256, rendererSha256);
    const manifest = JSON.parse(readFileSync(join(resourceDirectory, 'manifest.json'), 'utf8'));
    assert.equal(lstatSync(join(resourceDirectory, 'manifest.json')).mode & 0o777, 0o644);
    const installedReceipt = JSON.parse(readFileSync(join(binary, 'inspection-composition.json'), 'utf8'));
    assert.equal(installedReceipt.root.sourceSha, receipt.sourceSha);
    assert.equal(installedReceipt.root.files[0].sha256, originalRoot.get('apparent'));
    for (const file of manifest.files) {
      const path = join(resourceDirectory, 'renderer', ...file.path.split('/'));
      assert.equal(sha256(readFileSync(path)), file.sha256);
      assert.equal(lstatSync(path).mode & 0o777, 0o644);
    }
    for (const entry of manifest.entries) assert(lstatSync(join(resourceDirectory, 'renderer', entry)).isFile());
    const directories = [resourceDirectory, join(resourceDirectory, 'renderer')];
    for (const file of manifest.files) {
      const parts = file.path.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) directories.push(join(resourceDirectory, 'renderer', ...parts.slice(0, i)));
    }
    for (const directory of new Set(directories)) assert.equal(lstatSync(directory).mode & 0o777, 0o755);
    for (const [name, expected] of originalRoot) assert.equal(sha256(readFileSync(join(rootDirectory, name))), expected);
    for (const [name, expected] of originalRoot) assert.equal(sha256(readFileSync(join(binary, name))), expected);
    assert.equal(admitRoot(rootDirectory, rootReceipt, rootReceiptSha256).sourceSha, receipt.sourceSha);
    console.log(JSON.stringify({ rootSourceSha: receipt.sourceSha, rootFiles: originalRoot.size,
      rootUnchanged: true, cargoAvailable: false, rendererSourceGitHead: manifest.source.gitHead,
      rendererArchiveSha256: rendererSha256, installedResources: manifest.files.length,
      rendererDirectoriesWorldTraversable: true, packagedAppExecutesOutsideCheckout: true,
      proofKind: 'non-GUI AppDir assembly and native execution' }));
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
