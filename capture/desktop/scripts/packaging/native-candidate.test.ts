import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fingerprint, inspectRetainedArchive, inventory, requireAdHoc, requireArm64, requireFreshDestination, sourceSnapshot, stageRetainedArchive, validateRetainedManifest} from './native-candidate.ts';

async function fixture(action: (root: string) => Promise<void> | void) {
  const root = mkdtempSync('/tmp/apparent-dev-native-candidate-');
  try { await action(root); } finally { rmSync(root, {recursive: true, force: true}); }
}

test('source qualification rejects another commit and tracked or untracked edits', () => fixture(root => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8'}).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'source'), 'committed');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  assert.deepEqual(sourceSnapshot(root, commit), {commit, tree: git('rev-parse', 'HEAD^{tree}')});
  assert.throws(() => sourceSnapshot(root, 'main'), /exact checkout commit/);
  assert.throws(() => sourceSnapshot(root, '0'.repeat(40)), /dispatched source/);
  writeFileSync(join(root, 'unexpected'), 'not committed');
  assert.throws(() => sourceSnapshot(root, commit), /Source tree changed/);
  rmSync(join(root, 'unexpected'));
  writeFileSync(join(root, 'source'), 'dirty');
  assert.throws(() => sourceSnapshot(root, commit), /Source tree changed/);
}));

