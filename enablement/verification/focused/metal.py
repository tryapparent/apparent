"""Overlap Metal preparation with Rust/cache setup on one disposable CI runner."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def command(arguments, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return 124
    try:
        process = subprocess.Popen(arguments, start_new_session=True)
    except OSError:
        return 127
    try:
        return process.wait(timeout=max(0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        # The unreaped child anchors its process group until this signal.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)
        return 124


def prepare(status, run=command, seconds=120):
    if status.exists() or status.is_symlink() or status.with_suffix('.pending').exists():
        raise RuntimeError('Metal status destination is not fresh')
    deadline = time.monotonic() + seconds
    code = run(['xcrun', '--sdk', 'macosx', 'metal', '--version'], deadline)
    if code not in (0, 124):
        code = run(['xcodebuild', '-downloadComponent', 'MetalToolchain'], deadline)
    temporary = status.with_suffix('.pending')
    with temporary.open('x') as output:
        json.dump({'exit': code}, output)
    temporary.replace(status)
    return code


def await_ready(status, seconds=120):
    deadline = time.monotonic() + seconds
    while not status.exists():
        if time.monotonic() >= deadline:
            raise RuntimeError('Metal preparation did not finish')
        time.sleep(0.2)
    if status.is_symlink():
        raise RuntimeError('Metal preparation failed')
    result = json.loads(status.read_text())
    if not isinstance(result, dict) or set(result) != {'exit'} or type(result['exit']) is not int or result['exit'] != 0:
        raise RuntimeError('Metal preparation failed')


if __name__ == '__main__':
    os.umask(0o077)
    if len(sys.argv) == 3 and sys.argv[1] == '--await':
        await_ready(Path(sys.argv[2]))
    elif len(sys.argv) == 2:
        sys.exit(prepare(Path(sys.argv[1])))
    else:
        raise SystemExit('Expected status path or --await status path')
