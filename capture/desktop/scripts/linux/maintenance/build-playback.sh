#!/bin/sh
# Build only. Never installs, changes a session, or restarts an audio service.
set -eu
out=${1:?usage: build-playback.sh OUTPUT_DIRECTORY [--test]}
case "$out" in /*) ;; *) out="$PWD/$out";; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../../.." && pwd)
src="$root/capture/desktop/linux/playback"
mkdir -p "$out"
cc=${CC:-cc}
if [ -n "${SPA_INCLUDE_DIR:-}" ]; then
    # For an offline checkout of the pinned PipeWire 1.6.9 source tree.
    set -- "-I$SPA_INCLUDE_DIR" "${2:-}"
else
    version=$(pkg-config --modversion libpipewire-0.3)
    [ "$version" = 1.6.9 ] || { printf '%s\n' 'Requires PipeWire 1.6.9 headers (or SPA_INCLUDE_DIR from that source)'; exit 1; }
    # pkg-config may produce more than one include flag.
    includes=$(pkg-config --cflags libspa-0.2)
    set -- "$includes" "${2:-}"
fi
flags='-std=gnu11 -O2 -Wall -Wextra -Werror'
if [ "${SANITIZE:-0}" = 1 ]; then flags="$flags -g -fsanitize=address,undefined -fno-omit-frame-pointer"; fi
# Deliberate splitting for compiler/pkg-config flag lists; quote the source paths.
# shellcheck disable=SC2086
"$cc" $flags $1 -fPIC -shared "$src/plugin.c" -o "$out/libspa-filter-graph-plugin-apparentlease.so"
# shellcheck disable=SC2086
"$cc" $flags "$src/helper.c" -o "$out/apparent-playback-helper"
if [ "$2" = --test ]; then
    python3 "$src/test_policy.py"
    # shellcheck disable=SC2086
    "$cc" $flags $1 "$src/test_native.c" -ldl -o "$out/test-native"
    runtime=$(mktemp -d "$out/apparent-playback.XXXXXX")
    trap 'rm -rf -- "$runtime"' EXIT HUP INT TERM
    XDG_RUNTIME_DIR="$runtime" timeout 30 "$out/test-native" "$out/libspa-filter-graph-plugin-apparentlease.so" "$out/apparent-playback-helper"
fi
printf 'Built optional playback artifacts in %s (not installed)\n' "$out"
