// Parse modules without executing candidate code. Node callers use the same Bun
// already required by the shared selector; missing/invalid parsing fails broad.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

declare const Bun: {Transpiler: new(options: {loader: 'ts'}) => {
  scanImports(source: string): {path: string; kind: string}[];
}};
const cache = new Map<string, string[] | null>();
export function moduleImports(source: string): string[] | null {
  if (cache.has(source)) return cache.get(source)!;
  let modules: string[] | null = null;
  try {
    if (typeof Bun !== 'undefined') modules = new Bun.Transpiler({loader: 'ts'}).scanImports(source).map(item => item.path);
    else {
      const result = spawnSync('bun', [fileURLToPath(import.meta.url)], {input: source, encoding: 'utf8', maxBuffer: 1024 * 1024});
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
