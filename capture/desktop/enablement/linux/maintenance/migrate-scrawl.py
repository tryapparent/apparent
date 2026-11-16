#!/usr/bin/env python3
"""Move an owned Scrawl AppImage installation to an explicitly supplied Apparent AppImage.

No historical settings or captures are copied: their formats and meanings differ.
Run after quitting Scrawl; this command never kills a recording or a service.
"""

import argparse
import configparser
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import uuid


class Refused(Exception):
    pass


UNSPECIFIED = object()


def owned(path, home):
    """Only ordinary, user-owned files under a real home; never follow a leaf symlink."""
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.geteuid():
        raise Refused(f"not an owned ordinary file: {path}")
    if not path.resolve().is_relative_to(home.resolve()):
        raise Refused(f"outside your home: {path}")
    return path


def target_of(link):
    return (link.parent / os.readlink(link)).resolve()


def desktop_exec(path):
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    parser.read(path)
    return parser.get("Desktop Entry", "Exec", fallback=None)


def old_command(command, old):
    # Exact previous AppImage path or the exact installed Scrawl command; no shell parsing.
    return command in ("scrawl", "scrawl app", str(old), f'"{old}" app', f"{old} app")


def running_old(old):
    # AppRun.wrapped has no Scrawl in its process name. Inspect its APPIMAGE instead.
    for proc in Path("/proc").iterdir():
        if not proc.name.isdecimal() or int(proc.name) == os.getpid():
            continue
        try:
            env = (proc / "environ").read_bytes().split(b"\0")
            if any(entry == b"APPIMAGE=" + os.fsencode(old) for entry in env):
                return proc.name
        except (OSError, PermissionError):
            continue
    return None


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def appimage_magic(home, path):
    # Type-2 AppImage marker, not just an executable with a convincing name.
    with secure_dir(home, path.parent) as parent:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        with os.fdopen(fd, "rb") as stream:
            return stream.read(11) == b"\x7fELF\x02\x01\x01\x00AI\x02"


