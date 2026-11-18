// Audited tooling-owned tests. Adding a test within this owner must not edit
// the shared executor (and thereby select every product). New roots require
// review of this execution definition and retain conservative CI selection.
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';

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
