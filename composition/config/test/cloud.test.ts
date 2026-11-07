import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnectCloudConfig, MAX_CONNECT_CLOUD_VALUE_BYTES } from '../src/cloud.ts';
import { createConfigBackend } from '../src/client.ts';

const peer = fileURLToPath(new URL('./peer.ts', import.meta.url));
async function options(mode = 'ok') {
  await chmod(peer, 0o755);
  return { executable: peer, executableSha256: createHash('sha256').update(await readFile(peer)).digest('hex'),
    configPath: join(tmpdir(), `${mode}.json`), timeoutMs: 1_000 };
}
const absent = { present: false, value: null } as const;
test('fixed cloud facade preserves presence and validates before dispatch', async () => {
  const cloud = await createConnectCloudConfig(await options());
  try {
    assert.equal(MAX_CONNECT_CLOUD_VALUE_BYTES, 16_384);
    assert.deepEqual(await cloud.read(), { present: true, value: null });
    await assert.rejects(cloud.compareAndSwap({ present: false, value: {} }, absent), /snapshot/);
    await assert.rejects(cloud.compareAndSwap(absent, { present: true, value: 'x'.repeat(16_384) }), /size/);
    await assert.rejects(cloud.compareAndSwap(absent, { present: true, value: NaN }), /JSON/);
    assert.deepEqual(await cloud.compareAndSwap(absent, { present: true, value: { server: 'synthetic', enabled: false } }), { status: 'saved' });
  } finally { await cloud.close(); }
  await assert.rejects(cloud.read(), /unavailable/i);
  await cloud.close();
});
test('fresh conflict is returned without retry or inferred write', async () => {
  const cloud = await createConnectCloudConfig(await options('conflict'));
  try { assert.deepEqual(await cloud.compareAndSwap(absent, absent), { status: 'conflict', current: { present: true, value: { server: 'synthetic', enabled: false } } }); }
  finally { await cloud.close(); }
});
test('publication uncertainty and lost or malformed replies stay unknown', async () => {
  for (const mode of ['unknown', 'exit', 'hang', 'malformed', 'wrong-id', 'oversized']) {
    const cloud = await createConnectCloudConfig(await options(mode));
    try {
      assert.deepEqual(await cloud.compareAndSwap(absent, absent), { status: 'unknown', message: 'Configuration outcome unknown; reload before retrying' });
      if (mode === 'unknown') assert.deepEqual(await cloud.read(), { present: true, value: null });
      else await assert.rejects(cloud.read(), /unavailable/i);
    } finally { await cloud.close(); }
  }
});
test('other owner bindings cannot access cloud operations', async () => {
  const backend = await createConfigBackend({ ...await options(), ownerId: 'record' });
  try {
    await assert.rejects(backend.readConnectCloud(), /connect owner/);
    await assert.rejects(backend.compareAndSwapConnectCloud(absent, absent), /connect owner/);
  } finally { await backend.close(); }
});
