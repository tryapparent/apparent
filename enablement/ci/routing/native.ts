// TypeScript selects owners; Python retains the existing native execution adapter.
import {spawnSync} from 'node:child_process';
import {parsePlan} from './run.ts';
const plan = parsePlan(process.env.VERIFICATION_PLAN);
const result = spawnSync('python3', ['enablement/verification.py', '--base', 'unknown', '--run', '--online',
  '--execution', 'platform', '--overlap-root-build', '--selection-json',
  JSON.stringify({root: plan.root, engine: plan.engine, browser: false, focused: [], paths: [], reason: 'audited TypeScript owner plan'})], {stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
