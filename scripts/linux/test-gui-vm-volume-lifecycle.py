#!/usr/bin/env python3
"""Launch-free entrypoint regressions; only privileged OS commands are substituted."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name('gui-vm-volume.py')
spec = importlib.util.spec_from_file_location('volume', MODULE)
assert spec is not None and spec.loader is not None
volume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(volume)


class LifecycleTests(unittest.TestCase):
    def test_child_entrypoint_rejects_abbreviated_results_before_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            owned, escaped = root / 'owned', root / 'escaped'
            command = [sys.executable, str(MODULE.with_name('gui-vm.py'))]
            for name in ('template', 'ovmf-vars', 'ssh-key', 'scenario', 'binary'):
                command += ['--' + name, str(root / 'missing')]
            command += ['--ssh-user', 'test', '--results', str(owned), '--res', str(escaped)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('unrecognized arguments: --res', result.stderr)
            self.assertEqual(list(root.iterdir()), [])

    def test_wrapper_refuses_owned_spellings_before_allocation(self):
        for option in ('--results', '--res', '--res=elsewhere', '--managed-life', '--job-t'):
            with tempfile.TemporaryDirectory() as tmp:
                image = Path(tmp) / 'new.ext4'
                with self.subTest(option=option), \
                     patch.object(sys, 'argv', [str(MODULE), '--image', str(image), '--', option, 'elsewhere']), \
                     patch.dict(os.environ, SUDO_UID=str(os.getuid()), SUDO_GID=str(os.getgid())), \
                     patch.object(volume.os, 'geteuid', return_value=0), \
                     patch.object(volume, 'create_volume') as create, \
                     patch.object(volume.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as command, \
                     contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as error:
                        volume.main()
                    self.assertEqual(error.exception.code, 2)
                    create.assert_not_called()
                    command.assert_not_called()
                    self.assertEqual(list(Path(tmp).iterdir()), [])

    def run_lifecycle(self, *, child_exit=0, stop_exit=0, collected=False, unmount_exit=0,
                      probe_failure=False, residual_directory=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image, mount = root / 'image.ext4', root / 'mount'
            commands = []
            real_path = Path

            def path(value):
                return mount if str(value).startswith('/run/apparent-vm-') else real_path(value)

            def create(image, mount, *_):
                image.touch()
                mount.mkdir()

            def run(command, **kwargs):
                commands.append(command)
                rc, out, err = 0, '', ''
                if command[0] == 'systemd-run':
                    rc = child_exit
                elif command[:2] == ['systemctl', 'stop']:
                    rc, err = stop_exit, 'synthetic stop diagnostic' if stop_exit else ''
                elif command[:2] == ['systemctl', 'show']:
                    rc = 1 if collected else 0
                    out = ('LoadState=not-found\nActiveState=inactive\nSubState=dead\nControlGroup=\n'
                           if collected else 'LoadState=loaded\nActiveState=active\nSubState=running\nControlGroup=/owned\n')
                    if probe_failure:
                        rc, out, err = 1, '', 'synthetic bus failure'
                elif command[0] == 'getent':
                    out = 'test:x:1000:1000::/home/test:/bin/sh'
                elif command[0] == 'umount':
                    rc, err = unmount_exit, 'synthetic busy mount' if unmount_exit else ''
                    if not rc and not residual_directory:
                        # Real unmount exposes the empty underlying mountpoint.
                        for entry in mount.iterdir():
                            shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
                else:
                    self.fail('unexpected OS command: ' + repr(command))
                result = subprocess.CompletedProcess(command, rc, out, err)
                if kwargs.get('check') and rc:
                    raise subprocess.CalledProcessError(rc, command, out, err)
                return result

            handlers = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
            try:
                with patch.object(sys, 'argv', [str(MODULE), '--image', str(image), '--', '--template', 'unused']), \
                     patch.dict(os.environ, SUDO_UID=str(os.getuid()), SUDO_GID=str(os.getgid())), \
                     patch.object(volume.os, 'geteuid', return_value=0), \
                     patch.object(volume, 'Path', side_effect=path), \
                     patch.object(volume, 'create_volume', side_effect=create), \
                     patch.object(volume.subprocess, 'run', side_effect=run), \
                     contextlib.redirect_stdout(io.StringIO()):
                    result = volume.main()
            finally:
                for s, handler in handlers.items():
                    signal.signal(s, handler)
            receipt = json.loads(image.with_suffix('.ext4.json').read_text())
            self.assertTrue(image.exists())
            self.assertEqual(receipt['image'], str(image))
            self.assertEqual(receipt['mount'], str(mount))
            self.assertRegex(receipt['unit'], r'^apparent-vm-[0-9a-f]{16}\.service$')
            return result, receipt, commands

    def test_successful_cleanup(self):
        result, receipt, commands = self.run_lifecycle()
        self.assertEqual(result, 0)
        self.assertEqual(receipt['cleanup'], 'unmounted; image retained')
        self.assertTrue(any(c[0] == 'umount' for c in commands))

    def test_failed_stop_with_active_unit_retains_mount_and_fails(self):
        result, receipt, commands = self.run_lifecycle(stop_exit=1)
        self.assertNotEqual(result, 0)
        self.assertIn('FAILED', receipt['cleanup'])
        self.assertIn('synthetic stop diagnostic', json.dumps(receipt))
        self.assertIn('ActiveState=active', json.dumps(receipt))
        self.assertFalse(any(c[0] == 'umount' for c in commands))

    def test_failed_unmount_fails_with_diagnostics(self):
        result, receipt, _ = self.run_lifecycle(unmount_exit=1)
        self.assertNotEqual(result, 0)
        self.assertIn('synthetic busy mount', receipt['cleanup'])

    def test_already_collected_unit_allows_cleanup(self):
        result, receipt, _ = self.run_lifecycle(stop_exit=5, collected=True)
        self.assertEqual(result, 0)
        self.assertEqual(receipt['cleanup'], 'unmounted; image retained')

    def test_child_exit_propagates_after_cleanup(self):
        result, receipt, _ = self.run_lifecycle(child_exit=23)
        self.assertEqual(result, 23)
        self.assertEqual(receipt['exit'], 23)

    def test_failed_state_query_does_not_claim_collected(self):
        result, receipt, commands = self.run_lifecycle(stop_exit=1, probe_failure=True)
        self.assertNotEqual(result, 0)
        self.assertIn('synthetic bus failure', json.dumps(receipt))
        self.assertFalse(any(c[0] == 'umount' for c in commands))

    def test_failed_directory_cleanup_is_not_success(self):
        result, receipt, _ = self.run_lifecycle(residual_directory=True)
        self.assertNotEqual(result, 0)
        self.assertIn('FAILED', receipt['cleanup'])


if __name__ == '__main__':
    unittest.main()
