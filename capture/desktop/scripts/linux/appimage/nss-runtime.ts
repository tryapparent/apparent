// NSS loads these modules at runtime; ELF DT_NEEDED traversal misses them.
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const modules = ['libsoftokn3.so', 'libfreebl3.so', 'libfreeblpriv3.so', 'libnssckbi.so'];
export function verifyDependencies(output: string, directory: string): void {
  if (/not found|undefined symbol/.test(output)) throw new Error(`Incomplete NSS runtime: ${output}`);
  for (const line of output.split('\n')) {
    const match = line.match(/\b(lib(?:nss3|nssutil3|smime3|ssl3|nspr4|plc4|plds4|sqlite3)\.so(?:\.\d+)*) => (\S+)/);
    if (match && !realpathSync(match[2]).startsWith(realpathSync(directory) + '/')) {
      throw new Error(`NSS dependency escaped AppDir: ${line.trim()}`);
    }
  }
}
export function modulePaths(directory: string): string[] {
  return modules.map(name => {
    const file = resolve(directory, name);
    if (!existsSync(file)) throw new Error(`Missing NSS runtime module: ${file}`);
    return realpathSync(file);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, directory] = process.argv.slice(2);
  if (!directory || !['libraries', 'check'].includes(mode)) throw new Error('Usage: nss-runtime.ts libraries|check LIBDIR');
  const paths = modulePaths(directory);
  if (mode === 'libraries') {
    for (const file of paths) process.stdout.write(file + '\n');
  } else {
    // Resolve relocations as well as dependency names. Never launch a shell with
    // AppImage LD_LIBRARY_PATH: bundled readline can break the host shell.
    for (const file of paths) {
      const result = spawnSync('/usr/bin/ldd', ['-r', file], { encoding: 'utf8' });
      if (result.error || result.status !== 0) throw new Error(`NSS dependency check failed: ${result.error || result.stderr}`);
      verifyDependencies(result.stdout + result.stderr, directory);
    }
  }
}
