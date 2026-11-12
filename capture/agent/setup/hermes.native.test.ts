import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { macHandler, system } from './hermes.ts';

// Native metadata proof, without opening a URL, launching an app, permissions,
// Rust, Electron, or touching the real apparent scheme's registration.
test('LaunchServices resolves an owned synthetic scheme to its actual executable', { skip: process.platform !== 'darwin' || process.env.APPARENT_SETUP_NATIVE_FIXTURE !== '1', timeout: 60000 }, () => {
  // Selecting a default can leave an OS-owned preference after unregistering.
  // The entire account must be disposable; refuse ordinary/self-hosted Macs.
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native selection fixture requires disposable hosted CI');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Native selection fixture refuses self-hosted accounts');
  // Keep the fixture in the disposable runner's user-owned staging directory.
  // /tmp registration returned success but exposed no candidates, even after
  // strict signature verification. Change only location to distinguish that
  // eligibility boundary; do not weaken the selected-handler assertions.
  const staging = process.env.RUNNER_TEMP;
  assert(staging && isAbsolute(staging), 'Native fixture requires hosted runner staging');
  const home = mkdtempSync(join(staging, 'apparent-dev-handler-native-'));
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
    // The copied Apple command retains its original code identity. Give this
    // owned app bundle its own coherent ad-hoc identity before registration;
    // never modify or sign the system executable itself.
    assert(system.run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', bundleId, bundle]).ok, 'Synthetic app signing failed');
    assert(system.run('/usr/bin/codesign', ['--verify', '--strict', bundle]).ok, 'Synthetic app signature verification failed');
    assert.equal(macHandler(system, executable, scheme).status, 'absent');
    registrationAttempted = true;
    // lsregister's process exit alone did not establish registration on hosted
    // Macs. Require the native operation's actual OSStatus before selection.
    const registration = system.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
ObjC.import('Foundation');
ObjC.import('CoreServices');
function run(argv) {
  return String($.LSRegisterURL($.NSURL.fileURLWithPath($(argv[0])), true));
}`, bundle]);
    assert(registration.ok && registration.output.trim() === '0', `Synthetic registration OSStatus: ${registration.output.slice(0, 100)}`);
    // Registration supplies a candidate; this test queries the selected handler.
    // Select only this fresh, owned scheme, never the real Apparent scheme.
    const selection = system.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
ObjC.import('CoreServices');
function run(argv) {
  return String($.LSSetDefaultHandlerForURLScheme($(argv[0]), $(argv[1])));
}`, scheme, bundleId]);
    assert(selection.ok && selection.output.trim() === '0', `Synthetic handler selection failed: ${selection.output.slice(0, 100)}`);
    const observed = macHandler(system, realpathSync(executable), scheme);
    if (observed.status !== 'ok') {
      // Distinguish invalid fixture metadata, missing registration and missing
      // selection. Report only booleans/counts for this owned scheme/bundle;
      // never dump the account's LaunchServices database or provider stderr.
      const diagnostics = system.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
ObjC.import('AppKit');
ObjC.import('CoreServices');
function run(argv) {
  var result = {};
  function probe(key, read) {
    try { result[key] = read(); } catch (_) { result[key] = 'unavailable'; }
  }
  var workspace = $.NSWorkspace.sharedWorkspace;
  var bundle = $.NSBundle.bundleWithPath($(argv[1]));
  function samePath(actual, expected) {
    return ObjC.unwrap(actual.stringByResolvingSymlinksInPath) === ObjC.unwrap($(expected).stringByResolvingSymlinksInPath);
  }
  probe('bundleReadable', function () { return !bundle.isNil(); });
  probe('bundleIdentifierMatches', function () { return ObjC.unwrap(bundle.bundleIdentifier) === argv[2]; });
  probe('bundleExecutableMatches', function () { return samePath(bundle.executablePath, argv[3]); });
  probe('executableRunnable', function () { return !!$.NSFileManager.defaultManager.isExecutableFileAtPath($(argv[3])); });
  probe('defaultIdentifierMatches', function () {
    return ObjC.unwrap($.LSCopyDefaultHandlerForURLScheme($(argv[0]))) === argv[2];
  });
  probe('identifierResolvesToFixture', function () {
    var url = workspace.URLForApplicationWithBundleIdentifier($(argv[2]));
    return !url.isNil() && samePath(url.path, argv[1]);
  });
  probe('schemeCandidateCount', function () {
    return Number(workspace.URLsForApplicationsToOpenURL($.NSURL.URLWithString(argv[0] + '://open')).count);
  });
  return JSON.stringify(result);
}`, scheme, bundle, bundleId, executable]);
      assert.fail(JSON.stringify({ observed, diagnostics: { ok: diagnostics.ok, output: diagnostics.output.slice(0, 2000) } }));
    }
    assert.equal(realpathSync(observed.evidence!.bundle!), realpathSync(bundle));
    assert.equal(macHandler(system, realpathSync(process.execPath), scheme).status, 'incompatible');
    assert.equal(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8').includes(scheme), true);
  } finally {
    const cleanup = registrationAttempted ? system.run(registry, ['-u', bundle]) : { ok: true };
    rmSync(home, { recursive: true, force: true });
    assert(cleanup.ok, 'Synthetic LaunchServices unregister failed');
  }
});
