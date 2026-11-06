import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureClient } from '@apparent/engine-sdk/capture';
import { preflightCapturePublication } from '@apparent/engine-sdk/capture';
import type { Media2Client } from '@apparent/engine-sdk/media2';
import { createRecordCaptureCoordinator, type RecordCaptureCoordinator } from '@apparent/record/host/capture2-coordinator';
import { bindRecordCoordinatorHost } from '../../src/record/coordinator-host.ts';
import type { RecordNativeBindings } from '../../src/record/native-bindings.ts';

function bindings(closed = () => {}) : RecordNativeBindings {
  return {
    native: { async readFacts() { return { version: 1, providerEpoch: 'no-native-effect', revision: 0, readiness: [],
      shortcut: { effective: null, label: null, registration: 'unknown', externallyManaged: false, draft: null } }; } },
    penConfig: { async read() { return { persisted: null, effective: null }; },
      async writeApplyAndReadBack() { throw new Error('No pen effect authorized'); } },
    clipboard: { async copyLocal() { throw new Error('No clipboard effect authorized'); } },
    async close() { closed(); },
  };
}

test('admitted automatic coordinator binds its public provider and preserves unavailable clearance', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shell-coordinator-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const unexpected = () => { throw new Error('No capture, selection, material or publication dispatch authorized'); };
  const flow = await createRecordCaptureCoordinator({
    captureClient: { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; } } as unknown as CaptureClient,
    mediaClient: {} as Media2Client,
    mappingRoot: join(root, 'mappings'), bundleRoot: join(root, 'bundles'), privateControlRoot: join(root, 'control'),
    createStartIntent: unexpected, trustedMaterialsRoot: unexpected, selectProcessing: unexpected,
    preflight: preflightCapturePublication,
  });
  t.after(() => flow.dispose()); // Empty synthetic fixture ownership only; not host close clearance.
  let engineClosed = false;
  const host = bindRecordCoordinatorHost({ coordinator: flow, nativeBindings: bindings(),
    async closeEngine() { engineClosed = true; } });
  await flow.reconcile();
  assert.deepEqual(host.processingIssues(), []);
  assert.equal(await flow.resolveHandoff({ captureId: 'unknown', artifactId: 'unknown' }), null);
  assert.equal(await host.canClose(), false);
  await assert.rejects(host.close(), /ownership remains unresolved/);
  assert.equal(engineClosed, false);
  host.record.detach();
});

test('cleared shutdown blocks SDK closure until coordinator disposal drains and seals command admission', { timeout: 2000 }, async () => {
  const events: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const disposalEntered = new Promise<void>(resolve => { entered = resolve; });
  const drain = new Promise<void>(resolve => { release = resolve; });
  const report = { requestIds: [], storageUnavailable: false, reconciliation: 'complete' as const };
  const runtime: RecordCaptureCoordinator['runtime'] = {
    state: { phase: 'idle', readiness: { ready: false, reason: 'Synthetic unavailable capture' } }, startup: { state: 'ready', knownRequestIds: [] },
    subscribe() { return () => {}; }, async dispatch() { throw new Error('Unexpected dispatch'); },
    async reconcileStartup() { return this.startup; }, unresolvedOwnership() { return report; },
    dispose() { events.push('runtime-detach'); return report; },
    async startCapture() { throw new Error('Unexpected start'); },
  };
  const flow = {
    runtime, capture2Start: runtime,
    captureFacts: { async readFacts() { return { version: 1, providerEpoch: 'cleared-fixture', revision: 1,
      captures: [], nextShortcutAdmission: { state: 'idle' as const } }; } },
    async dispose() { events.push('drain-start'); entered(); await drain; events.push('drain-end'); },
    async reconcile() {}, processingIssues: () => [], observeProcessingIssues() { return () => {}; },
  } as unknown as RecordCaptureCoordinator;
  const host = bindRecordCoordinatorHost({ coordinator: flow, nativeBindings: bindings(() => events.push('config-close')),
    async closeEngine() { events.push('sdk-close'); } });
  let snapshot!: Parameters<Parameters<typeof host.record.observe>[0]>[0];
  const remove = host.record.observe(value => { snapshot = value; }); remove();
  const closing = host.close();
  await disposalEntered;
  assert.deepEqual(events, ['runtime-detach', 'drain-start']);
  const refused = await host.record.execute({ type: 'refresh', requestId: 'during-drain',
    expected: { providerEpoch: snapshot.providerEpoch, revision: snapshot.revision } });
  assert.equal(refused.status, 'refused');
  release(); await closing;
  assert.deepEqual(events, ['runtime-detach', 'drain-start', 'drain-end', 'sdk-close', 'config-close']);
  await host.close();
  assert.equal(events.filter(event => event === 'sdk-close').length, 1);
});
