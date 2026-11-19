import { readFileSync } from "node:fs";
import {execFileSync} from 'node:child_process';
import {posix} from 'node:path';
import {moduleImports} from '../fixture-portability/imports.ts';

// Desktop verifier execution and its regression consumers, not Engine producer
// execution. No directory/test-extension exemption; mac-platform belongs to the
// separate test-only qualifier. New files require a consumer audit here.
export const independentInputs = new Set([
  'enablement/ci/root.ts', 'enablement/ci/root.test.ts',
  'enablement/ci/routing/native.ts',
  'enablement/ci/runner/apt.test.ts', 'enablement/ci/runner/rust.test.ts',
]);
const auditedImports = new Map([
  ['enablement/ci/root.ts', ['node:child_process','node:fs','node:os','node:perf_hooks','node:string_decoder','node:url']],
  ['enablement/ci/root.test.ts', ['node:test','node:assert/strict','node:child_process','node:events','node:fs','node:path']],
  ['enablement/ci/routing/native.ts', ['node:child_process','./run.ts']],
  ['enablement/ci/runner/apt.test.ts', ['node:test','node:assert/strict','node:fs','node:child_process','bun']],
  ['enablement/ci/runner/rust.test.ts', ['node:test','node:assert/strict','node:fs','bun']],
]);
const callers = new Set([
  ...independentInputs, '.github/workflows/verification-platform.yml',
  'enablement/verification.py', 'enablement/tests/test_owner_lanes.py',
  'enablement/timing/mac-cache.test.ts',
]);
const references = String.raw`root\.ts|root\.test|routing/native(\.ts)?($|['"[:space:]])|runner/(apt|rust)\.test|from[[:space:]]*['"][^'"]*/root['"]`;
function imports(path: string, text: string): string | null {
  const edges = moduleImports(text);
  if (!edges || JSON.stringify(edges.sort()) !== JSON.stringify(auditedImports.get(path)?.slice().sort())) return null;
  // Include literal dynamic imports (also in generated subprocess fixtures).
  // Computed loaders and unknown syntax cannot establish independence.
  const dynamic: string[] = [];
  const rest = text.replace(/\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (_match, _quote, name: string) => {dynamic.push(name); return '';});
  if (/\b(?:import|require)\s*\(/.test(rest) || JSON.stringify(dynamic.sort()) !== JSON.stringify(path === 'enablement/ci/root.test.ts' ? ['fs', 'node:child_process', 'node:fs'] : [])) return null;
  return JSON.stringify([edges.sort(), dynamic.sort()]);
}

// The path map is useful to explain ownership, but only a regular modification
// with unchanged module edges earns it in the committed range. Both trees must
// retain the audited inbound consumers; new Engine/SDK/qualifier callers fail
// broad even when introduced on an earlier main commit.
export function engineIndependentRange(base: string, head: string, paths: string[], cwd: string): boolean {
  const candidates = paths.filter(path => independentInputs.has(path));
  if (!candidates.length) return true;
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  try {
    for (const ref of [base, head]) {
      let matches = '';
      try {matches = git('grep', '-I', '-l', '-E', references, ref, '--', ':!*.md', ':!enablement/ci/routing/engine-inputs/**');}
      catch (error) {if ((error as {status?: number}).status !== 1) return false;}
      let moduleReferences = '';
      try {moduleReferences = git('grep', '-I', '-l', '-E', String.raw`(from|import|require).*['"][^'"]*(root|native|apt\.test|rust\.test)(\.ts)?['"]`, ref, '--', '*.ts', '*.tsx', '*.mts', '*.cts');}
      catch (error) {if ((error as {status?: number}).status !== 1) return false;}
      for (const line of moduleReferences.trim().split('\n').filter(Boolean)) {
        const importer = line.slice(ref.length + 1);
        if (callers.has(importer) || importer.startsWith('enablement/ci/routing/engine-inputs/')) continue;
        const text = git('show', ref + ':' + importer);
        for (const match of text.matchAll(/['"]([^'"\n]+)['"]/g)) {
          if (!match[1].startsWith('.')) {
            // This exact repository-relative command belongs to the legacy
            // application's prerequisite verifier, not ci/routing/native.ts.
            if (match[1] === 'enablement/prerequisites/native.ts') continue;
            if (/\/(?:root|native|apt\.test|rust\.test)(?:\.ts)?$/.test(match[1])) return false;
            continue;
          }
          const target = posix.normalize(posix.join(posix.dirname(importer), match[1]));
          if (independentInputs.has(target) || independentInputs.has(target + '.ts')) return false;
        }
      }
      if (matches.trim().split('\n').filter(Boolean).some(line => !callers.has(line.slice(ref.length + 1)))) return false;
    }
    for (const path of candidates) {
      const raw = git('diff', '--raw', '--no-abbrev', '--no-renames', base, head, '--', path).trim();
      if (!/^:100644 100644 [a-f0-9]{40} [a-f0-9]{40} M\t/.test(raw)) return false;
      const before = imports(path, git('show', base + ':' + path));
      if (before === null || before !== imports(path, git('show', head + ':' + path))) return false;
    }
    return true;
  } catch {return false;}
}

const { root, desktopPaths, excludedSuffixes } = JSON.parse(
  readFileSync(
    new URL("../../../../engine/enablement/ci/inputs.json", import.meta.url),
    "utf8",
  ),
) as { root: string; desktopPaths: string[]; excludedSuffixes: string[] };
export const desktopEnginePaths = desktopPaths.map((path) => path + "**");
export const automaticPaths = [
  root + "/**",
  ...desktopEnginePaths.map((path) => "!" + path),
  ...excludedSuffixes.map((suffix) => "!" + root + "/**/*" + suffix),
];
export const affectsEngine = (path: string) =>
  path.startsWith(root + "/") &&
  !desktopPaths.some((prefix) => path.startsWith(prefix)) &&
  !excludedSuffixes.some((suffix) => path.endsWith(suffix));
export { desktopPaths };
