#!/usr/bin/env bash
# Only invoked by updater-gui.py inside its disposable, network-restricted guest.
set -Eeuo pipefail
trap 'printf "scenario failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
export UPDATER_EXPECTED_SOURCE_HEAD='__UPDATER_EXPECTED_SOURCE_HEAD__'
export UPDATER_EXPECTED_SHA256='__UPDATER_EXPECTED_SHA256__'
out="${SCRAWL_GUI_OUTPUT:?}"
image="${SCRAWL_GUI_BINARY:?}"
mkdir -p "$out"
# The controller prepends the fixture source, never fetched code.
__UPDATER_FIXTURE_SOURCE__
while IFS= read -r entry; do
  case "$entry" in DISPLAY=*|WAYLAND_DISPLAY=*|XDG_RUNTIME_DIR=*|DBUS_SESSION_BUS_ADDRESS=*|HYPRLAND_INSTANCE_SIGNATURE=*) export "$entry";; esac
done < <(systemctl --user show-environment)
export APPARENT_CONFIG="$out/config.json" APPARENT_CAPTURES_DIR="$out/captures"
export APPIMAGE_EXTRACT_AND_RUN=1 CURL_CA_BUNDLE="$out/cert.pem" SSL_CERT_FILE="$out/cert.pem"
unset HTTP_PROXY ALL_PROXY http_proxy all_proxy
export HTTPS_PROXY='http://127.0.0.1:8443' https_proxy='http://127.0.0.1:8443'
export NO_PROXY='' no_proxy=''
# Refuse a template containing an already-running app. Never take over a worker.
if pgrep -u "$(id -u)" -x apparent; then echo 'template has an existing Apparent process' >&2; exit 1; fi
printf '{"onboarding":{"seen":true},"updateChannel":"stable","transcriber":"off","launchAtLogin":false}\n' > "$APPARENT_CONFIG"
# The sanitized Omarchy template's tips are a quickshell layer, not mako.
# Stop only that disposable guest's known shell supervisor and its child.
pkill -f '^/bin/bash /usr/share/omarchy/bin/omarchy-launch-shell$' || :
pkill -x quickshell || :
# A rootless guest-local CONNECT proxy preserves canonical URLs and verified TLS.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=api.github.com \
  -addext 'subjectAltName=DNS:api.github.com,DNS:github.com' \
  -keyout "$out/key.pem" -out "$out/cert.pem" > "$out/cert-generation.log" 2>&1
version="$($image --version | awk '{print $2}')"
original_hash="$(sha256sum "$image" | cut -d' ' -f1)"
[[ "$original_hash" == "$UPDATER_EXPECTED_SHA256" ]]
original_inode="$(stat -c %i "$image")"
printf '%s\n' "$original_hash" > "$out/candidate.sha256"
serial=0
control() {
  serial=$((serial + 1))
  rm -f "$out/request-started" "$out/release-response"
  printf '{"version":"%s","mode":"%s","gate":%s,"serial":%s}\n' "$version" "$1" "${2:-false}" "$serial" > "$out/control.new"
  mv "$out/control.new" "$out/control.json"
}
wait_file() {
  for _ in $(seq 1 150); do [[ ! -f "$1" ]] || return 0; sleep .1; done
  echo "timed out: $1" >&2; exit 1
}
ui() {
  printf 'UPDATER_UI %s\n' "$1"
  IFS= read -r reply
  [[ "$reply" == 'OK' ]] || { echo "GUI controller failed: $reply" >&2; exit 1; }
}
status() { "$image" update status > "$out/$1.json"; }
control current
python3 "$out/fixture.py" "$out" "$image" > "$out/fixture.log" 2>&1 &
server_job=$!
app_job=''
trap '[[ -z "$app_job" ]] || kill "$app_job" 2>/dev/null || :; kill "$server_job" 2>/dev/null || :' EXIT
wait_file "$out/server-ready"
# Open the exact packaged candidate; second launch opens its Settings via IPC.
"$image" app > "$out/app.log" 2>&1 &
app_job=$!
for _ in $(seq 1 150); do
  if "$image" capture state > "$out/capture-state.json" 2>/dev/null; then break; fi
  sleep .1
