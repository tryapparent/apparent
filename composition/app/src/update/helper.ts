/** Runs under util-linux flock, using the packaged Electron's Node runtime. */
import { constants } from 'node:fs';
import { copyFile, open, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { feed, MAIN_FEED, SHA, type MainFeed } from './contract.ts';
import { atomicJson, hashFile, ownedFile, ownedImage, paths, readJson } from './files.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Fetcher = (url: string, options: { signal: AbortSignal }) => Promise<{ ok: boolean; body: AsyncIterable<Uint8Array> | null }>;
/** curl preserves the system's HTTPS proxy/CA configuration, including on Omarchy. */
const download: Fetcher = async (url, { signal }) => {
  const child = spawn('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
    '--connect-timeout', '10', '--max-time', '300', '--max-filesize', String(1024 ** 3), '--user-agent', 'Apparent-Foundation', '--url', url],
  { stdio: ['ignore', 'pipe', 'ignore'], signal });
  const settled = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  void settled.catch(() => {});
  return { ok: true, body: (async function* () {
    try { for await (const chunk of child.stdout!) yield chunk as Buffer;
      if (await settled !== 0) throw new Error('HTTPS download failed');
    } finally { if (child.exitCode === null) child.kill('SIGTERM'); }
  })() };
};
export async function ticks(pid: number) {
  try { return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1)!.split(' ')[19]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function jsonResponse(response: Awaited<ReturnType<Fetcher>>) {
  if (!response.ok || !response.body) throw new Error('Main feed unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of response.body) { if ((size += chunk.length) > 4 * 1024 * 1024) throw new Error('Main feed exceeds its limit'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function stage(image: string, running: string, fetcher: Fetcher = download) {
  await ownedImage(image);
  if (!SHA.test(running)) throw new Error('Unknown running Main revision');
  const p = paths(image);
  const installed = await readJson(p.installed) as { sourceSha: string } | undefined;
  const current = installed?.sourceSha ?? running;
  const release = feed(await jsonResponse(await fetcher(MAIN_FEED, { signal: AbortSignal.timeout(30_000) })), current);
  // Revalidate a staged image's ancestry before replacing it with another candidate.
  const pending = await readJson(p.pendingInfo) as MainFeed | undefined;
  if (pending) feed(release, pending.sourceSha);
  const failed = await readJson(p.failed) as { sourceSha: string } | undefined;
  if (failed?.sourceSha === release.sourceSha) throw new Error('This update failed to start; waiting for a newer Main build');
  if (release.sourceSha === current) return { phase: 'idle' as const, available: null };
  if (pending?.sourceSha === release.sourceSha) {
    try { if (await hashFile(p.pending) === release.image.sha256) return { phase: 'ready' as const, available: release.sourceSha }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const temporary = join(dirname(image), `.app-shell-download-${randomUUID()}`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o700);
  try {
    const response = await fetcher(release.image.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error('Main image download failed');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of response.body) {
      if ((size += chunk.length) > release.image.size) throw new Error('Main image exceeds its declared size');
      hash.update(chunk); await handle.writeFile(chunk);
    }
    if (size !== release.image.size || hash.digest('hex') !== release.image.sha256) throw new Error('Main image checksum mismatch');
    await handle.sync(); await handle.close();
    // Refuse aliases even though rename itself does not follow a final symlink.
    try { await ownedFile(p.pending); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // The runtime handles this argument without creating an app or capture host.
    const preflightEnv = { ...process.env };
    // This is a runtime query, not an app launch. Extract-and-run would unpack
    // the whole image first and exceed the bounded output before answering it.
    delete preflightEnv.APPIMAGE_EXTRACT_AND_RUN;
    await promisify(execFile)(temporary, ['--appimage-version'], { timeout: 5_000, maxBuffer: 4096, env: preflightEnv });
    await rename(temporary, p.pending);
    await atomicJson(p.pendingInfo, release);
    return { phase: 'ready' as const, available: release.sourceSha };
  } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function restart(image: string, running: string, parent: number, parentTicks: string, options: {
  readinessMs?: number; args?: string[]; launch?: (image: string, ready: string) => ReturnType<typeof spawn>;
} = {}) {
  if (!Number.isSafeInteger(parent) || parent <= 1 || !/^\d+$/.test(parentTicks) || !SHA.test(running)) throw new Error('Invalid restart identity');
  const deadline = Date.now() + 30_000;
  while (await ticks(parent) === parentTicks) {
    if (Date.now() > deadline) throw new Error('The running app has not finished shutting down');
    await pause(50);
  }
  await ownedImage(image);
  const p = paths(image);
  const previous = await readJson(p.installed) ?? { sourceSha: running };
  const pending = await readJson(p.pendingInfo) as MainFeed;
  const release = feed(pending, (previous as { sourceSha: string }).sourceSha);
  if (await hashFile(p.pending) !== release.image.sha256) throw new Error('Staged image changed before restart');
  const originalHash = await hashFile(image);
  try { await ownedFile(p.backup); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // Write the complete recovery pair before replacing the installed launcher.
  const backupWork = p.backup + '-' + randomUUID();
  try {
    await copyFile(image, backupWork, constants.COPYFILE_EXCL);
    if (await hashFile(backupWork) !== originalHash || await hashFile(image) !== originalHash) throw new Error('Installed image changed during backup');
    await rename(backupWork, p.backup);
  } finally { await unlink(backupWork).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  await atomicJson(p.backupInfo, previous);
  await rename(p.pending, image);
  try { await atomicJson(p.installed, { sourceSha: release.sourceSha }); }
  catch (error) { await rename(p.backup, image); throw error; }
  const ready = join(dirname(image), `.app-shell-ready-${randomUUID()}`);
  let exited = false;
  const launch = options.launch ?? ((executable: string, signal: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, APPARENT_SHELL_UPDATE_READY: signal };
    delete env.ELECTRON_RUN_AS_NODE;
    return spawn(executable, options.args ?? [], { stdio: 'ignore', env });
  });
  const child = launch(image, ready);
  child.once('exit', () => { exited = true; });
  child.once('error', () => { exited = true; });
  try {
    const until = Date.now() + (options.readinessMs ?? 15_000);
    while (Date.now() < until) {
      try { await ownedFile(ready);
        if (await readFile(ready, 'utf8') !== release.sourceSha) break;
        await unlink(ready); child.unref(); await unlink(p.pendingInfo); return;
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (exited) break;
      await pause(25);
    }
    if (!exited) { child.kill('SIGTERM'); const until = Date.now() + 2_000; while (!exited && Date.now() < until) await pause(25); }
    if (!exited) { child.unref(); throw new Error('Updated app is still live; leaving it and its backup intact'); }
    if (await hashFile(image) !== release.image.sha256 || await hashFile(p.backup) !== originalHash
      || (await readJson(p.installed) as { sourceSha: string })?.sourceSha !== release.sourceSha) throw new Error('Recovery identities changed; refusing rollback');
    await rename(p.backup, image);
    await atomicJson(p.installed, previous);
    await atomicJson(p.failed, { sourceSha: release.sourceSha });
    await unlink(p.pendingInfo);
    throw new Error('Updated app did not become ready; restored previous AppImage');
  } finally { await unlink(ready).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
// The generated CJS entry has no import.meta; esbuild supplies this one constant.
declare const APPARENT_UPDATER_ENTRY: boolean;
if (typeof APPARENT_UPDATER_ENTRY !== 'undefined' && APPARENT_UPDATER_ENTRY) {
  const [command, image, running, parent, start, rawArgs] = process.argv.slice(2);
  if (command === 'restart') console.log('ready'); // Executed only after flock acquired the transaction.
  const operation = command === 'stage' ? stage(image, running) : command === 'restart'
    ? Promise.resolve().then(() => {
      const args = JSON.parse(rawArgs);
      if (!Array.isArray(args) || args.length > 64 || args.some(value => typeof value !== 'string' || value.length > 4096)) throw new Error('Invalid launch arguments');
      return restart(image, running, Number(parent), start, { args });
    }) : Promise.reject(new Error('Unknown updater operation'));
  operation.then(result => { if (result) console.log(JSON.stringify(result)); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
