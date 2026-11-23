import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

execFileSync(process.execPath, [
  fileURLToPath(new URL('../../../../../composition/enablement/ci/bend/build.ts', import.meta.url)),
], {stdio: 'inherit'});

await build({entryPoints: [fileURLToPath(new URL('../../../../../composition/settings/update-worker.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../electron/settings/update-worker.cjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22'});
