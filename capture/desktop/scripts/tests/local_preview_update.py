#!/usr/bin/env python3
"""Disposable local Sparkle A→B probe. NEVER use its HTTP feed for a release."""
import argparse
import http.server
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
PORT = 8765
ET.register_namespace("sparkle", SPARKLE)


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def prepare(mode):
    home = Path.home()
    root = Path(__file__).resolve().parents[4]
    app = root / "dist/Apparent Preview.app"
    plist = app / "Contents/Info.plist"
    with plist.open("rb") as handle:
        info = plistlib.load(handle)
    version = "0.9000.1" if mode == "a" else "0.9000.2"
    if info["CFBundleShortVersionString"] != version:
        raise SystemExit(f"Expected {version}, got {info['CFBundleShortVersionString']}")
    info["SUFeedURL"] = f"http://127.0.0.1:{PORT}/appcast.xml"
    info["NSAppTransportSecurity"] = {"NSAllowsArbitraryLoads": True}
    with plist.open("wb") as handle:
        plistlib.dump(info, handle)
    run("codesign", "--force", "--sign", "-", "--identifier", info["CFBundleIdentifier"], str(app))
    run("codesign", "--verify", "--deep", "--strict", str(app))
    if mode == "a":
        installed = home / "Applications/Apparent Preview.app"
        installed.parent.mkdir(exist_ok=True)
        if installed.exists():
            shutil.rmtree(installed)
        run("ditto", str(app), str(installed))
        run("codesign", "--verify", "--deep", "--strict", str(installed))
        print("A installed:", installed, "version", version)
        return

    serve = home / "apparent-preview-e2e"
    serve.mkdir(exist_ok=True)
    archive = serve / "Apparent-Preview-0.9000.2-arm64.zip"
    run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(archive))
    sparkle = run(str(root / "capture/desktop/scripts/release/setup-sparkle.sh"))
    signature = run(str(Path(sparkle) / "bin/sign_update"), "--account", "apparent-preview-disposable", str(archive))
    match = re.fullmatch(r'sparkle:edSignature="([A-Za-z0-9+/=]+)" length="([0-9]+)"', signature)
    if not match or int(match[2]) != archive.stat().st_size:
        raise SystemExit("Sparkle did not sign the local archive")
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "Apparent Preview local update probe"
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = version
    ET.SubElement(item, f"{{{SPARKLE}}}version").text = "9000.2"
    ET.SubElement(item, f"{{{SPARKLE}}}shortVersionString").text = version
    ET.SubElement(item, f"{{{SPARKLE}}}minimumSystemVersion").text = "15.0"
    ET.SubElement(item, "enclosure", {
        "url": f"http://127.0.0.1:{PORT}/{archive.name}",
        "length": match[2],
        "type": "application/octet-stream",
        f"{{{SPARKLE}}}edSignature": match[1],
    })
    ET.indent(rss)
    (serve / "appcast.xml").write_bytes(ET.tostring(rss, encoding="utf-8", xml_declaration=True))
    print("B signed and local appcast ready:", serve)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("a", "b"))
    prepare(parser.parse_args().mode)
