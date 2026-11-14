import {posix} from 'node:path';

// Finite test consumers, never production verifier/build definitions. Qualification
// is over candidate Git blobs, not the working tree or file extensions alone.
export const fixtureInputs = new Set([
  'enablement/local-tests/fixtures/runner.ts',
  'enablement/local-tests/fixtures/runner.test.ts',
  'enablement/local-tests/run.test.ts',
  'enablement/local-tests/desktop-install.test.ts',
  'enablement/tests/test_pre_push_guard.py',
]);
const fixtureRoot = 'enablement/local-tests/fixtures/';
export const fixtureCandidate = (path: string) => fixtureInputs.has(path) ||
  (path.startsWith(fixtureRoot) && /^[\w-]+(?:\.test)?\.ts$/.test(path.slice(fixtureRoot.length)));

const dependencies = new Set([
  'enablement/local-tests/run.ts', 'enablement/local-tests/desktop-install.ts',
  'enablement/local-tests/receipt.ts',
]);
const builtins = new Set(['assert/strict', 'test', 'fs', 'path', 'url', 'child_process', 'os']);
function imports(text: string): string[] | null {
  text = text.replace(/\brequire\(['"](?:node:)?(?:fs|path|url|assert\/strict|child_process|os)['"]\)/g, 'builtin');
  // Unknown module loaders and computed dependencies cannot earn the exception.
  if (/\b(?:import|require)\s*\(/m.test(text)) return null;
  return [...text.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]/gm)].map(match => match[1]);
}
const resolveImport = (path: string, name: string) => posix.normalize(posix.join(posix.dirname(path), name.endsWith('.ts') ? name : name + '.ts'));

export function qualifyFixtures(files: Map<string, string>, changed: string[]): string[] {
  const candidates = changed.filter(fixtureCandidate);
  if (!candidates.length) return [];
  const reachable = new Set(fixtureInputs);
  const visit = (path: string): boolean => {
    const text = files.get(path);
    if (!fixtureInputs.has(path) && fixturePlatformBoundary('', text ?? '')) return false;
    if (text === undefined) return false;
    if (path.endsWith('.py')) {
      const modules = [...text.matchAll(/^(?:import ([\w.]+)|from ([\w.]+) import )/gm)].map(match => match[1] ?? match[2]);
      return modules.length === 7 && modules.every(name => ['os', 'pathlib', 'shutil', 'subprocess', 'sys', 'tempfile', 'unittest'].includes(name)) &&
        !/\b(?:__import__|importlib|ctypes)\b/.test(text);
    }
    // The installed-hook test writes this exact finite driver into a synthetic
    // repository. It is not an import of a production runner.ts module.
    const moduleText = path === 'enablement/local-tests/desktop-install.test.ts' ?
      text.replace("import {execute} from './runner.ts';", '') : text;
    const modules = imports(moduleText);
    if (!modules) return false;
    for (const name of modules) {
      if (name.startsWith('node:') && builtins.has(name.slice(5))) continue;
      if (!name.startsWith('.')) return false;
      const target = resolveImport(path, name);
      // run.test.ts also inspects its canonical fixtures with built-in tools.
      if (dependencies.has(target)) continue;
      if (!fixtureCandidate(target)) return false;
      if (!reachable.has(target)) {reachable.add(target); if (!visit(target)) return false;}
    }
    return true;
  };
  if (![...fixtureInputs].every(visit)) return [];
  for (const path of candidates.filter(path => path.startsWith(fixtureRoot) && path.endsWith('.test.ts'))) {
    reachable.add(path); if (!visit(path)) return [];
  }
  // A new production importer invalidates the audited test-only consumer closure.
  // Literal native/build references are checked as well as TS import edges.
  for (const [path, text] of files) {
    if (reachable.has(path) || path.endsWith('.md') || ['enablement/ci/routing/fixture-portability/qualify.ts', 'enablement/ci/routing/fixture-portability/qualify.test.ts', 'enablement/ci/select.test.ts'].includes(path)) continue;
    const modules = imports(text);
    if (modules === null) return [];
    if (modules.some(name => name.startsWith('.') && reachable.has(resolveImport(path, name))) ||
        [...reachable].some(target => text.includes(target) && !(path === 'enablement/local-tests/run.ts' && (target.endsWith('.test.ts') || target === 'enablement/tests/test_pre_push_guard.py')))) return [];
  }
  return candidates.filter(path => reachable.has(path));
}

// Shared fixture helpers feed the OS-specific hook/install tests too.
export const fixtureMacRequired = (paths: string[]) => paths.length > 0;

// OS/native probes in the audited fixture harness remain unchanged. A new or
// altered probe needs a fresh platform audit, even with the same module imports.
export function fixturePlatformBoundary(before: string, after: string): boolean {
  const probes = (text: string) => text.split('\n').filter(line =>
    /\b(?:cargo|rustc|xcrun|osascript|darwin|win32|ctypes|dlopen|electron|platform)\b|\.(?:rs|swift|dylib)\b/i.test(line));
  return JSON.stringify(probes(before)) !== JSON.stringify(probes(after));
}
