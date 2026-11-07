import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { RecordProductionHostOptions } from '../../src/record/production-host.ts';
import type { RecordNativeBindingOptions, RecordNativeBindings } from '../../src/record/native-bindings.ts';

type Factory = typeof import('../../src/record/production-host.ts');
async function controlledNative(create: (input: RecordNativeBindingOptions) => Promise<RecordNativeBindings>,
  inspectCoordinator?: (input: RecordProductionHostOptions['coordinator']) => void): Promise<Factory> {
  const key = `__productionHostTest${Math.random().toString(36).slice(2)}`;
  (globalThis as unknown as Record<string, unknown>)[key] = create;
  const observerKey = key + 'Coordinator';
  (globalThis as unknown as Record<string, unknown>)[observerKey] = inspectCoordinator;
  const actualCoordinator = fileURLToPath(import.meta.resolve('@apparent/record/host/capture2-coordinator'));
  const output = await build({ entryPoints: [fileURLToPath(new URL('../../src/record/production-host.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-native-binding', setup(builder) {
      builder.onResolve({ filter: /^\//, namespace: key }, args => ({ path: args.path, namespace: 'file' }));
      if (inspectCoordinator) {
        builder.onResolve({ filter: /^@apparent\/record\/host\/capture2-coordinator$/ }, () => ({ path: 'coordinator', namespace: key }));
        builder.onLoad({ filter: /^coordinator$/, namespace: key }, () => ({ loader: 'js', contents:
          `import {createStandardRecordCaptureCoordinator as actual} from ${JSON.stringify(actualCoordinator)}; export function createStandardRecordCaptureCoordinator(input) { globalThis[${JSON.stringify(observerKey)}](input); return actual(input); }` }));
      }
      builder.onResolve({ filter: /^\.\/native-bindings\.ts$/ }, () => ({ path: 'binding', namespace: key }));
      builder.onLoad({ filter: /.*/, namespace: key }, () => ({ loader: 'js',
        contents: `export const createRecordNativeBindings = input => globalThis[${JSON.stringify(key)}](input);` }));
    } }] });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${key}`);
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
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const module = await controlledNative(async input => { supplied = input; await barrier; return f.native; }, input => { observed = input; });
  f.options.coordinator.standardProcessing.destination = { session: 'original-session', title: 'original title', via: 'explicit-host' };
  const creating = module.createRecordProductionHost(f.options);
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
  assert.equal(observed.standardProcessing.requestVideoProof, true);
  assert.equal(observed.standardProcessing.destination?.title, 'original title');
  await assert.rejects(stat(join(root, 'substituted-control')), { code: 'ENOENT' });
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
