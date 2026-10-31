#!/usr/bin/env python3
"""Run gui-vm.py inside a fixed ext4 disk budget and expiring systemd cgroup.

Run with sudo. The image is retained, never expanded, and contains all guest
writable state and evidence. This is a trusted local test tool, not a sandbox
for malicious host users or arbitrary untrusted scenarios.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid


def checked(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout


def create_volume(image, mount, size, uid, gid):
    # Exclusive creation and actual reservation: no sparse-file reserve claims.
    fd = os.open(image, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
    try:
        os.posix_fallocate(fd, 0, size)
    finally:
        os.close(fd)
    checked('mkfs.ext4', '-q', '-F', '-m', '0', '-E', 'nodiscard', str(image))
    mount.mkdir(mode=0o700)
    checked('mount', '-o', 'loop,nodev,nosuid', str(image), str(mount))
    os.chown(mount, uid, gid)
    os.chmod(mount, 0o700)


def unmount(mount):
    # Never lazy-unmount: a busy writer must retain its filesystem and evidence.
    checked('umount', str(mount))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image', type=Path, required=True, help='new retained ext4 image, outside git')
    p.add_argument('--disk-gib', type=int, default=8, choices=range(2, 17))
    p.add_argument('--seconds', type=int, default=1200, choices=range(60, 3601))
    p.add_argument('runner_args', nargs=argparse.REMAINDER, help='gui-vm.py options after --; results supplied here')
    a = p.parse_args()
    if os.geteuid() != 0 or 'SUDO_UID' not in os.environ:
        p.error('invoke via sudo from the owning test account')
    args = a.runner_args[1:] if a.runner_args[:1] == ['--'] else a.runner_args
    if any(x.split('=')[0] in ('--results', '--managed-lifetime', '--job-timeout') for x in args):
        p.error('volume owns results and lifetime')
    uid, gid = int(os.environ['SUDO_UID']), int(os.environ['SUDO_GID'])
    image = a.image.absolute()
    if not image.parent.is_dir() or image.exists() or image.with_suffix(image.suffix + '.json').exists():
        p.error('image parent must exist; image must be new')
    # Root-owned private mountpoint, short enough for QEMU Unix sockets.
    token = uuid.uuid4().hex[:16]
    mount = Path('/run/apparent-vm-' + token)
    unit = 'apparent-vm-' + token + '.service'
    receipt = image.with_suffix(image.suffix + '.json')
    mounted = False
    status = {'unit': unit, 'image': str(image), 'mount': str(mount),
              'disk_bytes': a.disk_gib * 1024**3, 'seconds': a.seconds,
              'cleanup': 'pending', 'exit': None}
    def terminated(*_):
        raise SystemExit(143)
    signal.signal(signal.SIGTERM, terminated)
    signal.signal(signal.SIGINT, terminated)
    try:
        create_volume(image, mount, status['disk_bytes'], uid, gid)
        mounted = True
        (mount / 'tmp').mkdir(mode=0o700)
        os.chown(mount / 'tmp', uid, gid)
        command = ['systemd-run', '--quiet', '--wait', '--collect', '--pipe',
                   '--unit=' + unit, '-p', 'User=' + str(uid), '-p', 'Group=' + str(gid),
                   '-p', 'SupplementaryGroups=kvm', '-p', 'MemoryMax=5G',
                   '-p', 'MemorySwapMax=0', '-p', 'CPUQuota=200%', '-p', 'TasksMax=128',
                   '-p', 'RuntimeMaxSec=' + str(a.seconds), '-p', 'TimeoutStopSec=15',
                   '-p', 'KillMode=control-group', '-p', 'NoNewPrivileges=yes',
                   '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=read-only',
                   '-p', 'ReadWritePaths=' + str(mount),
                   '--setenv=HOME=' + str(Path(checked('getent', 'passwd', str(uid)).split(':')[5])),
                   '--setenv=XDG_RUNTIME_DIR=/run/user/' + str(uid),
                   '--setenv=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + str(uid) + '/bus',
                   '--setenv=TMPDIR=' + str(mount / 'tmp'),
                   '/usr/bin/python3', str(Path(__file__).with_name('gui-vm.py').resolve()),
                   '--results', str(mount / 'job'), '--managed-lifetime',
                   '--job-timeout', str(a.seconds), *args]
        with (mount / 'controller.log').open('wb') as log:
            status['exit'] = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT).returncode
    finally:
        # Exact owned unit only. Blocking stop completes cgroup termination before
        # unmount. A failed stop/unmount keeps the image for recovery, never deletes it.
        stop = subprocess.run(['systemctl', 'stop', unit], capture_output=True)
        if mounted or os.path.ismount(mount):
            try:
                unmount(mount)
                mount.rmdir()
                status['cleanup'] = 'unmounted; image retained'
            except subprocess.CalledProcessError as e:
                status['cleanup'] = 'FAILED: ' + e.stderr
        status['mounted'] = os.path.ismount(mount)
        receipt.write_text(json.dumps(status, indent=2) + '\n')
        os.chown(receipt, uid, gid)
        os.chmod(receipt, 0o600)
        os.chown(image, uid, gid)
    print(json.dumps(status))
    return status['exit'] if status['exit'] is not None else 1

if __name__ == '__main__':
    sys.exit(main())
