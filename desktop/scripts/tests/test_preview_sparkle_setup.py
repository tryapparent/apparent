"""A damaged cached Sparkle tree must not poison a Mac preview build."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class SparkleSetupTest(unittest.TestCase):
    def test_incomplete_destination_is_replaced_not_nested(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "desktop/scripts").mkdir(parents=True)
            script = root / "desktop/scripts/setup-sparkle.sh"
            script.write_bytes((ROOT / "desktop/scripts/setup-sparkle.sh").read_bytes())
            destination = root / "sparkle"
            (destination / "stale").mkdir(parents=True)
            (destination / "bin").mkdir()
            (destination / "Sparkle.framework").mkdir()
            for tool in ("generate_appcast", "sign_update"):
                cached_tool = destination / "bin" / tool
                cached_tool.touch(mode=0o755)
                cached_tool.chmod(0o755)
            fake_bin = root / "fake-bin"
            fake_bin.mkdir()
            (fake_bin / "curl").write_text(
                '#!/bin/sh\nwhile [ "$1" != "--output" ]; do shift; done\n'
                'printf archive > "$2"\n'
            )
            (fake_bin / "shasum").write_text('#!/bin/sh\ncat >/dev/null\n')
            (fake_bin / "tar").write_text(
                '#!/bin/sh\nwhile [ "$1" != "-C" ]; do shift; done\n'
                'd="$2"\n'
                'sleep 0.2\n'
                'mkdir -p "$d/bin" '
                '"$d/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/MacOS" '
                '"$d/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc/Contents/MacOS" '
                '"$d/Sparkle.framework/Versions/B/Updater.app"\n'
                'touch "$d/bin/generate_appcast" "$d/bin/sign_update" '
                '"$d/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/MacOS/Installer" '
                '"$d/Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/Info.plist" '
                '"$d/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc/Contents/MacOS/Downloader" '
                '"$d/Sparkle.framework/Versions/B/Autoupdate"\n'
                'chmod +x "$d/bin/generate_appcast" "$d/bin/sign_update"\n'
            )
            for tool in fake_bin.iterdir():
                tool.chmod(0o755)
            env = dict(os.environ, APPARENT_SPARKLE_DIR=str(destination),
                       PATH=f'{fake_bin}:{os.environ["PATH"]}')
            result = subprocess.run(["sh", str(script)], env=env,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), str(destination))
            self.assertTrue((destination / "Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/Info.plist").is_file())
            self.assertFalse((destination / "stale").exists())
            self.assertFalse(Path(f"{destination}.partial").exists())
            self.assertFalse(Path(f"{destination}.lock").exists())

            # Two builds encountering the same damaged cache must both finish.
            (destination / "Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/Info.plist").unlink()
            children = [subprocess.Popen(["sh", str(script)], env=env,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         text=True) for _ in range(2)]
            for child in children:
                stdout, stderr = child.communicate(timeout=10)
                self.assertEqual(child.returncode, 0, stderr)
                self.assertEqual(stdout.strip(), str(destination))
            self.assertTrue((destination / "Sparkle.framework/Versions/B/XPCServices/Installer.xpc/Contents/Info.plist").is_file())
            self.assertFalse(Path(f"{destination}.partial").exists())
            self.assertFalse(Path(f"{destination}.lock").exists())


if __name__ == "__main__":
    unittest.main()
