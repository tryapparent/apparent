#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
version=2.9.4
sha256=ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9
# APPARENT_SPARKLE_DIR keeps the tools outside target/ (which cleans wipe), e.g.
# ~/.local/share/apparent-release/sparkle-2.9.4 on the Macs that release (docs/release.md).
destination="${APPARENT_SPARKLE_DIR:-$root/target/sparkle-$version}"
parent=$(dirname -- "$destination")
archive="$parent/Sparkle-$version.tar.xz"
url="https://github.com/sparkle-project/Sparkle/releases/download/$version/Sparkle-$version.tar.xz"

# A cached tree can be incomplete after an interrupted build. Keep other setup
# processes from reading it while one process replaces it.
mkdir -p "$parent"
lockdir="$destination.lock"
attempt=0
until mkdir "$lockdir" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 180 ]; then
    echo "Sparkle setup lock is busy: $lockdir" >&2
    exit 1
  fi
  sleep 1
done
trap 'rmdir "$lockdir"' 0
trap 'exit 1' 1 2 3 15

sparkle_complete() {
  [ -x "$1/bin/generate_appcast" ] \
    && [ -x "$1/bin/sign_update" ] \
    && [ -f "$1/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/Info.plist" ] \
    && [ -f "$1/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/MacOS/Installer" ] \
    && [ -f "$1/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc/Contents/MacOS/Downloader" ] \
    && [ -f "$1/Sparkle.framework/Versions/B/Autoupdate" ] \
    && [ -d "$1/Sparkle.framework/Versions/B/Updater.app" ]
}

if sparkle_complete "$destination"; then
  echo "$destination"
  exit 0
fi

for cache in "$root/target/sparkle-$version" "$HOME/code/open-source/voice-control/target/sparkle-$version"; do
  if [ "$cache" != "$destination" ] && sparkle_complete "$cache"; then
    rm -rf "$destination.partial"
    /usr/bin/ditto "$cache" "$destination.partial"
    rm -rf "$destination"
    mv "$destination.partial" "$destination"
    echo "$destination"
    exit 0
  fi
done

curl --fail --location --retry 3 --continue-at - --output "$archive.partial" "$url"
if ! printf '%s  %s\n' "$sha256" "$archive.partial" | shasum -a 256 -c - >&2; then
  rm -f "$archive.partial"
  exit 1
fi
mv "$archive.partial" "$archive"
rm -rf "$destination.partial"
mkdir -p "$destination.partial"
tar -xJf "$archive" -C "$destination.partial"
if ! sparkle_complete "$destination.partial"; then
  echo "Incomplete Sparkle $version archive" >&2
  exit 1
fi
rm -rf "$destination"
mv "$destination.partial" "$destination"
echo "$destination"
