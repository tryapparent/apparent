// Record is built headlessly. Desktop composition stages its published Engine
// dependency; none of Engine's implementation or Rust build inputs are imported.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const record = fileURLToPath(new URL('../../../../../record/media/', import.meta.url));
const output = fileURLToPath(new URL('../electron/record-media/', import.meta.url));
for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'build']])
  execFileSync('npm', args, {cwd: record, stdio: 'inherit'});
execFileSync(process.execPath, ['--experimental-strip-types', 'stage.ts', '--out', output], {cwd: record, stdio: 'inherit'});
