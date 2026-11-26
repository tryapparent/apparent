// Clanker push boundary: the existing runner owns admission, deadlines and cleanup.
import {pathToFileURL} from 'node:url';
import {recordPushLaunch} from '../../timing/push/receipt.ts';

export const runner = '/home/simon/.local/bin/t3-build';

export function pushArguments(args: string[], env = process.env): string[] {
  if (env.T3_BUILD_JOBS) throw Error('Already admitted: run git push directly; do not nest t3-build');
  const result: string[] = [];
  let index = 0;
  while (index < args.length && args[index] !== '--') {
    const option = args[index++];
    if (!['--jobs', '--min-jobs', '--total-budget'].includes(option)) throw Error(`Unknown option: ${option}`);
    const value = args[index++];
    if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) throw Error(`${option} needs positive seconds or workers`);
    result.push(option === '--total-budget' ? '--timeout' : option, value);
  }
  if (args[index] !== '--') throw Error('Usage: push.ts [--jobs N] [--min-jobs N] [--total-budget SECONDS] -- [git push arguments]');
  // No agent-selected short deadline: inherit the live runner default. A real
  // human cap remains explicit and includes both admission and hook execution.
  return [...result, '--', 'git', 'push', ...args.slice(index + 1)];
}

export function replaceProcess(file: string, args: string[]): never {
  // No extra supervisor, timer or detached child. Preserve stdin, signal delivery
  // and exit status through the runner's existing process-group cleanup boundary.
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  process.execve(file, [file, ...args], env);
  throw Error('execve returned without replacing the process');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const timing = args[0] === '--runner-timing' ? args.splice(0, 2)[1] : undefined;
    const invocation = pushArguments(args);
    delete process.env.APPARENT_PUSH_TIMING;
    if (timing && recordPushLaunch(timing)) process.env.APPARENT_PUSH_TIMING = timing;
    replaceProcess(runner, invocation);
  } catch (error) {
    console.error(`push: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 125;
  }
}
