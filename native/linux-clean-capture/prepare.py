#!/usr/bin/env python3
"""Prepare pinned, patched external sources. Never install or launch anything."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import tempfile
import urllib.request

HERE = Path(__file__).resolve().parent


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare(destination, cache, offline):
    manifest = json.loads((HERE / "sources.json").read_text())
    if destination.exists():
        raise ValueError(f"Destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    archives = []
    for entry in manifest["inputs"]:
        archive = cache / (entry["sha256"] + ".tar.gz")
        if not archive.exists():
            if offline:
                raise FileNotFoundError(f"Missing cached source: {entry['name']}")
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
                temporary = Path(output.name)
                try:
                    with urllib.request.urlopen(entry["url"], timeout=90) as response:
                        while chunk := response.read(1024 * 1024):
                            output.write(chunk)
                            if output.tell() > 64 * 1024 * 1024:
                                raise ValueError("Source archive exceeds 64 MiB")
                    output.flush()
                    if digest(temporary) != entry["sha256"]:
                        raise ValueError(f"Source digest mismatch: {entry['name']}")
                    temporary.replace(archive)
                finally:
                    temporary.unlink(missing_ok=True)
        if digest(archive) != entry["sha256"]:
            raise ValueError(f"Cached source digest mismatch: {entry['name']}")
        archives.append((entry, archive))
    with tempfile.TemporaryDirectory(prefix=".apparent-clean-", dir=destination.parent) as temporary:
        staged = Path(temporary) / "sources"
        staged.mkdir()
        for entry, archive in archives:
            for relative in entry["destinations"]:
                target = staged / relative
                target.mkdir(parents=True, exist_ok=True)
                with tarfile.open(archive) as source:
                    members = source.getmembers()
                    prefixes = {PurePosixPath(member.name).parts[0] for member in members}
                    if len(prefixes) != 1:
                        raise ValueError(f"Archive has multiple roots: {entry['name']}")
                    for member in members:
                        path = PurePosixPath(member.name)
                        if path.is_absolute() or ".." in path.parts:
                            raise ValueError("Unsafe source archive path")
                        if len(path.parts) == 1:
                            continue
                        member.name = str(PurePosixPath(*path.parts[1:]))
                        source.extract(member, target, filter="data")
        patches = {}
        for directory, name in [("Hyprland", "hyprland.patch"), ("portal", "portal.patch"), ("backend", "portal-hyprland.patch")]:
            patch = HERE / "patches" / name
            subprocess.run(["git", "apply", "--check", str(patch)], cwd=staged / directory, check=True)
            subprocess.run(["git", "apply", str(patch)], cwd=staged / directory, check=True)
            patches[name] = digest(patch)
        receipt = {"schema": 1, "inputs": manifest["inputs"], "patches": patches,
                   "scope": "Verified source preparation only; no build, install or native acceptance"}
        (staged / "apparent-clean-source.json").write_text(json.dumps(receipt, indent=2) + "\n")
        staged.rename(destination)
    print(destination / "apparent-clean-source.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="New, absent directory for external sources")
    parser.add_argument("--cache", type=Path, required=True, help="SHA256-addressed archive cache")
    parser.add_argument("--offline", action="store_true", help="Require every archive to be cached")
    args = parser.parse_args()
    prepare(args.destination.resolve(), args.cache.resolve(), args.offline)


if __name__ == "__main__":
    main()
