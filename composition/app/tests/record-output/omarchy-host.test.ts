import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { SourceDiscovery } from '@apparent/engine-sdk/capture';

// Match the packaged main's compilation rather than Node's strip-only parser
// (the existing setup error class has TypeScript parameter properties).
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../src/record/omarchy/host.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'no-production-setup', setup(builder) {
    builder.onResolve({ filter: /production-host\.ts$/ }, () => ({ path: 'production', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents:
      'export function createRecordProductionHost() { throw new Error("Native setup must remain uncalled"); }' }));
  } }] });
const { createRecordHostServices, omarchyStartIntent } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`) as typeof import('../../src/record/omarchy/host.ts');

test('real host intent preserves public Start identity and exact native source with silent options', () => {
  const source = { id: 'native-monitor', generation: 'native-generation', kind: 'display' as const, displayId: 1,
    bounds: { x: 0, y: 0, width: 1280, height: 800, scale: 1 } };
  const discovery: SourceDiscovery = { state: 'available', sources: [source] };
  const intent = omarchyStartIntent('original-start-request', discovery);
  assert.equal(intent.invocation.invocationId, 'original-start-request');
  assert.equal(intent.source, source);
  assert.deepEqual(intent.options, { audio: 'none', localOnly: true });
  assert.throws(() => omarchyStartIntent('request', { state: 'available', sources: [source, { ...source, id: 'other' }] }), /exactly one/);
  assert.throws(() => omarchyStartIntent('request', { state: 'unavailable', sources: [] }), /exactly one/);
});

test('permissive existing profile refuses before native manifest read or worker launch', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'omarchy-private-profile-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o755);
  await assert.rejects(createRecordHostServices({ profilePath: root, nativeRoot: join(root, 'absent-native') }), /not private/);
});
