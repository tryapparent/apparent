import {appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {commands, root} from '../../local-tests/run.ts';
import {suitePlan} from './consumers.ts';

const full = suitePlan(null);
// Missing, malformed or partial plans never silently omit coverage.
export function parsePlan(raw: string | undefined): typeof full {
  try {
    const value = JSON.parse(raw ?? '');
    if (!value || Object.keys(value).length !== Object.keys(full).length ||
        Object.keys(full).some(key => typeof value[key] !== 'boolean')) return full;
    return value;
  } catch { return full; }
}
const plan = parsePlan(process.env.VERIFICATION_PLAN);
if (process.argv.includes('--outputs')) {
  appendFileSync(process.env.GITHUB_OUTPUT!, Object.entries(plan).map(([key,value]) => `${key}=${value}\n`).join(''));
} else if (process.argv.includes('--portable')) {
  const selected = [plan.browser ? 'web' : null, plan.service ? 'service' : null, plan.tools ? 'capture-tools' : null].filter(Boolean) as ('web'|'service'|'capture-tools')[];
  for (const command of commands(selected, 'unknown', 'HEAD', process.platform, false).slice(1)) {
    console.log(`[${command.cwd}] ${command.argv.join(' ')}`);
    const result = spawnSync(command.argv[0], command.argv.slice(1), {cwd: `${root}/${command.cwd}`, stdio: 'inherit', env: {...process.env, ...command.env}});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
