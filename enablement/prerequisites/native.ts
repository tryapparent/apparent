// Fail before Cargo; this is input/executable readiness, never native acceptance.
import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export function checkElectron(root: string): string {
  const frontend = resolve(root, 'capture/desktop/ui/frontend');
  const require = createRequire(resolve(frontend, 'package.json'));
  const electron: unknown = require('electron');
  if (typeof electron !== 'string' || !electron.startsWith(frontend + '/node_modules/electron/')) {
    throw new Error('Electron did not resolve to the locked local installation');
  }
  accessSync(electron, constants.X_OK);
  if (!statSync(electron).isFile()) throw new Error('Electron executable is not a file');
  return electron;
}

export function checkNativeInputs(root: string, platform = process.platform): string {
  const electron = checkElectron(root);
  const inputs = [
    'capture/desktop/ui/frontend/node_modules/@apparent/record-capture-request/dist/lifecycle.js',
    'capture/desktop/ui/frontend/tests/reference-native.cjs',
    'capture/desktop/ui/frontend/electron/main.cjs',
    'capture/desktop/ui/frontend/electron/preload.cjs',
    'capture/desktop/ui/frontend/electron/runtime.cjs',
    'capture/desktop/ui/frontend/electron/connect.cjs',
    'capture/desktop/ui/frontend/electron/settings/agents.cjs',
    'capture/desktop/ui/frontend/electron/settings/update-worker.cjs',
    'capture/desktop/ui/frontend/electron/settings/labs.cjs',
    'capture/desktop/ui/frontend/electron/notes/record-transcription.cjs',
    'capture/desktop/ui/frontend/electron/storage-policy.cjs',
    'capture/desktop/ui/frontend/electron/storage-owner/location-workflow.js',
    'capture/desktop/ui/frontend/electron/storage-owner/location-policy.js',
    'capture/desktop/ui/frontend/electron/storage-owner/retention-workflow.js',
    'capture/desktop/ui/frontend/electron/storage-owner/policy.js',
    'capture/desktop/ui/frontend/electron/storage-owner/package.json',
    'capture/desktop/ui/frontend/electron/storage-owner/cleanup-policy/package.json',
    'capture/desktop/ui/frontend/electron/storage-owner/cleanup-policy/policy.js',
    'capture/desktop/ui/frontend/electron/storage-owner/cleanup-policy/retention/policy.js',
    'capture/desktop/ui/frontend/electron/storage-owner/cleanup-policy/retention/worker.js',
    'capture/desktop/ui/frontend/electron/record-completion/worker.js',
    'capture/desktop/ui/frontend/electron/record-completion/policy.js',
    'capture/desktop/ui/frontend/electron/record-completion/session.js',
    'capture/desktop/ui/frontend/electron/record-completion/copy-admission.mjs',
    'capture/desktop/ui/frontend/electron/record-completion/package.json',
    'capture/desktop/ui/frontend/electron/record-media/worker.js',
    'capture/desktop/ui/frontend/electron/record-media/policy.js',
    'capture/desktop/ui/frontend/electron/record-media/frames-worker.js',
    'capture/desktop/ui/frontend/electron/record-media/frames-policy.js',
    'capture/desktop/ui/frontend/electron/record-media/phone-worker.js',
    'capture/desktop/ui/frontend/electron/record-media/phone-policy.js',
    'capture/desktop/ui/frontend/electron/record-media/screen-worker.js',
    'capture/desktop/ui/frontend/electron/record-media/screen-policy.js',
    'capture/desktop/ui/frontend/electron/record-media/assembly-worker.js',
    'capture/desktop/ui/frontend/electron/record-media/assembly-policy.js',
    'capture/desktop/ui/frontend/electron/record-media/transcript/worker.js',
    'capture/desktop/ui/frontend/electron/record-media/transcript/policy.js',
    'capture/desktop/ui/frontend/electron/record-media/selection/worker.js',
    'capture/desktop/ui/frontend/electron/record-media/selection/cues.js',
    'capture/desktop/ui/frontend/electron/record-media/selection/scene-worker.js',
    'capture/desktop/ui/frontend/electron/record-media/selection/scene.js',
    'capture/desktop/ui/frontend/electron/record-media/package.json',
    'capture/desktop/ui/frontend/electron/record-media/node_modules/@apparent/engine-sdk/dist/index.js',
    'capture/desktop/ui/frontend/electron/record-media/native/apparent-engine-media',
    'capture/desktop/ui/frontend/electron/record-media/native/apparent-engine-frames',
    'capture/desktop/ui/frontend/electron/record-media/native/manifest.json',
    'capture/desktop/ui/frontend/electron/agent-media/worker.js',
    'capture/desktop/ui/frontend/electron/agent-media/policy.js',
    'capture/desktop/ui/frontend/electron/agent-media/range-worker.js',
    'capture/desktop/ui/frontend/electron/agent-media/range-policy.js',
    'capture/desktop/ui/frontend/electron/agent-media/package.json',
    'capture/desktop/ui/frontend/electron/agent-media/node_modules/@apparent/engine-sdk/dist/index.js',
    'capture/desktop/ui/frontend/electron/agent-media/native/apparent-engine-frames',
    'capture/desktop/ui/frontend/electron/agent-media/engine-source-manifest.json',
  ];
  if (platform === 'darwin') inputs.push(
    'capture/desktop/ui/frontend/electron/record-media/native/apparent-engine-probe',
    'capture/desktop/ui/frontend/electron/record-media/native/apparent-engine-frames-native',
    'capture/desktop/ui/frontend/electron/agent-media/native/apparent-engine-frames-native',
    'capture/desktop/ui/frontend/tests/mac-storage-native.cjs',
    'capture/desktop/scripts/native/copy-capture-id.swift',
    'capture/desktop/assets/Apparent.icns',
    'shared/assets/fonts/HostGrotesk-Variable.ttf',
    'shared/assets/brand/apparent-wordmark.png',
    'shared/assets/brand/apparent-a.png',
    'shared/assets/brand/connect-frogs.png',
  );
  for (const input of inputs) {
    const file = resolve(root, input);
    accessSync(file, constants.R_OK);
    if (!statSync(file).isFile() || statSync(file).size === 0) {
      throw new Error('Required native input is empty or not a file: ' + input);
    }
  }
  return electron;
}

export function prepareNativeInputs(root: string, platform = process.platform): string {
  // Refuse a missing runtime before paying for any TypeScript compilation.
  checkElectron(root);
  const frontend = resolve(root, 'capture/desktop/ui/frontend');
  for (const generator of ['record-capture-request', 'storage-policy', 'connect-transport', 'updates', 'pill', 'record-media']) {
    execFileSync(process.execPath, ['--experimental-strip-types', `scripts/build-${generator}.ts`],
      {cwd: frontend, stdio: 'inherit'});
  }
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/agent-media/build.ts'],
    {cwd: frontend, stdio: 'inherit'});
  return checkNativeInputs(root, platform);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Use the same complete preparation from CI and clean local checkouts.
  const electron = prepareNativeInputs(process.cwd());
  // Parse the real native picker adapter before Cargo/installed-GUI setup.
  // The Mac-only contract compiles AppleScript; it performs no UI actions.
  if (process.platform === 'darwin') execFileSync(process.execPath,
    ['--experimental-strip-types', '--test', 'enablement/prerequisites/mac-picker.test.ts'], {stdio: 'inherit'});
  console.log('Native prerequisites ready: ' + electron);
}
