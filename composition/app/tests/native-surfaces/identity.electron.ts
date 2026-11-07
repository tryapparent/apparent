import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';
import { buildShell, root } from '../../scripts/build.ts';
import { assemble } from '../../scripts/assemble.ts';
import { packageApplication } from '../../scripts/package.ts';
import { linuxStartTicks } from '../../src/native-surfaces/identity.ts';
import type { NativeControlSurfaceIdentity } from '@apparent/app-contracts/native';
const run = promisify(execFile);
const { stopElectron } = createRequire(import.meta.url)('../../../../enablement/native/owned-processes.ts') as {
  stopElectron(application: Awaited<ReturnType<typeof electron.launch>> | undefined): Promise<void>;
};

test('packaged main identifies a hidden native control window and rejects visible or destroyed surfaces', { timeout: 180_000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'native-surface-')));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let sandbox: { path: string; bytes: Buffer; mode: number } | undefined;
  t.after(async () => {
    try { await stopElectron(application); }
    finally {
      if (sandbox) { await rm(sandbox.path); await writeFile(sandbox.path, sandbox.bytes, { mode: sandbox.mode }); await chmod(sandbox.path, sandbox.mode); }
      await rm(directory, { recursive: true, force: true });
    }
  });
  const profile = join(directory, 'profile'); await mkdir(profile, { mode: 0o700 });
  const binding = join(directory, 'binding.ts');
  await writeFile(binding, `
import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecordFixture } from '@apparent/record/fixtures';
import { identifyHiddenControlSurface } from ${JSON.stringify(join(root, 'src/native-surfaces/identity.ts'))};
export async function createRecordHostServices({profilePath}) {
  const surface = new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  await surface.loadURL('about:blank');
  const backend = process.platform === 'darwin' ? 'appkit' : 'x11';
  const identity = identifyHiddenControlSurface(surface,backend);
  const stable = identity === identifyHiddenControlSurface(surface,backend);
  globalThis.__surfaceProof = {surface,identify:(target=surface)=>identifyHiddenControlSurface(target,backend)};
  await writeFile(join(profilePath,'identity.json'),JSON.stringify({identity,stable,hidden:!surface.isVisible(),frozen:Object.isFrozen(identity)&&Object.isFrozen(identity.owner)&&Object.isFrozen(identity.owner.incarnation)&&Object.isFrozen(identity.window)}));
  const fixture = createRecordFixture('unsubscribe-during-recording');
  return {record:fixture.client,async canClose(){return true;},async close(){if(!surface.isDestroyed())surface.destroy();}};
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
  const executablePath = process.platform === 'darwin' ? join(bundle, 'Contents/MacOS/apparent-foundation') : join(bundle, 'apparent-foundation');
  application = await electron.launch({ executablePath, timeout: 20000, args: process.platform === 'linux' ? ['--ozone-platform=x11'] : [],
    env: { ...process.env, APPARENT_FOUNDATION_PROFILE: profile } });
  await expect.poll(() => readFile(join(profile, 'identity.json'), 'utf8').then(JSON.parse, () => null), { timeout: 15000 }).toBeTruthy();
  const observed = JSON.parse(await readFile(join(profile, 'identity.json'), 'utf8')) as {
    identity: NativeControlSurfaceIdentity; stable: boolean; hidden: boolean; frozen: boolean;
  };
  assert.equal(observed.stable, true); assert.equal(observed.hidden, true); assert.equal(observed.frozen, true);
  const identity = observed.identity;
  assert.equal(identity.owner.pid, application.process().pid);
  assert.equal(identity.api, 1); assert(identity.generation > 0);
  assert.notEqual(identity.hostEpoch, identity.surfaceId);
  if (process.platform === 'linux') {
    assert.equal(identity.window.kind, 'x11');
    assert.equal(identity.owner.incarnation.kind, 'linux-proc-start');
    if (identity.owner.incarnation.kind !== 'linux-proc-start') throw new Error('Wrong process clock');
    assert.equal(identity.owner.incarnation.bootId, (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim());
    assert.equal(identity.owner.incarnation.startTicks, linuxStartTicks(await readFile(`/proc/${identity.owner.pid}/stat`, 'utf8')));
    const native = await run('xprop', ['-id', String(identity.window.id), '_NET_WM_PID']);
    assert.match(native.stdout, new RegExp(`= ${identity.owner.pid}\\s*$`));
    const map = await run('xwininfo', ['-id', String(identity.window.id)]);
    assert.match(map.stdout, /Map State: IsUnMapped/);
  } else {
    assert.equal(identity.window.kind, 'cg-window');
    assert.equal(identity.owner.incarnation.kind, 'electron-process-creation-unix-ms');
    // Independent native CGWindow owner/incarnation proof remains a separate Mac gate.
  }
  const visibleRefusal = await application.evaluate(() => {
    const proof = (globalThis as any).__surfaceProof; proof.surface.showInactive();
    try { proof.identify(); return false; } catch { return true; }
  });
  assert.equal(visibleRefusal, true);
  const destroyedRefusal = await application.evaluate(() => {
    const proof = (globalThis as any).__surfaceProof; proof.surface.hide(); proof.surface.destroy();
    try { proof.identify(); return false; } catch { return true; }
  });
  assert.equal(destroyedRefusal, true);
  if (process.platform === 'linux') await assert.rejects(run('xwininfo', ['-id', String(identity.window.id)]));
  const replacement = await application.evaluate(async ({ BrowserWindow }) => {
    const previous = (globalThis as any).__surfaceProof;
    const surface = new BrowserWindow({ show: false,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    try {
      await surface.loadURL('about:blank');
      // The trusted fixture retains the same production observer for this owner.
      return previous.identify(surface);
    } finally { surface.destroy(); }
  });
  assert.equal(replacement.hostEpoch, identity.hostEpoch);
  assert.deepEqual(replacement.owner, identity.owner);
  assert.notEqual(replacement.surfaceId, identity.surfaceId);
  assert(replacement.generation > identity.generation);
});