test('artifact hashes bind actual bytes and refuse symlink inputs', () => fixture(async root => {
  const path = join(root, 'worker.js'), bytes = Buffer.from('generated worker bytes\0\xff');
  writeFileSync(path, bytes);
  assert.deepEqual(await fingerprint(path), {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  symlinkSync('worker.js', join(root, 'link'));
  await assert.rejects(fingerprint(join(root, 'link')), /regular file/);
  await assert.rejects(fingerprint(root), /regular file/);
}));

test('archive inventory binds every file, executable modes and internal framework links', () => fixture(async root => {
  mkdirSync(join(root, 'Versions/A'), {recursive: true});
  writeFileSync(join(root, 'Versions/A/runtime'), 'native', {mode: 0o755});
  symlinkSync('A', join(root, 'Versions/Current'));
  symlinkSync('Versions/Current/runtime', join(root, 'runtime'));
  writeFileSync(join(root, 'worker.js'), 'worker');
  const before = await inventory(root);
  assert.equal(Object.keys(before).length, 4);
  assert.deepEqual(before.runtime, {kind: 'link', target: 'Versions/Current/runtime'});
  assert.equal(before['Versions/A/runtime'].kind === 'file' && before['Versions/A/runtime'].mode, 0o755);
  writeFileSync(join(root, 'worker.js'), 'different worker');
  assert.notDeepEqual(await inventory(root), before);
}));

test('archive inventory refuses links outside the app and dangling links', () => fixture(async root => {
  const app = join(root, 'app'); mkdirSync(app);
  writeFileSync(join(root, 'private-config'), 'must not ship');
  symlinkSync('../private-config', join(app, 'escape'));
  await assert.rejects(inventory(app), /escapes the app/);
  rmSync(join(app, 'escape'));
  symlinkSync(join(root, 'private-config'), join(app, 'absolute'));
  await assert.rejects(inventory(app), /escapes the app/);
  rmSync(join(app, 'absolute'));
  symlinkSync('missing', join(app, 'dangling'));
  await assert.rejects(inventory(app), /ENOENT/);
}));

test('runner labels cannot substitute for hardware and process architecture', () => {
  const host = {platform: 'darwin', node: 'arm64', machine: 'arm64', hardware: '1'};
  requireArm64(host);
  for (const patch of [{platform: 'linux'}, {node: 'x64'}, {machine: 'x86_64'}, {hardware: '0'}]) {
    assert.throws(() => requireArm64({...host, ...patch}), /actual ARM64 hardware/);
  }
});

test('ad-hoc qualification uses actual codesign identity', () => {
  requireAdHoc('Executable=/candidate\nSignature=adhoc\nTeamIdentifier=not set\n');
  assert.throws(() => requireAdHoc('Authority=Developer ID Application\n'), /ad-hoc test candidate/);
  assert.throws(() => requireAdHoc('Signature=adhoc\nAuthority=unexpected\n'), /release signing/);
});

test('retained Intel candidate binds exact source, archive digest, and pending-only status', () => {
  const manifest = {schema: 1, source: {commit: 'a'.repeat(40), tree: 'b'.repeat(40)}, run: {id: '123', attempt: '1'},
    app: 'Apparent.app', architecture: 'x64',
    host: {platform: 'darwin', node: 'x64', machine: 'x86_64', hardware: '0'}, signing: 'ad-hoc',
    nativeAcceptance: 'pending', releaseAdmission: false, artifact: {name: 'candidate.zip', sha256: 'c'.repeat(64)},
    contents: {'Contents/MacOS/apparent': {kind: 'file', sha256: 'd'.repeat(64), bytes: 1, mode: 0o755}}};
  validateRetainedManifest(manifest, '/tmp/candidate.zip', 'a'.repeat(40), 'c'.repeat(64));
  for (const patch of [{architecture: 'arm64'}, {nativeAcceptance: 'passed'}, {releaseAdmission: true},
    {signing: 'Developer ID'}, {source: {commit: 'e'.repeat(40)}}, {artifact: {name: 'candidate.zip', sha256: 'f'.repeat(64)}}]) {
    assert.throws(() => validateRetainedManifest({...manifest, ...patch}, '/tmp/candidate.zip', 'a'.repeat(40), 'c'.repeat(64)));
  }
  assert.throws(() => validateRetainedManifest(manifest, '/tmp/other.zip', 'a'.repeat(40), 'c'.repeat(64)));
  assert.throws(() => validateRetainedManifest(manifest, '/tmp/candidate.zip', 'bad', 'c'.repeat(64)));
});

test('retained install refuses to overwrite an existing destination', () => fixture(root => {
  const destination = join(root, 'App.app'); mkdirSync(destination);
  assert.throws(() => requireFreshDestination(destination), /already exists/);
  rmSync(destination, {recursive: true});
  requireFreshDestination(destination);
  assert.throws(() => requireFreshDestination('relative.app'), /absolute .app/);
  assert.throws(() => requireFreshDestination(join(root, 'not-an-app')), /absolute .app/);
}));

test('retained archive inspection binds actual payload bytes before extraction', () => fixture(async root => {
  const archive = join(root, 'candidate.zip'), manifestPath = join(root, 'candidate.json');
  const bytes = Buffer.from('synthetic archive payload'); writeFileSync(archive, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {schema: 1, source: {commit: 'a'.repeat(40), tree: 'b'.repeat(40)},
    run: {id: '123', attempt: '1'}, app: 'Apparent.app', architecture: 'x64',
    host: {platform: 'darwin', node: 'x64', machine: 'x86_64', hardware: '0'}, signing: 'ad-hoc',
    nativeAcceptance: 'pending', releaseAdmission: false,
    artifact: {name: 'candidate.zip', sha256: digest, bytes: bytes.length}, contents: {}};
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const options = {archive, manifestPath, expectedSource: 'a'.repeat(40), expectedArchiveSha256: digest};
  assert.deepEqual(await inspectRetainedArchive(options), manifest);
  const staging = join(root, 'private-staging'); mkdirSync(staging, {mode: 0o700});
  const stable = await stageRetainedArchive(options, staging);
  writeFileSync(archive, 'tampered payload');
  await assert.rejects(inspectRetainedArchive(options), /Archive bytes differ/);
  assert.deepEqual(await fingerprint(stable.archive), {sha256: digest, bytes: bytes.length},
    'Original archive replacement must not change the privately verified extraction input');
  writeFileSync(archive, bytes);
  rmSync(manifestPath); symlinkSync('candidate.zip', manifestPath);
  await assert.rejects(inspectRetainedArchive(options), /Manifest must be a regular file/);
}));
