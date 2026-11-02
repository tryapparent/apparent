// Assemble the notes-only Electron runtime next to the Rust application.
import { cp, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw new Error('Expected absolute notes destination');
for (const args of [['ci', '--no-audit', '--no-fund'], ['run', 'build']]) {
  const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
// electron's npm package downloads the platform's pinned runtime on first resolution.
const resolve = spawnSync(process.execPath, ['-e', "require('electron')"], { cwd: root, stdio: 'inherit' });
if (resolve.status !== 0) process.exit(resolve.status || 1);
await mkdir(path.join(destination, 'electron'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(destination, 'dist'), { recursive: true, force: true });
await cp(path.join(root, 'electron/notes'), path.join(destination, 'electron/notes'), { recursive: true, force: true });
await cp(path.join(root, 'node_modules/electron/dist'), path.join(destination, 'runtime'), { recursive: true, force: true });
await stat(path.join(destination, 'dist/index.html'));
