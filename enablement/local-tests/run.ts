import {affectedBendOwners} from "../../shared/enablement/bend/owners.ts";
import {bendDirectory} from "../../shared/enablement/bend/manifest.ts";
import {serviceCommands} from '../../connect/enablement/ci/local/service.ts';
import { verification as publicVerification } from '../../public/enablement/cd/ci/inputs.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {changedPaths as inputPaths} from '../ci/inputs.ts';
import {installCommand, publish, alreadyPassed} from '../ci/install-contracts/evidence.ts';
import {serviceTests} from './service.ts';
import {desktopDependencies, desktopPackage} from './desktop-install.ts';
import {owners, selectedOwners, routeDecision, routingProblems, desktopPackagingInputs} from '../ci/routing/consumers.ts';
import {selectRange} from '../ci/select.ts';
import {explainSelection} from './preview/explain.ts';
import {foregroundCommands, timingContracts} from './contracts.ts';
export {owners} from '../ci/routing/consumers.ts';
import type {Admission} from './service.ts';

export const root = fileURLToPath(new URL('../../', import.meta.url));
type Owner = typeof owners[number];
export type Command = { argv: string[]; cwd: string; env?: Record<string, string> };

export function select(paths: string[], known = true, workflowControls: string[] = []): Owner[] {
  return routeDecision(known ? paths : null, workflowControls).selected;
}

export function changedPaths(base: string, head: string, cwd = root): string[] {
  return inputPaths(base, head, cwd);
}

export function selection(base: string, head: string, cwd = root, _conservativeWorkflows = false) {
  const routing = selectRange(base, head, cwd, _conservativeWorkflows);
  return {...routing, rustChanged: !routing.historyKnown || routing.paths.some(path => path.endsWith('.rs'))};
}

