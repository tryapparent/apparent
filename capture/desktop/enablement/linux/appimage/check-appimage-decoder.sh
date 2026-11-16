#!/usr/bin/env bash
# Test the shipped GStreamer runtime, not the build host's registry.
set -euo pipefail
image="$(realpath "$1")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# Use the build host only to make the fixture; decoding runs inside the AppImage.
gst-launch-1.0 -q videotestsrc num-buffers=8 ! video/x-raw,width=160,height=90,framerate=10/1 ! x264enc ! h264parse ! mp4mux ! filesink location="$work/sample.mp4"
GST_PLUGIN_SYSTEM_PATH_1_0= GST_PLUGIN_PATH_1_0= APPIMAGE_EXTRACT_AND_RUN=1 \
  "$image" decoder-check "$work/sample.mp4" | grep -F '(160x90)'
