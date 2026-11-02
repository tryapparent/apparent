// One runtime, separate surface entrypoints and protocols.
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
export async function stageRuntime(source, destination) {
  // Electron's macOS frameworks require relocatable relative symlinks.
  await cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
}
export async function stagePopupEntries(root, destination) {
  await mkdir(path.join(destination, 'electron'), { recursive: true });
  for (const surface of ['notes', 'share']) {
    const source = path.join(root, 'electron', surface);
    try { await stat(source); }
    catch (error) { if (surface === 'share' && error.code === 'ENOENT') continue; throw error; }
    await stat(path.join(source, 'main.cjs'));
    await cp(source, path.join(destination, 'electron', surface), { recursive: true, force: true });
  }
}
