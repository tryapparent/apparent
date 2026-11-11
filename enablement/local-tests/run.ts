// Local owner-level gates. Native/release proof remains separately required.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {changedPaths as inputPaths, workflowControlPaths, regularFileDelta} from '../ci/inputs.ts';
import {serviceTests} from './service.ts';
import {desktopDependencies} from './desktop-install.ts';
import {owners, selectedOwners, nativeInputs} from '../ci/routing/consumers.ts';
export {owners} from '../ci/routing/consumers.ts';
import type {Admission} from './service.ts';

export const root = fileURLToPath(new URL('../../', import.meta.url));
type Owner = typeof owners[number];
export type Command = { argv: string[]; cwd: string; env?: Record<string, string> };

export function select(paths: string[], known = true, workflowControls: string[] = []): Owner[] {
  const effective = paths.filter(path => !workflowControls.includes(path));
  const selected = known && paths.length && !effective.length ? [] : selectedOwners(known ? effective : null);
  if (workflowControls.length && !selected.includes('tooling')) selected.push('tooling');
  return owners.filter(owner => selected.includes(owner));
}

export function changedPaths(base: string, head: string, cwd = root): string[] {
  return inputPaths(base, head, cwd);
}

export function selection(base: string, head: string, cwd = root, conservativeWorkflows = false) {
  let paths: string[] = [], historyKnown = true;
  try { paths = changedPaths(base, head, cwd); historyKnown = regularFileDelta(base, head, cwd); } catch { historyKnown = false; }
  const workflowControls = historyKnown && !conservativeWorkflows ? workflowControlPaths(base, head, paths, cwd) : [];
  const remaining = paths.filter(path => !workflowControls.includes(path));
  const rustChanged = historyKnown && paths.length && !remaining.length ? false : nativeInputs(historyKnown ? remaining : null);
  return {paths, historyKnown, workflowControls, rustChanged, selected: select(paths, historyKnown, workflowControls)};
}

