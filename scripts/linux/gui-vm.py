#!/usr/bin/env python3
"""Run one isolated Scrawl GUI scenario against a stopped-VM template.

The template is never writable. Each invocation owns its disk overlay, OVMF state,
network forwarding, VNC/QMP sockets, SSH host key cache, and artifact directory.
"""

import argparse
import contextlib
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import shlex
import signal
import socket
import subprocess
import sys
import time
import uuid


def run_checked(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout


def qemu_users(path):
    """Fail closed if a QEMU command line references this disk as a live drive."""
    path = str(path.resolve())
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / "cmdline").read_bytes().split(b"\0")
        except (OSError, PermissionError):
            continue
        if not args or b"qemu-system-" not in args[0]:
            continue
        if any(path.encode() in arg for arg in args):
            yield proc.name


def available_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def make_overlay(template, destination, immutable_chain=False):
    if list(qemu_users(template)):
        raise RuntimeError("template is in use by a running QEMU process")
    if not template.is_file():
        raise RuntimeError(f"missing template: {template}")
    if immutable_chain:
        chain = json.loads(run_checked("qemu-img", "info", "--backing-chain", "--output=json", str(template)))
        for member in chain:
            path = Path(member['filename']).resolve()
            if path.stat().st_mode & 0o222 or list(qemu_users(path)):
                raise RuntimeError('backing chain must be powered-off and read-only')
        info = chain[0]
    else:
        info = json.loads(run_checked("qemu-img", "info", "--output=json", str(template)))
    if info.get("format") != "qcow2" or (info.get("backing-filename") and not immutable_chain):
        raise RuntimeError("template must be a standalone qcow2 image")
    run_checked("qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", str(template.resolve()), str(destination))

def copy_firmware(template, destination):
    shutil.copyfile(template, destination)
    destination.chmod(0o600)

def arm_expiry(directory, seconds):
    unit = "scrawl-gui-expire-" + uuid.uuid4().hex
    # Keep the reaper beside its job: a temporary code worktree may disappear
    # after the runner is killed but before the independent timer fires.
    reaper = directory / "reaper.py"
    shutil.copyfile(Path(__file__).with_name("gui-vm-reaper.py"), reaper)
    reaper.chmod(0o700)
    subprocess.run(["systemd-run", "--user", "--quiet", "--collect",
                    "--timer-property=RemainAfterElapse=no", "--unit=" + unit,
                    f"--on-active={seconds}s", "/usr/bin/python3",
                    str(reaper), str(directory)],
                   check=True, timeout=10)
    return unit


def qemu_command(overlay, vars_copy, directory, port, memory, isolated_network=False, identity=None):
    command = [
        "qemu-system-x86_64", "-name", "scrawl-gui-" + directory.name,
        "-machine", "q35,accel=kvm", "-cpu", "host", "-smp", "4", "-m", str(memory),
        "-drive", "if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd",
        "-drive", "if=pflash,format=raw,file=" + str(vars_copy),
        "-drive", "if=virtio,format=qcow2,file=" + str(overlay) + ",cache=none",
        "-boot", "order=c", "-device", "virtio-vga", "-display", "none",
        "-vnc", "unix:" + str(directory / "vnc.sock"),
        "-device", "qemu-xhci", "-device", "usb-tablet", "-device", "usb-kbd",
        "-netdev", f"user,id=net0,hostfwd=tcp:127.0.0.1:{port}-:22" + (",restrict=on" if isolated_network else ""),
        "-device", "virtio-net-pci,netdev=net0",
        "-qmp", "unix:" + str(directory / "qmp.sock") + ",server=on,wait=off",
        "-monitor", "none", "-serial", "none",
    ]
    if identity:
        command += ['-uuid', identity]
    kvm_group = Path("/dev/kvm").stat().st_gid
    if kvm_group in os.getgroups():
        return command
    groups = sorted(set(os.getgroups()) | {kvm_group})
    # Drop straight back to the calling UID; only the supplementary KVM group is new.
    return ["sudo", "-n", "env", "HOME=" + str(Path.home()),
            "XDG_CACHE_HOME=" + str(Path.home() / ".cache"), "setpriv",
            "--reuid=" + str(os.getuid()), "--regid=" + str(os.getgid()),
            "--groups=" + ",".join(map(str, groups))] + command


def ssh_prefix(port, key, known_hosts, user):
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
            "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=" + str(known_hosts),
            "-i", str(key), "-p", str(port), f"{user}@127.0.0.1"]


