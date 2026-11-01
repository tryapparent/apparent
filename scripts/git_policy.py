#!/usr/bin/env python3
"""Read-only Git-tree policy and explicit hook setup (Python 3.11+, macOS/Linux)."""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import signal
import subprocess
import sys
import tempfile
import time

if sys.version_info < (3, 11):
    sys.exit("git policy: Python 3.11+ required; see docs/git-hooks.md")

import tomllib

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1"
# These are real owners, not the future directory diagram in refactor.md.
REQUIRED = ("Cargo.toml", "capture/engine/Cargo.toml", "capture/engine/src/lib.rs",
            "site/src/main.tsx", "site/src/entry-server.tsx", "connect/web/src/main.tsx",
            "hosted/package.json", "scripts/architecture-baseline.json",
            "tools/narrator/Cargo.toml", "video/Cargo.toml")
BROWSER_ROOTS = ("site/src/", "connect/web/src/", "hosted/src/")
SOURCE_TYPES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"}
# Capture bundle names are prohibited only in publishable static trees. Synthetic
# .apparent fixtures elsewhere, ordinary images and marketing videos are allowed.
PUBLIC_TREES = ("site/public/", "site/dist/", "site/dist-apparent/", "connect/web/public/", "connect/web/dist/")
BUNDLE_NAMES = {"apparent.json", "contact-sheet.png", "recording.mp4", "recording.mov", "audio.wav"}


class PolicyError(Exception):
    pass


class Runner:
    """One wall-clock deadline, including Git and all formatter descendants."""
    def __init__(self, seconds=45):
        self.deadline = time.monotonic() + seconds

    def run(self, command, *, data=None, cwd=ROOT, check=True):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise PolicyError("45-second policy budget exhausted; split the change or diagnose the slow tool")
        process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
        try:
            out, err = process.communicate(data, timeout=remaining)
        finally:
            # Kill the complete owned group even if the leader exited first.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream:
                    stream.close()
        if check and process.returncode:
            # Never echo file contents (including formatter/diff source excerpts).
            raise PolicyError(f"command failed ({process.returncode}): {' '.join(command)}")
        return out, process.returncode


class View:
    def __init__(self, runner, revision=None, root=ROOT):
        self.runner, self.root, self.revision = runner, root, revision
        if revision is None:
            raw = self.git("ls-files", "--stage", "-z")
            self.entries = {}
            for record in raw.split(b"\0"):
                if not record:
                    continue
                meta, path = record.split(b"\t", 1)
                mode, oid, stage = meta.decode().split()
                if stage != "0":
                    raise PolicyError("unmerged index; resolve conflicts first")
                self.entries[path.decode()] = (mode, oid)
        else:
            # Resolve once: callers cannot change a symbolic ref mid-check.
            self.revision = self.git("rev-parse", "--verify", revision + "^{tree}").decode().strip()
            self.entries = {}
            for record in self.git("ls-tree", "-rz", self.revision).split(b"\0"):
                if record:
                    meta, path = record.split(b"\t", 1)
                    mode, kind, oid = meta.decode().split()
                    self.entries[path.decode()] = (mode, oid)

    def git(self, *args):
        return self.runner.run(["git", "--no-pager", *args], cwd=self.root)[0]

    def read(self, path):
        if path not in self.entries or self.entries[path][0] not in {"100644", "100755"}:
            raise PolicyError(f"missing or non-regular configured file: {path}")
        if secret_path(path):
            raise PolicyError(f"credential path is not read: {path}")
        return self.git("cat-file", "blob", self.entries[path][1])


def secret_path(path):
    return any(part == ".env" or part.startswith(".env.") or part in
               {".ssh", ".aws", "credentials", "credentials.json", "id_rsa", "id_ed25519"}
               or part.endswith((".p12", ".pfx", ".pem", ".key"))
               for part in PurePosixPath(path).parts)


