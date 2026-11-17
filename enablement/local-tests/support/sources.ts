// Shared source materialization for synthetic hook and publisher repositories.
// This module copies files only; it never imports or executes the test runner.
import {copyFileSync, mkdirSync, readdirSync, realpathSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceOwners = ['enablement/local-tests', 'enablement/ci', 'public/enablement/cd/ci', 'connect/enablement/ci/local', 'shared/enablement/ci', 'shared/enablement/issues', 'enablement/timing', 'record/enablement/ci'];
const excluded = new Set(['fixtures', 'node_modules', 'dist', 'target', '.git']);
function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

/** Copy bounded owner source trees, so new runner imports need no fixture list edit. */
export function copyRunnerSources(destination: string, source = root): void {
  const target = realpathSync(destination), origin = realpathSync(source);
  if (within(origin, target) || within(target, origin)) throw Error('Fixture and source repositories must be separate');
  function copy(path: string): void {
    for (const entry of readdirSync(resolve(origin, path), {withFileTypes: true})) {
      if (excluded.has(entry.name)) continue;
      const child = resolve(origin, path, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Unsupported fixture source symlink: ${child}`);
      if (entry.isDirectory()) copy(relative(origin, child));
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const output = resolve(target, relative(origin, child));
        mkdirSync(dirname(output), {recursive: true});
        copyFileSync(child, output);
      }
    }
  }
  for (const owner of sourceOwners) copy(owner);
  const declaration = 'engine/enablement/ci/inputs.json';
  mkdirSync(dirname(resolve(target, declaration)), {recursive: true});
  copyFileSync(resolve(origin, declaration), resolve(target, declaration));
}
