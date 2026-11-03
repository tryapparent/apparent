#!/usr/bin/env bash
# Private, separately identified test bundle. No signing credentials or publication.
set -euo pipefail
[[ $(uname -s) == Darwin ]] || { echo 'Build this app on macOS.' >&2; exit 1; }
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
out=${APPARENT_TEST_OUTPUT:?Set APPARENT_TEST_OUTPUT to a fresh absolute output directory}
[[ $out == /* && ! -e $out ]] || { echo 'Output must be a fresh absolute path.' >&2; exit 1; }
cd "$repo"
installer_target=(-target "$(uname -m)-apple-macos15.0")
electron_arch=""
case "${APPARENT_TEST_TARGET:-${CARGO_BUILD_TARGET:-}}" in
  "") ;;
  aarch64-apple-darwin)
    export CARGO_BUILD_TARGET=aarch64-apple-darwin
    electron_arch=arm64
    installer_target=(-target arm64-apple-macos15.0)
    ;;
  x86_64-apple-darwin)
    export CARGO_BUILD_TARGET=x86_64-apple-darwin
    electron_arch=x64
    installer_target=(-target x86_64-apple-macos15.0)
    ;;
  *) echo 'Unsupported onboarding test target.' >&2; exit 1 ;;
esac
# Use the repository build/install entry point, with no launch and a private stage.
# Its production updater is removed before the test bundle is signed or launched.
mkdir -p "$out"
APPARENT_APP_DIR="$out/Apparent Onboarding Test.app" APPARENT_NO_LAUNCH=1 bash capture/desktop/scripts/packaging/install-app.sh
app="$out/Apparent Onboarding Test.app"
resources="$app/Contents/Resources"
frontend=capture/desktop/ui/frontend
npm ci --prefix "$frontend" --no-audit --no-fund
if [[ -n "$electron_arch" ]]; then
  # npm's build tools run on the host; only the packaged Electron runtime is cross-targeted.
  rm -rf -- "$frontend/node_modules/electron/dist"
  npm_config_arch="$electron_arch" node "$frontend/node_modules/electron/install.js"
else
  node "$frontend/node_modules/electron/install.js"
fi
npm run build --prefix "$frontend"
mkdir -p "$resources/onboarding/electron"
cp -R "$frontend/dist" "$resources/onboarding/dist"
cp "$frontend"/electron/onboarding{,-preload}.cjs "$resources/onboarding/electron/"
cat > "$resources/onboarding/package.json" <<'JSON'
{"name":"apparent-onboarding-test-ui","version":"0.0.0","main":"electron/entry.cjs"}
JSON
cat > "$resources/onboarding/electron/entry.cjs" <<'JS'
require('./onboarding.cjs');
JS
ditto "$frontend/node_modules/electron/dist/Electron.app" "$resources/Apparent Test UI.app"
cat > "$resources/onboarding-shell" <<'SH'
#!/bin/sh
set -eu
resources=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$resources/Apparent Test UI.app/Contents/MacOS/Electron" "$resources/onboarding" "$@"
SH
chmod 755 "$resources/onboarding-shell"
python3 - "$app" "$(git rev-parse HEAD)" <<'PY'
import pathlib,plistlib,sys,shutil
app=pathlib.Path(sys.argv[1]);info=app/'Contents/Info.plist'
p=plistlib.loads(info.read_bytes());p.update(CFBundleIdentifier='dev.apparent.onboarding-test',CFBundleName='Apparent Onboarding Test',CFBundleDisplayName='Apparent Onboarding Test',LSEnvironment={'APPARENT_TEST_INSTANCE':'1'},ApparentTestBuildID=sys.argv[2],ApparentTestPreview=5)
for k in list(p):
 if k.startswith('SU') or k in ['CFBundleURLTypes']:p.pop(k,None)
info.write_bytes(plistlib.dumps(p))
framework=app/'Contents/Frameworks/Sparkle.framework'
if framework.exists():shutil.rmtree(framework)
ui=app/'Contents/Resources/Apparent Test UI.app/Contents/Info.plist';p=plistlib.loads(ui.read_bytes());p.update(CFBundleIdentifier='dev.apparent.onboarding-test.ui',CFBundleName='Apparent Test UI',CFBundleDisplayName='Apparent Test UI',LSUIElement=True);ui.write_bytes(plistlib.dumps(p))
PY
# Strip only this owned copy, before signing; never mutate the build cache.
strip -S "$app/Contents/MacOS/apparent" "$app/Contents/MacOS/apparent-helper"
codesign --force --sign - --identifier dev.apparent.onboarding-test.helper "$app/Contents/MacOS/apparent-helper"
codesign --force --sign - --deep "$resources/Apparent Test UI.app"
codesign --force --sign - --deep --identifier dev.apparent.onboarding-test "$app"
codesign --verify --deep --strict "$app"
installer="$out/Install Apparent Onboarding Test.app"
mkdir -p "$installer/Contents/MacOS" "$installer/Contents/Resources" "$installer/Contents/SharedSupport"
xcrun swiftc "${installer_target[@]}" -parse-as-library capture/desktop/native/installer/LocalInstaller.swift -o "$installer/Contents/MacOS/LocalInstaller"
cp capture/desktop/assets/app-icon.png "$installer/Contents/Resources/app-icon.png"
cp public/site/public/assets/pond/frog-rest-cohesive.png "$installer/Contents/Resources/frog-jump.png"
ditto "$app" "$installer/Contents/SharedSupport/Apparent Onboarding Test.app"
python3 - "$installer" <<'PY'
import pathlib,plistlib,sys
p=pathlib.Path(sys.argv[1])/'Contents/Info.plist';p.write_bytes(plistlib.dumps({'CFBundleIdentifier':'dev.apparent.onboarding-test.installer','CFBundleName':'Install Apparent Onboarding Test','CFBundleExecutable':'LocalInstaller','CFBundlePackageType':'APPL','LSMinimumSystemVersion':'15.0'}))
PY
codesign --force --sign - --deep "$installer"
codesign --verify --deep --strict "$installer"
ditto -c -k --sequesterRsrc --keepParent "$installer" "$out/Apparent-Onboarding-Test.zip"
shasum -a 256 "$out/Apparent-Onboarding-Test.zip" > "$out/SHA256SUMS"
echo "Created $out/Apparent-Onboarding-Test.zip"
