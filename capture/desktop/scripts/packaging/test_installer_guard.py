#!/usr/bin/env python3
"""Synthetic installer execution: never builds, contacts SSH or touches a real app."""
import os
import shutil
import hashlib
import io
import json
import tarfile
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent


class InstallerGuardTests(unittest.TestCase):
    def run_installer(self, remote, running=None, ps_status=0, no_launch=False, prebuilt=None, repeat=False):
        with tempfile.TemporaryDirectory(prefix="installer-guard-") as temporary:
            root = Path(temporary)
            home = root / "Test User"
            repo = home / "code/open-source/apparent"
            packaging = repo / "capture/desktop/scripts/packaging"
            packaging.mkdir(parents=True)
            tools = root / "tools"
            tools.mkdir()
            log = root / "tools.log"
            app = home / "Applications/Apparent.app"
            executable = app / "Contents/MacOS/apparent"
            executable.parent.mkdir(parents=True)
            executable.write_text("old app")
            (executable.parent / "apparent-helper").write_text("old helper")
            legacy_runtime = app / "Contents/Resources/note-ui/runtime/legacy-marker"
            legacy_runtime.parent.mkdir(parents=True)
            legacy_runtime.write_text("old generated runtime")
            processes = root / "processes"
            # comm is executable identity, not argv: unrelated CLIs must survive.
            unrelated = [
                "/Applications/Other Apparent.app/Contents/MacOS/apparent",
                str(repo / "target/debug/apparent"),
                str(app) + ".backup/Contents/MacOS/apparent",
                "/usr/bin/ssh",
            ]
            entries = unrelated + ([str(app / running)] if running else [])
            processes.write_text("".join(f"  {100 + i} {path}\n" for i, path in enumerate(entries)))
            mock = '''#!/usr/bin/env bash
set -eu
name="${0##*/}"
printf '%s\\n' "$name $*" >> "$MOCK_LOG"
case "$name" in
  ps) cat "$MOCK_PROCESSES"; exit "$MOCK_PS_STATUS" ;;
  ssh) shift; exec "$@" ;;
  launchctl)
    if [[ "$1" == bootstrap ]]; then
      for file in "$MOCK_TMP"/*.plist; do
        bash -n "${file%.plist}.sh"
        printf 'STAGE-EXIT=0\\n' > "${file%.plist}.log"
        mkdir -p "$MOCK_TMP/ApparentStage.app/Contents/Resources/settings/runtime" "$MOCK_TMP/ApparentStage.app/Contents/MacOS"
        printf synthetic > "$MOCK_TMP/ApparentStage.app/Contents/MacOS/apparent"
        printf synthetic > "$MOCK_TMP/ApparentStage.app/Contents/MacOS/apparent-helper"
      done
    fi ;;
  security) exit 1 ;;
  node)
    if [[ "$1" == --experimental-strip-types ]]; then shift; fi
    case "$1" in
      */package-notes.mjs) mkdir -p "$2/dist" ;;
      */mac-artifact-consumer.ts) test "$MOCK_PREBUILT" = accepted ;;
      */transaction.ts) exec "$REAL_NODE" --experimental-strip-types "$@" ;;
      */recipient/package.ts) exec "$REAL_NODE" --experimental-strip-types "$@" ;;
      */composition.ts)
        test "$2" = package
        mkdir "$4/inspection"
        printf synthetic > "$4/inspection/apparent-inspect"
        printf '{"schema":1,"executable":"apparent-inspect"}' > "$4/inspection/manifest.json" ;;
      *) exit 90 ;;
    esac ;;
  gh)
    if [[ "$1" == release ]]; then
      if bash "$MOCK_LOCK_WRAPPER" "$APPARENT_APP_DIR" true 2>/dev/null; then exit 84; fi
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --dir) recipient_output="$2"; shift ;;
          --pattern) recipient_asset="$2"; shift ;;
        esac
        shift
      done
      cp "$MOCK_RECIPIENT_ARCHIVE" "$recipient_output/$recipient_asset"
    elif [[ "$1" == attestation && "$2" == verify ]]; then
      : # Synthetic provenance transport; production stage/validation code is real.
    else exit 90; fi ;;
  taskpolicy|cargo|git|codesign|open|sleep|pgrep|pkill|ditto) : ;;
  *) exit 90 ;;
esac
'''
            for name in ("ps", "ssh", "launchctl", "security", "taskpolicy", "cargo", "git",
                         "codesign", "open", "sleep", "pgrep", "pkill", "ditto", "node", "gh"):
                tool = tools / name
                tool.write_text(mock)
                tool.chmod(0o755)
            for relative in ("target/debug/apparent", "target/debug/apparent-helper",
                             "capture/desktop/assets/Apparent.icns",
                             "shared/assets/fonts/HostGrotesk-Variable.ttf",
                             "shared/assets/brand/apparent-wordmark.png",
                             "shared/assets/brand/apparent-a.png", "shared/assets/brand/connect-frogs.png"):
                asset = repo / relative
                asset.parent.mkdir(parents=True, exist_ok=True)
                asset.write_text("synthetic new asset")
            release = repo / "capture/desktop/scripts/release"
            release.mkdir()
            for name in ("setup-sparkle.sh", "release-app.sh"):
                (release / name).write_text("#!/usr/bin/env bash\nexit 0\n")
            for name in ("install-app.sh", "install-app-remote.sh"):
                source = (SCRIPTS / name).read_text()
                # Redirect fixed native paths into this disposable synthetic fixture.
                source = source.replace("/tmp/", str(root) + "/")
                source = source.replace("/usr/bin/ditto", str(tools / "ditto"))
                (packaging / name).write_text(source)
            shared_packaging = repo / "shared/packaging"
            shared_packaging.mkdir(parents=True)
            (shared_packaging / "transaction.ts").write_bytes((SCRIPTS.parents[3] / "shared/packaging/transaction.ts").read_bytes())
            (packaging / "with-install-lock.sh").write_bytes((SCRIPTS / "with-install-lock.sh").read_bytes())
            (packaging / "stage-settings.py").write_text(
                "import os, sys\nfrom pathlib import Path\n"
                "with Path(os.environ['MOCK_LOG']).open('a') as log: log.write('stage-settings ' + ' '.join(sys.argv[1:]) + '\\n')\n")
            recipient = repo / "connect/delivery/recipient"
            recipient.mkdir(parents=True)
            for name in ("package.ts", "stage.ts", "validate.ts", "seal.ts"):
                (recipient / name).write_bytes((SCRIPTS.parents[3] / "connect/delivery/recipient" / name).read_bytes())
            recipient_archive = root / "recipient.tar.gz"
            def recipient_fixture(attempt, bad_pin=False):
                payload = bytearray(32)
                payload[:4] = bytes.fromhex("cffaedfe")
                payload[4:8] = (0x1000007).to_bytes(4, "little")
                payload[12:16] = (2).to_bytes(4, "little")
                payload.extend(str(attempt).encode())
                identity = dict(schema=1, protocol=1, repository="tryapparent/apparent",
                    workflow=".github/workflows/connect-delivery.yml", executable="apparent-connect-recipient")
                pin = dict(sourceSha="a" * 40, run="123", attempt=str(attempt),
                    version=f"recipient-{'a' * 40}-123-{attempt}", sha256=hashlib.sha256(payload).hexdigest())
                manifest = dict(identity, **pin, target="x86_64-apple-darwin")
                with tarfile.open(recipient_archive, "w:gz") as archive:
                    for name, contents in (("apparent-connect-recipient", payload), ("manifest.json", json.dumps(manifest).encode())):
                        info = tarfile.TarInfo(name); info.size = len(contents)
                        archive.addfile(info, io.BytesIO(contents))
                targets = ("x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "aarch64-apple-darwin", "x86_64-apple-darwin")
                pins = {target: dict(pin, target=target, manifest=identity) for target in targets}
                if bad_pin: pins["x86_64-apple-darwin"]["sha256"] = "0" * 64
                (recipient / "pins.json").write_text(json.dumps(dict(schema=1, adopted=True, pins=pins)))
            recipient_fixture(1)
            env = dict(os.environ, HOME=str(home), PATH=str(tools) + ":" + os.environ["PATH"],
                       REAL_NODE=shutil.which("node"), MOCK_RECIPIENT_ARCHIVE=str(recipient_archive), MOCK_LOCK_WRAPPER=str(packaging / "with-install-lock.sh"), MOCK_LOG=str(log), MOCK_PROCESSES=str(processes),
                       MOCK_PS_STATUS=str(ps_status), MOCK_TMP=str(root),
                       APPARENT_APP_DIR=str(app), APPARENT_NO_LAUNCH="1" if no_launch else "0")
            env.pop("APPARENT_PREBUILT_DIR", None)
            if prebuilt:
                binary_inputs = root / "verified inputs"
                binary_inputs.mkdir()
                for name in ("apparent", "apparent-helper"):
                    (binary_inputs / name).write_text("synthetic verified input")
                env.update(APPARENT_PREBUILT_DIR=str(binary_inputs), MOCK_PREBUILT=prebuilt)
            script = packaging / ("install-app-remote.sh" if remote else "install-app.sh")
            result = subprocess.run(["bash", str(script)], env=env, text=True,
                                    capture_output=True, timeout=10)
            if repeat and not remote:
                self.assertEqual(result.returncode, 0, result.stderr)
                def installed():
                    return {str(p.relative_to(app)): p.read_bytes() for p in app.rglob("*") if p.is_file()}
                first = installed()
                result = subprocess.run(["bash", str(script)], env=env, text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(installed(), first, "same-pin repeat must succeed without partial replacement")
                recipient_fixture(2)
                result = subprocess.run(["bash", str(script)], env=env, text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                upgraded = installed()
                self.assertNotEqual(first["Contents/MacOS/recipient/manifest.json"], upgraded["Contents/MacOS/recipient/manifest.json"])
                recipient_fixture(3, bad_pin=True)
                rejected = subprocess.run(["bash", str(script)], env=env, text=True, capture_output=True, timeout=10)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertEqual(installed(), upgraded, "failed component admission must preserve the entire installed app")
                env.pop("APPARENT_INSTALL_LOCKED", None)
                released = subprocess.run(["bash", str(packaging / "with-install-lock.sh"), str(app), "true"], capture_output=True)
                self.assertEqual(released.returncode, 0, "failed staging must release the shared installation lock")
                return
            calls = log.read_text() if log.exists() else ""
            self.assertNotIn("pkill ", calls, result.stderr)
            refused = running is not None or ps_status != 0 or prebuilt == "rejected"
            if prebuilt:
                self.assertNotIn("cargo build", calls, "Explicit artifact selection must never rebuild")
            if refused:
                self.assertNotIn("stage-settings", calls, "Never stage Settings into a running app")
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(executable.read_text(), "old app")
                self.assertTrue(legacy_runtime.exists(), "A refused install must preserve the old runtime")
                self.assertFalse((app / "Contents/Info.plist").exists())
                self.assertNotIn("ditto ", calls)
                if not prebuilt:
                    self.assertNotIn("node ", calls)
                self.assertNotIn("open ", calls)
                if prebuilt != "rejected":
                    self.assertIn("retry", result.stderr)
                if running:
                    self.assertIn("finish", result.stderr)
                    self.assertIn("quit", result.stderr)
            else:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                if remote:
                    self.assertIn("publish-prepared-app", calls)
                    self.assertFalse(legacy_runtime.exists(), "whole-app replacement must not retain the obsolete popup runtime")
                else:
                    self.assertEqual(executable.read_text(), "synthetic verified input" if prebuilt else "synthetic new asset")
                    self.assertNotIn("package-notes.mjs", calls)
                    self.assertEqual(calls.count("stage-settings"), 1)
                    self.assertIn("/candidate.app/Contents/Resources/note-ui", calls)
                    self.assertNotIn("--popups-destination " + str(app / "Contents/Resources/note-ui"), calls)
                self.assertEqual("open " in calls, remote or not no_launch)

    def test_real_recipient_packager_repeat_upgrade_and_failed_pin_preserve_app(self):
        # Real install-app.sh + Node recipient packager + filesystem transaction;
        # only Mac tools and provenance transport are synthetic, so this is not native Mac proof.
        self.run_installer(False, no_launch=True, repeat=True)

    def test_explicit_prebuilt_admission_selects_inputs_or_refuses_without_fallback(self):
        for prebuilt in ("accepted", "rejected"):
            with self.subTest(prebuilt=prebuilt):
                self.run_installer(False, no_launch=True, prebuilt=prebuilt)

    def test_destination_processes_refuse_before_replacement(self):
        for remote in (False, True):
            for running in ("Contents/MacOS/apparent", "Contents/MacOS/apparent-helper",
                            "Contents/Frameworks/Sparkle.framework/Autoupdate",
                            "Contents/Resources/note-ui/runtime/Electron.app/Contents/MacOS/Electron",
                            "Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron"):
                for no_launch in (False, True):
                    with self.subTest(remote=remote, running=running, no_launch=no_launch):
                        self.run_installer(remote, running, no_launch=no_launch)

    def test_process_listing_failure_refuses(self):
        for remote in (False, True):
            with self.subTest(remote=remote):
                self.run_installer(remote, ps_status=2)

    def test_unrelated_apps_and_clis_do_not_block(self):
        for remote in (False, True):
            for no_launch in (False, True):
                with self.subTest(remote=remote, no_launch=no_launch):
                    self.run_installer(remote, no_launch=no_launch)


if __name__ == "__main__":
    unittest.main(verbosity=2)