def validate_image(home, path, product, version):
    if not appimage_magic(home, path):
        raise Refused(f"not a type-2 Linux AppImage: {path}")
    if not os.access(path, os.X_OK):
        raise Refused(f"AppImage is not executable: {path}")
    check = subprocess.run([str(path), "--version"],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if check.returncode:
        raise Refused(f"AppImage CLI smoke check failed: {check.stderr.decode(errors='replace')[-400:]}")
    if check.stdout.decode(errors="replace").strip() != f"{product} {version}":
        raise Refused(f"AppImage product/version does not match the {product} asset name")


@contextmanager
def secure_dir(home, parent, create=False):
    """Pin each directory under home without following a substituted symlink."""
    parts = parent.relative_to(home).parts
    fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts:
            if part in (".", ".."):
                raise Refused(f"unsafe directory component: {parent}")
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            if os.fstat(fd).st_uid != os.geteuid():
                raise Refused(f"directory is not owned by this user: {parent}")
        yield fd
    finally:
        os.close(fd)


def secure_read(home, path):
    with secure_dir(home, path.parent) as parent:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():
                raise Refused(f"not an owned ordinary file: {path}")
            return stream.read()


def atomic_bytes(parent, name, data, mode=0o600, exclusive=False, expected=UNSPECIFIED):
    temp = f".{name}.{uuid.uuid4().hex}"
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=parent)
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            info = os.fstat(stream.fileno())
            identity = (info.st_dev, info.st_ino)
        if exclusive:
            os.link(temp, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
        else:
            if expected is not UNSPECIFIED:
                assert_unchanged(parent, name, expected)
            os.replace(temp, name, src_dir_fd=parent, dst_dir_fd=parent)
        return identity
    finally:
        try:
            os.unlink(temp, dir_fd=parent)
        except FileNotFoundError:
            pass


def assert_unchanged(parent, name, expected):
    """Refuse edits made after the saved snapshot, including in-place edits."""
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
    except FileNotFoundError:
        if expected is None:
            return
        raise Refused(f"file disappeared during migration: {name}")
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if expected is None or not stat.S_ISREG(info.st_mode) or (
            info.st_dev, info.st_ino, stream.read()
        ) != expected:
            raise Refused(f"file changed during migration: {name}")


def retire(parent, name, expected):
    assert_unchanged(parent, name, expected)
    os.unlink(name, dir_fd=parent)


def published_unchanged(parent, name, identity, content):
    try:
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return False
    if (info.st_dev, info.st_ino) != identity:
        return False
    if isinstance(content, str):
        return stat.S_ISLNK(info.st_mode) and os.readlink(name, dir_fd=parent) == content
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
    except OSError:
        return False
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            return False
        if isinstance(content, tuple):
            digest = hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
            return digest.hexdigest() == content[1]
        return stream.read() == content


def publish_symlink(parent, name, target):
    temp = f".{name}.{uuid.uuid4().hex}"
    try:
        os.symlink(target, temp, dir_fd=parent)
        info = os.stat(temp, dir_fd=parent, follow_symlinks=False)
        os.link(temp, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
        return (info.st_dev, info.st_ino)
    finally:
        try:
            os.unlink(temp, dir_fd=parent)
        except FileNotFoundError:
            pass


def desktop(command, autostart=False):
    return ("[Desktop Entry]\nType=Application\nName=Apparent\n"
            "Comment=Show an agent what you mean\n"
            f"Exec=\"{command}\"{' app' if autostart else ''}\n"
            "Icon=dev.kitlangton.apparent\nTerminal=false\n"
            + ("X-GNOME-Autostart-enabled=true\n" if autostart else
               "Categories=Utility;Development;\nStartupWMClass=dev.kitlangton.apparent\n")).encode()


def shortcut_change(text):
    # A permanent Omarchy Lua bind takes precedence over Apparent's runtime bind.
    # Touch only the exact old CLI action and matching description, not other user binds.
    lines = text.splitlines(keepends=True)
    changed = 0
    for n, line in enumerate(lines):
        match = re.fullmatch(
            r'(\s*hl\.bind\([^\n]*hl\.dsp\.exec_cmd\(["\'])(scrawl shortcut (?:record|paste))'
            r'(["\']\)[^\n]*description\s*=\s*["\']Scrawl: (?:record|paste)["\'][^\n]*\)\s*(?:--[^\n]*)?\n?)',
            line,
        )
        if match:
            action = match.group(2).rsplit(" ", 1)[1]
            if f"Scrawl: {action}" not in match.group(3):
                raise Refused("shortcut action and description disagree")
            lines[n] = line.replace(f"scrawl shortcut {action}", f"apparent shortcut {action}", 1).replace(
                f"Scrawl: {action}", f"Apparent: {action}", 1)
            changed += 1
        elif "scrawl shortcut" in line and not line.lstrip().startswith("--"):
            raise Refused("unrecognized permanent Scrawl shortcut; edit it explicitly before migration")
    return "".join(lines), changed


def plan(home, image, shortcut):
    home = home.resolve()
    if home.is_symlink() or home.stat().st_uid != os.geteuid():
        raise Refused("home directory is not owned by this user")
    if any(char in str(home) for char in ('"', "\\", "\n", "\r")):
        raise Refused("home path cannot be represented safely in desktop Exec")
    image = owned(image, home)
    if not re.fullmatch(r"Apparent-\d+\.\d+\.\d+-linux-(x86_64|aarch64)\.AppImage", image.name):
        raise Refused("supply a versioned Apparent Linux AppImage, not a Scrawl or debug build")

    if image.name.rsplit("-", 1)[1] != platform.machine() + ".AppImage":
        raise Refused("AppImage CPU architecture does not match this machine")
    if not os.access(image, os.X_OK):
        raise Refused("AppImage is not executable")
    bin_dir = home / ".local/bin"
    old_link = bin_dir / "scrawl"
    if not old_link.is_symlink():
        raise Refused(f"expected an owned Scrawl CLI link at {old_link}; nothing changed")
    old = target_of(old_link)
    owned(old, home)
    if not re.fullmatch(r"Scrawl-[^/]+\.AppImage", old.name):
        raise Refused("Scrawl link does not target a Scrawl AppImage")
    if running_old(old):
        raise Refused("Scrawl is still running; quit it after finishing any recording")
    new = home / "Applications" / image.name
    if new.exists() or new.is_symlink():
        raise Refused(f"destination already exists: {new}")
    paths = {
        "old_link": old_link,
        "old_desktop": home / ".local/share/applications/dev.kitlangton.scrawl.desktop",
        "new_desktop": home / ".local/share/applications/dev.kitlangton.apparent.desktop",
        "old_autostart": home / ".config/autostart/scrawl.desktop",
        "new_autostart": home / ".config/autostart/apparent.desktop",
        "new_link": bin_dir / "apparent",
        "config": home / ".config/apparent/config.json",
    }
    paths["shortcut"] = shortcut
    for path in (new, *paths.values()):
        if path is None:
            continue
        # A symlinked ancestor can redirect a seemingly home-local write into /opt.
        ancestor = next((parent for parent in (path.parent, *path.parents) if parent.exists()), None)
        if ancestor is None or not ancestor.resolve().is_relative_to(home) or ancestor.stat().st_uid != os.geteuid():
            raise Refused(f"target parent is not an owned directory under home: {path}")
    for key in ("old_desktop", "old_autostart"):
        path = paths[key]
        if path.exists() or path.is_symlink():
            owned(path, home)
            if not old_command(desktop_exec(path), old):
                raise Refused(f"desktop entry does not launch the owned Scrawl image: {path}")
    if not paths["old_desktop"].exists():
        raise Refused("no owned Scrawl desktop launcher; cannot establish installation ownership")
    paths["old_desktop_snapshot"] = paths["old_desktop"].read_bytes()
    paths["old_autostart_snapshot"] = paths["old_autostart"].read_bytes() if paths["old_autostart"].exists() else None
    for key in ("new_desktop", "new_autostart", "new_link"):
        path = paths[key]
        if path.exists() or path.is_symlink():
            raise Refused(f"Apparent target already exists; refusing to replace it: {path}")
    config = paths["config"]
    if config.exists() or config.is_symlink():
        owned(config, home)
        try:
            paths["config_snapshot"] = secure_read(home, config)
            value = json.loads(paths["config_snapshot"])
        except (ValueError, UnicodeError) as exc:
            raise Refused(f"invalid Apparent config; left intact: {exc}") from exc
        if not isinstance(value, dict):
            raise Refused("Apparent config is not an object")
    else:
        value = {}
        paths["config_snapshot"] = None
    if "updateChannel" in value and value["updateChannel"] not in ("main", "stable"):
        raise Refused("existing Apparent update channel is invalid")
    active_login = False
    if paths["old_autostart"].exists():
        text = paths["old_autostart"].read_text()
        active_login = not any(line.strip().lower() in ("hidden=true", "x-gnome-autostart-enabled=false")
                               for line in text.splitlines())
    # Do not turn a deliberately disabled Apparent login preference back on.
    if "launchAtLogin" in value and not isinstance(value["launchAtLogin"], bool):
        raise Refused("existing Apparent login preference is invalid")
    if value.get("launchAtLogin") is True and not active_login:
        raise Refused("existing Apparent login preference conflicts with Scrawl autostart; reconcile it first")
    active_login = active_login and value.get("launchAtLogin", True)
    value["launchAtLogin"] = bool(active_login)
    value.setdefault("updateChannel", "main")  # no Stable Linux asset yet
    new_shortcut = None
    if shortcut is None:
        usual = home / ".config/hypr/bindings.lua"
        if usual.exists() or usual.is_symlink():
            owned(usual, home)
            if "scrawl shortcut" in usual.read_text().lower():
                shortcut = usual
    if shortcut:
        owned(shortcut, home)
        paths["shortcut_snapshot"] = secure_read(home, shortcut)
        new_shortcut, _ = shortcut_change(paths["shortcut_snapshot"].decode())
    paths["shortcut"] = shortcut
    return old, new, paths, value, new_shortcut, active_login


def migrate(home, image, shortcut=None):
    old, new, paths, config, new_shortcut, login = plan(home, image, shortcut)
    shortcut = paths["shortcut"]
    expected_source = sha(image)
    # A name and a launcher are not proof that either image is this product.
    for path, product in ((old, "scrawl"), (image, "apparent")):
        version = path.name.removeprefix("Scrawl-").removeprefix("Apparent-").split("-", 1)[0]
        validate_image(home, path, product, version)
    backups = home / ".local/share/apparent/migration-backups" / uuid.uuid4().hex
    # Securely create and pin the backup directory before writing any config.
    with secure_dir(home, backups.parent, create=True) as parent:
        os.mkdir(backups.name, 0o700, dir_fd=parent)
    prior = {}
    original = {}
    touched = []
    installed = {}
    def save(path: Path):
        if path in prior:
            return
        with secure_dir(home, path.parent, create=True) as parent:
            pinned = os.dup(parent)
        try:
            try:
                info = os.stat(path.name, dir_fd=pinned, follow_symlinks=False)
            except FileNotFoundError:
                entry = ("absent",)
                previous_identity = None
            else:
                if stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid():
                    fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=pinned)
                    with os.fdopen(fd, "rb") as stream:
                        info = os.fstat(stream.fileno())
                        entry = ("file", stream.read(), info.st_mode & 0o777)
                        previous_identity = (info.st_dev, info.st_ino, entry[1])
                else:
                    raise Refused(f"not an owned ordinary file: {path}")
            snapshots = {
                paths["config"]: paths["config_snapshot"],
                paths["old_desktop"]: paths["old_desktop_snapshot"],
                paths["old_autostart"]: paths["old_autostart_snapshot"],
            }
            if shortcut is not None:
                snapshots[shortcut] = paths["shortcut_snapshot"]
            if path in snapshots and (entry[1] if entry[0] == "file" else None) != snapshots[path]:
                raise Refused(f"file changed since preflight: {path}")
            if path not in (paths["old_desktop"], paths["old_autostart"], paths["config"], shortcut) and entry[0] != "absent":
                raise Refused(f"target appeared during migration: {path}")
            prior[path] = (pinned, *entry)
            original[path] = previous_identity
        except BaseException:
            os.close(pinned)
            raise
        if entry[0] == "file":
            with secure_dir(home, backups) as backup:
                atomic_bytes(backup, f"{len(prior):02d}-{path.name}", entry[1], exclusive=True)

    def mark(path: Path, identity, content):
        installed[path] = (identity, content)
        touched.append(path)

    def write(path: Path, data: bytes, mode=0o600):
        save(path)
        identity = atomic_bytes(prior[path][0], path.name, data, mode,
                                exclusive=prior[path][1] == "absent", expected=original[path])
        mark(path, identity, data)

    try:
        save(new)
        parent = prior[new][0]
        stage = f".{new.name}.{uuid.uuid4().hex}"
        try:
            staged_fd = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                0o700, dir_fd=parent)
            with os.fdopen(staged_fd, "wb") as output:
                with secure_dir(home, image.parent) as source_parent:
                    source_fd = os.open(image.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_parent)
                    with os.fdopen(source_fd, "rb") as source:
                        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                            raise Refused("source AppImage changed during staging")
                        shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
            with os.fdopen(os.open(stage, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent), "rb") as staged:
                digest = hashlib.sha256(staged.read()).hexdigest()
                info = os.fstat(staged.fileno())
                stage_identity = (info.st_dev, info.st_ino)
            if digest != expected_source:
                raise Refused("staged AppImage checksum changed")
            staged_path = new.parent / stage
            version = new.name.removeprefix("Apparent-").split("-", 1)[0]
            validate_image(home, staged_path, "apparent", version)
            os.link(stage, new.name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            mark(new, stage_identity, ("sha256", expected_source))
        finally:
            try:
                os.unlink(stage, dir_fd=parent)
            except FileNotFoundError:
                pass
        write(paths["new_desktop"], desktop(new))
        save(paths["new_link"])
        identity = publish_symlink(prior[paths["new_link"]][0], paths["new_link"].name, new)
        mark(paths["new_link"], identity, str(new))
        write(paths["config"], (json.dumps(config, indent=2) + "\n").encode())
        if login:
            write(paths["new_autostart"], desktop(new, autostart=True))
        else:
            save(paths["new_autostart"])
        if shortcut is not None and new_shortcut is not None and new_shortcut != paths["shortcut_snapshot"].decode():
            save(shortcut)
            write(shortcut, new_shortcut.encode(), prior[shortcut][3])
        # No Scrawl deletion until every new target is installed and reads back correctly.
        link_parent = prior[paths["new_link"]][0]
        if os.readlink(paths["new_link"].name, dir_fd=link_parent) != str(new) or desktop_exec(paths["new_desktop"]) != f'"{new}"':
            raise Refused("Apparent launcher/CLI read-back failed")
        if login and desktop_exec(paths["new_autostart"]) != f'"{new}" app':
            raise Refused("Apparent autostart read-back failed")
        if not login:
            assert_unchanged(prior[paths["new_autostart"]][0], paths["new_autostart"].name, None)
        if running_old(old):
            raise Refused("Scrawl started during migration")
        if not paths["old_link"].is_symlink() or target_of(paths["old_link"]) != old:
            raise Refused("Scrawl CLI target changed during migration")
        validate_image(home, old, "scrawl", old.name.removeprefix("Scrawl-").split("-", 1)[0])
        # Old image and old CLI remain available for rollback. Retire only the old launchers.
        for key in ("old_desktop", "old_autostart"):
            path = paths[key]
            if path.exists():
                save(path)
                retire(prior[path][0], path.name, original[path])
                installed[path] = None
                touched.append(path)
        print(f"Migrated launch targets to {new}\nOld AppImage and CLI retained: {old}, {home / '.local/bin/scrawl'}")
        print(f"Prior launch files and config backed up in {backups}")
        print("Old captures/settings were not copied or deleted. Restart the desktop session to activate permanent shortcut edits.")
    except BaseException:
        for path in reversed(touched):
            parent, kind, *data = prior[path]
            try:
                info = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                info = None
            publication = installed[path]
            if info is None and publication is not None:
                continue  # a concurrent deletion is not ours to undo
            if info is not None and (publication is None or not published_unchanged(parent, path.name, *publication)):
                continue  # another writer owns this name now; backups remain
            if info is not None:
                os.unlink(path.name, dir_fd=parent)
            if kind == "file":
                atomic_bytes(parent, path.name, data[0], data[1], exclusive=True)
        raise
    finally:
        for parent, *_ in prior.values():
            os.close(parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("appimage", type=Path, help="local, owned, versioned Apparent Linux AppImage")
    parser.add_argument("--shortcut-file", type=Path,
                        help="owned permanent Hyprland bindings.lua with Scrawl CLI binds")
    args = parser.parse_args()
    try:
        migrate(Path.home(), args.appimage.absolute(), args.shortcut_file.absolute() if args.shortcut_file else None)
    except (Refused, OSError, subprocess.TimeoutExpired) as exc:
        parser.exit(1, f"Migration refused: {exc}\n")


if __name__ == "__main__":
    main()
