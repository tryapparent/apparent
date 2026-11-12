import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { macHandler, system } from './hermes.ts';

// Native metadata proof, without opening a URL, launching an app, permissions,
// Rust, Electron, or touching the real apparent scheme's registration.
test('LaunchServices resolves an owned synthetic scheme to its actual executable', { skip: process.platform !== 'darwin' || process.env.APPARENT_SETUP_NATIVE_FIXTURE !== '1', timeout: 60000 }, () => {
  // Selecting a default can leave an OS-owned preference after unregistering.
  // The entire account must be disposable; refuse ordinary/self-hosted Macs.
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native selection fixture requires disposable hosted CI');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Native selection fixture refuses self-hosted accounts');
  const home = mkdtempSync('/tmp/apparent-dev-handler-native-');
  const scheme = `apparent-setup-${randomUUID().replaceAll('-', '')}`;
  const bundleId = `com.tryapparent.${scheme}`;
  const bundle = join(home, 'SetupFixture.app');
  const executable = join(bundle, 'Contents/MacOS/apparent');
  const registry = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  let registrationAttempted = false;
  try {
    mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
    copyFileSync('/usr/bin/true', executable);
    writeFileSync(join(bundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleName</key><string>SetupFixture</string>
<key>CFBundleExecutable</key><string>apparent</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>CFBundleURLSchemes</key><array><string>${scheme}</string></array>
</dict></array>
</dict></plist>`);
    assert.equal(macHandler(system, executable, scheme).status, 'absent');
    registrationAttempted = true;
    assert(system.run(registry, ['-f', bundle]).ok, 'Synthetic registration failed');
    // Registration supplies a candidate; this test queries the selected handler.
    // Select only this fresh, owned scheme, never the real Apparent scheme.
    const selection = system.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
ObjC.import('CoreServices');
function run(argv) {
  return String($.LSSetDefaultHandlerForURLScheme($(argv[0]), $(argv[1])));
}`, scheme, bundleId]);
    assert(selection.ok && selection.output.trim() === '0', `Synthetic handler selection failed: ${selection.output.slice(0, 100)}`);
    const observed = macHandler(system, realpathSync(executable), scheme);
    assert.equal(observed.status, 'ok', JSON.stringify(observed));
    assert.equal(realpathSync(observed.evidence!.bundle!), realpathSync(bundle));
    assert.equal(macHandler(system, realpathSync(process.execPath), scheme).status, 'incompatible');
    assert.equal(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8').includes(scheme), true);
  } finally {
    const cleanup = registrationAttempted ? system.run(registry, ['-u', bundle]) : { ok: true };
    rmSync(home, { recursive: true, force: true });
    assert(cleanup.ok, 'Synthetic LaunchServices unregister failed');
  }
});
