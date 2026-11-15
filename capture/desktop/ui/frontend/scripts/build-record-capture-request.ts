import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const record = fileURLToPath(new URL('../../../../../record/capture-request/', import.meta.url));
for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'build']])
  execFileSync('npm', args, {cwd: record, stdio: 'inherit'});
await import('./stage-record-capture-request.ts');
