"""Synthetic home fixtures: never touch a live user's installation."""

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("migrate-scrawl.py"))
assert SPEC is not None and SPEC.loader is not None
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.old = self.home / "Applications/Scrawl-0.3.13-linux-x86_64.AppImage"
        self.old.parent.mkdir()
        self.old.write_bytes(b"\x7fELF\x02\x01\x01\x00AI\x02old fixture")
        self.old.chmod(0o700)
        link = self.home / ".local/bin/scrawl"
        link.parent.mkdir(parents=True)
        link.symlink_to(self.old)
        self.old_desktop = self.home / ".local/share/applications/dev.kitlangton.scrawl.desktop"
        self.old_desktop.parent.mkdir(parents=True)
        self.old_desktop.write_text(f"[Desktop Entry]\nExec=\"{self.old}\" app\nName=Scrawl\n")
        self.old_autostart = self.home / ".config/autostart/scrawl.desktop"
        self.old_autostart.parent.mkdir(parents=True)
        self.old_autostart.write_text(f"[Desktop Entry]\nExec=\"{self.old}\" app\nName=Scrawl\n")
        self.image = self.home / "Downloads/Apparent-0.3.13-linux-x86_64.AppImage"
        self.image.parent.mkdir()
        self.image.write_bytes(b"\x7fELF\x02\x01\x01\x00AI\x02new fixture")
        self.image.chmod(0o700)
        self.config = self.home / ".config/apparent/config.json"
        self.config.parent.mkdir()
        self.config.write_text('{"ingestToken":"preserve-me","experiments":{"other":true}}')
        self.shortcut = self.home / ".config/hypr/bindings.lua"
        self.shortcut.parent.mkdir(parents=True)
        self.shortcut.write_text('hl.bind("ALT + SHIFT + S", hl.dsp.exec_cmd("scrawl shortcut record"), { description = "Scrawl: record" })\n'
                                 'hl.bind("ALT + SHIFT + V", hl.dsp.exec_cmd("scrawl shortcut paste"), { description = "Scrawl: paste" })\n'
                                 'hl.bind("ALT + X", hl.dsp.exec_cmd("other"), { description = "Scrawl: other" })\n')
        self.runtime = mock.patch.object(migration, "running_old", return_value=None)
        self.runtime.start()
        self.addCleanup(self.runtime.stop)
        self.cpu = mock.patch.object(migration.platform, "machine", return_value="x86_64")
        self.cpu.start()
        self.addCleanup(self.cpu.stop)
        self.smoke = mock.patch.object(migration.subprocess, "run", side_effect=lambda args, **kwargs: mock.Mock(
            returncode=0, stdout=b"scrawl 0.3.13\n" if args[0] == str(self.old) else b"apparent 0.3.13\n"))
        self.smoke.start()
        self.addCleanup(self.smoke.stop)

    def test_success_preserves_old_data_and_unrelated_config(self):
        legacy = self.home / ".local/share/scrawl/captures/a.scrawl"
        legacy.mkdir(parents=True)
        (legacy / "summary.md").write_text("old capture")
        migration.migrate(self.home, self.image, self.shortcut)
        new = self.home / "Applications" / self.image.name
        self.assertEqual(new.read_bytes(), self.image.read_bytes())
        self.assertEqual((self.home / ".local/bin/apparent").resolve(), new)
        self.assertEqual(migration.desktop_exec(self.home / ".local/share/applications/dev.kitlangton.apparent.desktop"), f'"{new}"')
        self.assertEqual(migration.desktop_exec(self.home / ".config/autostart/apparent.desktop"), f'"{new}" app')
        self.assertFalse(self.old_desktop.exists())
        self.assertFalse(self.old_autostart.exists())
        self.assertTrue(self.old.exists())
        self.assertEqual((self.home / ".local/bin/scrawl").resolve(), self.old)
        self.assertEqual((legacy / "summary.md").read_text(), "old capture")
        self.assertIn("apparent shortcut record", self.shortcut.read_text())
        self.assertIn('description = "Scrawl: other"', self.shortcut.read_text())
        cfg = json.loads(self.config.read_text())
        self.assertEqual(cfg["ingestToken"], "preserve-me")
        self.assertEqual(cfg["experiments"], {"other": True})
        self.assertEqual(cfg["updateChannel"], "main")
        self.assertTrue(cfg["launchAtLogin"])

    def test_refuses_unowned_command_before_any_changes(self):
        (self.home / ".local/bin/apparent").write_text("package manager owned")
        before = self.config.read_bytes()
        with self.assertRaises(migration.Refused):
            migration.migrate(self.home, self.image, self.shortcut)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertTrue(self.old_autostart.exists())

    def test_corrupt_config_or_unrecognized_shortcut_refused(self):
        self.config.write_text("invalid")
        with self.assertRaises(migration.Refused):
            migration.migrate(self.home, self.image, self.shortcut)
        self.config.write_text("{}")
        self.shortcut.write_text('hl.bind("ALT + S", hl.dsp.exec_cmd("scrawl shortcut record"))\n')
        with self.assertRaises(migration.Refused):
            migration.migrate(self.home, self.image, self.shortcut)
        self.assertTrue(self.old_desktop.exists())

    def test_disabled_autostart_stays_disabled(self):
        self.old_autostart.write_text(self.old_autostart.read_text() + "Hidden=true\n")
        migration.migrate(self.home, self.image)
        self.assertFalse((self.home / ".config/autostart/apparent.desktop").exists())
        self.assertFalse(json.loads(self.config.read_text())["launchAtLogin"])

    def test_renamed_scrawl_image_refused(self):
        with mock.patch.object(migration.subprocess, "run", return_value=mock.Mock(returncode=0, stdout=b"foreign 0.3.13\n")):
            with self.assertRaisesRegex(migration.Refused, "product/version"):
                migration.migrate(self.home, self.image)
        self.assertTrue(self.old_desktop.exists())

    def test_symlinked_backup_parent_refused_without_outside_write(self):
        outside = self.home.parent / (self.home.name + "-outside")
        outside.mkdir()
        self.addCleanup(shutil.rmtree, outside)
        (self.home / ".local/share/apparent").symlink_to(outside)
        with self.assertRaises(OSError):
            migration.migrate(self.home, self.image)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertTrue(self.old_desktop.exists())

    def test_parent_swapped_after_validation_never_writes_outside(self):
        outside = self.home.parent / (self.home.name + "-outside")
        outside.mkdir()
        self.addCleanup(shutil.rmtree, outside)
        original = migration.secure_dir
        swapped = False
        from contextlib import contextmanager
        @contextmanager
        def swap_after_check(home, parent, create=False):
            nonlocal swapped
            if parent == self.home / "Applications" and not swapped:
                swapped = True
                # After plan() has approved the path, replace its parent.
                (self.home / "Applications").rename(self.home / "Applications-held")
                (self.home / "Applications").symlink_to(outside)
            with original(home, parent, create) as fd:
                yield fd
        with mock.patch.object(migration, "secure_dir", side_effect=swap_after_check):
            with self.assertRaises(OSError):
                migration.migrate(self.home, self.image)
        self.assertEqual(list(outside.iterdir()), [])

    def test_new_image_appearing_after_preflight_is_not_replaced(self):
        new = self.home / "Applications" / self.image.name
        original = migration.validate_image
        def appear(home, path, product, version):
            result = original(home, path, product, version)
            if path == self.image:
                new.write_text("another process owns this")
            return result
        with mock.patch.object(migration, "validate_image", side_effect=appear):
            with self.assertRaisesRegex(migration.Refused, "target appeared"):
                migration.migrate(self.home, self.image)
        self.assertEqual(new.read_text(), "another process owns this")
        self.assertTrue(self.old_desktop.exists())

    def test_losing_exclusive_launcher_creation_keeps_other_file(self):
        launcher = self.home / ".local/share/applications/dev.kitlangton.apparent.desktop"
        original = migration.atomic_bytes
        def compete(parent, name, data, mode=0o600, exclusive=False, expected=migration.UNSPECIFIED):
            if name == launcher.name:
                fd = migration.os.open(name, migration.os.O_WRONLY | migration.os.O_CREAT | migration.os.O_EXCL,
                                       0o600, dir_fd=parent)
                with migration.os.fdopen(fd, "wb") as output:
                    output.write(b"competitor")
            return original(parent, name, data, mode, exclusive, expected)
        with mock.patch.object(migration, "atomic_bytes", side_effect=compete):
            with self.assertRaises(FileExistsError):
                migration.migrate(self.home, self.image)
        self.assertEqual(launcher.read_bytes(), b"competitor")
        self.assertFalse((self.home / "Applications" / self.image.name).exists())
        self.assertTrue(self.old_desktop.exists())

    def test_new_image_appearing_at_publish_is_not_replaced(self):
        new = self.home / "Applications" / self.image.name
        original = migration.os.link
        def compete(src, dst, *, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=True):
            if dst == new.name:
                fd = migration.os.open(dst, migration.os.O_WRONLY | migration.os.O_CREAT | migration.os.O_EXCL,
                                       0o600, dir_fd=dst_dir_fd)
                with migration.os.fdopen(fd, "wb") as output:
                    output.write(b"competitor")
            return original(src, dst, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd,
                            follow_symlinks=follow_symlinks)
        with mock.patch.object(migration.os, "link", side_effect=compete):
            with self.assertRaises(FileExistsError):
                migration.migrate(self.home, self.image)
        self.assertEqual(new.read_bytes(), b"competitor")
        self.assertTrue(self.old_desktop.exists())

    def test_losing_cli_link_creation_keeps_other_file(self):
        link = self.home / ".local/bin/apparent"
        original = migration.os.link
        def compete(src, dst, *, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=True):
            if dst == link.name:
                fd = migration.os.open(dst, migration.os.O_WRONLY | migration.os.O_CREAT | migration.os.O_EXCL,
                                       0o600, dir_fd=dst_dir_fd)
                with migration.os.fdopen(fd, "wb") as output:
                    output.write(b"competitor")
            return original(src, dst, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd,
                            follow_symlinks=follow_symlinks)
        with mock.patch.object(migration.os, "link", side_effect=compete):
            with self.assertRaises(FileExistsError):
                migration.migrate(self.home, self.image)
        self.assertEqual(link.read_bytes(), b"competitor")
        self.assertFalse((self.home / "Applications" / self.image.name).exists())
        self.assertFalse((self.home / ".local/share/applications/dev.kitlangton.apparent.desktop").exists())

    def test_source_replaced_during_staging_is_rejected(self):
        original_copy = migration.shutil.copyfileobj
        def replace_source(source, output):
            # Still reports the expected product/version; only its bytes differ.
            self.image.write_bytes(b"\x7fELF\x02\x01\x01\x00AI\x02different apparent build")
            return original_copy(source, output)
        with mock.patch.object(migration.shutil, "copyfileobj", side_effect=replace_source):
            with self.assertRaisesRegex(migration.Refused, "checksum changed"):
                migration.migrate(self.home, self.image)
        self.assertFalse((self.home / "Applications" / self.image.name).exists())
        self.assertTrue(self.old_desktop.exists())

    def test_config_edit_after_snapshot_is_not_overwritten(self):
        original = migration.atomic_bytes
        def edit(parent, name, data, mode=0o600, exclusive=False, expected=migration.UNSPECIFIED):
            if name == self.config.name and expected is not migration.UNSPECIFIED:
                self.config.write_text('{"concurrent":true}')
            return original(parent, name, data, mode, exclusive, expected)
        with mock.patch.object(migration, "atomic_bytes", side_effect=edit):
            with self.assertRaisesRegex(migration.Refused, "changed during migration"):
                migration.migrate(self.home, self.image)
        self.assertEqual(json.loads(self.config.read_text()), {"concurrent": True})
        self.assertTrue(self.old_desktop.exists())

    def test_old_launcher_edit_after_snapshot_is_not_removed(self):
        original = migration.retire
        def edit(parent, name, expected):
            if name == self.old_desktop.name:
                self.old_desktop.write_text("new user launcher")
            return original(parent, name, expected)
        with mock.patch.object(migration, "retire", side_effect=edit):
            with self.assertRaisesRegex(migration.Refused, "changed during migration"):
                migration.migrate(self.home, self.image)
        self.assertEqual(self.old_desktop.read_text(), "new user launcher")
        self.assertFalse((self.home / "Applications" / self.image.name).exists())

    def test_rollback_does_not_adopt_replacement_after_link(self):
        new = self.home / "Applications" / self.image.name
        original_link = migration.os.link
        original_exec = migration.desktop_exec
        def replace_after_link(src, dst, *, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=True):
            result = original_link(src, dst, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd,
                                   follow_symlinks=follow_symlinks)
            if dst == new.name:
                new.unlink()
                new.write_bytes(b"competitor")
            return result
        def fail_readback(path):
            if path.name == "dev.kitlangton.apparent.desktop":
                return "bad"
            return original_exec(path)
        with mock.patch.object(migration.os, "link", side_effect=replace_after_link), \
             mock.patch.object(migration, "desktop_exec", side_effect=fail_readback):
            with self.assertRaises(migration.Refused):
                migration.migrate(self.home, self.image)
        self.assertEqual(new.read_bytes(), b"competitor")
        self.assertTrue(self.old_desktop.exists())

    def test_rollback_preserves_in_place_config_and_shortcut_edits(self):
        original_exec = migration.desktop_exec
        def fail_after_user_edit(path):
            if path.name == "dev.kitlangton.apparent.desktop":
                self.config.write_text('{"concurrent":true}')
                self.shortcut.write_text("new shortcut edited during migration")
                return "bad"
            return original_exec(path)
        with mock.patch.object(migration, "desktop_exec", side_effect=fail_after_user_edit):
            with self.assertRaises(migration.Refused):
                migration.migrate(self.home, self.image)
        self.assertEqual(json.loads(self.config.read_text()), {"concurrent": True})
        self.assertEqual(self.shortcut.read_text(), "new shortcut edited during migration")
        self.assertTrue(self.old_desktop.exists())
        self.assertFalse((self.home / "Applications" / self.image.name).exists())

    def test_rollback_does_not_recreate_deleted_config_or_shortcut(self):
        original_exec = migration.desktop_exec
        def fail_after_user_delete(path):
            if path.name == "dev.kitlangton.apparent.desktop":
                self.config.unlink()
                self.shortcut.unlink()
                return "bad"
            return original_exec(path)
        with mock.patch.object(migration, "desktop_exec", side_effect=fail_after_user_delete):
            with self.assertRaises(migration.Refused):
                migration.migrate(self.home, self.image)
        self.assertFalse(self.config.exists())
        self.assertFalse(self.shortcut.exists())
        self.assertTrue(self.old_desktop.exists())

    def test_no_login_refuses_concurrent_autostart_creation(self):
        self.old_autostart.write_text(self.old_autostart.read_text() + "Hidden=true\n")
        new_autostart = self.home / ".config/autostart/apparent.desktop"
        original_exec = migration.desktop_exec
        def create_login(path):
            if path.name == "dev.kitlangton.apparent.desktop":
                new_autostart.write_text("another process enabled login")
            return original_exec(path)
        with mock.patch.object(migration, "desktop_exec", side_effect=create_login):
            with self.assertRaisesRegex(migration.Refused, "changed during migration"):
                migration.migrate(self.home, self.image)
        self.assertEqual(new_autostart.read_text(), "another process enabled login")
        self.assertTrue(self.old_desktop.exists())
        self.assertFalse((self.home / "Applications" / self.image.name).exists())

    def test_automatic_shortcut_discovery(self):
        migration.migrate(self.home, self.image)
        self.assertIn("apparent shortcut record", self.shortcut.read_text())

    def test_active_scrawl_refused(self):
        with mock.patch.object(migration, "running_old", return_value="1234"):
            with self.assertRaisesRegex(migration.Refused, "still running"):
                migration.migrate(self.home, self.image)
        self.assertTrue(self.old_desktop.exists())

    def test_symlinked_destination_parent_refused(self):
        other = self.home.parent / (self.home.name + "-other")
        other.mkdir()
        self.addCleanup(shutil.rmtree, other)
        (self.home / ".local/bin/scrawl").unlink()
        (self.home / ".local/bin").rmdir()
        (self.home / ".local/bin").symlink_to(other)
        (other / "scrawl").symlink_to(self.old)
        with self.assertRaises(migration.Refused):
            migration.migrate(self.home, self.image)
        self.assertFalse((other / "apparent").exists())

    def test_existing_channel_preserved(self):
        self.config.write_text('{"updateChannel":"stable","launchAtLogin":false}')
        migration.migrate(self.home, self.image)
        self.assertEqual(json.loads(self.config.read_text())["updateChannel"], "stable")
        self.assertFalse((self.home / ".config/autostart/apparent.desktop").exists())

    def test_failure_after_install_restores_every_target(self):
        before = self.config.read_bytes()
        original = migration.desktop_exec
        def fail_readback(path):
            if path.name == "dev.kitlangton.apparent.desktop":
                return "bad"
            return original(path)
        with mock.patch.object(migration, "desktop_exec", side_effect=fail_readback):
            with self.assertRaises(migration.Refused):
                migration.migrate(self.home, self.image, self.shortcut)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertTrue(self.old_desktop.exists())
        self.assertTrue(self.old_autostart.exists())
        self.assertIn("scrawl shortcut record", self.shortcut.read_text())
        self.assertFalse((self.home / ".local/bin/apparent").exists())
        self.assertFalse((self.home / "Applications" / self.image.name).exists())


if __name__ == "__main__":
    unittest.main()
