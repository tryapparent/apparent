import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect } from '@playwright/test';
import { buildShell, root } from '../scripts/build.ts';
import { assemble, verifyAssembly } from '../scripts/assemble.ts';
import { packageApplication } from '../scripts/package.ts';
import { build } from 'esbuild';
const { stopElectron } = createRequire(import.meta.url)('../../../enablement/native/owned-processes.ts') as {
  stopElectron(application: Awaited<ReturnType<typeof electron.launch>> | undefined): Promise<void>;
};

test('packaged Record provider retains unresolved runtime and closes only after authoritative reconciliation',
  { timeout: 180_000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'record-provider-electron-')));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let sandbox: { path: string; bytes: Buffer; mode: number } | undefined;
  t.after(async () => {
    try { await stopElectron(application); }
    finally {
      if (sandbox) { await rm(sandbox.path); await writeFile(sandbox.path, sandbox.bytes, { mode: sandbox.mode }); await chmod(sandbox.path, sandbox.mode); }
      await rm(directory, { recursive: true, force: true });
    }
  });
  const binding = join(directory, 'binding.ts');
  const nativeFixture = join(directory, 'native-bindings.ts');
  await writeFile(nativeFixture, `
import {writeFile} from 'node:fs/promises';
export async function createRecordNativeBindings(options) {
  const never=()=>{throw new Error('No native effect authorized');};
  return {native:{async readFacts(){return {version:1,providerEpoch:'recovery-synthetic-native',revision:0,readiness:[],shortcut:{effective:null,label:null,registration:'unknown',externallyManaged:false,draft:null}};}},
    penConfig:{async read(){return {persisted:null,effective:null};},writeApplyAndReadBack:never},clipboard:{copyLocal:never},
    async close(){await writeFile(options.config.configPath+'.closed','closed');}};
}`);
  const recoveryFactory = join(directory, 'recovery-factory.mjs');
  await build({entryPoints:[join(root,'src/record/production-host.ts')],bundle:true,platform:'node',format:'esm',
    target:'node22',outfile:recoveryFactory,plugins:[{name:'synthetic-native-producers',setup(builder){
      builder.onResolve({filter:/^\.\/native-bindings\.ts$/},()=>({path:nativeFixture}));
    }}]});

  // Real public Record provider and production host lifecycle. Only Engine/native
  // producers are synthetic: this proves transport/ownership, not OS effects.
  await writeFile(binding, `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CaptureClient, preflightCapturePublication } from '@apparent/engine-sdk/capture';
import { createRecordPublicationOutput } from '@apparent/record/publication';
import { createStandardRecordCaptureCoordinator } from '@apparent/record/host/capture2-coordinator';
import { bindRecordCoordinatorHost } from ${JSON.stringify(join(root, 'src/record/coordinator-host.ts'))};
import { createRecordProviderHost } from ${JSON.stringify(join(root, 'src/record/provider-host.ts'))};
import { createRecordRecoveryProductionHost } from ${JSON.stringify(recoveryFactory)};
export async function createRecordHostServices({profilePath}) {
  let outputDispatches = 0;
  const sdk = new CaptureClient({async request() { outputDispatches++; throw new Error('No native operation admitted'); }, async close() {return 'already-exited';}});
  const output = createRecordPublicationOutput(sdk,join(profilePath,'publication-output'),preflightCapturePublication);
  await writeFile(join(profilePath,'public-output.json'),JSON.stringify({facts:await output.captureFacts.readFacts(),handoff:await output.resolveHandoff({captureId:'unknown-request',artifactId:'unknown-bundle'}),outputDispatches}));
  await sdk.close();
  const never = () => { throw new Error('No capture or processing dispatch admitted'); };
  const flow = await createStandardRecordCaptureCoordinator({
    captureClient: {async handshake() {return {implementation:'native',readiness:'unavailable',capabilities:{}};}}, mediaClient:{},
    mappingRoot:join(profilePath,'coordinator-mappings'),bundleRoot:join(profilePath,'bundles'),privateControlRoot:join(profilePath,'coordinator-control'),
    createStartIntent:never,trustedMaterialsRoot:never,standardProcessing:{requestVideoProof:true},preflight:preflightCapturePublication,
  });
  const coordinatedCounts = {sdk:0,config:0};
  const coordinatedHost = bindRecordCoordinatorHost({coordinator:flow,nativeBindings:{
    native:{async readFacts(){return {version:1,providerEpoch:'no-native',revision:0,readiness:[],shortcut:{effective:null,label:null,registration:'unknown',externallyManaged:false,draft:null}};}},
    penConfig:{async read(){return {persisted:null,effective:null};},writeApplyAndReadBack:never},clipboard:{copyLocal:never},async close(){coordinatedCounts.config++;},
  },async shutdownOtherRuntimeUsers(){return 'clear';},async closeEngine(){coordinatedCounts.sdk++;}});
  await flow.reconcile();
  const coordinatorFacts = await flow.captureFacts.readFacts();
  const canClose = await coordinatedHost.canClose();
  const beforeClose = {...coordinatedCounts};
  const report = coordinatedHost.shutdownReport();
  await coordinatedHost.close();
  await coordinatedHost.close();
  await writeFile(join(profilePath,'public-coordinator.json'),JSON.stringify({canClose,beforeClose,afterClose:coordinatedCounts,report,reservation:coordinatorFacts.nextShortcutAdmission}));
  const releaseCounts = {capture:0,media:0,owningClose:0};
  const releaseReceipt=id=>({scope:'client-connection',peerId:id,connection:'released',inputClosure:'unconfirmed',runtimeClearance:'not-established',reconcile:'original-capture-materials-job-publication-bindings'});
  const peer=(client,channel,peerId,slot)=>({client,lifetime:{schema:'apparent.engine-recovery-peer/1',channel,peerId,implementation:'native',role:'recovery',startsFreshCapture:false,onInputEof:'retain-admitted-finite-work'},async release(){releaseCounts[slot]++;return releaseReceipt(peerId);}});
  const forbiddenClose=async()=>{releaseCounts.owningClose++;throw new Error('Recovery client.close is forbidden');};
  const capturePeer=peer({async handshake(){return {implementation:'native',readiness:'unavailable',capabilities:{}};},close:forbiddenClose},'capture/2','packaged-capture-peer','capture');
  const mediaPeer=peer({close:forbiddenClose},'media/2','packaged-media-peer','media');
  const recoveredHost=await createRecordRecoveryProductionHost({peers:{capture:capturePeer,media:mediaPeer},
    coordinator:{mappingRoot:join(profilePath,'recovery-mappings'),bundleRoot:join(profilePath,'recovery-bundles'),privateControlRoot:join(profilePath,'recovery-control'),createStartIntent:never,trustedMaterialsRoot:never,standardProcessing:{requestVideoProof:true}},
    native:{requiredPermissionIds:[],config:{executable:'/synthetic-not-launched',executableSha256:'a'.repeat(64),configPath:join(profilePath,'recovery-config')}},
    async shutdownOtherRuntimeUsers(){return 'clear';}});
  const recoveredCanClose=await recoveredHost.canClose();
  await recoveredHost.close();
  await writeFile(join(profilePath,'public-recovery.json'),JSON.stringify({canClose:recoveredCanClose,report:recoveredHost.shutdownReport(),release:recoveredHost.recoveryRelease(),counts:releaseCounts}));
  let reconciliation = 'pending';
  const counts = { dispatch: 0, dispose: 0, engine: 0, native: 0 };
  const listeners = new Set();
  const state = { phase: 'idle', readiness: {ready: false, reason: 'Synthetic runtime not reconciled'} };
  const runtime = {
    state, startup: {state: 'ready', knownRequestIds: []},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async dispatch() { counts.dispatch++; reconciliation = 'complete'; for (const listener of listeners) listener(state); return state; },
    async reconcileStartup() { return {state: 'ready', knownRequestIds: []}; },
    unresolvedOwnership() { return {requestIds: [], storageUnavailable: false, reconciliation}; },
    dispose() { counts.dispose++; listeners.clear(); return this.unresolvedOwnership(); },
  };
  return createRecordProviderHost({runtime, nativeBindings: {
    native: {async readFacts() { return { version: 1, providerEpoch: 'synthetic-native', revision: 1,
      readiness: [], shortcut: {effective: null, label: null, registration: 'unknown', externallyManaged: false, draft: null} }; }},
    penConfig: {async read() { return {persisted: null, effective: null}; }, async writeApplyAndReadBack() { return {status: 'unknown', effective: null}; }},
    clipboard: {async copyLocal() { return {status: 'refused', reason: 'not-saved'}; }},
    async close() { counts.native++; await writeFile(join(profilePath, 'closed.json'), JSON.stringify(counts)); },
  }, async closeEngine() { counts.engine++; }});
}
`);
  const shell = join(directory, 'shell');
  await buildShell(shell, undefined, { module: binding });
  const assembled = await assemble(shell, [], join(directory, 'app'));
  const bundle = await packageApplication(assembled, join(directory, 'packages'));
  const helper = process.env.APPARENT_FOUNDATION_SANDBOX_HELPER;
  if (process.platform === 'linux' && helper) {
    const metadata = await stat(helper);
    assert(metadata.isFile() && metadata.uid === 0 && (metadata.mode & 0o4000) && !(metadata.mode & 0o022));
    const target = join(bundle, 'chrome-sandbox');
    sandbox = { path: target, bytes: await readFile(target), mode: (await stat(target)).mode & 0o777 };
    await rm(target); await symlink(helper, target);
  }
  const payload = process.platform === 'darwin' ? join(bundle, 'Contents/Resources/app') : join(bundle, 'resources/app');
  await verifyAssembly(payload);
  const executablePath = process.platform === 'darwin' ? join(bundle, 'Contents/MacOS/apparent-foundation') : join(bundle, 'apparent-foundation');
  const profile = join(directory, 'profile'); await mkdir(profile, { mode: 0o700 });
  application = await electron.launch({ executablePath, args: [], env: { ...process.env, APPARENT_FOUNDATION_PROFILE: profile } });
  const page = application.windows()[0] ?? await application.waitForEvent('window');
  await expect(page.getByRole('heading', { name: 'Apparent Foundation' })).toBeVisible();
  await page.evaluate(() => { (window as any).apparent.host.observeCloseRefusal((reason: string) => { document.body.dataset.closeReason = reason; }); });
  const initial = await page.evaluate(() => (window as any).apparent.record.read());
  assert.equal(initial.connection, 'connected');
  const publicOutput = JSON.parse(await readFile(join(profile, 'public-output.json'), 'utf8'));
  assert.deepEqual(publicOutput.facts.captures, []);
  assert.deepEqual(publicOutput.facts.nextShortcutAdmission, { state: 'unavailable' });
  assert.equal(publicOutput.handoff, null);
  assert.equal(publicOutput.outputDispatches, 0);
  const coordinated = JSON.parse(await readFile(join(profile, 'public-coordinator.json'), 'utf8'));
  assert.equal(coordinated.canClose, true);
  assert.deepEqual(coordinated.beforeClose, {sdk:0,config:0});
  assert.deepEqual(coordinated.afterClose, {sdk:1,config:1});
  assert.deepEqual(coordinated.reservation, {state:'unavailable'});
  assert.equal(coordinated.report.scope, 'record-coordinator');
  assert.equal(coordinated.report.admission, 'closed');
  assert.equal(coordinated.report.localDrain, 'complete');
  assert.equal(coordinated.report.runtimeClearance, 'clear');
  assert.equal(coordinated.report.nextShortcutAdmission.state, 'unsupported');
  assert.deepEqual(coordinated.report.work, []);
  const recovered = JSON.parse(await readFile(join(profile, 'public-recovery.json'), 'utf8'));
  assert.equal(recovered.canClose, true);
  assert.equal(recovered.report.runtimeClearance, 'clear');
  assert.equal(recovered.release.state, 'released');
  assert.equal(recovered.release.capture.receipt.inputClosure, 'unconfirmed');
  assert.equal(recovered.release.capture.receipt.runtimeClearance, 'not-established');
  assert.equal(recovered.release.media.receipt.runtimeClearance, 'not-established');
  assert.deepEqual(recovered.counts, {capture:1,media:1,owningClose:0});
  assert.equal(await readFile(join(profile, 'recovery-config.closed'), 'utf8'), 'closed');
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await expect(page.locator('body')).toHaveAttribute('data-close-reason', 'ownership-unresolved');
  assert.equal(await readFile(join(profile, 'closed.json')).then(() => true, () => false), false);
  const result = await page.evaluate(async () => {
    const port = (window as any).apparent.record;
    const snapshot = await port.read();
    return port.execute({ type: 'refresh', requestId: 'reconcile-runtime', expected: {providerEpoch: snapshot.providerEpoch, revision: snapshot.revision} });
  });
  assert.equal(result.status, 'accepted');
  const exited = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await exited; application = undefined;
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'closed.json'), 'utf8')), {dispatch: 1, dispose: 1, engine: 1, native: 1});
});