def artifact_checks(view):
    for path in view.entries:
        if secret_path(path):
            raise PolicyError(f"credential path must not be tracked: {path} (contents not read)")
        if path.startswith(PUBLIC_TREES):
            parts = PurePosixPath(path).parts
            if (PurePosixPath(path).name in BUNDLE_NAMES or any(p.endswith(".apparent") for p in parts)
                    or any(p.lower() in {"pitch", "pitch-deck", "private-captures"}
                           or p.lower().startswith("pitch-deck.") for p in parts)):
                raise PolicyError(f"private capture/pitch artifact in publishable static tree: {path}")


def dependency_tables(manifest):
    for key, value in manifest.items():
        if key in {"dependencies", "dev-dependencies", "build-dependencies"}:
            if not isinstance(value, dict):
                raise PolicyError("invalid Cargo dependency table")
            yield value
        elif isinstance(value, dict):
            yield from dependency_tables(value)


def architecture_checks(view):
    for path in REQUIRED:
        if path not in view.entries or view.entries[path][0] not in {"100644", "100755"}:
            raise PolicyError(f"missing configured path: {path}")
    manifests = {p for p in view.entries if PurePosixPath(p).name == "Cargo.toml"}
    if manifests != {"Cargo.toml", "capture/engine/Cargo.toml", "tools/narrator/Cargo.toml", "video/Cargo.toml"}:
        raise PolicyError("new/missing Cargo package needs an explicit architecture policy review")
    engine = tomllib.loads(view.read("capture/engine/Cargo.toml").decode())
    if (engine.get("package", {}).get("name") != "apparent-capture-engine"
            or any(k in engine for k in ("workspace", "lib", "bin", "example", "test", "bench", "patch", "replace"))
            or any(k in engine.get("package", {}) for k in ("build", "links"))):
        raise PolicyError("Engine package/build roots changed; review ownership before extending policy")
    for table in dependency_tables(engine):
        for alias, spec in table.items():
            if not isinstance(spec, (str, dict)):
                raise PolicyError(f"invalid Engine dependency: {alias}")
            package = spec.get("package", alias) if isinstance(spec, dict) else alias
            if (package not in {"libc", "serde", "serde_json"}
                    or isinstance(spec, dict) and any(k in spec for k in ("path", "git", "workspace", "registry"))):
                raise PolicyError(f"Engine dependency {alias} is outside reviewed mechanics-only graph")
    if "capture/engine/build.rs" in view.entries:
        raise PolicyError("Engine build.rs requires architecture review")
    for path in view.entries:
        if path.startswith("capture/engine/src/") and path.endswith(".rs"):
            # This is a deliberately conservative escape-hatch check, NOT a Rust
            # parser. Cargo owns normal module/dependency resolution and compilation.
            text = view.read(path).decode()
            if re.search(r'\binclude(?:_str|_bytes)?\s*!|#\s*\[\s*path\s*=', text):
                raise PolicyError(f"Engine source inclusion needs explicit review: {path}")
    root_manifest = tomllib.loads(view.read("Cargo.toml").decode())
    # Workspace-wide overrides can replace even Engine's admitted registry crates.
    if any(k in root_manifest for k in ("workspace", "patch", "replace")):
        raise PolicyError("root Cargo resolution changed; explicit architecture policy review required")
    for table in dependency_tables(root_manifest):
        for alias, spec in table.items():
            if isinstance(spec, dict) and "path" in spec:
                if posixpath.normpath(spec["path"]) != "capture/engine":
                    raise PolicyError(f"root product path dependency is not a supported Engine contract: {alias}")
    baseline = json.loads(view.read("scripts/architecture-baseline.json"))
    expected = {"site/src/entry-server.tsx -> site/src/hosted/Hosted"}
    if (not isinstance(baseline, dict) or set(baseline) != {"version", "browser_edges", "reason"}
            or type(baseline["version"]) is not int or baseline["version"] != 1
            or not isinstance(baseline["browser_edges"], list)
            or not all(isinstance(edge, str) for edge in baseline["browser_edges"])
            or set(baseline["browser_edges"]) != expected
            or len(baseline["browser_edges"]) != len(expected)
            or not isinstance(baseline["reason"], str) or not baseline["reason"].strip()):
        raise PolicyError("invalid reviewed architecture baseline")
    observed = set()
    for path in view.entries:
        if not path.startswith(BROWSER_ROOTS) or PurePosixPath(path).suffix not in SOURCE_TYPES:
            continue
        text = view.read(path).decode()
        # Screen relative literal references, including imports, exports, dynamic
        # imports and CSS urls. Comments can conservatively trigger review. This
        # is not a JS parser; emitted frontend closure tests remain authoritative.
        for reference in re.findall(r'''["']((?:\.{1,2}/|/src/)[^"'\n]+)["']''', text):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), reference))
            if reference.startswith("/src/"):
                package = "connect/web" if path.startswith("connect/web/") else "site" if path.startswith("site/") else "hosted"
                target = posixpath.normpath(package + reference)
            public = path.startswith("site/src/") and not path.startswith("site/src/hosted/")
            forbidden = (public and target.startswith(("site/src/hosted/", "connect/", "hosted/"))
                         or path.startswith(("connect/web/src/", "hosted/src/", "site/src/hosted/"))
                         and target.startswith(("src/", "capture/", "site/src/"))
                         and not target.startswith("site/src/hosted/"))
            if path.startswith("connect/web/src/") and not target.startswith("connect/web/src/"):
                forbidden = True
            if forbidden:
                edge = f"{path} -> {target}"
                if edge not in expected:
                    raise PolicyError(f"forbidden browser owner reference: {edge}")
                observed.add(edge)
    if observed != expected:
        raise PolicyError("reviewed migration edge disappeared; remove/review the exact baseline with its policy")


