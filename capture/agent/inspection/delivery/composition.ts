/** Versioned, conservative root reuse and single-app inspection composition. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, stage } from './package.ts';
import { stageRendererArchive } from './renderer/assembly.ts';
import { publishValidatedDirectory } from '../../../../shared/packaging/transaction.ts';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const compatibility = 'inspection-host-v1';
const buildEnvironment = () => Object.fromEntries(['APPARENT_PREVIEW_BUILD', 'APPARENT_HELPER_BUNDLE_ID', 'APPARENT_POSTHOG_TOKEN', 'MACOSX_DEPLOYMENT_TARGET', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS'].map(key => [key, process.env[key] ? hash(process.env[key]!) : null]));
const policy = () => hash(readFileSync(fileURLToPath(import.meta.url)));
const runtime = (name: string) => /^lib(?:transcribe|ggml)[A-Za-z0-9_.-]*\.so(?:\.[0-9.]+)?$/.test(name);
// Electron's packaged resources are built/staged independently; Rust bridge/native
// code remains in the root closure and the compiler dep-info guard below verifies it.
const independentlyPackagedRenderer = (path: string) => path.startsWith('capture/desktop/ui/frontend/');
const independent = (path: string) => path === 'capture/agent/inspection/main.rs' || path === 'capture/agent/inspection/Cargo.lock' ||
  path === 'capture/agent/inspection/README.md' || path.startsWith('capture/agent/inspection/tests/') ||
  path.startsWith('capture/agent/inspection/delivery/') || independentlyPackagedRenderer(path);
function command(cmd: string, args: string[], cwd = process.cwd()) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(r.status, 0, `${cmd}: ${r.stderr}`); return r.stdout.trim();
}
const repository = () => command('git', ['rev-parse', '--show-toplevel']);
export function inputs(root = repository()) {
  assert.equal(command('git', ['status', '--porcelain', '--untracked-files=normal'], root), '', 'Clean committed source required');
  const files = command('git', ['ls-files', '-z'], root).split('\0').filter(Boolean);
  return files.filter(p => !independent(p)).map(path => {
    const stat = lstatSync(join(root, path)); assert(stat.isFile() && !stat.isSymbolicLink(), `Nonregular root input: ${path}`);
    return { path, executable: Boolean(stat.mode & 0o111), sha256: hash(readFileSync(join(root, path))) };
  });
}
export function sealRoot(binaryDirectory: string, profile: string, output: string) {
  assert(['debug', 'release'].includes(profile));
  assert(['linux', 'darwin'].includes(process.platform));
  for (const key of ['CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET', 'RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) assert(!process.env[key], `Unsupported root build override: ${key}`);
  const root = repository();
  const closure = inputs(root);
  assert.equal(resolve(binaryDirectory), join(root, 'target', profile), 'Seal only this clean source build');
  const buildStarted = Date.now();
  command('cargo', ['build', '--locked', '--offline', '-j', process.env.T3_BUILD_JOBS ?? '3', ...(profile === 'release' ? ['--release'] : [])], root);
  const rootBuildElapsedMs = Date.now() - buildStarted;
  assert.deepEqual(inputs(root), closure, 'Source changed during root production');
  // Compiler dep-info, not the aggregate .d containing Git-identity invalidation watches.
  const deps = join(root, 'target', profile, 'deps');
  const info = readdirSync(deps).filter(n => /^(apparent-|apparent_inspect-).*\.d$/.test(n));
  assert(info.length > 0, 'Root and library compiler dependency evidence required');
  const compiler = info.map(name => readFileSync(join(deps, name), 'utf8').replaceAll('\\ ', ' ')).join('\n');
  for (const path of command('git', ['ls-files', '-z'], root).split('\0').filter(independent)) {
    assert(!compiler.includes(path), `Excluded input is compiled into root: ${path}`);
  }
  const files = ['apparent', ...(process.platform === 'darwin' ? ['apparent-helper'] : []), ...readdirSync(binaryDirectory).filter(runtime).sort()].map(name => {
    const stat = lstatSync(join(binaryDirectory, name)); assert(stat.isFile() && !stat.isSymbolicLink());
    const bytes = readFileSync(join(binaryDirectory, name)); return { name, sha256: hash(bytes), size: bytes.length };
  });
  const manifest = { schema: 1, kind: 'inspection-root', compatibility, sourceSha: command('git', ['rev-parse', 'HEAD'], root),
    sourceTree: command('git', ['rev-parse', 'HEAD^{tree}'], root), inputPolicySha256: policy(), inputs: closure, inputsSha256: hash(JSON.stringify(closure)),
    target: `${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-${process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu'}`,
    profile, rootBuildElapsedMs, buildEnvironment: buildEnvironment(), rustc: command('rustc', ['-vV']), cargo: command('cargo', ['-V']), files,
    buildIdentity: 'Root label retains root source revision; composition records independent component revision.' };
  writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}
export function admitRoot(binaryDirectory: string, manifestPath: string, expectedDigest: string) {
  const bytes = readFileSync(manifestPath); assert.equal(hash(bytes), expectedDigest, 'Root receipt digest mismatch');
  const m = JSON.parse(bytes.toString());
  assert(m.schema === 1 && m.kind === 'inspection-root' && m.compatibility === compatibility && m.inputPolicySha256 === policy(), 'Incompatible root receipt');
  assert(/^[a-f0-9]{40}$/.test(m.sourceSha) && /^[a-f0-9]{40}$/.test(m.sourceTree));
  assert.equal(command('git', ['rev-parse', `${m.sourceSha}^{tree}`]), m.sourceTree, 'Root source tree mismatch');
  assert.deepEqual(m.buildEnvironment, buildEnvironment(), 'Root build variant/environment changed');
  command('git', ['merge-base', '--is-ancestor', m.sourceSha, 'HEAD']);
  const closure = inputs();
  assert.equal(hash(JSON.stringify(closure)), m.inputsSha256, 'Root input closure changed: rebuild root');
  assert.deepEqual(closure, m.inputs, 'Root input inventory changed');
  assert(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= 100);
  assert(m.files.every((f: any) => ['apparent', 'apparent-helper'].includes(f.name) || runtime(f.name)), 'Unsafe root inventory');
  assert.deepEqual(m.files.filter((f: any) => !runtime(f.name)).map((f: any) => f.name), process.platform === 'darwin' ? ['apparent', 'apparent-helper'] : ['apparent']);
  const payload = new Map<string, Buffer>();
  for (const f of m.files) {
    const stat = lstatSync(join(binaryDirectory, f.name)); assert(stat.isFile() && !stat.isSymbolicLink(), 'Unsafe root artifact file');
    const bytes = readFileSync(join(binaryDirectory, f.name)); assert.equal(hash(bytes), f.sha256, 'Root executable changed'); payload.set(f.name, bytes);
  }
  Object.defineProperty(m, 'payload', { value: payload });
  return m;
}
/** Fresh executable directory. Surrounding app resources/signing remain their existing owners. */
export function assemble(rootDirectory: string, rootReceipt: string, rootDigest: string,
  inspectorArchive: string, inspectorDigest: string, destination: string) {
  const root = admitRoot(rootDirectory, rootReceipt, rootDigest);
  const dest = resolve(destination); mkdirSync(dest, { mode: 0o755 });
  for (const f of root.files) { writeFileSync(join(dest, f.name), root.payload.get(f.name), { flag: 'wx' }); chmodSync(join(dest, f.name), 0o755); }
  const inspector = stage(inspectorArchive, inspectorDigest, root.target, join(dest, 'inspection'));
  const receipt = { schema: 1, compatibility, compositionSource: command('git', ['rev-parse', 'HEAD']),
    root, rootReceiptSha256: rootDigest, inspector, inspectorArchiveSha256: inspectorDigest,
    inspectorRuntimeSha256: inspector.sha256, rootRebuilt: false };
  writeFileSync(join(dest, 'inspection-composition.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
function initialRootIdentity(binaryDirectory: string) {
  const retained = join(binaryDirectory, 'root-receipt.json');
  if (existsSync(retained)) return admitRoot(binaryDirectory, retained, hash(readFileSync(retained)));
  // Preserve the already authenticated exact-source Mac development-input route.
  const legacy = join(binaryDirectory, 'manifest.json');
  if (process.env.APPARENT_PREBUILT_DIR && existsSync(legacy)) {
    const manifest = JSON.parse(readFileSync(legacy, 'utf8'));
    assert(manifest.kind === 'mac-dev-executables' && manifest.source.sha === command('git', ['rev-parse', 'HEAD']) &&
      manifest.source.tree === command('git', ['rev-parse', 'HEAD^{tree}']), 'Exact-source Mac inputs required');
    for (const file of manifest.files) {
      assert(['apparent', 'apparent-helper'].includes(file.name));
      assert.equal(hash(readFileSync(join(binaryDirectory, file.name))), file.sha256);
    }
    return { kind: 'legacy-exact-source-root', compatibility, sourceSha: manifest.source.sha,
      sourceTree: manifest.source.tree, originalReceiptSha256: hash(readFileSync(legacy)), files: manifest.files };
  }
  const directory = resolve(binaryDirectory);
  const profile = basename(directory);
  assert(['debug', 'release'].includes(profile), 'A sealed root artifact or normal source build is required');
  const receipt = join(repository(), 'target', `initial-root-${Date.now()}.json`);
  return sealRoot(directory, profile, receipt);
}
/** Called by ordinary app packaging after root build; no separate manual installation. */
export function packageApplication(binaryDirectory: string, destination: string, signing: string[]) {
  const root = repository();
  const rendererArchive = process.env.APPARENT_DESKTOP_RENDERER_ARCHIVE;
  const rendererDigest = process.env.APPARENT_DESKTOP_RENDERER_SHA256;
  const rendererSource = process.env.APPARENT_DESKTOP_RENDERER_SOURCE_SHA;
  assert.equal(Boolean(rendererArchive), Boolean(rendererDigest) && Boolean(rendererSource),
    'Renderer assembly requires the producer archive, digest and source revision');
  const consumers = rendererArchive ? rendererConsumerRoots(destination) : [];
  const temporary = mkdtempSync(join(destination, '.inspection-package-'));
  const candidate = join(temporary, 'inspection');
  const final = join(destination, 'inspection');
  try {
    let renderer: any;
    let rendererStage: string | undefined;
    if (rendererArchive && rendererDigest && rendererSource) {
      rendererStage = join(temporary, 'renderer-artifact');
      renderer = stageRendererArchive(rendererArchive, rendererDigest, rendererStage);
      assert.equal(renderer.sourceGitHead, rendererSource, 'Renderer producer source revision changed');
      renderer = { ...renderer, consumers: consumers.map(item => item.label) };
    }
    let receipt: any;
    if (process.env.APPARENT_INSPECTION_REUSE) {
      receipt = JSON.parse(readFileSync(join(binaryDirectory, 'inspection-composition.json'), 'utf8'));
      const bytes = readFileSync(join(binaryDirectory, 'inspection/apparent-inspect'));
      assert.equal(hash(bytes), receipt.inspectorRuntimeSha256, 'Reused inspector changed');
      mkdirSync(candidate, { mode: 0o755 });
      writeFileSync(join(candidate, 'apparent-inspect'), bytes, { mode: 0o755, flag: 'wx' });
      writeFileSync(join(candidate, 'manifest.json'), JSON.stringify(receipt.inspector) + '\n');
    } else {
      const component = process.env.APPARENT_INSPECTION_ARCHIVE;
      let archive = component, expected = process.env.APPARENT_INSPECTION_ARCHIVE_SHA256;
      if (!archive) {
        assert(!expected, 'Incomplete inspector input');
        command('cargo', ['package', '--locked', '--offline', '--manifest-path', join(root, 'capture/agent/inspection/Cargo.toml')]);
        const source = join(root, 'capture/agent/inspection/target/package/apparent-inspect-0.1.0.crate');
        const built = build(source, hash(readFileSync(source)), join(root, 'target', `inspection-${Date.now()}`));
        archive = built.artifact; expected = built.archiveSha256;
      }
      assert(archive && expected, 'Complete inspector input required');
      const target = `${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-${process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu'}`;
      if (component) {
        const source = process.env.APPARENT_INSPECTION_SOURCE_SHA;
        assert(source && /^[a-f0-9]{40}$/.test(source), 'Expected inspector source required');
        assert.equal(hash(readFileSync(archive)), expected);
        provenance(archive, source, process.env.APPARENT_INSPECTION_SIGNER_WORKFLOW, expected);
      }
      const inspector = stage(archive, expected, target, candidate);
      if (component) assert.equal(inspector.sourceSha, process.env.APPARENT_INSPECTION_SOURCE_SHA);
      const rootIdentity = initialRootIdentity(binaryDirectory);
      for (const f of rootIdentity.files) { if (['apparent', 'apparent-helper'].includes(f.name)) assert.equal(hash(readFileSync(join(destination, f.name))), f.sha256, 'Copied root differs from its source receipt'); }
      receipt = { schema: 1, compatibility, compositionSource: command('git', ['rev-parse', 'HEAD']),
        root: rootIdentity, inspector, inspectorArchiveSha256: expected };
    }
    if (renderer) receipt.renderer = renderer;
    if (signing.length) command(signing[0], [...signing.slice(1), join(candidate, 'apparent-inspect')]);
    receipt.inspectorRuntimeSha256 = hash(readFileSync(join(candidate, 'apparent-inspect')));
    const nextReceipt = join(temporary, 'inspection-composition.json');
    writeFileSync(nextReceipt, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    publishValidatedDirectory(candidate, final, undefined, () => {
      renameSync(nextReceipt, join(destination, 'inspection-composition.json'));
    });
    if (renderer && rendererStage && rendererArchive && rendererDigest) {
      installRendererConsumers(rendererStage, rendererArchive, rendererDigest, rendererSource!, consumers, temporary);
    }
  } finally { rmSync(temporary, { recursive: true }); }
}

/** Existing installed Electron consumers; the packaged host files load their sibling `dist/`. */
export function rendererConsumerRoots(destination: string, platform = process.platform) {
  const executableDirectory = resolve(destination);
  const parent = basename(dirname(executableDirectory));
  const leaf = basename(executableDirectory);
  if (platform === 'darwin') {
    assert(leaf === 'MacOS' && parent === 'Contents', 'Unsupported packaged macOS renderer destination');
    const resources = join(dirname(executableDirectory), 'Resources');
    return [
      { label: 'settings/app', app: join(resources, 'settings/app') },
      { label: 'note-ui', app: join(resources, 'note-ui') },
    ];
  }
  if (platform === 'linux') {
    assert(leaf === 'bin' && parent === 'usr', 'Unsupported packaged Linux renderer destination');
    const usr = dirname(executableDirectory);
    return [
      { label: 'settings/app', app: join(usr, 'share/apparent/settings/app') },
      { label: 'note-ui', app: join(usr, 'lib/apparent/note-ui') },
    ];
  }
  throw new Error(`Unsupported renderer package platform: ${platform}`);
}

function validateOwnedDirectory(path: string, requiredFiles: string[] = []) {
  const root = lstatSync(path);
  assert(root.isDirectory() && !root.isSymbolicLink(), 'Unsafe packaged Electron resource directory');
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      const stat = lstatSync(child);
      assert(!stat.isSymbolicLink(), 'Symlink in packaged Electron resources');
      if (stat.isDirectory()) visit(child);
      else assert(stat.isFile(), 'Nonregular packaged Electron resource');
    }
  };
  visit(path);
  for (const file of requiredFiles) {
    const stat = lstatSync(join(path, ...file.split('/')));
    assert(stat.isFile() && !stat.isSymbolicLink(), `Existing Electron resource is missing ${file}`);
  }
}

function copyPackageFiles(source: string, destination: string, files: string[]) {
  mkdirSync(destination, { mode: 0o700 });
  for (const file of files) {
    const from = join(source, ...file.split('/'));
    const stat = lstatSync(from);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Invalid renderer package source: ${file}`);
    const to = join(destination, ...file.split('/'));
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    copyFileSync(from, to);
    chmodSync(to, 0o644);
  }
  const normalize = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) { normalize(child); chmodSync(child, 0o755); }
      else chmodSync(child, 0o644);
    }
  };
  normalize(destination);
  chmodSync(destination, 0o755);
}

function installRendererConsumers(stage: string, archive: string, archiveDigest: string, sourceSha: string | undefined,
  consumers: ReturnType<typeof rendererConsumerRoots>, temporary: string) {
  const manifest = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8'));
  assert.equal(manifest.source.gitHead, sourceSha, 'Renderer stage source identity changed');
  const rendererFiles = manifest.files.map((file: { path: string }) => file.path);
  const hostFiles = manifest.hostFiles.map((file: { path: string }) => file.path);
  const popupHostFiles = hostFiles.filter((path: string) => path === 'runtime.cjs' || path.startsWith('notes/') ||
    path === 'share/main.cjs' || path === 'share/preload.cjs');
  for (const required of ['runtime.cjs', 'notes/main.cjs', 'notes/preload.cjs', 'notes/protocol.cjs']) {
    assert(popupHostFiles.includes(required), `Source-bound Electron host is missing ${required}`);
  }
  const record = { schema: 1, sourceGitHead: sourceSha, archiveSha256: archiveDigest,
    inputInventorySha256: manifest.source.inputInventory.sha256, rendererFiles: rendererFiles.length,
    hostFiles: hostFiles.length, consumers: consumers.map(item => item.label) };
  for (const [index, consumer] of consumers.entries()) {
    const dist = join(consumer.app, 'dist');
    const electron = join(consumer.app, 'electron');
    const previousEntries = consumer.label === 'settings/app'
      ? ['settings.html', 'onboarding.html', 'pill/index.html']
      : ['index.html'];
    validateOwnedDirectory(dist, previousEntries);
    validateOwnedDirectory(electron, consumer.label === 'settings/app'
      ? ['main.cjs', 'preload.cjs', 'settings.cjs', 'pill/main.cjs', 'pill/preload.cjs']
      : ['notes/main.cjs', 'notes/preload.cjs']);
    const nextDist = join(temporary, `renderer-dist-${index}`);
    copyPackageFiles(join(stage, 'renderer'), nextDist, rendererFiles);
    validateOwnedDirectory(nextDist, manifest.entries);
    publishValidatedDirectory(nextDist, dist, path => validateOwnedDirectory(path, previousEntries));
    const nextElectron = join(temporary, `renderer-electron-${index}`);
    const files = consumer.label === 'settings/app' ? hostFiles : popupHostFiles;
    copyPackageFiles(join(stage, 'electron'), nextElectron, files);
    const requiredHost = consumer.label === 'settings/app'
      ? ['main.cjs', 'preload.cjs', 'settings.cjs', 'pill/main.cjs', 'pill/preload.cjs']
      : ['notes/main.cjs', 'notes/preload.cjs'];
    validateOwnedDirectory(nextElectron, requiredHost);
    publishValidatedDirectory(nextElectron, electron, path => validateOwnedDirectory(path, requiredHost));
    const marker = join(consumer.app, 'apparent-renderer-manifest.json');
    writeFileSync(marker, JSON.stringify(record, null, 2) + '\n', { mode: 0o644, flag: 'wx' });
  }
}
const signerWorkflows = ['verification-platform.yml', 'release-linux.yml', 'release-mac-preview.yml'].map(name => `tryapparent/apparent/.github/workflows/${name}`);
function provenance(file: string, source: string, signer = signerWorkflows[0], expectedDigest: string) {
  assert(/^[a-f0-9]{40}$/.test(source) && signerWorkflows.includes(signer), 'Unsupported component producer');
  const bytes = readFileSync(file);
  assert.equal(hash(bytes), expectedDigest, 'Provenance subject changed');
  const directory = mkdtempSync(join(tmpdir(), 'inspection-provenance-'));
  try {
    const subject = join(directory, 'subject');
    writeFileSync(subject, bytes, { mode: 0o400, flag: 'wx' });
    command('gh', ['attestation', 'verify', subject, '--repo', 'tryapparent/apparent',
      '--signer-workflow', signer, '--source-ref', 'refs/heads/main', '--source-digest', source]);
  } finally { rmSync(directory, { recursive: true }); }
}
/** Production reuse authenticates each exact component; local assemble is proof only. */
export function reuse(inputPath: string, destination: string) {
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  assert(input.schema === 1, 'Invalid composition inputs');
  const root = admitRoot(input.rootDirectory, input.rootReceipt, input.rootReceiptSha256);
  assert(['debug', 'release'].includes(input.rootProfile) && root.profile === input.rootProfile, 'Root profile mismatch');
  if (process.env.APPARENT_INSPECTION_REQUIRED_PROFILE) assert.equal(root.profile, process.env.APPARENT_INSPECTION_REQUIRED_PROFILE);
  provenance(input.rootReceipt, root.sourceSha, input.rootSignerWorkflow, input.rootReceiptSha256);
  assert.equal(hash(readFileSync(input.inspectorArchive)), input.inspectorArchiveSha256);
  provenance(input.inspectorArchive, input.inspectorSourceSha, input.inspectorSignerWorkflow, input.inspectorArchiveSha256);
  command('git', ['merge-base', '--is-ancestor', input.inspectorSourceSha, 'origin/main']);
  const result = assemble(input.rootDirectory, input.rootReceipt, input.rootReceiptSha256,
    input.inspectorArchive, input.inspectorArchiveSha256, destination);
  assert.equal(result.inspector.sourceSha, input.inspectorSourceSha, 'Inspector producer source mismatch');
  return result;
}
export function rootBundle(binaryDirectory: string, profile: string, destination: string) {
  mkdirSync(destination, { mode: 0o700 });
  const manifest = sealRoot(binaryDirectory, profile, join(destination, 'root-receipt.json'));
  for (const file of manifest.files) {
    const bytes = readFileSync(join(binaryDirectory, file.name));
    assert.equal(hash(bytes), file.sha256, 'Root artifact changed during retention');
    writeFileSync(join(destination, file.name), bytes, { mode: 0o755, flag: 'wx' });
  }
}
export function retainRelease(binaryDirectory: string, applicationDirectory: string, destination: string) {
  assert(!process.env.APPARENT_INSPECTION_REUSE, 'Reused components retain their original producer identity');
  const head = command('git', ['rev-parse', 'HEAD']);
  assert(process.env.GITHUB_SHA === head && process.env.GITHUB_REF === 'refs/heads/main', 'Exact main producer context required');
  mkdirSync(destination, { mode: 0o700 });
  rootBundle(binaryDirectory, 'release', join(destination, 'root'));
  const receipt = JSON.parse(readFileSync(join(applicationDirectory, 'inspection-composition.json'), 'utf8'));
  assert.equal(receipt.inspector.sourceSha, head, 'Do not reattribute an older inspector to this producer');
  const candidates = readdirSync('target').filter(n => /^inspection-[0-9]+$/.test(n)).flatMap(n =>
    readdirSync(join('target', n)).filter(f => f.endsWith('.tar.gz')).map(f => join('target', n, f)))
    .filter(p => hash(readFileSync(p)) === receipt.inspectorArchiveSha256);
  assert(candidates.length > 0, 'Current inspector archive unavailable');
  writeFileSync(join(destination, 'inspector.tar.gz'), readFileSync(candidates[0]), { flag: 'wx' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...args] = process.argv.slice(2);
  if (op === 'retain-release' && args.length === 3) retainRelease(args[0], args[1], args[2]);
  else if (op === 'root-bundle' && args.length === 3) rootBundle(args[0], args[1], args[2]);
  else if (op === 'reuse' && args.length === 2) console.log(JSON.stringify(reuse(args[0], args[1])));
  else if (op === 'seal-root' && args.length === 3) console.log(JSON.stringify(sealRoot(args[0], args[1], args[2])));
  else if (op === 'assemble' && args.length === 6) console.log(JSON.stringify(assemble(...args as [string,string,string,string,string,string])));
  else if (op === 'package' && args.length >= 2) packageApplication(args[0], args[1], args.slice(2));
  else throw new Error('Usage: composition.ts seal-root BIN_DIR debug|release RECEIPT | assemble ROOT_DIR RECEIPT ROOT_DIGEST INSPECTOR_ARCHIVE DIGEST NEW_DIR | package ROOT_DIR DEST [SIGN_COMMAND...]');
}