def wait_for_desktop(prefix, process, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"guest exited before readiness (code {process.returncode})")
        try:
            probe = subprocess.run(prefix + [
                'pgrep -u "$(id -u)" -x Hyprland >/dev/null && '
                'systemctl --user show-environment | grep -q "^HYPRLAND_INSTANCE_SIGNATURE="'
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   timeout=min(5, max(0.1, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            continue
        if probe.returncode == 0:
            return
        time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise TimeoutError(f"guest user desktop did not become ready within {seconds}s")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, required=True, help="offline, standalone qcow2 disk")
    parser.add_argument("--ovmf-vars", type=Path, required=True, help="template's powered-off OVMF vars")
    parser.add_argument("--ssh-key", type=Path, required=True)
    parser.add_argument("--ssh-user", required=True)
    parser.add_argument("--scenario", type=Path, required=True, help="guest bash script; runs after Hyprland starts")
    parser.add_argument("--audio-file", type=Path, help="optional WAV stimulus staged inside the guest")
    parser.add_argument("--binary", type=Path, required=True, help="candidate executable (sibling .so files are staged too)")
    parser.add_argument("--results", type=Path, required=True, help="new directory; retained after the run")
    parser.add_argument("--memory", type=int, default=3072, help="guest MiB (default: 3072)")
    parser.add_argument("--isolated-network", action="store_true", help="deny guest outbound networking; preserve loopback SSH forwarding")
    parser.add_argument("--boot-timeout", type=int, default=180)
    parser.add_argument("--scenario-timeout", type=int, default=300)
    parser.add_argument("--job-timeout", type=int, default=900,
                        help="hard lifetime in seconds; independent systemd timer (default: 900)")
    parser.add_argument('--managed-lifetime', action='store_true', help='internal: enclosing systemd service owns expiry')
    parser.add_argument('--immutable-chain', action='store_true', help='allow a powered-off read-only qcow2 backing chain')
    args = parser.parse_args()
    for path in (args.ovmf_vars, args.ssh_key, args.scenario, args.binary, args.audio_file):
        if path is None:
            continue
        if not path.is_file():
            parser.error(f"missing file: {path}")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", args.ssh_user):
        parser.error("ssh-user must be a simple Unix account name")
    if not 2048 <= args.memory <= 4096:
        parser.error("memory must be 2048..4096 MiB")
    if args.managed_lifetime and not os.environ.get('INVOCATION_ID'):
        parser.error('managed lifetime requires an enclosing systemd service')
    if args.job_timeout < 30:
        parser.error("job-timeout must be at least 30 seconds")
    if list(qemu_users(args.template)):
        parser.error("template is in use; do not clone a live VM disk")
    if args.results.exists():
        parser.error("results directory already exists")
    args.results.mkdir(parents=True, mode=0o700)
    args.results.chmod(0o700)
    directory = args.results.resolve()
    if len(os.fsencode(str(directory / 'vnc.sock'))) > 107:
        parser.error('results path too long for QEMU Unix sockets')
    process = None
    expiry_unit = None
    retained = False
    start = time.monotonic()
    try:
        overlay = directory / "disk.qcow2"
        make_overlay(args.template, overlay, args.immutable_chain)
        vars_copy = directory / "OVMF_VARS.fd"
        copy_firmware(args.ovmf_vars, vars_copy)
        port = available_port()
        identity = str(uuid.uuid4())
        command = qemu_command(overlay, vars_copy, directory, port, args.memory, args.isolated_network, identity)
        # The user manager survives a SIGKILL or OOM kill of this runner.
        # Refuse to boot at all if that independent expiry cannot be armed.
        if not args.managed_lifetime:
            expiry_unit = arm_expiry(directory, args.job_timeout)
        with (directory / "qemu.log").open("wb") as log:
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            prefix = ssh_prefix(port, args.ssh_key.resolve(), directory / "known_hosts", args.ssh_user)
            wait_for_desktop(prefix, process, args.boot_timeout)
            actual_identity = run_checked(*prefix, 'cat /sys/class/dmi/id/product_uuid').strip().lower()
            if actual_identity != identity:
                raise RuntimeError('SSH endpoint does not match owned QEMU UUID')
            (directory / 'identity.json').write_text(json.dumps({'uuid': identity, 'ssh_uuid': actual_identity, 'port': port, 'qemu_command': command}, indent=2))
            boot_seconds = round(time.monotonic() - start, 2)
            remote = "/home/" + args.ssh_user + "/scrawl-gui-scenario-" + uuid.uuid4().hex + ".sh"
            guest_output = "/home/" + args.ssh_user + "/scrawl-gui-output-" + uuid.uuid4().hex
            guest_bin = "/home/" + args.ssh_user + "/scrawl-gui-bin-" + uuid.uuid4().hex
            subprocess.run(prefix + ["mkdir -p " + shlex.quote(guest_bin)], check=True, timeout=10)
            files = [args.binary.resolve()] + sorted(args.binary.parent.glob("lib*.so*"))
            transfer = ["scp", "-q", "-P", str(port), "-i", str(args.ssh_key.resolve()),
                        "-o", "StrictHostKeyChecking=accept-new",
                        "-o", "UserKnownHostsFile=" + str(directory / "known_hosts")]
            subprocess.run(transfer + [*[str(path) for path in files],
                                       f"{args.ssh_user}@127.0.0.1:{guest_bin}/"], check=True, timeout=120)
            digest = hashlib.sha256(args.binary.read_bytes()).hexdigest()
            guest_binary = guest_bin + "/" + args.binary.name
            actual = run_checked(*prefix, "sha256sum " + shlex.quote(guest_binary)).split()[0]
            if actual != digest:
                raise RuntimeError("staged executable hash differs from candidate")
            scp = transfer + [str(args.scenario), f"{args.ssh_user}@127.0.0.1:{remote}"]
            subprocess.run(scp, check=True, timeout=30)
            try:
                audio_file = ""
                if args.audio_file:
                    subprocess.run(prefix + ["mkdir -p " + shlex.quote(guest_output)], check=True, timeout=10)
                    audio_file = guest_output + "/stimulus.wav"
                    subprocess.run(transfer + [str(args.audio_file.resolve()),
                                               f"{args.ssh_user}@127.0.0.1:{audio_file}"],
                                   check=True, timeout=120)
                try:
                    with (directory / "scenario.log").open("wb") as output:
                        result = subprocess.run(prefix + ["mkdir -p " + shlex.quote(guest_output) +
                                                          " && SCRAWL_GUI_OUTPUT=" + shlex.quote(guest_output) +
                                                          " SCRAWL_GUI_BINARY=" + shlex.quote(guest_binary) +
                                                          " SCRAWL_GUI_AUDIO_FILE=" + shlex.quote(audio_file) +
                                                          " LD_LIBRARY_PATH=" + shlex.quote(guest_bin) +
                                                          " bash " + shlex.quote(remote)], stdout=output,
                                                stderr=subprocess.STDOUT, timeout=args.scenario_timeout)
                finally:
                    # Preserve guest diagnostics even when the scenario times out.
                    subprocess.run(transfer[:2] + ["-r"] + transfer[2:] +
                                   [f"{args.ssh_user}@127.0.0.1:{guest_output}/.", str(directory / "artifacts")],
                                   check=True, timeout=60)
                    retained = True
            finally:
                subprocess.run(prefix + ["rm -f " + shlex.quote(remote)], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10, check=False)
            status = {"scenario_exit": result.returncode, "boot_seconds": boot_seconds,
                      "elapsed_seconds": round(time.monotonic() - start, 2)}
            (directory / "result.json").write_text(json.dumps(status, indent=2) + "\n")
            print(json.dumps(status))
            return result.returncode
    except (OSError, RuntimeError, TimeoutError, subprocess.SubprocessError) as error:
        print(f"gui-vm: {error}", file=sys.stderr)
        return 1
    finally:
        if process is not None:
            # sudo/setpriv can wrap QEMU: stop the whole job group, not just sudo.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)
        # A sudo wrapper can exit before QEMU; never unlink its live disk.
        if list(qemu_users(directory / "disk.qcow2")):
            print("gui-vm: QEMU still owns the job disk; keeping writable state for safe recovery", file=sys.stderr)
        elif retained:
            for filename in ("disk.qcow2", "OVMF_VARS.fd", "known_hosts", "qmp.sock", "vnc.sock"):
                with contextlib.suppress(FileNotFoundError):
                    (directory / filename).unlink()
            if expiry_unit is not None:
                subprocess.run(["systemctl", "--user", "stop", expiry_unit + ".timer"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=10)
        else:
            print('gui-vm: retaining cold guest disk after incomplete artifact retention', file=sys.stderr)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    sys.exit(main())
