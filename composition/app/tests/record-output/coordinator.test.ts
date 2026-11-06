import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureClient } from '@apparent/engine-sdk/capture';
import { preflightCapturePublication } from '@apparent/engine-sdk/capture';
import type { Media2Client } from '@apparent/engine-sdk/media2';
import { createRecordCaptureCoordinator, type RecordCaptureCoordinator, type RecordCaptureCoordinatorShutdownReport } from '@apparent/record/host/capture2-coordinator';
import { createRecordCapabilityProvider, type CapabilitySnapshot } from '@apparent/record/capabilities';
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

const clearReport = (): RecordCaptureCoordinatorShutdownReport => ({ scope: 'record-coordinator', admission: 'closed',
  localDrain: 'complete', runtimeClearance: 'clear', nextShortcutAdmission: { state: 'unsupported', reason: 'no coordinator shortcut producer' }, work: [] });

test('admitted coordinator clears its own empty scope without changing unavailable reservation facts', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shell-coordinator-')));
  let flow: RecordCaptureCoordinator | undefined;
  t.after(async () => { await flow?.dispose(); await rm(root, { recursive: true, force: true }); });
  const unexpected = () => { throw new Error('No capture, selection, material or publication dispatch authorized'); };
  flow = await createRecordCaptureCoordinator({
    captureClient: { async handshake() { return { implementation: 'native', readiness: 'unavailable', capabilities: {} }; } } as unknown as CaptureClient,
    mediaClient: {} as Media2Client,
    mappingRoot: join(root, 'mappings'), bundleRoot: join(root, 'bundles'), privateControlRoot: join(root, 'control'),
    createStartIntent: unexpected, trustedMaterialsRoot: unexpected, selectProcessing: unexpected,
    preflight: preflightCapturePublication,
  });
  let engineClosed = 0, configClosed = 0;
  const host = bindRecordCoordinatorHost({ coordinator: flow, nativeBindings: bindings(() => configClosed++),
    async shutdownOtherRuntimeUsers() { return 'clear'; }, // This fixture constructs the only SDK users.
    async closeEngine() { engineClosed++; } });
  await flow.reconcile();
  assert.deepEqual(host.processingIssues(), []);
  assert.equal(await flow.resolveHandoff({ captureId: 'unknown', artifactId: 'unknown' }), null);
  assert.deepEqual((await flow.captureFacts.readFacts()).nextShortcutAdmission, { state: 'unavailable' });
  assert.equal(await host.canClose(), true);
  assert.equal(host.shutdownReport()?.scope, 'record-coordinator');
  assert.equal(host.shutdownReport()?.runtimeClearance, 'clear');
  assert.equal(host.shutdownReport()?.nextShortcutAdmission.state, 'unsupported');
  assert.equal(engineClosed, 0, 'clearance does not close a caller-owned SDK itself');
  await assert.rejects(flow.captureFacts.readFacts(), /closing|disposed/);
  await host.close(); await host.close();
  assert.equal(engineClosed, 1); assert.equal(configClosed, 1);
});

function fixture(options: {
  report?: RecordCaptureCoordinatorShutdownReport;
  active?: boolean;
  nativeRead?(): Promise<void>;
  shutdown?(): Promise<void>;
  dispose?(): Promise<void>;
  other?(): Promise<'clear' | 'unresolved' | 'unknown'>;
} = {}) {
  const events: string[] = [];
  let active = options.active ?? false;
  const readiness = { ready: false as const, reason: 'Synthetic capture producer' };
  let state: RecordCaptureCoordinator['runtime']['state'] = active
    ? { phase: 'recording', captureId: 'active-capture', readiness } : { phase: 'idle', readiness };
  const listeners = new Set<(value: typeof state) => void>();
  const runtime: RecordCaptureCoordinator['runtime'] = {
    get state() { return state; }, startup: { state: 'ready', knownRequestIds: [] },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async dispatch(command) {
      if (command.type === 'stop') { active = false; state = { phase: 'cancelled', captureId: 'active-capture', readiness }; }
      for (const listener of listeners) listener(state);
      return state;
    },
    async reconcileStartup() { return this.startup; },
    unresolvedOwnership() { return { requestIds: active ? ['active-capture'] : [], storageUnavailable: false, reconciliation: 'complete' }; },
    dispose() { events.push('runtime-detach'); return this.unresolvedOwnership(); },
    async startCapture() { throw new Error('Unexpected start'); },
  };
  const captureFacts: RecordCaptureCoordinator['captureFacts'] = { async readFacts() {
    return { version: 1, providerEpoch: 'fixture-output', revision: 1, captures: [], nextShortcutAdmission: { state: 'unavailable' } };
  } };
  const flow: RecordCaptureCoordinator = {
    runtime, capture2Start: runtime, captureFacts,
    async resolveHandoff() { return null; },
    createProvider(ports) { return createRecordCapabilityProvider({ ...ports, runtime, capture2Start: runtime, captureFacts }); },
    async shutdown() { events.push('shutdown-start'); await options.shutdown?.(); events.push('shutdown-end'); return options.report ?? clearReport(); },
    async dispose() { events.push('dispose-start'); await options.dispose?.(); events.push('dispose-end'); },
    async reconcile() {}, processingIssues: () => [], observeProcessingIssues() { return () => {}; },
  };
  const native = bindings(() => events.push('config-close'));
  const read = native.native.readFacts.bind(native.native);
  native.native.readFacts = async () => { await options.nativeRead?.(); return read(); };
  const host = bindRecordCoordinatorHost({ coordinator: flow, nativeBindings: native,
    async shutdownOtherRuntimeUsers() { events.push('other-users'); return options.other ? options.other() : 'clear'; },
    async closeEngine() { events.push('sdk-close'); } });
  const snapshot = (): CapabilitySnapshot => {
    let current!: CapabilitySnapshot;
    const off = host.record.observe(value => { current = value; }); off(); return current;
  };
  return { host, flow, events, snapshot };
}

