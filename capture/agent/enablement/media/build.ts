// Application composition stages Agent's published Engine dependency.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const agent = fileURLToPath(new URL('../../media/', import.meta.url));
const output = fileURLToPath(new URL('../../../desktop/ui/frontend/electron/agent-media/', import.meta.url));
for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'build']])
  execFileSync('npm', args, {cwd: agent, stdio: 'inherit'});
execFileSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./stage.ts', import.meta.url)), '--out', output], {cwd: agent, stdio: 'inherit'});
