#!/usr/bin/env python3
"""Conservative changed-tree verification shared by pre-push and Actions.

No user-selected fast mode: only reviewed path rules can narrow the default.
Both sides of renames/deletions are included. Missing history broadens checks.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
DOCS = {"AGENTS.md", "README.md", "refactor.md"}


def select(paths, history_known=True):
    paths = sorted(set(paths))
    # Unknown/shared/build/security/lifecycle input is broad by default. Do not
    # infer safety from a commit message, extension, or a newly created owner.
    broad = not history_known or not paths
    engine = False
    reasons = []
    for path in paths:
        if path in DOCS or (path.startswith("docs/") and path.endswith(".md")):
            continue
        if path.startswith("capture/engine/tests/") or path == "capture/engine/README.md":
            engine = True
        else:
            broad = True
            reasons.append(path)
    return {"root": broad, "engine": broad or engine, "paths": paths,
            "reason": "unknown history or empty delta" if not history_known or not paths
            else "broad inputs: " + ", ".join(reasons) if broad else "document/package-test-only delta"}


def changed_paths(base, head):
    # --no-renames reports the old and new path, including cross-owner moves.
    result = subprocess.run(["git", "diff", "--no-renames", "--name-only", "-z",
                             base, head, "--"], cwd=ROOT, capture_output=True, check=True)
    return result.stdout.decode("utf-8").rstrip("\0").split("\0") if result.stdout else []


def plan(base, head):
    try:
        return select(changed_paths(base, head))
    except (subprocess.CalledProcessError, UnicodeError):
        return select([], history_known=False)


def run_checks(selection, offline=True):
    subprocess.run(["python3", "-m", "unittest", "discover", "-s", "tests",
                    "-p", "test_*push*.py"], cwd=ROOT, check=True)
    subprocess.run(["python3", "-m", "unittest", "discover", "-s", "tests",
                    "-p", "test_verification.py"], cwd=ROOT, check=True)
    cargo = ["cargo"]
    if subprocess.run(["sh", "-c", "command -v taskpolicy"], capture_output=True).returncode == 0:
        cargo = ["taskpolicy", "-c", "utility", "cargo"]
    jobs = os.environ.get("T3_BUILD_JOBS", "3")
    dependency_mode = "--offline" if offline else "--locked"
    if selection["root"]:
        subprocess.run(cargo + ["build", "-j", jobs, dependency_mode], cwd=ROOT, check=True)
        subprocess.run(cargo + ["test", "-j", jobs, dependency_mode, "--", "--test-threads=2"], cwd=ROOT, check=True)
    if selection["engine"]:
        for command in ("build", "test"):
            args = cargo + [command, "--manifest-path", "capture/engine/Cargo.toml", "-j", jobs, dependency_mode]
            if command == "test":
                args += ["--", "--test-threads=2"]
            subprocess.run(args, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--online", action="store_true", help="CI: use locked graph instead of offline cache")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    selection = plan(args.base, args.head)
    print(json.dumps(selection, sort_keys=True), flush=True)
    if args.github_output:
        with args.github_output.open("a") as output:
            for key in ("root", "engine"):
                output.write(f"{key}={str(selection[key]).lower()}\n")
    if args.run:
        run_checks(selection, offline=not args.online)


if __name__ == "__main__":
    main()