done
"$image" app >> "$out/app.log" 2>&1
ui '{"op":"click","text":"About","label":"open-about"}'
ui '{"op":"assert","text":"Check for Updates","label":"baseline"}'
# Acknowledged startup checksum, not a boot-time sleep or the first request alone.
wait_file "$out/startup-complete"
status baseline
python3 - "$out/baseline.json" <<'PY'
import json,os,sys
s=json.load(open(sys.argv[1])); r=s['running']
assert r and s['canUpdate'] and not s['pendingRestart'], s
assert r['revision'] == os.environ['UPDATER_EXPECTED_SOURCE_HEAD'], s
PY
baseline_pid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["running"]["pid"])' "$out/baseline.json")"
tr '\0' '\n' < "/proc/$baseline_pid/environ" | grep -Fx "APPIMAGE=$image" > "$out/running-image.txt"
printf '%s\n' "$original_inode" > "$out/original-inode.txt"
manual() {
  control "$1" true
  ui "{\"op\":\"click\",\"text\":\"Check for Updates\",\"label\":\"$1-click\"}"
  wait_file "$out/request-started"
  ui "{\"op\":\"assert\",\"text\":\"Checking\",\"label\":\"$1-loading\",\"timeout\":2}"
  # A second actual pointer click on the disabled loading control must do nothing.
  ui "{\"op\":\"click\",\"text\":\"Checking\",\"label\":\"$1-disabled-click\"}"
  touch "$out/release-response"
}
manual current
ui '{"op":"assert","text":"No update available","label":"no-update"}'
ui '{"op":"click","text":"OK","label":"dismiss-current"}'
manual error
ui '{"op":"assert","text":"Update check failed","label":"network-error"}'
ui '{"op":"click","text":"OK","label":"dismiss-error"}'
manual current
ui '{"op":"assert","text":"No update available","label":"retry-succeeded"}'
ui '{"op":"click","text":"OK","label":"dismiss-retry"}'
manual bad-checksum
ui '{"op":"assert","text":"Update check failed","label":"checksum-error"}'
[[ "$(sha256sum "$image" | cut -d' ' -f1)" == "$original_hash" ]]
[[ "$(stat -c %i "$image")" == "$original_inode" ]]
[[ ! -e "$image.apparent-update.json" ]]
[[ -z "$(find "$(dirname "$image")" -maxdepth 1 -name '.*.download-*' -o -name '.*.update-*')" ]]
status checksum-error
ui '{"op":"click","text":"OK","label":"dismiss-checksum"}'
manual available
ui '{"op":"assert","text":"Update available","label":"available"}'
ui '{"op":"click","text":"Update later","label":"defer"}'
ui '{"op":"assert-dismissed","label":"later-dismissed"}'
assert_deferred() {
status "$1"
python3 - "$out/$1.json" "$baseline_pid" <<'PY'
import json,os,sys
s=json.load(open(sys.argv[1]))
assert s['pendingRestart'] is True and s['running']['pid'] == int(sys.argv[2]), s
assert s['installed'] == {'channel':'stable','id':'v999.0.0'}, s
os.kill(s['running']['pid'], 0)
PY
}
assert_deferred deferred
backup="$(dirname "$image")/.$(basename "$image").previous"
[[ "$(sha256sum "$backup" | cut -d' ' -f1)" == "$original_hash" ]]
[[ "$(sha256sum "$image" | cut -d' ' -f1)" == "$original_hash" ]]
[[ "$(stat -c %i "$image")" != "$original_inode" ]]
[[ "$(stat -c %i "$backup")" == "$original_inode" ]]
printf '%s\n' "$(stat -c %i "$image")" > "$out/staged-inode.txt"
# A staged update remains available. Escape is another real cancellation path.
control available
ui '{"op":"click","text":"Check for Updates","label":"check-staged"}'
ui '{"op":"assert","text":"Update available","label":"staged-result"}'
ui '{"op":"key","key":"esc","label":"escape-defer"}'
ui '{"op":"assert-dismissed","label":"escape-dismissed"}'
assert_deferred escape-deferred
ui '{"op":"click","text":"Check for Updates","label":"check-before-relaunch"}'
ui '{"op":"assert","text":"Update available","label":"relaunch-offered"}'
ui '{"op":"click","text":"Update now","label":"restart"}'
# No real release: this deliberately restarts the SAME candidate bytes under a
# synthetic newer release ID, exclusively in the disposable guest.
for _ in $(seq 1 200); do
  status relaunched
  if python3 - "$out/relaunched.json" "$baseline_pid" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); r=s['running']
sys.exit(0 if r and r['pid'] != int(sys.argv[2]) and not s['pendingRestart'] and r['updateId']=='v999.0.0' else 1)
PY
  then break; fi
  sleep .1
done
python3 - "$out/relaunched.json" "$baseline_pid" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); r=s['running']
assert r and r['pid'] != int(sys.argv[2]) and not s['pendingRestart'] and r['updateId']=='v999.0.0', s
PY
"$image" app >> "$out/app.log" 2>&1
ui '{"op":"click","text":"About","label":"reopen-about"}'
ui '{"op":"assert","text":"Check for Updates","label":"relaunch-verified"}'
ui '{"op":"hold","seconds":3,"label":"finished"}'
python3 - "$out/requests.jsonl" <<'PY'
from collections import Counter
import json,sys
requests=[json.loads(line) for line in open(sys.argv[1])]
counts=Counter(r['control']['serial'] for r in requests if r['control']['gate'] and r['path'].endswith('/latest'))
assert counts == {2:1,3:1,4:1,5:1,6:1}, counts
downloads=[r for r in requests if r['path'].endswith('.AppImage')]
assert len(downloads)==2, downloads  # rejected checksum, then staged; no re-download on recheck
PY
printf 'UPDATER_GUI_PASS\n'
