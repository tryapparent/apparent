import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { macHandler, system } from './hermes.ts';

// Native metadata proof, without opening a URL, launching an app, permissions,
// Rust, Electron, or touching the real apparent scheme's registration.
test('LaunchServices resolves an owned synthetic scheme to its actual executable', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  const home = mkdtempSync('/tmp/apparent-dev-handler-native-');
  const scheme = `apparent-setup-${randomUUID().replaceAll('-', '')}`;
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
<key>CFBundleIdentifier</key><string>com.tryapparent.${scheme}</string>
<key>CFBundleName</key><string>SetupFixture</string>
<key>CFBundleExecutable</key><string>apparent</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>${scheme}</string></array></dict></array>
</dict></plist>`);
    assert.equal(macHandler(system, executable, scheme).status, 'absent');
    registrationAttempted = true;
    assert(system.run(registry, ['-f', bundle]).ok, 'Synthetic registration failed');
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
