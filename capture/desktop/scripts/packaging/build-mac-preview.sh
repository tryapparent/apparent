#!/usr/bin/env bash
set -euo pipefail
exec node --experimental-strip-types "${0%/*}/../../../../composition/enablement/release/mac/build.ts" "$@"