export function captureToolTests(cwd = root): Command[] {
  const result = spawnSync('git', ['ls-files', '-z', '--', 'capture/desktop/scripts/', 'capture/desktop/enablement/', 'capture/agent/scripts/'], { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('Capture tooling inventory failed');
  const paths = result.stdout.split('\0').filter(path => /\/(?:test[-_][^/]*\.py|[^/]+\.test\.ts)$/.test(path)).sort();
  const nodeTests = paths.filter(path => path.endsWith('.test.ts'));
  const nodeCommand = {argv: ['node', '--experimental-strip-types', '--test', '--test-concurrency=1', ...nodeTests], cwd: '.'};
  const firstNode = paths.find(path => path.endsWith('.test.ts'));
  const commands: Command[] = [];
  for (const path of paths) {
    if (path === firstNode) commands.push(nodeCommand);
    else if (!path.endsWith('.test.ts')) commands.push({
      argv: ['python3', '-m', 'unittest', path], cwd: '.',
      ...(path.endsWith('/test_issue_cli.py') ? {env: {APPARENT_BIN: resolve(cwd, process.env.CARGO_TARGET_DIR || 'target', 'debug/apparent')}} : {})
    });
  }
  return commands;
}

export function installationContracts(paths: string[] | null, workflowControls: string[] = []): Command[] {
  if (paths?.length && paths.every(path => workflowControls.includes(path))) return [];
  const manifests = new Set(['package.json', 'package-lock.json', '.npmrc', '.npmignore', '.gitignore']);
  const inputs = [desktopPackage, 'shared/ui', 'record/storage'];
  const affected = !paths?.length || selectedOwners(paths).includes('tooling') || paths.some(path =>
    desktopPackagingInputs.has(path) ||
    ['.github/', 'enablement/', 'shared/ui/', 'record/storage/'].some(root => path.startsWith(root)) ||
    path.startsWith(desktopPackage + '/scripts/') ||
    new RegExp('^' + desktopPackage + '/(?:tsconfig[^/]*\\.json|vite\\.config\\.[^/]+)$').test(path) ||
    inputs.some(root => path.startsWith(root + '/') && manifests.has(path.slice(root.length + 1))));
  return affected ? [installCommand] : [];
}
export function fixtureMacCommands(): Command[] {
  return [
    installCommand,
    {argv: ['python3', '-m', 'unittest', 'discover', '-s', 'enablement/tests', '-p', 'test_pre_push_guard.py'], cwd: '.'},
  ];
}

export function toolingCommands(): Command[] {
  return [
    installCommand,
    {argv: ['node', '--experimental-strip-types', '--test', 'enablement/posthog-fixer/test/service.test.ts', 'enablement/posthog-fixer/test/t3.test.ts'], cwd: '.'},
    {argv: ['python3', '-m', 'unittest', 'discover', '-s', 'enablement/directory-width/tests', '-p', 'test_*.py'], cwd: '.'},
  ];
}

export function onboardingCommands(): Command[] {
  const cwd = 'capture/desktop/ui/frontend';
  return [
    {argv: ['npm', 'run', 'test:onboarding-policy'], cwd},
    {argv: ['npm', 'ci', '--prefix', 'tests/onboarding', '--ignore-scripts', '--no-audit', '--no-fund'], cwd},
    {argv: ['npm', '--prefix', 'tests/onboarding', 'run', 'typecheck'], cwd},
    {argv: ['node', '--experimental-strip-types', '--test', 'tests/connect/flow-hook.test.ts'], cwd},
  ];
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

export function commands(selected: Owner[], base: string, head: string, platform = process.platform, rustChanged = true,
  installScope: {paths: string[] | null; workflowControls?: string[]; local?: boolean} = {paths: null}): Command[] {
  const result: Command[] = [];
  const add = (argv: string[], cwd = '.') => result.push({ argv, cwd });
  if (rustChanged && selected.some(owner => ['capture', 'engine', 'client'].includes(owner)))
    add(['python3', 'enablement/verification.py', '--base', base, '--preflight']);
  if (selected.includes('tooling') || installScope.paths === null)
    add(['python3', 'enablement/verification.py', '--base', base, '--head', head, '--pr']);
  if (installScope.local)
    for (const owner of affectedBendOwners(root, installScope.paths))
      add(['node', bendDirectory(owner) + '/check.ts']);
  if (selected.includes('tooling')) result.push(...toolingCommands());
  else if (selected.includes('desktop')) result.push(...installationContracts(installScope.paths, installScope.workflowControls));
  if (selected.includes('onboarding')) result.push(...onboardingCommands());
  if (selected.includes('capture')) {
    add(['node', '--experimental-strip-types', 'record/enablement/ci/media.ts']);
    result.push(...agentMediaCommands());
  }
  if (selected.includes('client-foreground')) result.push(...foregroundCommands());
  if (selected.includes('engine-media')) add(['node', '--experimental-strip-types', 'engine/enablement/ci/producer/check.ts', ...(rustChanged ? [] : ['--sdk-only'])]);
  const tools = selected.includes('capture-tools') ? captureToolTests() : [];
  result.push(...tools.filter(command => !command.env?.APPARENT_BIN));
  if (selected.includes('hermes')) {
    add(['npm', 'ci', '--ignore-scripts', '--prefix', 'hermes/desktop']);
    add(['python3', '-m', 'unittest', 'discover', '-s', 'hermes/tests', '-p', 'test_*.py']);
    add(['node', '--experimental-strip-types', '--test', 'hermes/desktop/controller.test.ts', 'hermes/desktop/plugin.test.ts', 'hermes/distribution/package.test.ts', 'hermes/distribution/consumer.test.ts', 'hermes/distribution/cache/downloads.test.ts', 'capture/agent/setup/hermes.test.ts', 'capture/agent/setup/hermes-receiver.test.ts',
      'capture/desktop/ui/frontend/src/hermes/protocol.test.ts', 'capture/desktop/ui/frontend/src/hermes/mailbox.test.ts']);
  }
  if (selected.includes('desktop')) {
    const cwd = 'capture/desktop/ui/frontend';
    add(['npm', 'ci', '--no-audit', '--no-fund'], cwd);
    add(['npm', 'test'], cwd);
    if (!installScope.local || installScope.paths === null || installScope.paths.some(path => /\.(?:rs|cjs)$/.test(path) || path.includes('/electron/') || path.includes('/tests/')))
      add([...(platform === 'linux' ? ['xvfb-run', '-a'] : []), 'npm', 'run', 'test:electron'], cwd);
  }
  if (rustChanged && (selected.includes('capture') || selected.includes('engine'))) {
    add(['python3', 'enablement/verification.py', '--base', base, '--head', head, '--run', '--execution', 'platform', '--selection-json',
      JSON.stringify({root: selected.includes('capture'), engine: selected.includes('engine'), browser: false, focused: [], paths: [], reason: 'shared suite plan'})]);
  }
  result.push(...tools.filter(command => rustChanged && selected.includes('capture') && command.env?.APPARENT_BIN));
  if (rustChanged && selected.includes('client')) {
    if (!selected.includes('capture') && !selected.includes('engine'))
      add(['python3', 'enablement/verification.py', '--base', base, '--head', head, '--prepare-connect-typescript']);
    const cargo = platform === 'darwin' ? ['taskpolicy', '-c', 'utility', 'cargo'] : ['cargo'];
    for (const action of ['build', 'test']) add([...cargo, action, '--manifest-path', 'connect/client/Cargo.toml',
      '-j', process.env.T3_BUILD_JOBS || '3', '--offline', ...(action === 'test' ? ['--', '--test-threads=2'] : [])]);
  }
  if (selected.includes('service')) result.push(...serviceCommands);
  if (selected.includes('web')) {
    add(['bun', 'install', '--frozen-lockfile'], 'connect/web');
    add(['npm', 'test'], 'connect/web');
  }
  if (selected.includes('service') || selected.includes('web')) {
    if (!selected.includes('web')) add(['bun', 'install', '--frozen-lockfile'], 'connect/web');
    add(['npm', 'ci', '--no-audit', '--no-fund'], 'connect/tooling/hosting');
    add(['npm', 'test'], 'connect/tooling/hosting');
  }
  if (selected.includes('public')) add(publicVerification.argv, publicVerification.cwd);
  return result;
}

export function contractTests(cwd = root): Command[] {
  const prerequisites = readdirSync(resolve(cwd, 'enablement/prerequisites'))
    .filter(name => name.endsWith('.test.ts')).sort()
    .map(name => `enablement/prerequisites/${name}`);
  if (!prerequisites.length) throw Error('Prerequisite inventory is empty');
  const fixtureTests = (existsSync(resolve(cwd, 'enablement/local-tests/fixtures')) ? readdirSync(resolve(cwd, 'enablement/local-tests/fixtures')) : [])
    .filter(name => name.endsWith('.test.ts') && name !== 'runner.test.ts').sort()
    .map(name => `enablement/local-tests/fixtures/${name}`);
  return [
    { argv: ['node', '--experimental-strip-types', '--test', ...fixtureTests, 'enablement/local-tests/run.test.ts', 'enablement/local-tests/reuse.test.ts',
      'enablement/local-tests/preview/explain.test.ts', 'enablement/local-tests/preview/inputs.test.ts', 'shared/enablement/issues/issues.test.ts',
      ...prerequisites, ...timingContracts(cwd)], cwd: '.' },
    { argv: ['bun', 'test', 'enablement/ci/'], cwd: '.' },
    { argv: ['bun', 'test', 'connect/enablement/ci/'], cwd: '.' },
  ];
}

export function execute(plan: Command[], cwd = root, admission?: Admission, sourceOnly = false): void {
  const local = spawnSync('git', ['rev-parse', '--local-env-vars'], { cwd, encoding: 'utf8' });
  if ((local.error || local.status !== 0) && !sourceOnly) throw Error('Git isolation failed');
  if (sourceOnly && ![onboardingCommands(), agentMediaCommands()].some(inventory => JSON.stringify(plan) === JSON.stringify(inventory)))
    throw Error('Source-only execution is limited to the reviewed policy inventories');
  const env = { ...process.env };
  const gitVariables = sourceOnly ? Object.keys(env).filter(name => name.startsWith('GIT_')) : local.stdout.trim().split('\n');
  for (const name of gitVariables) delete env[name];
  const run = ({ argv, cwd: directory, env: extra }: Command, environment = env) => {
    console.error(`pre-push: [${directory}] ${argv.join(' ')}`);
    const invocation = environment.APPARENT_TIMING_FILE ? [process.execPath, '--experimental-strip-types', resolve(cwd, 'enablement/timing/command.ts'),
      argv.includes('ci') || argv.includes('install') ? 'push-setup' : argv.includes('build') ? 'push-build' : 'push-test', ...argv] : argv;
    const result = spawnSync(invocation[0], invocation.slice(1), { cwd: resolve(cwd, directory), env: {...environment, ...extra}, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`Local test command failed (${result.signal || result.status}): ${argv.join(' ')}`);
  };
  for (let index = 0; index < plan.length; index++) {
    const command = plan[index];
    const desktop = plan.slice(index, index + (plan[index + 2]?.argv.includes('test:electron') ? 3 : 2));
    if (desktopDependencies(desktop, cwd, env, admission, run)) { index += desktop.length - 1; continue; }
    if (!serviceTests(command, cwd, {...env, ...command.env}, admission, run)) run(command);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--service-tests') {
    const read = (...args: string[]) => {
      const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
      if (result.status !== 0) throw Error('Unknown candidate');
      return result.stdout.trim();
    };
    const head = read('rev-parse', 'HEAD'), base = read('merge-base', head, 'origin/main');
    execute(serviceCommands.slice(0, 2), root, {base, head});
    process.exit(0);
  }
  if (args.length === 1 && args[0] === '--agent-media') {
    execute(agentMediaCommands(), root, undefined, true);
    process.exit(0);
  }
  if (args.length === 1 && args[0] === '--fixture-mac') {
    execute(fixtureMacCommands());
    if (process.env.GITHUB_ACTIONS === 'true') publish(root);
    process.exit(0);
  }
  if (args.length === 1 && args[0] === '--tooling') {
    if (selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? 'HEAD').plan.tooling) execute(toolingCommands());
    process.exit(0);
  }
  if (args.length === 1 && args[0] === '--onboarding') {
    execute(onboardingCommands(), root, undefined, true);
    process.exit(0);
  }
  if (args.length === 1 && args[0] === '--contracts') {
    execute(contractTests());
    process.exit(0);
  }
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  if (!args.includes('--base') || !args.includes('--head')) throw Error('--base and --head are required');
  const base = value('--base'), head = value('--head');
  const result = selection(base, head, root, args.includes('--conservative-workflows'));
  const paths = result.inputProofKnown ? result.paths : null;
  const native = process.env.GITHUB_ACTIONS ? result.plan.root || result.plan.engine || result.plan.client || result.plan.engineMedia : result.rustChanged;
  const plan = args.includes('--desktop-install-contracts') ? installationContracts(paths, result.workflowControls)
    : commands(result.selected, base, head, process.platform, native, {paths, workflowControls: result.workflowControls, local: !process.env.GITHUB_ACTIONS});
  console.log(args.includes('--explain') ? explainSelection(result, plan) : JSON.stringify({ ...result, commands: plan }));
  if (args.includes('--run')) {
    const problems = result.historyKnown ? routingProblems(result) : [];
    if (problems.length) throw Error(problems.join('\n'));
    if (args.includes('--desktop-install-contracts') && plan.length === 1 &&
        JSON.stringify(plan[0]) === JSON.stringify(installCommand) && await alreadyPassed(root)) {
      console.log('Reusing successful Mac hook fixtures installation contracts for this exact candidate, suite and run attempt.');
    } else execute(plan, root, result.inputProofKnown ? {base, head} : undefined);
  }
}
