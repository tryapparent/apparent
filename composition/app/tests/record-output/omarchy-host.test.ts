import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { validateCaptureRequest, type SourceDiscovery } from '@apparent/engine-sdk/capture';
import { cloneRecordCommand } from '../../src/record/wire.ts';

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

test('public Start IDs map deterministically to valid native invocation IDs without changing public identity', () => {
  const source = { id: 'display:1', generation: 'c'.repeat(32), kind: 'display' as const, displayId: 1,
    bounds: { x: 0, y: 0, width: 1280, height: 800, scale: 1 } };
  const discovery: SourceDiscovery = { state: 'available', sources: [source] };
  const originalDiscovery = structuredClone(discovery);
  // First value is emitted by the real renderer's crypto.randomUUID(). The
  // other accepted public IDs ensure this boundary is not UUID stripping.
  const requestIds = ['9e2f4cea-4386-4b08-b6c1-1c6c142b7482', 'request-42', 'request42'];
  const nativeIds = new Set<string>();
  for (const requestId of requestIds) {
    const command = cloneRecordCommand({ type: 'start-capture', requestId,
      expected: { providerEpoch: 'provider-test', revision: 1 }, delivery: 'host-default' });
    assert(command, 'the public command accepts this opaque request ID');
    const originalCommand = structuredClone(command);
    const intent = omarchyStartIntent(command.requestId, discovery);
    const envelope = { channel: 'capture', protocolVersion: 2, clientId: 'a'.repeat(32), rpcId: 'b'.repeat(32),
      method: 'start', ownerToken: '0'.repeat(64), captureId: '0'.repeat(32),
      bundleId: 'record-preflight.apparent', bundlePath: '/record-preflight.apparent',
      source: intent.source, options: intent.options, invocation: intent.invocation };
    assert.throws(() => validateCaptureRequest({ ...envelope,
      invocation: { ...intent.invocation, invocationId: requestId } }), /invalid invocation invocationId/);
    assert.doesNotThrow(() => validateCaptureRequest(envelope), 'actual installed SDK preflight accepts adapted invocation');
    assert.match(intent.invocation.invocationId, /^[a-f0-9]{32}$/);
    assert.equal(intent.invocation.invocationId, omarchyStartIntent(requestId, discovery).invocation.invocationId);
    nativeIds.add(intent.invocation.invocationId);
    assert.deepEqual(command, originalCommand);
    assert.equal(command.requestId, requestId);
    assert.equal(intent.source, source);
    assert.deepEqual(intent.options, { audio: 'none', localOnly: true });
  }
  assert.equal(nativeIds.size, requestIds.length);
  assert.deepEqual(discovery, originalDiscovery);
  assert.throws(() => omarchyStartIntent('request', { state: 'available', sources: [source, { ...source, id: 'other' }] }), /exactly one/);
  assert.throws(() => omarchyStartIntent('request', { state: 'unavailable', sources: [] }), /exactly one/);
});

test('permissive existing profile refuses before native manifest read or worker launch', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'omarchy-private-profile-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o755);
  await assert.rejects(createRecordHostServices({ profilePath: root, nativeRoot: join(root, 'absent-native') }), /not private/);
});

test('ordinary microphone intent preserves source and invocation while refusing a silent fallback',()=>{
  const source={id:'display:1',generation:'c'.repeat(32),kind:'display' as const,displayId:1,bounds:{x:0,y:0,width:1280,height:800,scale:1}};
  const discovery:SourceDiscovery={state:'available',sources:[source]};
  const requestId='3d214f90-c9ed-49d8-b3b1-1ed92d1cf939';
  const silent=omarchyStartIntent(requestId,discovery);
  const voice=omarchyStartIntent(requestId,discovery,'microphone');
  assert.deepEqual(voice.options,{audio:'microphone',localOnly:true});assert.equal(voice.source,source);
  assert.equal(voice.invocation.invocationId,silent.invocation.invocationId);
  validateCaptureRequest({channel:'capture',protocolVersion:2,clientId:'a'.repeat(32),rpcId:'b'.repeat(32),method:'start',
    captureId:'c'.repeat(32),ownerToken:'d'.repeat(64),bundleId:'original.apparent',bundlePath:'/private/original.apparent',...voice});
});
