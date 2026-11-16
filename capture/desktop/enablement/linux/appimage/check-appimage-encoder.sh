#!/usr/bin/env bash
# Fail packaging unless the AppImage's own GStreamer runtime encodes a decodable H.264 MP4.
set -euo pipefail
image="$(realpath "$1")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
GST_PLUGIN_SYSTEM_PATH_1_0= GST_PLUGIN_PATH_1_0= APPIMAGE_EXTRACT_AND_RUN=1 \
  "$image" encoder-check "$work/encoded.mp4"
[ "$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$work/encoded.mp4")" = h264 ]
ffmpeg -v error -xerror -i "$work/encoded.mp4" -f null -
echo "Packaged H.264 encoder produced a playable MP4"
