#!/usr/bin/env python3
"""Contract tests for disposable Omarchy guest creation; no live VM required."""

import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

MODULE = Path(__file__).with_name("gui-vm.py")
spec = importlib.util.spec_from_file_location("gui_vm", MODULE)
assert spec is not None and spec.loader is not None
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
REAPER = MODULE.with_name("gui-vm-reaper.py")

def load_reaper():
    spec = importlib.util.spec_from_file_location("gui_vm_reaper", REAPER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GuestIsolationTests(unittest.TestCase):
    def test_readonly_chain_can_back_owned_overlay_but_writable_member_refuses(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            base, derived, overlay = [root / name for name in ('base.qcow2', 'derived.qcow2', 'overlay.qcow2')]
            runner.run_checked('qemu-img', 'create', '-f', 'qcow2', str(base), '1M')
            runner.make_overlay(base, derived)
            derived.chmod(0o400)
            with self.assertRaisesRegex(RuntimeError, 'read-only'):
                runner.make_overlay(derived, overlay, True)
            self.assertFalse(overlay.exists())
            base.chmod(0o400)
            runner.make_overlay(derived, overlay, True)
            self.assertTrue(overlay.exists())

    @patch.object(runner.os, 'getgroups', return_value=[1234])
    @patch.object(runner.Path, 'stat', return_value=SimpleNamespace(st_gid=1234))
    def test_fixture_network_denies_guest_egress_but_keeps_loopback_ssh(self, _stat, _groups):
        directory = Path('/synthetic/job')
        command = runner.qemu_command(directory / 'disk.qcow2', directory / 'OVMF_VARS.fd', directory, 23456, 3072, True)
        network = command[command.index('-netdev') + 1]
        self.assertEqual(network, 'user,id=net0,hostfwd=tcp:127.0.0.1:23456-:22,restrict=on')

    def test_expiry_is_armed_before_guest_boot_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as scratch:
            with patch.object(runner.subprocess, "run") as command:
                command.return_value.returncode = 0
                unit = runner.arm_expiry(Path(scratch), 45)
                self.assertIn("--on-active=45s", command.call_args.args[0])
                self.assertIn(str(Path(scratch) / "reaper.py"), command.call_args.args[0])
                self.assertEqual((Path(scratch) / "reaper.py").read_bytes(), REAPER.read_bytes())
                self.assertTrue(unit.startswith("scrawl-gui-expire-"))
                command.side_effect = subprocess.CalledProcessError(1, ["systemd-run"])
                with self.assertRaises(subprocess.CalledProcessError):
                    runner.arm_expiry(Path(scratch), 45)

    def test_expiry_kills_only_job_qemu_then_removes_writable_state(self):
        reaper = load_reaper()
        with tempfile.TemporaryDirectory() as scratch:
            directory = Path(scratch)
            disk = directory / "disk.qcow2"
            disk.write_bytes(b"private overlay")
            (directory / "OVMF_VARS.fd").write_bytes(b"firmware")
            (directory / "scenario.log").write_text("keep evidence")
            with patch.object(reaper, "qemu_users", side_effect=[[321], [], []]) as users, \
                 patch.object(reaper.os, "kill") as kill, \
                 patch.object(reaper.time, "sleep"):
                reaper.reap(directory)
            kill.assert_called_once_with(321, signal.SIGTERM)
            self.assertEqual(users.call_args_list[0].args[0], disk)
            self.assertFalse(disk.exists())
            self.assertFalse((directory / "OVMF_VARS.fd").exists())
            self.assertTrue((directory / "scenario.log").exists())

    def test_expiry_preserves_disk_if_qemu_survives(self):
        reaper = load_reaper()
        with tempfile.TemporaryDirectory() as scratch:
            disk = Path(scratch) / "disk.qcow2"
            disk.write_bytes(b"private overlay")
            with patch.object(reaper, "qemu_users", return_value=[321]), \
                 patch.object(reaper.os, "kill"), patch.object(reaper.time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, "still owns"):
                    reaper.reap(Path(scratch))
            self.assertTrue(disk.exists())


    def test_readiness_requires_our_session_not_the_sddm_greeter(self):
        class RunningGuest:
            def poll(self):
                return None

        with patch.object(runner.subprocess, "run") as probe:
            probe.return_value.returncode = 0
            runner.wait_for_desktop(["ssh", "guest"], RunningGuest(), 1)
        command = probe.call_args.args[0][-1]
        self.assertIn('pgrep -u "$(id -u)" -x Hyprland', command)
        self.assertIn('HYPRLAND_INSTANCE_SIGNATURE=', command)

    def test_stalled_ssh_readiness_probe_obeys_boot_deadline(self):
        class RunningGuest:
            def poll(self):
                return None
        with patch.object(runner.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['ssh'], 1)) as probe, \
             patch.object(runner.time, 'monotonic', side_effect=[0, 0, 0, 2]):
            with self.assertRaises(TimeoutError):
                runner.wait_for_desktop(['ssh', 'guest'], RunningGuest(), 1)
        self.assertEqual(probe.call_args.kwargs['timeout'], 1)

    def test_firmware_copy_is_writable_even_when_template_is_read_only(self):
        with tempfile.TemporaryDirectory() as scratch:
            base, job = Path(scratch) / "base.fd", Path(scratch) / "job.fd"
            base.write_bytes(b"firmware")
            base.chmod(0o444)
            runner.copy_firmware(base, job)
            self.assertEqual(job.stat().st_mode & 0o777, 0o600)
            self.assertEqual(base.stat().st_mode & 0o777, 0o444)


    def test_overlay_leaves_template_unchanged(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = Path(scratch)
            base = directory / "base.qcow2"
            overlay = directory / "job.qcow2"
            subprocess.run(["qemu-img", "create", "-f", "qcow2", str(base), "1M"],
                           check=True, capture_output=True)
            before = base.read_bytes()
            runner.make_overlay(base, overlay)
            info = json.loads(runner.run_checked("qemu-img", "info", "--output=json", str(overlay)))
            self.assertEqual(info["backing-filename"], str(base.resolve()))
            self.assertEqual(base.read_bytes(), before)

    @patch.object(runner.os, 'getgroups', return_value=[1234])
    @patch.object(runner.Path, 'stat', return_value=SimpleNamespace(st_gid=1234))
    def test_distinct_jobs_have_distinct_state_and_loopback_ports(self, _stat, _groups):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            a, b = root / "job-a", root / "job-b"
            port_a, port_b = runner.available_port(), runner.available_port()
            # Kernel may reuse a freed ephemeral port; distinct chosen ports are a launcher requirement.
            while port_b == port_a:
                port_b = runner.available_port()
            commands = [runner.qemu_command(d / "disk.qcow2", d / "OVMF_VARS.fd", d, port, 8192)
                        for d, port in ((a, port_a), (b, port_b))]
            for command in commands:
                joined = " ".join(command)
                self.assertIn("hostfwd=tcp:127.0.0.1:", joined)
                self.assertNotIn("-vnc :", joined)
            self.assertNotEqual(commands[0], commands[1])
            self.assertIn("unix:" + str(a / "vnc.sock"), commands[0])
            self.assertIn("unix:" + str(b / "vnc.sock"), commands[1])

    def test_refuses_backing_chain_as_template(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = Path(scratch)
            base = directory / "base.qcow2"
            nested = directory / "nested.qcow2"
            runner.run_checked("qemu-img", "create", "-f", "qcow2", str(base), "1M")
            runner.make_overlay(base, nested)
            with self.assertRaisesRegex(RuntimeError, "standalone"):
                runner.make_overlay(nested, directory / "job.qcow2")


if __name__ == "__main__":
    unittest.main()
