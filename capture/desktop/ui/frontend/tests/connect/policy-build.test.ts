import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const worker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../electron/settings-policy.cjs');
const buildScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/build-connect-transport.ts');

test('compiled Settings policy worker is a bounded secret-free one-shot contract', () => {
  const request = {
    state: { consent: false, confirmation: null },
    context: { action: 'connect', snapshotAvailable: true, busy: false, retryDisable: null, emergency: false, closed: false },
  };
  const child = spawnSync(process.execPath, [worker], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 2_000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(Object.keys(result).sort(), ['effect', 'overlay', 'state']);
  assert.deepEqual(result.state, { consent: true, confirmation: null });
  assert.equal(result.effect, null);
  assert.equal(result.overlay.mode, 'consent');
  assert.equal(JSON.stringify(result).includes('token'), false);
  assert.equal(JSON.stringify(result).includes('/home/'), false);
});

test('compiled worker rejects unknown fields instead of accepting an expanded wire contract', () => {
  const child = spawnSync(process.execPath, [worker], {
    input: JSON.stringify({
      state: { consent: false, confirmation: null },
      context: { action: 'connect', snapshotAvailable: true, busy: false, retryDisable: null, emergency: false, closed: false, token: 'secret' },
    }), encoding: 'utf8', timeout: 2_000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(child.status, 2);
  assert.equal(child.stdout, '');
});

test('compiled worker rejects malformed, oversized and wrongly typed frames without output', () => {
  const invalid = [
    '{"state":',
    'x'.repeat(64 * 1024),
    JSON.stringify({
      state: { consent: false, confirmation: null },
      context: { action: 'connect', snapshotAvailable: true, busy: false, retryDisable: null, emergency: 'yes', closed: false },
    }),
  ];
  for (const input of invalid) {
    const child = spawnSync(process.execPath, [worker], {
      input, encoding: 'utf8', timeout: 2_000,
      env: { PATH: process.env.PATH ?? '' },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 2);
    assert.equal(child.stdout, '');
  }
});

test('generated worker remains runnable from the installed Settings electron directory', async t => {
  const staged = await mkdtemp(path.join(os.tmpdir(), 'apparent-dev-account-policy-'));
  t.after(() => rm(staged, { recursive: true, force: true }));
  const electron = path.join(staged, 'electron');
  await mkdir(electron);
  const workerPath = path.join(electron, 'settings-policy.cjs');
  await copyFile(worker, workerPath);
  const child = spawnSync(process.execPath, [workerPath], {
    input: JSON.stringify({
      state: { consent: false, confirmation: null },
      context: { action: 'request-disconnect', snapshotAvailable: true, busy: false, retryDisable: null, emergency: false, closed: false },
    }), encoding: 'utf8', timeout: 2_000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).overlay.mode, 'confirmation');
});

test('transport build rejects redirected output and cleanly regenerates its worker', async t => {
  const external = await mkdtemp(path.join(os.tmpdir(), 'apparent-dev-account-output-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const sentinel = path.join(external, 'sentinel');
  await writeFile(sentinel, 'preserve');
  const original = await readFile(worker);
  try {
    await rm(worker);
    await symlink(sentinel, worker);
    const unsafe = spawnSync(process.execPath, ['--experimental-strip-types', buildScript], {
      encoding: 'utf8', timeout: 15_000,
    });
    assert.notEqual(unsafe.status, 0);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
    await rm(worker);
    await writeFile(worker, 'stale generated output');
    const regenerated = spawnSync(process.execPath, ['--experimental-strip-types', buildScript], {
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(regenerated.error, undefined);
    assert.equal(regenerated.status, 0, regenerated.stderr);
    assert.notEqual(await readFile(worker, 'utf8'), 'stale generated output');
    assert.deepEqual(await readFile(worker), original);
  } finally {
    await rm(worker, { force: true });
    await writeFile(worker, original);
  }
});
