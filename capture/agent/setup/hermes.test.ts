import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { diagnose, setup, installPackage, system, type Provider } from './hermes.ts';

test('empty and partial installs stay distinct from unknown runtime state; check never mutates', () => {
  const home = mkdtempSync('/tmp/apparent-dev-hermes-setup-');
  try {
    const calls: string[][] = [];
    const p: Provider = { home, platform: 'linux', env: {}, run: (exe, args) => { calls.push([exe, ...args]); return { ok: true, output: '' }; } };
    const exe = join(home, 'apparent');
    const empty = setup(p, exe, home, true);
    assert.equal(empty.checks.find(c => c.id === 'executable')?.status, 'absent');
    assert.equal(empty.checks.find(c => c.id === 'plugin-agent')?.status, 'absent');
    assert.equal(empty.checks.find(c => c.id === 'capture')?.status, 'unknown');
    assert.deepEqual(empty.repairs, []);
    mkdirSync(join(home, 'plugins/apparent'), { recursive: true });
    writeFileSync(join(home, 'plugins/apparent/__init__.py'), '');
    symlinkSync(join(home, 'deleted.AppImage'), exe);
    const partial = diagnose(p, exe, home);
    assert.equal(partial.find(c => c.id === 'plugin-agent')?.status, 'ok');
    assert.equal(partial.find(c => c.id === 'plugin-desktop')?.status, 'absent');
    assert.equal(partial.find(c => c.id === 'executable')?.status, 'absent');
    assert(calls.every(c => c.slice(1).join(' ') === 'query default x-scheme-handler/apparent'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('archive checksum is enforced before invoking writer; verified archive is snapshotted and cleaned', () => {
  const home = mkdtempSync('/tmp/apparent-dev-hermes-archive-');
  try {
    const source = join(home, 'source');
    mkdirSync(join(source, 'apparent'), { recursive: true });
    writeFileSync(join(source, 'apparent/compatibility.json'), '{}');
    writeFileSync(join(source, 'install.cjs'), '');
    const archive = join(home, 'package.tar.gz');
    assert(system.run('/usr/bin/tar', ['-czf', archive, '-C', source, 'apparent', 'install.cjs']).ok);
    let writers = 0, snapshot: string | undefined;
    const p: Provider = { home, platform: 'darwin', env: {}, run(exe, args) {
      if (exe === 'tar') { snapshot = args[1]; return system.run('/usr/bin/tar', args); }
      assert.equal(exe, process.execPath);
      assert.equal(args[1], '--profile'); assert.equal(args[2], home);
      assert.equal(readFileSync(args[0], 'utf8'), '');
      writers++;
      return { ok: true, output: '' };
    } };
    assert.throws(() => installPackage(p, archive, '0'.repeat(64), home), /checksum mismatch/);
    assert.equal(writers, 0);
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    assert(installPackage(p, archive, digest, home));
    assert.equal(writers, 1);
    assert.throws(() => readFileSync(snapshot!), /ENOENT/);
    // A symlink anywhere in the archive must fail before extraction or execution.
    symlinkSync('/outside', join(source, 'apparent/link'));
    assert(system.run('/usr/bin/tar', ['-czf', archive, '-C', source, 'apparent', 'install.cjs']).ok);
    const unsafeDigest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    assert.throws(() => installPackage(p, archive, unsafeDigest, home), /contents/);
    assert.equal(writers, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('stale selected MIME entry is repaired through one provider and rechecked idempotently', () => {
  const home = mkdtempSync('/tmp/apparent-dev-hermes-setup-');
  try {
    const exe = join(home, 'apparent');
    writeFileSync(exe, '#!/bin/sh\n', { mode: 0o700 });
    const apps = join(home, '.local/share/applications');
    let installs = 0;
    const p: Provider = { home, platform: 'linux', env: {}, run: (_, args) => {
      const command = args.join(' ');
      if (command === '--version') return { ok: true, output: 'apparent 0.3.13' };
      if (command === 'capture handoff --help') return { ok: true, output: 'handoff' };
      if (command === 'capture state') return { ok: true, output: '{"error":"control_unavailable"}' };
      if (command === 'update status') return { ok: true, output: '{"running":null,"installed":null}' };
      if (command === 'query default x-scheme-handler/apparent') return { ok: true, output: 'apparent-launch.desktop' };
      assert.equal(command, 'launch-handler install'); installs++;
      mkdirSync(apps, { recursive: true });
      writeFileSync(join(apps, 'apparent-launch.desktop'), `[Desktop Entry]\nType=Application\nExec=${exe} launch %u\nMimeType=x-scheme-handler/apparent;\n`);
      return { ok: true, output: '' };
    } };
    assert.equal(setup(p, exe, home, true).checks.find(c => c.id === 'url-handler')?.status, 'absent');
    assert.equal(installs, 0);
    const repaired = setup(p, exe, home, false);
    assert.equal(repaired.checks.find(c => c.id === 'url-handler')?.status, 'ok');
    assert.equal(repaired.ready, false);
    setup(p, exe, home, false);
    assert.equal(installs, 1);
    writeFileSync(join(apps, 'apparent-launch.desktop'), '[Desktop Entry]\nExec=/different launch %u\n');
    assert.equal(setup(p, exe, home, false).checks.find(c => c.id === 'url-handler')?.status, 'incompatible');
    assert.equal(installs, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('macOS and failed providers never claim absent or loaded from configuration', () => {
  const p: Provider = { platform: 'darwin', home: '/not-used', env: {}, run: () => ({ ok: false, output: '' }) };
  const report = setup(p, process.execPath, undefined, false);
  assert.equal(report.checks.find(c => c.id === 'url-handler')?.status, 'unknown');
  assert.equal(report.checks.find(c => c.id === 'plugin-loaded')?.status, 'unknown');
  assert.equal(report.checks.find(c => c.id === 'plugin-agent')?.status, 'unknown');
  assert.deepEqual(report.repairs, []);
});

test('explicit package uses only the package writer; check ignores it and never installs', () => {
  const home = mkdtempSync('/tmp/apparent-dev-hermes-setup-');
  try {
    const packageRoot = join(home, 'release');
    mkdirSync(packageRoot); writeFileSync(join(packageRoot, 'install.cjs'), '');
    let writes = 0;
    const p: Provider = { home, platform: 'darwin', env: {}, run(exe, args) {
      assert.equal(exe, process.execPath);
      assert.deepEqual(args, [join(packageRoot, 'install.cjs'), '--profile', home]);
      writes++; return { ok: false, output: '' };
    } };
    assert.deepEqual(setup(p, '/missing/apparent', home, true, packageRoot).repairs, []);
    assert.equal(writes, 0);
    const result = setup(p, '/missing/apparent', home, false, packageRoot);
    assert.equal(writes, 0);
    assert.equal(result.repairs[0].status, 'failed');
    assert.equal(result.ready, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('real updater contract distinguishes pending restart and capture availability', () => {
  let pendingRestart = true;
  const p: Provider = { home: '/unused', platform: 'linux', env: {}, run(_, args) {
    const command = args.join(' ');
    if (command === 'update status') return { ok: true, output: JSON.stringify({ pendingRestart, running: { version: '0.3.13', updateId: 'a', updateChannel: 'main' }, installed: { id: pendingRestart ? 'b' : 'a', channel: 'main' } }) };
    if (command === 'capture state') return { ok: true, output: '{"state":{"phase":"recording"}}' };
    return { ok: false, output: '' };
  } };
  const first = diagnose(p, process.execPath);
  assert.equal(first.find(c => c.id === 'capture')?.status, 'ok');
  assert.equal(first.find(c => c.id === 'running')?.status, 'incompatible');
  assert.deepEqual(first.find(c => c.id === 'running')?.evidence, { runningVersion: '0.3.13', runningUpdate: 'a', installedUpdate: 'b' });
  pendingRestart = false;
  assert.equal(diagnose(p, process.execPath).find(c => c.id === 'running')?.status, 'ok');
});
