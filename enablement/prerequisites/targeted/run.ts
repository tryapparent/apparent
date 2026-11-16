// Prepared targeted renderer checks; not native acceptance or a concurrent-build lock.
import { statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkElectron } from '../native.ts';

export function targetedElectron(root: string, files: string[]): number {
  const frontend = realpathSync(resolve(root, 'capture/desktop/ui/frontend'));
  if (!files.length) throw Error('Name one or more frontend-relative test files; no flags or globs');
  const selected = files.map(file => {
    if (file.startsWith('-') || isAbsolute(file) || !/\.(?:ts|cts|cjs)$/.test(file)) throw Error('Invalid test file: ' + file);
    const absolute = realpathSync(resolve(frontend, file));
    const local = relative(frontend, absolute);
    if (local.startsWith('..') || isAbsolute(local) || !/^(?:tests|electron|src)\//.test(local) ||
        !statSync(absolute).isFile() || !statSync(absolute).size) throw Error('Invalid test file: ' + file);
    return absolute;
  });
  // Electron's require may perform lazy installation. Finish it in this parent,
  // before either the build or test workers can resolve the package.
  checkElectron(root);
  const build = spawnSync('npm', ['run', 'build'], {cwd: frontend, stdio: 'inherit'});
  if (build.error) throw build.error;
  if (build.status !== 0) return build.status ?? 1;
  const tests = spawnSync(process.execPath,
    ['--experimental-strip-types', '--test', '--test-concurrency=1', ...selected],
    {cwd: frontend, stdio: 'inherit'});
  if (tests.error) throw tests.error;
  return tests.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = targetedElectron(resolve(import.meta.dirname, '../../..'), process.argv.slice(2));
}
