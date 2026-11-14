// Synthetic hook repositories use real runner sources and finite downstream tests.
// Never import this fixture builder from the production runner.
import {copyFileSync, mkdirSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {commands, contractTests, root} from '../run.ts';
import type {Command} from '../run.ts';

const sourceOwners = ['enablement/local-tests', 'enablement/ci'];
const excluded = new Set(['fixtures', 'node_modules', 'dist', 'target', '.git']);
const finiteTest = "import {test} from 'node:test'; test('finite hook fixture', () => {});\n";

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

/** Copy bounded owner source trees, so new runner imports need no fixture list edit. */
export function copyRunnerSources(destination: string, source = root): void {
  // Callers create their own empty synthetic repository. Never write into the
  // source checkout, including via a symlink or an enclosing directory.
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
}

/** Only the suites exercised by the synthetic hook fixtures; no package execution. */
export function finiteCheckPlan(): Command[] {
  return [...contractTests(), ...commands(['tooling', 'onboarding', 'hermes'], 'fixture-base', 'fixture-head')];
}

/** Preserve dispatch boundaries without recursively executing real hook/npm tests. */
export function writeFiniteChecks(destination: string, plan = finiteCheckPlan()): void {
  const target = realpathSync(destination), origin = realpathSync(root);
  if (within(origin, target) || within(target, origin)) throw Error('Fixture and source repositories must be separate');
  for (const {argv, cwd} of plan) {
    if (argv[0] !== 'node' || !argv.includes('--test')) continue;
    for (const input of argv.slice(argv.indexOf('--test') + 1)) {
      // Literal TS module inputs only. New flags/globs need deliberate fixture
      // support rather than silently changing the finite boundary.
      if (!/^[\w./-]+\.test\.ts$/.test(input) || input.startsWith('-'))
        throw Error(`Unsupported finite test input: ${input}`);
      const output = resolve(target, cwd, input);
      if (!within(target, output)) throw Error(`Finite test escapes fixture: ${input}`);
      mkdirSync(dirname(output), {recursive: true});
      writeFileSync(output, finiteTest);
    }
  }
}

export function runnerFixture(destination: string): void {
  copyRunnerSources(destination);
  writeFiniteChecks(destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: runner.ts <existing synthetic repository>');
  runnerFixture(process.argv[2]);
}
