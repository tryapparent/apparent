import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeHostPort } from '@apparent/native-host';

async function startTicks(pid: number): Promise<string> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  const end = stat.lastIndexOf(')');
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  if (end < 0 || !/^\d+$/.test(fields[19] ?? '')) throw new Error('Native GUI start identity unavailable');
  return fields[19];
}
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function descendants(pid: number, depth = 0): Promise<number[]> {
  if (depth > 8) throw new Error('Native GUI launch tree exceeds bound');
  const path = `/proc/${pid}/task/${pid}/children`;
  const children = (await readFile(path, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
  if (children.length > 32) throw new Error('Native GUI launch tree is ambiguous');
  const result = [pid];
  for (const child of children) {
    try { result.push(...await descendants(child, depth + 1)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return result;
}

/** Starts the existing root GUI in its adapter-only role, in this launch's
 * dedicated HOME. Never connects to a pre-existing socket or signals by name. */
export async function launchNativeHost(profilePath: string, nativeRoot: string) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Omarchy launch requires Linux x64');
  const home = join(profilePath, 'home');
  if (homedir() !== home || process.env.APPARENT_CONFIG !== join(home, '.config/apparent/config.json')) {
    throw new Error('Launch with the packaged private-profile launcher');
  }
  const uid = process.getuid!();
  const profileStat = await lstat(profilePath);
  if (!profileStat.isDirectory() || profileStat.isSymbolicLink() || profileStat.uid !== uid
    || (profileStat.mode & 0o077) || await realpath(profilePath) !== profilePath) {
    throw new Error('Native GUI profile is not private');
  }
  const homeStat = await lstat(home);
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || homeStat.uid !== uid || (homeStat.mode & 0o077)
    || await realpath(home) !== home) throw new Error('Native GUI home is not private');
  const socket = join(home, '.config/apparent/agent-control/capture.sock');
  // The existing native listener owns lock-checked stale-socket recovery. Do
  // not unlink it here or contact it before joining our own child below.
  try {
    const previous = await lstat(socket);
    if (!previous.isSocket() || previous.uid !== uid || (previous.mode & 0o777) !== 0o600) {
      throw new Error('Unsafe existing Native GUI socket');
    }
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const manifest = JSON.parse(await readFile(join(nativeRoot, 'gui/manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.role !== 'native-host-only' || manifest.entry !== 'Apparent.AppImage'
    || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !/^[a-f0-9]{64}$/.test(manifest.executableSha256)) {
    throw new Error('Native GUI closure identity unavailable');
  }
  const executable = join(nativeRoot, 'gui/Apparent.AppImage');
  if (hash(await readFile(executable)) !== manifest.sha256) throw new Error('Native GUI package changed');
  const child: ChildProcess = spawn(executable, ['--appimage-extract-and-run', 'app', '--native-host-only'], {
    stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env },
  });
  let exited = false;
  let launchError: Error | undefined;
  child.once('error', error => { launchError = error; });
  child.once('exit', () => { exited = true; });
  let owned: { pid: number; ticks: string } | undefined;
  const port = createNativeHostPort();
  // Bounded readiness on this private socket; no clipboard write or permission action.
  for (let attempt = 0; attempt < 30 && !owned; attempt++) {
    if (launchError || exited || !child.pid) throw new Error('Native GUI exited before readiness', { cause: launchError });
    try {
      const candidates: Array<{ pid: number; ticks: string }> = [];
      const unix = await readFile('/proc/net/unix', 'utf8');
      const line = unix.split('\n').find(line => line.trim().split(/\s+/).at(-1) === socket);
      const inode = line?.trim().split(/\s+/)[6];
      if (inode) for (const pid of await descendants(child.pid)) {
        const ticks = await startTicks(pid);
        const fds = await readdir(`/proc/${pid}/fd`);
        let ownsSocket = false;
        for (const fd of fds) {
          try { if (await readlink(`/proc/${pid}/fd/${fd}`) === `socket:[${inode}]`) ownsSocket = true; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (ownsSocket && hash(await readFile(`/proc/${pid}/exe`)) === manifest.executableSha256
          && await startTicks(pid) === ticks) candidates.push({ pid, ticks });
      }
      if (candidates.length > 1) throw new Error('Native GUI socket owner is ambiguous');
      if (candidates.length === 1) {
        const snapshot = await port.readSnapshot();
        if (snapshot.processEpoch.startsWith('process-')) throw new Error('Native GUI has weak incarnation');
        owned = candidates[0];
      }
    } catch (error) {
      if (attempt === 29) throw new Error('Native GUI readiness unresolved; retained launch requires cleanup', { cause: { error, child } });
    }
    if (!owned) await delay(100);
  }
  if (!owned) throw new Error('Native GUI readiness timed out; retained launch requires cleanup', { cause: child });
  const identity = Object.freeze({ ...owned });
  let close: Promise<void> | undefined;
  return { identity,
    close() {
      close ??= (async () => {
        if (await startTicks(identity.pid) !== identity.ticks
          || hash(await readFile(`/proc/${identity.pid}/exe`)) !== manifest.executableSha256) {
          throw new Error('Native GUI incarnation changed; refusing signal');
        }
        process.kill(identity.pid, 'SIGTERM');
        for (let attempt = 0; attempt < 100; attempt++) {
          try { await startTicks(identity.pid); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
          await delay(100);
        }
        throw new Error('Native GUI exit remains unconfirmed');
      })();
      return close;
    },
  };
}