export function captureToolTests(cwd = root): Command[] {
  // Load tracked files explicitly: discovery skips hyphenated module filenames
  // and does not recurse into these non-package test folders.
  const result = spawnSync('git', ['ls-files', '-z', '--', 'capture/desktop/scripts/', 'capture/agent/scripts/'], { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('Cannot enumerate capture tooling tests');
  return result.stdout.split('\0').filter(path => /\/(?:test[-_][^/]*\.py|[^/]+\.test\.ts)$/.test(path)).sort()
    .map(path => ({ argv: path.endsWith('.ts') ? ['node', '--experimental-strip-types', '--test', path] : ['python3', '-m', 'unittest', path], cwd: '.',
      ...(path.endsWith('/test_issue_cli.py') ? {env: {APPARENT_BIN: resolve(cwd, process.env.CARGO_TARGET_DIR || 'target', 'debug/apparent')}} : {}) }));
}

export function commands(selected: Owner[], base: string, head: string, platform = process.platform, rustChanged = true): Command[] {
  const result: Command[] = [];
  const add = (argv: string[], cwd = '.') => result.push({ argv, cwd });
  // Diagnose invalid/private/overlong temporary roots before any selected work.
  if (selected.some(owner => ['capture', 'engine', 'client'].includes(owner)))
    add(['python3', 'enablement/verification.py', '--base', base, '--preflight']);
  // These cheap contracts were previously missing from feature pushes.
  add(['python3', 'enablement/verification.py', '--base', base, '--head', head, '--pr']);
  const tools = selected.includes('capture-tools') ? captureToolTests() : [];
  result.push(...tools.filter(command => !command.env?.APPARENT_BIN));
  if (selected.includes('tooling')) add(['python3', '-m', 'unittest', 'discover', '-s', 'enablement/directory-width/tests', '-p', 'test_*.py']);
  if (selected.includes('hermes')) {
    add(['python3', '-m', 'unittest', 'discover', '-s', 'hermes/tests', '-p', 'test_*.py']);
    add(['node', '--experimental-strip-types', '--test', 'hermes/desktop/controller.test.ts', 'hermes/desktop/plugin.test.ts',
      'capture/desktop/ui/frontend/src/hermes/protocol.test.ts', 'capture/desktop/ui/frontend/src/hermes/mailbox.test.ts']);
  }
  // These TypeScript/renderer checks are independent of Rust. Run their real
  // locked install and full Electron suite first so a broken download, display
  // or sandbox cannot waste a cold native build. Keep every canonical assertion.
  if (selected.includes('desktop')) {
    const cwd = 'capture/desktop/ui/frontend';
    add(['npm', 'ci', '--no-audit', '--no-fund'], cwd);
    add(['npm', 'test'], cwd);
    add([...(platform === 'linux' ? ['xvfb-run', '-a'] : []), 'npm', 'run', 'test:electron'], cwd);
  }
  if (rustChanged && (selected.includes('capture') || selected.includes('engine'))) {
    // Reuse the authoritative conservative Rust verifier, including TMPDIR and jobs.
    // For mixed inputs it broadens to root + staged Engine rather than omit tests.
    add(['python3', 'enablement/verification.py', '--base', base, '--head', head, '--run', '--execution', 'platform']);
  }
  // This real CLI suite needs the exact executable the preceding root check
  // rebuilt. Its existing APPARENT_BIN contract supports private target dirs.
  // CLI integration follows a rebuilt root only; isolated driver contracts need no app.
  result.push(...tools.filter(command => rustChanged && selected.includes('capture') && command.env?.APPARENT_BIN));
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
  if (selected.includes('service')) {
    add(['npm', 'ci', '--no-audit', '--no-fund'], 'connect/service');
    add(['npm', 'test'], 'connect/service');
    add(['npm', 'run', 'test:recipient'], 'connect/service');
  }
  if (selected.includes('web')) {
    add(['bun', 'install', '--frozen-lockfile'], 'connect/web');
    add(['npm', 'test'], 'connect/web');
  }
  if (selected.includes('public')) add(['node', 'scripts/site-build/verify.mjs'], 'public/site');
  return result;
}

export function contractTests(cwd = root): Command[] {
  const prerequisites = readdirSync(resolve(cwd, 'enablement/prerequisites'))
    .filter(name => name.endsWith('.test.ts')).sort()
    .map(name => `enablement/prerequisites/${name}`);
  if (!prerequisites.length) throw Error('Native prerequisite contract inventory is empty');
  return [
    { argv: ['node', '--experimental-strip-types', '--test', 'enablement/local-tests/run.test.ts', 'enablement/local-tests/reuse.test.ts', 'enablement/local-tests/desktop-install.test.ts',
      ...prerequisites, 'enablement/timing/command.test.ts', 'enablement/timing/mac-cache.test.ts'], cwd: '.' },
    { argv: ['bun', 'test', 'enablement/ci/'], cwd: '.' },
  ];
}

export function execute(plan: Command[], cwd = root, admission?: Admission): void {
  // Git exports repository-local routing into hooks. Test fixtures and package
  // subprocesses must resolve their own cwd rather than mutate the caller's Git
  // config/index. Preserve identity/credentials and all non-local environment.
  const local = spawnSync('git', ['rev-parse', '--local-env-vars'], { cwd, encoding: 'utf8' });
  if (local.error || local.status !== 0) throw Error('Cannot isolate hook Git environment');
  const env = { ...process.env };
  for (const name of local.stdout.trim().split('\n')) delete env[name];
  const run = ({ argv, cwd: directory, env: extra }: Command, environment = env) => {
    console.error(`pre-push: [${directory}] ${argv.join(' ')}`);
    const result = spawnSync(argv[0], argv.slice(1), { cwd: resolve(cwd, directory), env: {...environment, ...extra}, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`Local test command failed (${result.signal || result.status}): ${argv.join(' ')}`);
  };
  for (let index = 0; index < plan.length; index++) {
    const command = plan[index];
    if (desktopDependencies(plan.slice(index, index + 3), cwd, env, admission, run)) { index += 2; continue; }
    if (!serviceTests(command, cwd, {...env, ...command.env}, admission, run)) run(command);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--contracts') {
    execute(contractTests());
    process.exit(0);
  }
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  if (!args.includes('--base') || !args.includes('--head')) throw Error('--base and --head are required');
  const base = value('--base'), head = value('--head');
  const result = selection(base, head, root, args.includes('--conservative-workflows'));
  const plan = commands(result.selected, base, head, process.platform, result.rustChanged);
  console.log(JSON.stringify({ ...result, commands: plan }));
  if (args.includes('--run')) execute(plan, root, result.historyKnown ? {base, head} : undefined);
}
