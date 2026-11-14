// Seal an installed, never-launched CI app for separate owned native verification.
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants, copyFileSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {basename, isAbsolute, join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

export function sourceSnapshot(root: string, expected: string) {
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  assert.match(expected, /^[0-9a-f]{40}$/, 'Expected an exact checkout commit');
  const commit = git('rev-parse', 'HEAD');
  assert.equal(commit, expected, 'Checkout differs from dispatched source');
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Source tree changed');
  return {commit, tree: git('rev-parse', 'HEAD^{tree}')};
}

export async function fingerprint(path: string) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile(), 'Artifact input must be a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {sha256: hash.digest('hex'), bytes: stat.size};
}

export function requireArm64(host: {platform: string; node: string; machine: string; hardware: string}) {
  assert.deepEqual(host, {platform: 'darwin', node: 'arm64', machine: 'arm64', hardware: '1'},
    'Requires actual ARM64 hardware and an ARM64 Node runtime');
}

export function requireAdHoc(description: string) {
  assert.match(description, /^Signature=adhoc$/m, 'Expected an ad-hoc test candidate');
  assert.doesNotMatch(description, /^Authority=/m, 'Candidate must not use release signing');
}

type Entry = {kind: 'file'; sha256: string; bytes: number; mode: number} | {kind: 'link'; target: string};
export async function inventory(app: string): Promise<Record<string, Entry>> {
  const root = realpathSync(app);
  const entries: Record<string, Entry> = {};
  async function visit(directory: string) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), key = relative(root, path), stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(path), resolved = relative(root, realpathSync(path));
        assert.ok(!isAbsolute(target) && resolved !== '..' && !resolved.startsWith('../'),
          `Packaged link escapes the app: ${key}`);
        entries[key] = {kind: 'link', target};
      } else if (stat.isDirectory()) await visit(path);
      else {
        assert.ok(stat.isFile(), `Unexpected packaged file type: ${key}`);
        entries[key] = {kind: 'file', ...await fingerprint(path), mode: stat.mode & 0o777};
      }
    }
  }
  await visit(root);
  return entries;
}

async function main() {
  const output = (command: string, args: string[]) => execFileSync(command, args, {encoding: 'utf8'}).trim();
  const retainInstalled = process.argv.includes('--retain-installed');
  const host = {platform: process.platform, node: process.arch, machine: output('uname', ['-m']),
    // Intel kernels may omit the optional ARM capability key.
    hardware: output('sysctl', [retainInstalled ? '-in' : '-n', 'hw.optional.arm64']) || '0'};
  if (!retainInstalled) requireArm64(host);
  else assert.deepEqual(host, {platform: 'darwin', node: 'x64', machine: 'x86_64', hardware: '0'},
    'Installed retention requires the actual Intel Mac CI host and x64 Node runtime');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  const root = process.cwd();
  const source = sourceSnapshot(root, process.env.GITHUB_SHA ?? '');
  const temporary = process.env.RUNNER_TEMP;
  assert.ok(temporary);
  if (retainInstalled) {
    assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/);
    assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^\d+$/);
    assert.ok(process.env.HOME && isAbsolute(process.env.HOME));
  }
  const app = retainInstalled
    ? join(process.env.HOME!, 'Applications', `Apparent-Storage-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.app`)
    : join(temporary, 'Apparent Native Candidate.app');
  assert.ok(lstatSync(app).isDirectory(), 'Expected the newly packaged app');
  const architecture = retainInstalled ? 'x64' : 'arm64';
  const executables = ['Contents/MacOS/apparent', 'Contents/MacOS/apparent-helper',
    'Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron',
    'Contents/Resources/settings/runtime/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    'Contents/Resources/settings/app/electron/pill/native/window.node'];
  for (const relative of executables) {
    assert.equal(output('lipo', ['-archs', join(app, relative)]), retainInstalled ? 'x86_64' : 'arm64', relative);
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
  const signature = spawnSync('codesign', ['-d', '--verbose=2', app], {encoding: 'utf8'});
  assert.equal(signature.status, 0, signature.stderr);
  requireAdHoc(signature.stderr);
  const out = join(temporary, 'apparent-native-candidate');
  mkdirSync(out, {mode: 0o700});
  const archive = join(out, `Apparent-Native-Candidate-${architecture}.zip`);
  const files: Record<string, {sha256: string; bytes: number}> = {};
  for (const relative of executables) {
    files[relative] = await fingerprint(join(app, relative));
  }
  // Includes every shipped owner worker/policy byte without importing an owner
  // or requiring a not-yet-adopted package on other candidate branches.
  const contents = await inventory(app);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
  const inspection = join(out, 'archive-inspection');
  mkdirSync(inspection, {mode: 0o700});
  execFileSync('ditto', ['-x', '-k', archive, inspection]);
  const restored = join(inspection, basename(app));
  assert.deepEqual(await inventory(restored), contents, 'Archive contents differ from the packaged app');
  execFileSync('codesign', ['--verify', '--deep', '--strict', restored]);
  rmSync(inspection, {recursive: true});
  assert.deepEqual(sourceSnapshot(root, source.commit), source);
  const manifest = {schema: 1, source, repository: process.env.GITHUB_REPOSITORY,
    run: {id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT},
    architecture, host, signing: 'ad-hoc', nativeAcceptance: 'pending', releaseAdmission: false,
    compiler: execFileSync('rustc', ['-Vv'], {encoding: 'utf8'}).trim(),
    app: basename(app), artifact: {name: basename(archive), ...await fingerprint(archive)}, files, contents};
  writeFileSync(join(out, 'candidate.json'), JSON.stringify(manifest, null, 2) + '\n', {mode: 0o600});
}

export async function installRetainedArchive(options: {archive: string; manifestPath: string; expectedSource: string;
  expectedArchiveSha256: string; destination: string; temporary: string}) {
  assert.equal(process.platform, 'darwin', 'Retained app installation requires macOS');
  requireFreshDestination(options.destination);
  const temporary = realpathSync(options.temporary), stat = lstatSync(temporary);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid!() && (stat.mode & 0o077) === 0,
    'Installation requires an owned private temporary directory');
  const inspection = mkdtempSync(join(temporary, 'retained-native-inspection-'));
  try {
    const {manifest, archive} = await stageRetainedArchive(options, inspection);
    execFileSync('ditto', ['-x', '-k', archive, inspection]);
    const app = join(inspection, manifest.app);
    assert.deepEqual(await inventory(app), manifest.contents, 'Extracted app inventory differs from manifest');
    execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
    const signature = spawnSync('codesign', ['-d', '--verbose=2', app], {encoding: 'utf8'});
    assert.equal(signature.status, 0, signature.stderr);
    requireAdHoc(signature.stderr);
    mkdirSync(resolve(options.destination, '..'), {recursive: true});
    // Reserve exclusively: ditto must never merge into another installation.
    mkdirSync(options.destination, {mode: 0o700});
    execFileSync('ditto', [app, options.destination]);
    assert.deepEqual(await inventory(options.destination), manifest.contents, 'Installed app inventory differs');
    execFileSync('codesign', ['--verify', '--deep', '--strict', options.destination]);
  } finally { rmSync(inspection, {recursive: true, force: true}); }
}

