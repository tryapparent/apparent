// Synthetic hook repositories use real runner sources and finite downstream tests.
// Never import this fixture builder from the production runner.
import {mkdirSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {commands, contractTests, root} from '../run.ts';
import type {Command} from '../run.ts';
import {copyRunnerSources, fixtureBendDirectories} from '../support/sources.ts';
export {copyRunnerSources} from '../support/sources.ts';

const finiteTest = "import {test} from 'node:test'; test('finite hook fixture', () => {});\n";

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
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
  const admission = resolve(destination, 'shared/enablement/dependency-policy');
  mkdirSync(admission, {recursive: true});
  const manifest = {name: 'finite-admission', private: true};
  writeFileSync(resolve(admission, 'package.json'), JSON.stringify(manifest));
  writeFileSync(resolve(admission, 'package-lock.json'), JSON.stringify({
    name: manifest.name, lockfileVersion: 3, packages: {'': {name: manifest.name}},
  }));
  for (const directory of fixtureBendDirectories(destination)) {
    const bend = resolve(destination, directory, 'check.ts');
    mkdirSync(dirname(bend), {recursive: true});
    writeFileSync(bend, "console.log('Finite Bend fixture');\n");
  }
  const ordering = resolve(destination, 'handoff/enablement/ci/bend/build.ts');
  mkdirSync(dirname(ordering), {recursive: true});
  writeFileSync(ordering, 'process.exit(0);\n');
  writeFileSync(resolve(destination, 'enablement/local-tests/rust/check.ts'), 'process.exit(0);\n');
  const issue = resolve(destination, 'shared/enablement/issues/run.ts');
  mkdirSync(dirname(issue), {recursive: true});
  writeFileSync(issue, "process.stdin.resume();\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: runner.ts <existing synthetic repository>');
  runnerFixture(process.argv[2]);
}