def staged_checks(view):
    changed = view.git("diff", "--cached", "--no-renames", "--name-only", "--diff-filter=ACMT", "-z").decode().split("\0")
    # Do not run diff --check on credentials: even diagnostics can expose contents.
    for path in filter(None, changed):
        if secret_path(path):
            raise PolicyError(f"credential path must not be staged: {path} (contents not read)")
    unsupported = set()
    for path in filter(None, changed):
        mode = view.entries[path][0]
        if mode in {"120000", "160000"}:
            # Link targets/commit IDs are not regular source bytes. Path privacy
            # was checked above; configured architecture paths still use read().
            continue
        if mode not in {"100644", "100755"}:
            raise PolicyError(f"unsupported staged file mode {mode}: {path}")
        data = view.read(path)
        if b"\0" in data:
            continue
        for number, line in enumerate(data.splitlines(), 1):
            if re.match(rb"^(<<<<<<< |=======\s*$|>>>>>>> )", line):
                raise PolicyError(f"conflict marker: {path}:{number}")
        # Git checks added lines only; full-file format checks below use index bytes.
        _, status = view.runner.run(["git", "-c", "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab",
                                     "diff", "--cached", "--no-ext-diff", "--no-textconv", "--check", "--", path],
                                    cwd=view.root, check=False)
        if status:
            raise PolicyError(f"staged whitespace errors: {path}; run git diff --cached --check -- <path>")
        suffix = PurePosixPath(path).suffix
        if suffix == ".rs":
            # stdin + skip_children avoids following modules or reading worktree
            # rustfmt config. --emit stdout cannot write source or index bytes.
            with tempfile.TemporaryDirectory(prefix="apparent-format-") as tmp:
                output, status = view.runner.run(["rustfmt", "--edition", "2024", "--config", "skip_children=true",
                                                  "--emit", "stdout"], data=data, cwd=tmp, check=False)
            if status or output != data:
                raise PolicyError(f"staged Rust formatting failed: {path}; format explicitly and stage the intended hunks")
        elif suffix == ".json":
            try:
                json.loads(data)  # No canonical JSON style exists here: validation only.
            except ValueError:
                raise PolicyError(f"staged JSON syntax failed: {path}") from None
        elif suffix == ".py":
            try:
                compile(data, path, "exec")  # syntax only; never execute staged code.
            except SyntaxError as error:
                raise PolicyError(f"staged Python syntax failed: {path}:{error.lineno}") from None
        elif suffix in {".sh", ".bash"} or path.startswith(".githooks/"):
            shell = "bash" if b"bash" in data.split(b"\n", 1)[0] else "sh"
            _, status = view.runner.run([shell, "-n"], data=data, check=False)
            if status:
                raise PolicyError(f"staged shell syntax failed: {path}; check explicitly with {shell} -n")
        else:
            unsupported.add(suffix or "extensionless")
    all_changed = view.git("diff", "--cached", "--no-renames", "--name-only", "-z").decode().split("\0")
    safe_paths = [path for path in all_changed if path and not secret_path(path)]
    # A removed credential file is allowed, but even numstat must not read its
    # historical contents. An empty path list would mean the entire tree to Git.
    stats = view.git("diff", "--cached", "--numstat", "--no-renames", "--no-ext-diff", "--no-textconv", "-z",
                     "--", *safe_paths) if safe_paths else b""
    size = sum(int(n) for record in stats.split(b"\0") if record
               for n in record.split(b"\t", 2)[:2] if n != b"-")
    if size > 500:
        print(f"advisory: {size} added/deleted text lines; keep this one coherent change (no size limit)", file=sys.stderr)
    print("format: Rust/rustfmt; JSON/Python/shell syntax only; no configured formatter for "
          + ", ".join(sorted(unsupported)), file=sys.stderr)