test('terminal inspection and disposal settle before SDK closure; concurrent close seals later commands', { timeout: 2000 }, async () => {
  let release!: () => void, entered!: () => void;
  const atDispose = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ async dispose() { entered(); await pending; } });
  const snapshot = f.snapshot();
  const closing = f.host.close();
  const concurrent = f.host.canClose();
  await atDispose;
  assert.deepEqual(f.events, ['other-users', 'shutdown-start', 'shutdown-end', 'dispose-start']);
  const result = await f.host.record.execute({ type: 'refresh', requestId: 'during-drain', expected: {
    providerEpoch: snapshot.providerEpoch, revision: snapshot.revision } });
  assert.equal(result.status, 'refused');
  release(); await closing; assert.equal(await concurrent, true);
  assert.deepEqual(f.events, ['other-users', 'shutdown-start', 'shutdown-end', 'dispose-start', 'dispose-end', 'runtime-detach', 'sdk-close', 'config-close']);
  await f.host.close(); assert.equal(f.events.filter(event => event === 'sdk-close').length, 1);
});

test('host drains admitted native commands before terminal coordinator inspection', { timeout: 2000 }, async () => {
  let block = false, release!: () => void, entered!: () => void;
  const atNativeRead = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ async nativeRead() { if (block) { entered(); await pending; } } });
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = f.snapshot(); block = true;
  const command = f.host.record.execute({ type: 'refresh', requestId: 'admitted-native', expected: {
    providerEpoch: snapshot.providerEpoch, revision: snapshot.revision } });
  await atNativeRead;
  const closing = f.host.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.events, [], 'no terminal inspection or SDK close while native command is admitted');
  release(); await command; await closing;
  assert.equal(f.events.at(-2), 'sdk-close'); assert.equal(f.events.at(-1), 'config-close');
});

test('known active capture refuses nonterminal preflight and preserves Stop controls', async () => {
  const f = fixture({ active: true });
  assert.equal(await f.host.canClose(), false);
  assert.equal(f.events.length, 0, 'must not call terminal shutdown as an active-capture probe');
  const snapshot = f.snapshot();
  const result = await f.host.record.execute({ type: 'stop-capture', captureId: 'active-capture', requestId: 'owned-stop', expected: {
    providerEpoch: snapshot.providerEpoch, revision: snapshot.revision } });
  assert.equal(result.status, 'accepted');
  assert.equal(await f.host.canClose(), true);
  await f.host.close(); assert(f.events.includes('sdk-close'));
});

test('unknown or inconsistent coordinator reports retain SDKs without reopening terminal admission', async () => {
  for (const report of [
    { ...clearReport(), runtimeClearance: 'unknown' as const },
    { ...clearReport(), runtimeClearance: 'unresolved' as const },
    { ...clearReport(), work: [{ owner: 'publication' as const, state: 'pending' as const, reason: 'reserved' }] },
    { ...clearReport(), scope: 'other-owner' } as unknown as RecordCaptureCoordinatorShutdownReport,
  ]) {
    const f = fixture({ report });
    assert.equal(await f.host.canClose(), false);
    assert(!f.events.includes('sdk-close')); assert(!f.events.includes('config-close'));
    await assert.rejects(f.host.close(), /retains unresolved runtime ownership/);
    assert.equal(await f.host.canClose(), false);
    assert.equal(f.events.filter(event => event === 'shutdown-start').length, 1, 'terminal inspection is not blindly retried');
  }
});

test('Record-only clear report never clears another SDK or runtime owner', async () => {
  for (const other of [async () => 'unknown' as const, async () => 'unresolved' as const, async () => { throw new Error('owner unreadable'); }]) {
    const f = fixture({ other });
    assert.equal(await f.host.canClose(), false);
    assert.equal(f.host.shutdownReport()?.runtimeClearance, 'clear', 'report scope remains Record only');
    assert(!f.events.includes('sdk-close')); assert(!f.events.includes('config-close'));
    await assert.rejects(f.host.close(), /retains unresolved runtime ownership/);
  }
});
