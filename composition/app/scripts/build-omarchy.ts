import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildShell, root } from './build.ts';
import { buildRecordArtifact } from './build-record.ts';
import { assemble } from './assemble.ts';
import { packageApplication } from './package.ts';
import { digest } from './artifacts.ts';
import type { RecordNativeArtifacts } from './record-native.ts';
import { hasReviewedGuiRefusalContract } from '../src/record/omarchy/startup-refusal.ts';

/** Packages already admitted Engine/config closures and this candidate's GUI.
 * Does not launch the desktop, record, copy, install or change routing. */
export async function buildOmarchyPackage(output: string, nativeArtifacts: RecordNativeArtifacts) {
  nativeArtifacts = structuredClone(nativeArtifacts);
  assert(process.platform === 'linux' && process.arch === 'x64', 'Omarchy package requires Linux x64');
  assert(nativeArtifacts.gui, 'Complete desktop requires the adapter-only GUI closure');
  assert(hasReviewedGuiRefusalContract(nativeArtifacts.gui.executableSha256),
    'Native GUI startup-refusal contract must be reviewed for this exact executable before packaging');
  const repo = resolve(root, '../..');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repo, encoding: 'utf8' }), '',
    'Freeze and commit the complete candidate before packaging');
  const destination = resolve(output);
  await mkdir(destination); // refuse any existing package/evidence
  const shell = join(destination, 'build/shell');
  await buildShell(shell, undefined, { module: join(root, 'src/record/omarchy/entry.ts'),
    nativeArtifacts, presentation: 'omarchy' });
  const record = join(destination, 'build/record');
  await buildRecordArtifact(record);
  const assembly = await assemble(shell, [record], join(destination, 'build/assembly'));
  const packaged = await packageApplication(assembly, join(destination, 'build/packages'));
  const install = join(destination, 'apparent-omarchy');
  await mkdir(install);
  await cp(packaged, join(install, 'app'), { recursive: true, errorOnExist: true, force: false });
  // A user-owned distribution cannot supply a root-owned SUID helper. Use
  // Chromium's namespace sandbox explicitly, and keep this helper unwritable.
  await chmod(join(install, 'app/chrome-sandbox'), 0o755);
  // A normal, explicit launch with one persistent dedicated profile. Preserve
  // the real session's Wayland/DBus/runtime environment for portal consent.
  await writeFile(join(install, 'apparent'), `#!/usr/bin/env bash
set -euo pipefail
umask 0077
package_dir="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
user_home="\${HOME:?HOME is required}"
profile="\${APPARENT_OMARCHY_PROFILE:-\${XDG_DATA_HOME:-$user_home/.local/share}/apparent-omarchy}"
case "$profile" in /*) ;; *) echo 'Profile must be absolute' >&2; exit 64;; esac
mkdir -p -- "$profile/home/.config/apparent" "$profile/home/.cache" "$profile/home/.local/share"
exec env HOME="$profile/home" XDG_CONFIG_HOME="$profile/home/.config" XDG_CACHE_HOME="$profile/home/.cache" XDG_DATA_HOME="$profile/home/.local/share" APPARENT_CONFIG="$profile/home/.config/apparent/config.json" APPARENT_FOUNDATION_PROFILE="$profile" "$package_dir/app/apparent-foundation" --disable-setuid-sandbox
`, { mode: 0o755, flag: 'wx' });
  await chmod(join(install, 'apparent'), 0o755);
  await writeFile(join(install, 'README.txt'),
    'Apparent Omarchy MVP candidate\n\nLaunch ./apparent from an extracted, user-owned directory. Keep the directory intact.\n'
    + 'Choose one monitor in the real portal. Record starts silent video; Record with microphone requires a configured local model and actual native support. Controls hide during capture; activate the Apparent tray icon to Stop. The tray menu also provides Cancel recording for the exact active capture. A requested or unknown cancellation is not a confirmed cancelled recording; the menu reports authoritative cancelled status separately.\n'
    + 'Optional microphone resource: place the explicit, verified parakeet-unified-en-0.6b-Q8_0.gguf (731357568 bytes, SHA256 4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795) in <profile>/resources/ before launch. The resources directory must be user-owned mode 0700; the regular model must have one link and no group/world write. No automatic download or microphone fallback is supplied. Native support is not transcript success.\n'
    + 'When drawing input is ready, hold Shift and move to draw. The tray menu opens Board and provides Undo drawing, Clear drawing and Close Board; reopening preserves completed marks. Input-device access, scale1 and native source identity are required. An unavailable source is not an empty collected drawing. Accepted history includes later undone or cleared gestures; movie pixels show the current canvas.\n'
    + 'Only authenticated Saved enables text handoff. Submission/matching bytes do not prove ownership or paste.\n'
    + 'State persists in ~/.local/share/apparent-omarchy by default. Never delete this profile to clear unknown work.\n'
    + 'Chromium user-namespace sandbox support is required. The launcher disables only the SUID helper; never use --no-sandbox or disable namespace/seccomp protection.\n'
    + 'This candidate does not install an updater or change OS routing. Close older Apparent instances before using this candidate.\n', { flag: 'wx' });
  const assemblyHash = digest(await readFile(join(install, 'app/resources/app/assembly.json')));
  await writeFile(join(destination, 'package-receipt.json'), JSON.stringify({ schema: 1, source,
    target: 'linux-x64', entry: 'apparent-omarchy/apparent', assemblySha256: assemblyHash,
    nativeArtifacts, sandbox: 'chromium-user-namespace-required',
    proof: 'packaging-only; native desktop acceptance remains required' }, null, 2) + '\n');
  return install;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, output] = process.argv.slice(2);
  assert(input && output, 'Usage: build-omarchy.ts <admitted-native-inputs.json> <fresh-output>');
  console.log(await buildOmarchyPackage(output, JSON.parse(await readFile(input, 'utf8'))));
}
