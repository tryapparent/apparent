#!/usr/bin/env bash
# Packs a built `apparent` into an AppImage with GStreamer and its plugins (screen capture,
# H.264 encoding, decoding) inside, so a movie records on any desktop:
#
#   ./capture/desktop/scripts/linux/appimage/appimage.sh [path/to/apparent]   # default target/release/apparent
#
# Writes target/appimage/Apparent-<arch>.AppImage. Needs the GStreamer plugin packages installed
# (gstreamer1.0-plugins-{base,good,bad,ugly}, gstreamer1.0-pipewire) and patchelf; linuxdeploy and its
# GStreamer plugin are downloaded into target/appimage/tools the first time.
set -euo pipefail
# Distribution members must be readable by the installing user even when the
# build was launched from a private evidence scope. This affects newly staged
# package files only; never chmod an existing source/profile or global setting.
umask 0022

root="$(cd "$(dirname "$0")/../../../../.." && pwd)"
binary="$(realpath "${1:-$root/target/release/apparent}")"
arch="$(uname -m)"
out="$root/target/appimage"
tools="${APPARENT_PACKAGING_TOOLS_DIR:-$out/tools}"
appdir="$out/AppDir"
mkdir -p "$tools"
# AppImage tools re-execute helpers from their extracted runtime. Keep those
# live files inside this owned build tree instead of shared /tmp maintenance.
# Failed runs retain their private runtime for diagnosis; remove only on success
# after every foreground packaging/encoder child has exited.
runtime_tmp="$(mktemp -d "$out/.tool-runtime.XXXXXXXX")"
export TMPDIR="$runtime_tmp"
manifest="${APPARENT_PACKAGING_TOOLS_MANIFEST:-$out/packaging-tools.json}"
if [[ -z "${APPARENT_PACKAGING_TOOLS_MANIFEST:-}" ]]; then
  node --experimental-strip-types "$root/capture/desktop/scripts/linux/appimage/packaging-tools.ts" resolve "$manifest"
fi
node --experimental-strip-types "$root/capture/desktop/scripts/linux/appimage/packaging-tools.ts" install "$manifest" "$tools"
rm -rf "$appdir"
python3 "$root/capture/desktop/scripts/packaging/stage-settings.py" "$appdir/usr/share/apparent/settings" \
  --popups-destination "$appdir/usr/lib/apparent/note-ui"
# Copies preserve cached frontend modes. Normalize only this freshly recreated
# distribution tree; recursive chmod ignores symlinks encountered within it.
chmod -R a+rX "$appdir"

multiarch="$(gcc -print-multiarch 2>/dev/null || echo "$arch-linux-gnu")"
export GSTREAMER_PLUGINS_DIR="/usr/lib/$multiarch/gstreamer-1.0"
export GSTREAMER_HELPERS_DIR="/usr/lib/$multiarch/gstreamer1.0/gstreamer-1.0"
export GSTREAMER_INCLUDE_BAD_PLUGINS=1
# CI runners have no FUSE.
export APPIMAGE_EXTRACT_AND_RUN=1
export PATH="$tools:$PATH"

# These modules are dlopen'd, not DT_NEEDED dependencies: linuxdeploy cannot
# discover them from apparent. Stage every tier next to libtranscribe in usr/lib.
libraries=()
for library in "$(dirname "$binary")"/libggml-cpu*.so; do
  [[ -f "$library" ]] || { echo "Missing transcribe runtime: $library" >&2; exit 1; }
  libraries+=(--library "$library")
done

cd "$out"
LDAI_OUTPUT="Apparent-$arch.AppImage" linuxdeploy \
  --appdir "$appdir" \
  --executable "$binary" \
  "${libraries[@]}" \
  --executable "$(command -v wl-copy)" \
  --executable "$(command -v wl-paste)" \
  --desktop-file "$root/capture/desktop/packaging/linux/dev.kitlangton.apparent.desktop" \
  --icon-file "$root/capture/desktop/packaging/linux/dev.kitlangton.apparent.png" \
  --plugin gstreamer \
  --output appimage
bash "$root/capture/desktop/scripts/linux/appimage/check-appimage-encoder.sh" "$out/Apparent-$arch.AppImage"
rm -rf -- "$runtime_tmp"
echo "$out/Apparent-$arch.AppImage"
