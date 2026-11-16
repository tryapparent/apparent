// Agent owns its check inventory; repository admission consumes these commands.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export type Command = {argv: string[]; cwd: string; env?: Record<string, string>};
const root = fileURLToPath(new URL('../../../', import.meta.url));
export function agentToolTests(cwd = root): Command[] {
  const result = spawnSync('git', ['ls-files', '-z', '--', 'capture/agent/enablement/scripts/'], {cwd, encoding: 'utf8'});
  if (result.error || result.status !== 0) throw Error('Cannot enumerate Agent tooling tests');
  const paths = result.stdout.split('\0').filter(path => /\/(?:test[-_][^/]*\.py|[^/]+\.test\.ts)$/.test(path)).sort();
  const node = paths.filter(path => path.endsWith('.test.ts'));
  return [
    ...(node.length ? [{argv: ['node', '--experimental-strip-types', '--test', '--test-concurrency=1', ...node], cwd: '.'}] : []),
    ...paths.filter(path => path.endsWith('.py')).map(path => ({argv: ['python3', '-m', 'unittest', path], cwd: '.'})),
  ];
}
export function agentSetupCommands(): Command[] {
  return [{argv: ['node', '--experimental-strip-types', '--test', 'capture/agent/setup/hermes.test.ts',
    'capture/agent/setup/hermes-receiver.test.ts', 'capture/agent/enablement/setup/hermes.native.test.ts'], cwd: '.'}];
}
export function agentMediaCommands(): Command[] {
  const cwd = 'capture/agent/media';
  return [
    {argv: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd},
    {argv: ['npm', 'run', 'typecheck'], cwd},
    {argv: ['npm', 'test'], cwd},
    {argv: ['npm', 'run', 'build'], cwd},
  ];
}
