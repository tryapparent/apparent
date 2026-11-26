#!/usr/bin/env bash
# Exits non-zero when this Mac's screen must not be used for a real-screen capture.
set -euo pipefail
host=$(scutil --get LocalHostName 2>/dev/null || hostname)
idle=$(ioreg -c IOHIDSystem -d 4 | awk '/HIDIdleTime/ {print int($NF / 1000000000); exit}')
if [[ $host == *Studio* ]]; then
  if [[ ${APPARENT_STUDIO_SCREEN_OK:-} != 1 ]]; then
    echo "screen-guard: refusing on $host: run real-screen captures on the Pro (ssh pro, /tmp/pro-gui.lock) or a virtual display" >&2
    exit 1
  fi
  if [[ -z $idle || $idle -ge 60 ]]; then
    echo "screen-guard: refusing on $host: idle ${idle:-?} s, recent user activity could not be confirmed" >&2
    exit 1
  fi
fi
