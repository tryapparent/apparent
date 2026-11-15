import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

await build({entryPoints: [fileURLToPath(new URL('../electron/settings/update-worker.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../electron/settings/update-worker.cjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22'});