def hooks(runner, setup=False):
    def git(*args):
        return runner.run(["git", *args])[0].decode().strip()
    root = Path(git("rev-parse", "--show-toplevel"))
    if root != ROOT:
        raise PolicyError("run this checkout's scripts/git_policy.py")
    if setup:
        # A relative path deliberately selects EACH worktree's checked-out hooks.
        # --local affects all worktrees; no copied code tied to one branch's path.
        git("config", "--local", "core.hooksPath", ".githooks")
    configured, _ = runner.run(["git", "config", "--show-origin", "--get", "core.hooksPath"], check=False)
    print(f"hooks policy v{VERSION}; configured: {configured.decode().strip() or '(Git default)'}")
    okay = True
    for name in ("pre-commit", "pre-push"):
        active = Path(git("rev-parse", "--git-path", "hooks/" + name))
        if not active.is_absolute():
            active = root / active
        expected = root / ".githooks" / name
        match = active.is_file() and expected.is_file() and active.read_bytes() == expected.read_bytes() and os.access(active, os.X_OK)
        print(f"{name}: {active} — {'checkout version matches' if match else 'MISSING/DIFFERENT/not executable'}")
        okay &= match
    if not okay:
        raise PolicyError("hooks inactive/stale; inspect overrides, then explicitly run python3 scripts/git_policy.py setup")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("staged", "tree", "setup", "doctor"))
    parser.add_argument("--revision", default="HEAD")
    args = parser.parse_args()
    runner = Runner()
    def interrupted(signum, _frame):
        raise PolicyError("policy interrupted or 45-second budget exhausted; no source/index changes made")
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
        signal.signal(signum, interrupted)
    signal.setitimer(signal.ITIMER_REAL, 45)
    try:
        if args.mode in {"setup", "doctor"}:
            hooks(runner, setup=args.mode == "setup")
        else:
            view = View(runner, None if args.mode == "staged" else args.revision)
            artifact_checks(view)
            architecture_checks(view)
            if args.mode == "staged":
                staged_checks(view)
                if View(runner).entries != view.entries:
                    raise PolicyError("index changed during policy checks; retry on a stable staged tree")
            print(f"policy v{VERSION}: {args.mode} checks passed")
    except (PolicyError, OSError, ValueError, SyntaxError, subprocess.TimeoutExpired) as error:
        # Parser errors can quote input; keep credential/source contents private.
        message = str(error) if isinstance(error, PolicyError) else type(error).__name__
        if isinstance(error, FileNotFoundError):
            message = f"missing required executable/file: {error.filename}; see docs/git-hooks.md"
        print(f"git policy: {message}", file=sys.stderr)
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
