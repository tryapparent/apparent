#!/usr/bin/env python3
"""Publish a checked Linux preview, or queue the main head that superseded it."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def release(repo, tag):
    result = subprocess.run(["gh", "release", "view", tag, "--repo", repo,
                             "--json", "isDraft,assets"], capture_output=True, text=True)
    if result.returncode:
        if "HTTP 404" in result.stderr or "release not found" in result.stderr.lower():
            return None
        raise RuntimeError(f"Could not inspect release {tag}: {result.stderr}")
    return json.loads(result.stdout)


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    sha = os.environ["GITHUB_SHA"]
    tag = f"linux-main-{sha}"
    dist = Path("dist")
    images = sorted(dist.glob("*.AppImage"))
    expected = {f"Apparent-{os.environ['APPARENT_VERSION']}-linux-{arch}.AppImage"
                for arch in ("aarch64", "x86_64")}
    if {image.name for image in images} != expected:
        raise RuntimeError(f"Expected both checked AppImages: {expected}; found {[p.name for p in images]}")
    files = sorted(dist.iterdir())
    if {p.name for p in files} != expected | {name + ".sha256" for name in expected}:
        raise RuntimeError("Preview must contain exactly two AppImages and their checksums")
    digests = {}
    for image in images:
        digest = hashlib.sha256(image.read_bytes()).hexdigest()
        if (dist / (image.name + ".sha256")).read_text().strip() != f"{digest}  {image.name}":
            raise RuntimeError(f"Checksum mismatch: {image.name}")
        digests[image.name] = digest

    def head():
        return json.loads(gh("api", f"repos/{repo}/git/ref/heads/main"))["object"]["sha"]

    def superseded(current):
        print(f"Main moved from {sha} to {current}; no preview published. Queuing current main.", file=sys.stderr)
        gh("workflow", "run", "release-linux.yml", "--repo", repo, "--ref", "main",
           "-f", "publish_main=true")
        raise RuntimeError(f"Superseded by {current}; replacement workflow dispatched")

    current = head()
    if current != sha:
        superseded(current)

    existing = release(repo, tag)
    if existing:
        if not existing["isDraft"]:
            raise RuntimeError(f"Published preview already exists: {tag}")
        # Recover a draft left by an interrupted attempt for this same commit.
        gh("release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag")

    # A draft is invisible to the updater until GitHub reports all four assets.
    published = False
    try:
        gh("release", "create", tag, *(str(p) for p in files), "--repo", repo,
           "--target", sha, "--draft", "--prerelease", "--latest=false",
           "--title", f"Linux main {sha[:12]}",
           "--notes", "Automatic Linux preview from main; not a stable release.")
        draft = release(repo, tag)
        if draft is None or not draft["isDraft"]:
            raise RuntimeError("Draft release was not created privately")
        assets = {asset["name"]: asset for asset in draft["assets"]}
        if set(assets) != {p.name for p in files}:
            raise RuntimeError("Draft release assets are incomplete")
        for image in images:
            asset = assets[image.name]
            checksum = assets[image.name + ".sha256"]
            if (asset["state"] != "uploaded" or asset["digest"] != "sha256:" + digests[image.name]
                    or checksum["state"] != "uploaded"
                    or checksum["digest"] != "sha256:" + hashlib.sha256(
                        (dist / (image.name + ".sha256")).read_bytes()).hexdigest()):
                raise RuntimeError(f"Remote asset differs from checked build: {image.name}")
        current = head()
        if current != sha:
            superseded(current)
        gh("release", "edit", tag, "--repo", repo, "--draft=false")
        public = release(repo, tag)
        if public is None or public["isDraft"]:
            raise RuntimeError("Release remains a draft after publication")
        current = head()
        if current != sha:
            superseded(current)
        published = True
        print(f"Published checked Linux preview {tag} with both AppImages and checksums")
    finally:
        if not published:
            partial = release(repo, tag)
            if partial:
                gh("release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, KeyError, ValueError) as exc:
        print(f"Linux preview not published successfully: {exc}", file=sys.stderr)
        sys.exit(1)
