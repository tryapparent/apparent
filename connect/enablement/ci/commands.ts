import type {Command} from '../../../enablement/local-tests/run.ts';
export function foregroundCommands(): Command[] {
  const cwd = 'connect/client/typescript';
  return [
    {argv: ['npm', 'ci', '--no-audit', '--no-fund'], cwd},
    {argv: ['npm', 'test'], cwd},
    {argv: ['npm', 'run', 'typecheck'], cwd},
    {argv: ['npm', 'run', 'build'], cwd},
  ];
}

export function connectCommands(selected: readonly string[]): Command[] {
  const result: Command[] = [];
  const add = (argv: string[], cwd: string) => result.push({argv, cwd});
  if (selected.includes('service')) {
    add(['npm', 'ci', '--no-audit', '--no-fund'], 'connect/service');
    add(['npm', 'test'], 'connect/service');
    add(['npm', 'run', 'test:mcp'], 'connect/service');
    add(['npm', 'run', 'test:recipient'], 'connect/service');
  }
  if (selected.includes('web')) {
    add(['bun', 'install', '--frozen-lockfile'], 'connect/web');
    add(['npm', 'test'], 'connect/web');
  }
  if (selected.includes('service') || selected.includes('web')) {
    // Exercise the same mounted gateway and static artifact that CD publishes.
    if (!selected.includes('web')) add(['bun', 'install', '--frozen-lockfile'], 'connect/web');
    add(['npm', 'ci', '--no-audit', '--no-fund'], 'connect/enablement/hosting');
    add(['npm', 'test'], 'connect/enablement/hosting');
  }
  return result;
}

export function connectClientCommands(selected: readonly string[], rustChanged: boolean, base: string, head: string, platform: string): Command[] {
  const result: Command[] = [];
  const add = (argv: string[]) => result.push({argv, cwd: '.'});
  if (rustChanged && selected.includes('client')) {
    // The Rust client-only lane also consumes the compiled shares policy. The
    // broad root verifier above prepares it when present; this route keeps the
    // standalone client owner lane safe without duplicating that work.
    if (!selected.includes('capture') && !selected.includes('engine'))
      add(['python3', 'enablement/verification.py', '--base', base, '--head', head, '--prepare-connect-typescript']);
    const cargo = platform === 'darwin' ? ['taskpolicy', '-c', 'utility', 'cargo'] : ['cargo'];
    for (const action of ['build', 'test']) add([...cargo, action, '--manifest-path', 'connect/client/Cargo.toml',
      '-j', process.env.T3_BUILD_JOBS || '3', '--offline', ...(action === 'test' ? ['--', '--test-threads=2'] : [])]);
  }
  return result;
}
