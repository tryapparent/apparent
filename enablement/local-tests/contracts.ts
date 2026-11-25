// Audited tooling-owned tests. Adding a test within this owner must not edit
// the shared executor (and thereby select every product). New roots require
// review of this execution definition and retain conservative CI selection.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {codexStopHookTest} from '../../shared/enablement/ci/inputs.ts';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {settingsContractRequired} from '../../shared/enablement/ci/settings-inputs.ts';

export function timingContracts(cwd: string): string[] {
  const tests: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(resolve(cwd, directory), {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw Error(`Contract inventory cannot follow a symlink: ${directory}/${entry.name}`);
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) tests.push(path);
    }
  }
  visit('enablement/timing');
  if (!tests.length) throw Error('Timing contract inventory is empty');
  return tests.sort();
}

export function foregroundCommands() {
  const cwd = 'connect/client/typescript';
  return [
    {argv: ['npm', 'ci', '--no-audit', '--no-fund'], cwd},
    {argv: ['npm', 'test'], cwd},
    {argv: ['npm', 'run', 'typecheck'], cwd},
    {argv: ['npm', 'run', 'build'], cwd},
  ];
}

export function diagnosticContracts() {
  const cwd = 'shared/enablement/dependency-policy';
  return [
    {argv: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd},
    {argv: ['node', '--experimental-strip-types', '--test', 'enablement/local-tests/rust/check.test.ts',
      'shared/enablement/dependency-policy/fast/typecheck.test.ts', 'enablement/local-tests/settings-contract.test.ts'], cwd: '.'},
  ];
}

export function workflowContracts(paths: string[] | null, base: string, workflowControls: string[] = []) {
  const fixture = 'enablement/ci/routing/test-only/workflow-triggers.test.ts';
  const commands = paths === null || paths.some(path => path.startsWith('.github/workflows/') || path === fixture)
    ? [{argv: ['bun', 'test', fixture], cwd: '.'}]
    : [];
  const controlsOnly = paths?.length && paths.every(path => workflowControls.includes(path));
  if (!controlsOnly && settingsContractRequired(paths))
    commands.push({argv: ['node', '--experimental-strip-types', 'enablement/ci/settings-contract/check.ts', base], cwd: '.'});
  return commands;
}

export function codexStopHookTests(head: string) {
  const trackedHookTest = spawnSync('git', ['ls-tree', '--end-of-options', head, '--', codexStopHookTest], {cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8'});
  return trackedHookTest.status === 0 && trackedHookTest.stdout.startsWith('100644 blob ')
    ? [{argv: ['node', '--experimental-strip-types', '--test', codexStopHookTest], cwd: '.'}]
    : [];
}
