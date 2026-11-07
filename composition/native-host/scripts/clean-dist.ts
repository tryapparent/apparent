import { lstat, rm } from 'node:fs/promises';

// This package owns only its generated output. Never follow an output-directory link.
const output = new URL('../dist', import.meta.url);
const metadata = await lstat(output).catch((error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
  throw error;
});
if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) {
  throw new Error('Native host dist must be a real generated directory');
}
await rm(output, { recursive: true, force: true });