export async function stageRetainedArchive(options: {archive: string; manifestPath: string;
  expectedSource: string; expectedArchiveSha256: string}, directory: string) {
  assert.equal(lstatSync(options.archive, {throwIfNoEntry: false})?.isFile(), true, 'Archive must be a regular file');
  const archive = join(directory, basename(options.archive));
  copyFileSync(options.archive, archive, constants.COPYFILE_EXCL);
  // Hash and extract one private copy, even if the downloaded path is replaced.
  const manifest = await inspectRetainedArchive({...options, archive});
  return {manifest, archive};
}

export async function inspectRetainedArchive(options: {archive: string; manifestPath: string;
  expectedSource: string; expectedArchiveSha256: string}) {
  assert.equal(lstatSync(options.archive, {throwIfNoEntry: false})?.isFile(), true, 'Archive must be a regular file');
  assert.equal(lstatSync(options.manifestPath, {throwIfNoEntry: false})?.isFile(), true, 'Manifest must be a regular file');
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  validateRetainedManifest(manifest, options.archive, options.expectedSource, options.expectedArchiveSha256);
  const actual = await fingerprint(options.archive);
  assert.equal(actual.sha256, options.expectedArchiveSha256, 'Archive bytes differ from inspected digest');
  assert.equal(actual.bytes, manifest.artifact.bytes, 'Archive size differs from manifest');
  return manifest;
}

export function validateRetainedManifest(manifest: any, archive: string, expectedSource: string, expectedArchiveSha256: string) {
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.source?.commit, expectedSource, 'Unexpected retained source commit');
  assert.match(expectedSource, /^[0-9a-f]{40}$/);
  assert.match(manifest.source?.tree ?? '', /^[0-9a-f]{40}$/);
  assert.equal(manifest.architecture, 'x64', 'Retained artifact architecture must be truthful');
  assert.equal(manifest.host?.platform, 'darwin');
  assert.equal(manifest.host?.node, 'x64');
  assert.equal(manifest.host?.machine, 'x86_64');
  assert.equal(manifest.host?.hardware, '0');
  assert.equal(manifest.signing, 'ad-hoc');
  assert.equal(manifest.nativeAcceptance, 'pending');
  assert.equal(manifest.releaseAdmission, false);
  assert.equal(manifest.artifact?.name, basename(archive));
  assert.match(expectedArchiveSha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.artifact?.sha256, expectedArchiveSha256, 'Expected archive digest mismatch');
  assert.match(manifest.run?.id ?? '', /^\d+$/);
  assert.match(manifest.run?.attempt ?? '', /^\d+$/);
  assert.ok(manifest.app === basename(manifest.app) && manifest.app.endsWith('.app'), 'Invalid archived app path');
  assert.ok(manifest.contents && typeof manifest.contents === 'object');
}

export function requireFreshDestination(destination: string) {
  assert.ok(isAbsolute(destination) && basename(destination).endsWith('.app'), 'Expected an absolute .app destination');
  assert.equal(lstatSync(destination, {throwIfNoEntry: false}), undefined, 'Destination already exists');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2] === 'install-retained') {
  assert.equal(process.env.APPARENT_NO_LAUNCH, '1', 'Retained install requires APPARENT_NO_LAUNCH=1');
  await installRetainedArchive({archive: process.env.APPARENT_RETAINED_ARCHIVE ?? '',
    manifestPath: process.env.APPARENT_RETAINED_MANIFEST ?? '', expectedSource: process.env.APPARENT_EXPECTED_SOURCE ?? '',
    expectedArchiveSha256: process.env.APPARENT_EXPECTED_ARCHIVE_SHA256 ?? '',
    destination: process.env.APPARENT_APP_DIR ?? '', temporary: process.env.RUNNER_TEMP ?? ''});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2] !== 'install-retained') await main();
