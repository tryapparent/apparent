import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCapture2RecordRuntime } from '@apparent/record/host/capture2-runtime';
import type { Capture2Event, Capture2Host, Capture2Receipt } from '@apparent/record/host/capture2';
import type { RecordCaptureCoordinator } from '@apparent/record/host/capture2-coordinator';
import { createRecordCapabilityProvider } from '@apparent/record/capabilities';
import { bindRecordCoordinatorHost } from '../../src/record/coordinator-host.ts';
import type { RecordNativeBindings } from '../../src/record/native-bindings.ts';
import { recordShutdownEvent } from '../../src/record/omarchy/shutdown-diagnostic.ts';

test('installed runtime reproduces cached ownership refusal after asynchronous Stop completion and records the exact preflight', async t => {
  const events: Array<{ stage: string; ownership?: { requestIds: string[] } }> = [];
  t.mock.method(console, 'error', (prefix: string, value: string) => {
    assert.equal(prefix, '[record-shutdown]'); events.push(JSON.parse(value));
  });
  const source = { id: 'a'.repeat(32), generation: 'b'.repeat(32), kind: 'display' as const,
    displayId: 1, bounds: { x: 0, y: 0, width: 1280, height: 800, scale: 1 } };
  let receipt: Capture2Receipt = { requestId: 'public-request', phase: 'recording' };
  let observe!: (event: Capture2Event) => void, reconciliations = 0;
  const producer: Capture2Host = {
    async readiness() { return { ready: true }; },
    async discoverSources() { return { state: 'available', sources: [source] }; },
    async start() { return receipt; }, async inspect() { return receipt; },
    async stop() { receipt = { ...receipt, phase: 'stopping' }; return receipt; },
    async cancel() { throw new Error('No cancellation authorized'); },
    async reconcile() { return ++reconciliations === 1 ? [] : [receipt]; },
    subscribe(listener) { observe = listener; return () => {}; }, dispose() {},
  };
  const runtime = await createCapture2RecordRuntime({ host: producer, pollIntervalMs: 10000,
    createStartIntent: () => ({ source, options: { audio: 'none', localOnly: true },
      invocation: { kind: 'explicit', invocationId: 'c'.repeat(32), observedAtMs: 1000 },
      destinationPath: '/synthetic/not-created.apparent' }) });
  t.after(async () => { runtime.dispose(); await runtime.drainObservation(); });
  await runtime.startCapture(receipt.requestId); await runtime.dispatch({ type: 'stop' });
  receipt = { ...receipt, phase: 'materials-ready' }; observe({ type: 'capture-changed', receipt });
  assert.equal(runtime.state.phase, 'processing');
  assert(runtime.unresolvedOwnership().requestIds.includes(receipt.requestId));
  let shutdownCalls = 0;
  const captureFacts: RecordCaptureCoordinator['captureFacts'] = { async readFacts() {
    return { version: 1, providerEpoch: 'synthetic-output', revision: 1, nextShortcutAdmission: { state: 'unavailable' },
      captures: [{ captureId: receipt.requestId, phase: 'saved', artifactId: 'synthetic-bundle', delivery: 'unknown',
        outcomes: [{ kind: 'save', at: '2026-11-07T00:00:00.000Z', ok: true }] }] };
  } };
  const flow: RecordCaptureCoordinator = {
    runtime, capture2Start: runtime, captureFacts,
    createProvider(ports) { return createRecordCapabilityProvider({ ...ports, runtime, capture2Start: runtime, captureFacts }); },
    async shutdown() { shutdownCalls++; throw new Error('Preflight must refuse before terminal inspection'); },
    async dispose() {}, async resolveHandoff() { return null; }, async reconcile() {},
    processingIssues: () => [], observeProcessingIssues() { return () => {}; },
  };
  const bindings: RecordNativeBindings = {
    native: { async readFacts() { return { version: 1, providerEpoch: 'synthetic-native', revision: 0, readiness: [],
      shortcut: { effective: null, label: null, registration: 'unknown', externallyManaged: false, draft: null } }; } },
    penConfig: { async read() { return { persisted: null, effective: null }; }, async writeApplyAndReadBack() { throw new Error('No effect authorized'); } },
    clipboard: { async copyLocal() { throw new Error('No clipboard effect authorized'); } }, async close() { assert.fail('No clearance'); },
  };
  const host = bindRecordCoordinatorHost({ coordinator: flow, nativeBindings: bindings,
    async shutdownOtherRuntimeUsers() { assert.fail('Preflight refused'); }, async closeEngine() { assert.fail('No clearance'); } });
  t.after(() => host.record.detach());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await host.canClose(), false);
  assert.equal(shutdownCalls, 0); assert.equal(host.shutdownReport(), undefined);
  assert(events.find(event => event.stage === 'coordinator-preflight')?.ownership?.requestIds.includes(receipt.requestId));
  assert(events.some(event => event.stage === 'preflight-refused'));
  // This establishes a causal offline case, not attribution of the retained native
  // run: that run did not log whether close reached this boundary.
  await runtime.reconcileStartup(); assert.deepEqual(runtime.unresolvedOwnership().requestIds, []);
});

test('diagnostic serialization and output failures never change ownership decisions', t => {
  t.mock.method(console, 'error', () => { throw new Error('closed log stream'); });
  assert.doesNotThrow(() => recordShutdownEvent('synthetic-log-failure'));
  const circular: { self?: unknown } = {}; circular.self = circular;
  assert.doesNotThrow(() => recordShutdownEvent('synthetic-serialization-failure', circular));
});
