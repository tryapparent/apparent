// Parse modules without executing candidate code. Publication-only callers need
// Node 22, not Bun; unavailable parsing still fails broad.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import module from 'node:module';
import vm from 'node:vm';

const cache = new Map<string, string[] | null>();
export function moduleImports(source: string): string[] | null {
  if (cache.has(source)) return cache.get(source)!;
  let modules: string[] | null = null;
  try {
    if (!process.versions.bun && typeof vm.SourceTextModule === 'function')
      modules = [...new vm.SourceTextModule(module.stripTypeScriptTypes(source)).dependencySpecifiers];
    else {
      const node = process.versions.bun ? 'node' : process.execPath;
      const result = spawnSync(node, ['--experimental-vm-modules', '--experimental-strip-types', fileURLToPath(import.meta.url)],
        {input: source, encoding: 'utf8', maxBuffer: 1024 * 1024});
      if (!result.error && result.status === 0) {
        const value = JSON.parse(result.stdout);
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) modules = value;
      }
    }
  } catch { /* Unsupported syntax cannot earn the exception. */ }
  cache.set(source, modules);
  return modules;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = moduleImports(readFileSync(0, 'utf8'));
  if (result === null) process.exitCode = 1;
  else process.stdout.write(JSON.stringify(result));
}
