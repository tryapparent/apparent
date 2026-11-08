import { constants } from 'node:fs';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export async function ownedFile(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || stat.nlink !== 1 || (stat.mode & 0o022)) {
    throw new Error('Updater requires an owned, non-writable-by-others regular file');
  }
  return stat;
}
export async function ownedImage(path: string) {
  const home = resolve(homedir());
  const rel = relative(home, path);
  if (!isAbsolute(path) || resolve(path) !== path || !rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('AppImage must be inside your home');
  let parent = dirname(path);
  while (parent !== home) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o022)) throw new Error('Unsafe installation directory');
    parent = dirname(parent);
  }
  const stat = await ownedFile(path);
  if (!(stat.mode & 0o100)) throw new Error('AppImage must be executable');
  return stat;
}
export async function readJson(path: string): Promise<unknown | undefined> {
  try {
    const stat = await ownedFile(path);
    if (stat.size > 4 * 1024 * 1024) throw new Error('Updater metadata exceeds its limit');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function atomicJson(path: string, value: unknown) {
  try { await ownedFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = join(dirname(path), `.updater-${randomUUID()}`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function hashFile(path: string) {
  await ownedFile(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256');
    for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
export const paths = (image: string) => ({ pending: image + '.pending', pendingInfo: image + '.pending.json',
  installed: image + '.version.json', backup: image + '.previous', backupInfo: image + '.previous.json', failed: image + '.failed.json' });
