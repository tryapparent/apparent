#!/usr/bin/env python3
"""Native kernel disk-bound regression, including KEEP_SIZE and many files."""
import errno
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('volume', Path(__file__).with_name('gui-vm-volume.py'))
assert spec is not None and spec.loader is not None
volume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(volume)

class VolumeTests(unittest.TestCase):
    def test_fixed_filesystem_bounds_aggregate_and_keep_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image, mount = root / 'volume.ext4', root / 'mount'
            volume.create_volume(image, mount, 64 * 1024 * 1024, os.getuid(), os.getgid())
            try:
                self.assertGreaterEqual(image.stat().st_blocks * 512, image.stat().st_size,
                                        'formatting must not discard the reserved backing blocks')
                # Two files compete for the SAME filesystem budget. KEEP_SIZE
                # consumes blocks without changing st_size (RLIMIT_FSIZE misses it).
                (mount / 'a').touch()
                (mount / 'b').touch()
                subprocess.run(['fallocate', '--keep-size', '-l', '40M', str(mount / 'a')], check=True)
                result = subprocess.run(['fallocate', '--keep-size', '-l', '40M', str(mount / 'b')], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'No space left', result.stderr)
                self.assertEqual((mount / 'a').stat().st_size, 0)
                self.assertEqual(image.stat().st_size, 64 * 1024 * 1024)
                self.assertGreaterEqual(image.stat().st_blocks * 512, image.stat().st_size)
            finally:
                volume.unmount(mount)
            self.assertFalse(os.path.ismount(mount))

if __name__ == '__main__':
    unittest.main()
