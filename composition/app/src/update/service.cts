import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { feed, identity, SHA, type ReleaseIdentity, type UpdateState } from './contract.ts';
import { hashFile, ownedImage, paths, readJson } from './files.ts';
import { ticks } from './helper.ts';

// SquashFS resources are immutable packaged inputs, often reported root-owned.
// Sidecars/install targets use the separate strict same-user filesystem checks.
async function packagedIdentity() {
  const bytes = await readFile(join(process.resourcesPath, 'app-shell-release.json'));
  if (bytes.length > 4096) throw new Error('Packaged Main identity exceeds its limit');
  return identity(JSON.parse(bytes.toString()));
}

/** No renderer-supplied URL, path, revision, executable or channel. */
async function runHelper(image: string, running: string, command: 'stage' | 'restart', detached = false) {
  await ownedImage(image);
  const lock = await open(image + '.update.lock', constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await lock.stat();
    if (!stat.isFile() || stat.uid !== process.getuid!() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new Error('Unsafe update lock');
    // flock's fd-only syntax cannot prefix a command. /proc pins its inherited
    // descriptor to the already validated inode instead of reopening a pathname.
    // A just-started app acknowledges readiness while the recovery helper still
    // holds this lock. Give its first check a bounded turn after that handoff.
    const args = [...(command === 'stage' ? ['--wait', '5'] : ['--nonblock']), '--no-fork', '/proc/self/fd/3', process.execPath, join(__dirname, 'updater-helper.cjs'), command, image, running];
    if (detached) args.push(String(process.pid), (await ticks(process.pid))!, JSON.stringify(process.argv.slice(1)));
    const child = spawn('/usr/bin/flock', args, { detached, stdio: ['ignore', 'pipe', 'pipe', lock.fd],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    return await new Promise<{ phase: 'idle' | 'ready'; available: string | null } | undefined>((resolve, reject) => {
      let out = ''; let err = '';
      const timeout = detached ? setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Restart helper did not acquire its lock')); }, 3_000) : undefined;
      child.stdout!.on('data', bytes => {
        out = (out + bytes).slice(0, 4096);
        if (detached && out.trim() === 'ready') {
          clearTimeout(timeout); child.stdout!.destroy(); child.stderr!.destroy(); child.unref(); resolve(undefined);
        }
      });
      child.stderr!.on('data', bytes => { err = (err + bytes).slice(0, 4096); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => {
        clearTimeout(timeout);
        if (code !== 0 || detached) { reject(new Error(err || 'Another update transaction is running')); return; }
        try {
          const result = JSON.parse(out);
          if (!['idle', 'ready'].includes(result.phase) || (result.phase === 'idle' ? result.available !== null : !SHA.test(result.available))) throw new Error('Invalid updater response');
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
  } finally { await lock.close(); }
}

/** Apply downloaded bytes only before creating any host/native capture authority. */
export async function applyPendingAtLaunch() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || !app.isPackaged || !process.env.APPIMAGE) return false;
  const image = process.env.APPIMAGE;
  try {
    const release = await packagedIdentity();
    const pending = await readJson(paths(image).pendingInfo);
    if (!pending || (pending as { sourceSha: string }).sourceSha === release.sourceSha) return false;
    const candidate = feed(pending, release.sourceSha);
    if ((await readJson(paths(image).failed) as { sourceSha: string } | undefined)?.sourceSha === candidate.sourceSha) return false;
    if (await hashFile(paths(image).pending) !== candidate.image.sha256) throw new Error('Staged image changed; retaining current app');
    await runHelper(image, release.sourceSha, 'restart', true);
    return true;
  } catch (error) { console.error('Pending Main update could not start; retaining current app', error); return false; }
}

export async function bindUpdater(window: BrowserWindow, entryUrl: string) {
  let release: ReleaseIdentity | undefined;
  const image = process.env.APPIMAGE;
  let state: UpdateState = { channel: 'main', running: null, available: null,
    phase: process.platform === 'linux' && process.arch === 'x64' ? 'not-installed' : 'unsupported',
    message: 'Automatic Main updates require the Linux x64 AppImage.' };
  if (state.phase === 'not-installed' && app.isPackaged && image) {
    try {
      release = await packagedIdentity();
      await ownedImage(image);
      state = { ...state, running: release.sourceSha, phase: 'idle', message: 'Main checks automatically at launch and hourly.' };
    } catch (error) { console.error('Main updater unavailable', error); }
  }
  let active = true; let intent = false; let checking: Promise<UpdateState> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const allowed = (event: IpcMainInvokeEvent) => {
    try { return active && !window.isDestroyed() && event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === entryUrl; }
    catch { return false; }
  };
  const helper = (command: 'stage' | 'restart', detached = false) => runHelper(image!, release!.sourceSha, command, detached);
  const check = () => {
    if (checking) return checking;
    if (!release || !active || intent) return Promise.resolve({ ...state });
    state = { ...state, phase: 'checking', message: 'Checking and downloading the latest verified Main build…' };
    checking = (async () => {
      try {
        const result = (await helper('stage'))!;
        state = { ...state, ...result, message: result.phase === 'ready' ? 'Update downloaded. Restart when you are ready.' : 'You have the latest published Main build.' };
      } catch (error) {
        console.error('Main update check failed', error);
        state = { ...state, phase: 'error', message: 'Update check failed. Your current app is unchanged; try again.' };
      } finally { checking = undefined; }
      return { ...state };
    })();
    return checking;
  };
  const refused = () => {
    if (intent) { intent = false; state = { ...state, phase: 'ready', message: 'Finish the active capture and its cleanup before restarting.' }; }
  };
  const handlers: Array<[string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown]> = [
    ['read', () => ({ ...state })], ['check', () => { void check(); return { ...state }; }],
    ['restart', async () => {
      if (state.phase !== 'ready' || intent) throw new Error('No update is ready');
      const candidate = feed(await readJson(paths(image!).pendingInfo), release!.sourceSha);
      if (await hashFile(paths(image!).pending) !== candidate.image.sha256) throw new Error('Staged image changed; check for updates again');
      intent = true; state = { ...state, phase: 'restarting', message: 'Waiting for safe shutdown…' }; window.close();
    }],
    ['ready', async () => {
      const path = process.env.APPARENT_SHELL_UPDATE_READY;
      if (path && image && release) {
        if (dirname(path) !== dirname(image) || !/^\.app-shell-ready-[a-f0-9-]{36}$/.test(basename(path))) throw new Error('Invalid readiness path');
        const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(release.sourceSha); await handle.sync(); await handle.close();
      }
      if (release && !timer) { void check(); timer = setInterval(() => { void check(); }, 3600_000); timer.unref(); }
    }],
  ];
  for (const [operation, handler] of handlers) ipcMain.handle(`apparent:updates:${operation}`, (event, ...args) => {
    if (args.length || !allowed(event)) throw new Error('Update request refused');
    return handler(event);
  });
  const revoke = () => {
    if (!active) return;
    active = false; if (timer) clearInterval(timer);
    for (const [operation] of handlers) ipcMain.removeHandler(`apparent:updates:${operation}`);
  };
  window.webContents.on('will-navigate', (_event, url) => { if (url !== entryUrl) { intent = false; revoke(); } });
  window.once('closed', revoke);
  return { refused, async closed() {
    revoke();
    if (intent) { await checking; await helper('restart', true); }
  } };
}
