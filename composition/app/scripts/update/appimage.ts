/** Wrap an already verified Electron bundle; never build another owner's source. */
import { build, Platform, Arch } from 'electron-builder';
import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPackagedApplication } from '../package.ts';
import { identity } from '../../src/update/contract.ts';
import { createHash } from 'node:crypto';

export async function appImage(bundle: string, output: string, sourceSha: string) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Main AppImage packaging requires Linux x64');
  const release = identity({ schema: 1, channel: 'main', target: 'linux-x64', sourceSha });
  await verifyPackagedApplication(bundle, 'linux');
  await mkdir(output, { recursive: true });
  await writeFile(join(bundle, 'resources/app-shell-release.json'), JSON.stringify(release) + '\n', { flag: 'wx' });
  // electron-builder's AppRun also injects --no-sandbox when its namespace
  // heuristic fails, independently of executableArgs. Keep sandboxing mandatory;
  // a restricted host must provide a working sandbox rather than silently lose it.
  await rename(join(bundle, 'apparent-foundation'), join(bundle, 'apparent-foundation-bin'));
  await writeFile(join(bundle, 'apparent-foundation'), `#!/usr/bin/env bash
set -e
binary="$(dirname "$(readlink -f "$0")")/apparent-foundation-bin"
args=()
for arg in "$@"; do
  if [[ "$arg" != --no-sandbox ]]; then args+=("$arg"); fi
done
exec "$binary" "\${args[@]}"
`, { flag: 'wx', mode: 0o755 });
  await chmod(join(bundle, 'apparent-foundation'), 0o755);
  const name = `Apparent-Foundation-main-${sourceSha}-linux-x64.AppImage`;
  await build({ targets: Platform.LINUX.createTarget('AppImage', Arch.x64), prepackaged: resolve(bundle),
    projectDir: resolve(bundle, 'resources/app'), publish: 'never', config: {
      appId: 'com.tryapparent.foundation', productName: 'Apparent Foundation',
      directories: { output: resolve(output) }, artifactName: name,
      linux: { executableName: 'apparent-foundation', category: 'Utility', executableArgs: [] },
      // electron-builder's legacy default adds --no-sandbox; explicitly retain
      // Chromium sandboxing in both the desktop entry and direct AppRun route.
      appImage: { executableArgs: [] },
      electronVersion: '45.2.1', npmRebuild: false,
    } });
  const bytes = await readFile(join(output, name));
  if (bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes.subarray(8, 11).toString('hex') !== '414902') throw new Error('Expected a type-2 AppImage');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(output, name + '.sha256'), `${sha256}  ${name}\n`);
  return { name, sha256, size: bytes.length };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [bundle, output, sourceSha] = process.argv.slice(2);
  console.log(JSON.stringify(await appImage(resolve(bundle), resolve(output), sourceSha)));
}
