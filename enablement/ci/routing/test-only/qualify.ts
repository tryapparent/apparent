import {execFileSync} from 'node:child_process';
import {moduleImports} from '../fixture-portability/imports.ts';

// Reviewed contract test only. Its workflow reads and synthetic command probes
// run in the mandatory `bun test enablement/ci/` lane, not in product builds.
export const ciTestInputs = new Set(['enablement/ci/runner/mac-platform.test.ts']);
const dependencies = ['node:test', 'node:assert/strict', 'node:fs', 'node:path',
  'node:os', 'node:child_process', 'bun', '../routing/consumers.ts'].sort();

export function qualifyCiTests(base: string, head: string, candidates: string[], cwd: string): string[] {
  const git = (args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  return candidates.filter(path => {
    if (!ciTestInputs.has(path)) return false;
    try {
      const raw = git(['diff', '--raw', '--no-abbrev', '--no-renames', '-z', base, head, '--', path]).split('\0');
      if (raw.length !== 3 || raw[1] !== path || !/^:100644 100644 [a-f0-9]{40} [a-f0-9]{40} M$/.test(raw[0])) return false;
      for (const revision of [base, head]) {
        const bytes = execFileSync('git', ['show', revision + ':' + path], {cwd, maxBuffer: 16 * 1024 * 1024});
        const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        const imports = moduleImports(text);
        // New imports/exports, loaders or dependency shapes require a new audit.
        if (!imports || JSON.stringify([...imports].sort()) !== JSON.stringify(dependencies) ||
            /\b(?:import|require)\s*(?:\(|\/)|\b(?:createRequire|module|exports)\b/.test(text)) return false;
      }
      // Candidate inbound references include module aliases, extensionless names,
      // filesystem consumers and directory aliases. Unknown consumers fail broad.
      let references = '';
      try { references = git(['grep', '-I', '-l', '-F', '-e', 'mac-platform', '-e', 'ci/runner',
        '-e', './runner/', '-e', '@runner/', head, '--']); }
      catch (error) { if ((error as {status?: number}).status !== 1) throw error; }
      return references.trim().split('\n').filter(Boolean).every(line => {
        const consumer = line.slice(head.length + 1);
        return consumer === path || consumer.endsWith('.md') ||
          consumer === 'enablement/ci/routing/test-only/qualify.ts' ||
          consumer === 'enablement/ci/routing/test-only/qualify.test.ts';
      });
    } catch { return false; }
  });
}
