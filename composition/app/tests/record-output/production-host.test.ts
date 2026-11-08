import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { CaptureClient } from '@apparent/engine-sdk/capture';
import type { Media2Client } from '@apparent/engine-sdk/media2';
import type { RecoveryPeer, RecoveryPeerFacts, RecoveryPeerRelease } from '@apparent/engine-sdk/recovery';
import type { RecordCaptureCoordinator } from '@apparent/record/host/capture2-coordinator';
import type { RecordProductionHostOptions, RecordRecoveryProductionHostOptions } from '../../src/record/production-host.ts';
import type { RecordNativeBindingOptions, RecordNativeBindings } from '../../src/record/native-bindings.ts';

type Factory = typeof import('../../src/record/production-host.ts');
async function controlledNative(create: (input: RecordNativeBindingOptions) => Promise<RecordNativeBindings>,
  inspectCoordinator?: (input: unknown) => void,
  transformCoordinator?: (flow: RecordCaptureCoordinator) => RecordCaptureCoordinator): Promise<Factory> {
  const key = `__productionHostTest${Math.random().toString(36).slice(2)}`;
  (globalThis as unknown as Record<string, unknown>)[key] = create;
  const observerKey = key + 'Coordinator';
  (globalThis as unknown as Record<string, unknown>)[observerKey] = inspectCoordinator;
  const transformKey = key + 'TransformCoordinator';
  (globalThis as unknown as Record<string, unknown>)[transformKey] = transformCoordinator;
  const actualCoordinator = fileURLToPath(import.meta.resolve('@apparent/record/host/capture2-coordinator'));
  const output = await build({ entryPoints: [fileURLToPath(new URL('../../src/record/production-host.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-native-binding', setup(builder) {
      builder.onResolve({ filter: /^\//, namespace: key }, args => ({ path: args.path, namespace: 'file' }));
      if (inspectCoordinator || transformCoordinator) {
        builder.onResolve({ filter: /^@apparent\/record\/host\/capture2-coordinator$/ }, () => ({ path: 'coordinator', namespace: key }));
        builder.onLoad({ filter: /^coordinator$/, namespace: key }, () => ({ loader: 'js', contents:
          `import {createStandardRecordCaptureCoordinator as actual} from ${JSON.stringify(actualCoordinator)}; export async function createStandardRecordCaptureCoordinator(input) { if (globalThis[${JSON.stringify(observerKey)}]) globalThis[${JSON.stringify(observerKey)}](input); const flow = await actual(input); return globalThis[${JSON.stringify(transformKey)}] ? globalThis[${JSON.stringify(transformKey)}](flow) : flow; }` }));
      }
      builder.onResolve({ filter: /^\.\/native-bindings\.ts$/ }, () => ({ path: 'binding', namespace: key }));
      builder.onLoad({ filter: /.*/, namespace: key }, () => ({ loader: 'js',
        contents: `export const createRecordNativeBindings = input => globalThis[${JSON.stringify(key)}](input);` }));
    } }] });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${key}`);
}

function recoveryPeer<Client>(client: Client, channel: RecoveryPeerFacts['channel'], peerId: string,
  release: () => Promise<RecoveryPeerRelease>): RecoveryPeer<Client> {
  return { client, lifetime: Object.freeze({ schema: 'apparent.engine-recovery-peer/1', peerId, channel,
    implementation: 'native', role: 'recovery', startsFreshCapture: false,
    onInputEof: 'retain-admitted-finite-work' }), release };
}

function recoveryOptions(f: ReturnType<typeof fixture>, peers: RecordRecoveryProductionHostOptions['peers']): RecordRecoveryProductionHostOptions {
  const { captureClient: _captureClient, mediaClient: _mediaClient, ...coordinator } = f.options.coordinator;
  return { coordinator, native: f.options.native, peers,
    shutdownOtherRuntimeUsers: f.options.shutdownOtherRuntimeUsers };
}

function unknownClearance(flow: RecordCaptureCoordinator): RecordCaptureCoordinator {
  const shutdown = flow.shutdown.bind(flow);
  flow.shutdown = async () => {
    const report = await shutdown();
    return { ...report, runtimeClearance: 'unknown', work: [
      ...report.work, { owner: 'capture', state: 'unknown', reason: 'synthetic native ownership unknown' },
    ] };
  };
  return flow;
}
function fixture(root: string) {
  let sdkClosed = 0, configClosed = 0, nativeDispatches = 0;
  const never = () => { nativeDispatches++; throw new Error('No capture or processing action authorized'); };
  const native: RecordNativeBindings = {
    native: { async readFacts() { return { version: 1, providerEpoch: 'isolated-native', revision: 0, readiness: [],
      shortcut: { effective: null, label: null, registration: 'unknown', externallyManaged: false, draft: null } }; } },
    penConfig: { async read() { return { persisted: null, effective: null }; }, writeApplyAndReadBack: never },
    clipboard: { copyLocal: never }, async close() { configClosed++; },
  };
  const options: RecordProductionHostOptions = {
    coordinator: {
      captureClient: { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; } } as never,
      mediaClient: {} as never,
      mappingRoot: join(root, 'mappings'), bundleRoot: join(root, 'bundles'), privateControlRoot: join(root, 'control'),
      createStartIntent: never, trustedMaterialsRoot: never, standardProcessing: { requestVideoProof: true },
    },
    native: { requiredPermissionIds: ['screen-recording'], config: {
      executable: '/admitted/config-host', executableSha256: 'a'.repeat(64), configPath: join(root, 'config.json'),
    } },
    async shutdownOtherRuntimeUsers() { return 'clear'; },
    async closeEngine() { sdkClosed++; },
  };
  return { native, options, counts: () => ({ sdkClosed, configClosed, nativeDispatches }) };
}

test('production composition uses the real admitted coordinator resolver and terminal lifecycle without native effects', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-production-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  let supplied: RecordNativeBindingOptions | undefined;
  const module = await controlledNative(async input => { supplied = input; return f.native; });
  const host = await module.createRecordProductionHost(f.options);
  assert.deepEqual(supplied?.requiredPermissionIds, ['screen-recording']);
  assert.equal(await supplied!.resolveHandoff({ captureId: 'unknown', artifactId: 'unknown' }), null);
  assert.deepEqual(f.counts(), { sdkClosed: 0, configClosed: 0, nativeDispatches: 0 });
  assert.equal(await host.canClose(), true);
  assert.equal(host.shutdownReport()?.runtimeClearance, 'clear');
  await assert.rejects(supplied!.resolveHandoff({ captureId: 'unknown', artifactId: 'unknown' }), /closing|disposed/);
  await host.close(); await host.close();
  assert.deepEqual(f.counts(), { sdkClosed: 1, configClosed: 1, nativeDispatches: 0 });
});

test('setup failure preserves partial assembly and caller-owned SDKs rather than closing uncertain ownership', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-production-failed-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  const module = await controlledNative(async () => f.native);
  f.options.coordinator.pollIntervalMs = 1;
  await assert.rejects(module.createRecordProductionHost(f.options), error => {
    assert(error instanceof module.RecordHostSetupError);
    assert.equal(error.nativeBindings, f.native);
    assert.equal(error.coordinator, undefined);
    assert(error.cause instanceof RangeError);
    return true;
  });
  assert.deepEqual(f.counts(), { sdkClosed: 0, configClosed: 0, nativeDispatches: 0 });
  // This injected validation failure occurred before runtime creation. The caller
  // can retire the returned config binding; SDK ownership was never transferred.
  await f.native.close();
});

test('trusted roots, config and permission records are snapshotted before asynchronous setup', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-production-snapshot-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  let supplied!: RecordNativeBindingOptions, observed!: RecordProductionHostOptions['coordinator'], release!: () => void;
  let ownedFlow!: RecordCaptureCoordinator;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const module = await controlledNative(async input => { supplied = input; await barrier; return f.native; },
    input => { observed = input as RecordProductionHostOptions['coordinator']; },
    flow => { ownedFlow = flow; return flow; });
  f.options.coordinator.standardProcessing.destination = { session: 'original-session', title: 'original title', via: 'explicit-host' };
  const captureClient = f.options.coordinator.captureClient;
  const mediaClient = f.options.coordinator.mediaClient;
  const publicationClient = { publish() { throw new Error('No publication authorized'); } } as unknown as CaptureClient;
  f.options.coordinator.publicationClient = publicationClient;
  const creating = module.createRecordProductionHost(f.options);
  f.options.coordinator.publicationClient = {} as CaptureClient;
  f.options.coordinator.captureClient = {} as CaptureClient;
  f.options.coordinator.mediaClient = {} as Media2Client;
  const originalControl = f.options.coordinator.privateControlRoot;
  f.options.coordinator.privateControlRoot = join(root, 'substituted-control');
  f.options.coordinator.standardProcessing.requestVideoProof = false;
  f.options.coordinator.standardProcessing.destination!.title = 'substituted title';
  f.options.native.config.executable = '/substituted/helper';
  (f.options.native.requiredPermissionIds as string[]).push('substituted-permission');
  f.options.closeEngine = async () => { throw new Error('substituted close must not run'); };
  release();
  const host = await creating;
  assert.equal(supplied.config.executable, '/admitted/config-host');
  assert.deepEqual(supplied.requiredPermissionIds, ['screen-recording']);
  assert.equal(observed.privateControlRoot, originalControl);
  assert.equal(observed.captureClient, captureClient);
  assert.equal(observed.mediaClient, mediaClient);
  assert.equal(observed.publicationClient, publicationClient);
  assert.notEqual(observed.publicationClient, observed.captureClient);
  assert.equal(observed.standardProcessing.requestVideoProof, true);
  assert.equal(observed.standardProcessing.destination?.title, 'original title');
  await assert.rejects(stat(join(root, 'substituted-control')), { code: 'ENOENT' });
  // Factory construction does not promise that asynchronous startup reconciliation settled.
  await ownedFlow.reconcile();
  assert.equal(await host.canClose(), true); await host.close();
  assert.equal(f.counts().sdkClosed, 1);
});

test('late binding failure returns the exact live coordinator for authoritative shutdown instead of disposing it implicitly', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-production-partial-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  const failedNative = { ...f.native, get native(): RecordNativeBindings['native'] { throw new Error('binding lost before provider admission'); } };
  const module = await controlledNative(async () => failedNative);
  let failed!: InstanceType<Factory['RecordHostSetupError']>;
  await assert.rejects(module.createRecordProductionHost(f.options), error => {
    assert(error instanceof module.RecordHostSetupError); failed = error;
    assert.equal(error.nativeBindings, failedNative);
    assert(error.coordinator, 'caller must receive the already constructed owner coordinator');
    return true;
  });
  assert.deepEqual(f.counts(), { sdkClosed: 0, configClosed: 0, nativeDispatches: 0 });
  const report = await failed.coordinator!.shutdown();
  assert.equal(report.runtimeClearance, 'clear');
  await failed.coordinator!.dispose();
  await failed.nativeBindings.close();
  assert.equal(f.counts().sdkClosed, 0, 'caller-owned SDKs still require explicit caller release');
});

function peerFacts(peerId: string, channel: RecoveryPeerFacts['channel']): RecoveryPeerFacts {
  return { schema: 'apparent.engine-recovery-peer/1', peerId, channel, implementation: 'native', role: 'recovery',
    startsFreshCapture: false, onInputEof: 'retain-admitted-finite-work' };
}

function peerReceipt(peerId: string, inputClosure: RecoveryPeerRelease['inputClosure']): RecoveryPeerRelease {
  return { scope: 'client-connection', peerId, connection: 'released', inputClosure,
    runtimeClearance: 'not-established', reconcile: 'original-capture-materials-job-publication-bindings' };
}

test('recovery factory injects snapshotted public clients and releases retained peers after local drain', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-recovery-production-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  let localClientCloses = 0, captureReleases = 0, mediaReleases = 0, substitutedReleases = 0;
  const captureClient = { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; },
    close() { localClientCloses++; } } as unknown as CaptureClient;
  const mediaClient = { close() { localClientCloses++; } } as unknown as Media2Client;
  const captureLifetime = peerFacts('capture-peer-original', 'capture/2');
  const mediaLifetime = peerFacts('media-peer-original', 'media/2');
  const captureRelease = async () => { captureReleases++; return peerReceipt('capture-peer-original', 'unconfirmed'); };
  const mediaRelease = async () => { mediaReleases++; return peerReceipt('media-peer-original', 'peer-exit-observed'); };
  const capturePeer = { client: captureClient, lifetime: captureLifetime, release: captureRelease } as RecoveryPeer<CaptureClient>;
  const mediaPeer = { client: mediaClient, lifetime: mediaLifetime, release: mediaRelease } as RecoveryPeer<Media2Client>;
  const options = recoveryOptions(f, { capture: capturePeer, media: mediaPeer });
  options.coordinator.standardProcessing.destination = { session: 'original-session', title: 'original title', via: 'explicit-host' };
  let supplied!: RecordNativeBindingOptions;
  let observed!: Record<string, unknown>;
  let allowSetup!: () => void;
  const barrier = new Promise<void>(resolve => { allowSetup = resolve; });
  const module = await controlledNative(async input => { supplied = input; await barrier; return f.native; },
    input => { observed = input as Record<string, unknown>; }, unknownClearance);
  const creating = module.createRecordRecoveryProductionHost(options);
  const originalControl = options.coordinator.privateControlRoot;
  options.coordinator.privateControlRoot = join(root, 'substituted-control');
  options.coordinator.standardProcessing.destination!.title = 'substituted title';
  options.native.config.executable = '/substituted/helper';
  (options.native.requiredPermissionIds as string[]).push('substituted-permission');
  options.shutdownOtherRuntimeUsers = async () => 'unknown';
  (capturePeer as unknown as { client: CaptureClient }).client = {} as CaptureClient;
  (captureLifetime as { peerId: string }).peerId = 'capture-peer-substituted';
  (capturePeer as unknown as { release(): Promise<RecoveryPeerRelease> }).release = async () => {
    substitutedReleases++; return peerReceipt('capture-peer-substituted', 'confirmed');
  };
  (mediaLifetime as { peerId: string }).peerId = 'media-peer-substituted';
  (mediaPeer as unknown as { release(): Promise<RecoveryPeerRelease> }).release = async () => {
    substitutedReleases++; return peerReceipt('media-peer-substituted', 'confirmed');
  };
  allowSetup();
  const host = await creating;
  assert.equal(supplied.config.executable, '/admitted/config-host');
  assert.deepEqual(supplied.requiredPermissionIds, ['screen-recording']);
  assert.equal(observed.privateControlRoot, originalControl);
  assert.equal((observed.standardProcessing as { destination?: { title?: string } }).destination?.title, 'original title');
  assert.equal(observed.captureClient, captureClient);
  assert.equal(observed.mediaClient, mediaClient);
  assert.deepEqual(host.recoveryRelease(), {
    state: 'pending',
    capture: { peerId: 'capture-peer-original', channel: 'capture/2', state: 'pending' },
    media: { peerId: 'media-peer-original', channel: 'media/2', state: 'pending' },
  });

  assert.equal(await host.canClose(), false, 'unknown native ownership remains uncleared');
  assert.deepEqual([captureReleases, mediaReleases, substitutedReleases], [1, 1, 0]);
  assert.equal(localClientCloses, 0, 'recovery clients are never closed as owning SDK clients');
  assert.equal(host.shutdownReport()?.runtimeClearance, 'unknown');
  const released = host.recoveryRelease();
  assert.equal(released.state, 'released', 'unconfirmed input closure is still a local connection release');
  assert.equal(released.capture.receipt?.peerId, 'capture-peer-original');
  assert.equal(released.capture.receipt?.inputClosure, 'unconfirmed');
  assert.equal(released.capture.receipt?.runtimeClearance, 'not-established');
  assert.equal(released.capture.channel, 'capture/2');
  assert.equal(released.media.receipt?.peerId, 'media-peer-original');
  assert.equal(released.media.receipt?.inputClosure, 'peer-exit-observed');
  assert.equal(host.shutdownReport()?.runtimeClearance, 'unknown', 'local release never rewrites the shutdown report');
  await assert.rejects(host.close(), /retains unresolved runtime ownership/);
  assert.equal(f.counts().configClosed, 0, 'unknown native ownership keeps config cleanup gated');
});

test('recovery release attempts both peers once when one rejects and records partial unknown without retry', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-recovery-partial-release-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  let captureReleases = 0, mediaReleases = 0, clientCloses = 0;
  const captureClient = { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; }, close() { clientCloses++; } } as unknown as CaptureClient;
  const mediaClient = { close() { clientCloses++; } } as unknown as Media2Client;
  const peers = {
    capture: recoveryPeer(captureClient, 'capture/2', 'capture-rejects', async () => {
      captureReleases++; throw new Error('synthetic release uncertainty');
    }),
    media: recoveryPeer(mediaClient, 'media/2', 'media-releases', async () => {
      mediaReleases++; return peerReceipt('media-releases', 'unconfirmed');
    }),
  };
  const module = await controlledNative(async () => f.native, undefined, unknownClearance);
  const host = await module.createRecordRecoveryProductionHost(recoveryOptions(f, peers));
  assert.equal(await host.canClose(), false);
  assert.deepEqual([captureReleases, mediaReleases], [1, 1], 'Promise.allSettled attempts both local releases');
  assert.equal(host.recoveryRelease().state, 'unknown');
  assert.equal(host.recoveryRelease().capture.state, 'unknown');
  assert.equal(host.recoveryRelease().media.state, 'released');
  assert.equal(host.recoveryRelease().media.receipt?.runtimeClearance, 'not-established');
  assert.equal(host.shutdownReport()?.runtimeClearance, 'unknown');
  assert.equal(await host.canClose(), false);
  assert.deepEqual([captureReleases, mediaReleases], [1, 1], 'a partial release is never retried');
  assert.equal(clientCloses, 0);
});

test('recovery setup failure returns partial host ownership without releasing either peer', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-recovery-setup-failure-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  let captureReleases = 0, mediaReleases = 0, clientCloses = 0;
  const captureClient = { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; }, close() { clientCloses++; } } as unknown as CaptureClient;
  const mediaClient = { close() { clientCloses++; } } as unknown as Media2Client;
  const peers = {
    capture: recoveryPeer(captureClient, 'capture/2', 'capture-retained', async () => { captureReleases++; return peerReceipt('capture-retained', 'confirmed'); }),
    media: recoveryPeer(mediaClient, 'media/2', 'media-retained', async () => { mediaReleases++; return peerReceipt('media-retained', 'confirmed'); }),
  };
  const options = recoveryOptions(f, peers);
  options.coordinator.pollIntervalMs = 1;
  const module = await controlledNative(async () => f.native);
  await assert.rejects(module.createRecordRecoveryProductionHost(options), error => {
    assert(error instanceof module.RecordHostSetupError);
    assert.equal(error.nativeBindings, f.native);
    assert.equal(error.coordinator, undefined);
    assert(error.cause instanceof RangeError);
    return true;
  });
  assert.deepEqual([captureReleases, mediaReleases, clientCloses], [0, 0, 0]);
  assert.equal(f.counts().configClosed, 0, 'the caller receives partial native cleanup responsibility');
});


test('recovery factory rejects a runtime-supplied publication client before native setup', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-recovery-publication-client-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  const captureClient = { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; } } as unknown as CaptureClient;
  const mediaClient = {} as Media2Client;
  const peers = {
    capture: recoveryPeer(captureClient, 'capture/2', 'capture-publication-test', async () => peerReceipt('capture-publication-test', 'confirmed')),
    media: recoveryPeer(mediaClient, 'media/2', 'media-publication-test', async () => peerReceipt('media-publication-test', 'confirmed')),
  };
  const options = recoveryOptions(f, peers);
  let nativeSetupCalls = 0;
  const module = await controlledNative(async () => { nativeSetupCalls++; return f.native; });
  const malicious = { ...options, coordinator: { ...options.coordinator, publicationClient: {} } } as unknown as RecordRecoveryProductionHostOptions;
  await assert.rejects(module.createRecordRecoveryProductionHost(malicious), /does not accept an additional publication client/);
  assert.equal(nativeSetupCalls, 0, 'untracked borrower is rejected before native setup');
});

test('failed local recovery release cannot admit close when the native report itself is clear', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'record-recovery-clear-release-failure-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(root);
  let attempts = 0;
  const peers = {
    capture: recoveryPeer(f.options.coordinator.captureClient, 'capture/2', 'clear-capture', async () => {
      attempts++; throw new Error('release lost');
    }),
    media: recoveryPeer(f.options.coordinator.mediaClient, 'media/2', 'clear-media', async () => {
      attempts++; return peerReceipt('clear-media', 'unconfirmed');
    }),
  };
  const module = await controlledNative(async () => f.native);
  const host = await module.createRecordRecoveryProductionHost(recoveryOptions(f, peers));
  assert.equal(await host.canClose(), false);
  assert.equal(host.shutdownReport()?.runtimeClearance, 'clear', 'native report remains unchanged');
  assert.equal(host.recoveryRelease().state, 'unknown');
  await assert.rejects(host.close(), /retains unresolved runtime ownership/);
  assert.equal(await host.canClose(), false);
  assert.equal(attempts, 2, 'both peers attempted once, with no retry');
  assert.equal(f.counts().configClosed, 0);
});
