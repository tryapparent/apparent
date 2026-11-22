// Application composition stages Agent's published Engine dependency.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const agent = fileURLToPath(new URL('../../../../../agent/media/', import.meta.url));
const output = fileURLToPath(new URL('../../electron/agent-media/', import.meta.url));
for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'build']])
  execFileSync('npm', args, {cwd: agent, stdio: 'inherit'});
execFileSync(process.execPath, ['--experimental-strip-types', 'stage.ts', '--out', output], {cwd: agent, stdio: 'inherit'});
const zoom = fileURLToPath(new URL('../../../../../../agent/enablement/ci/bend/build.ts', import.meta.url));
execFileSync(process.execPath, [zoom, output], {stdio: 'inherit'});
