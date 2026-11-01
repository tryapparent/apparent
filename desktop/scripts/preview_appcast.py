#!/usr/bin/env python3
"""Construct the Apparent Preview Sparkle appcast from a signed archive."""
import argparse
import base64
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ET.register_namespace("sparkle", SPARKLE)


def make_feed(previous: str, archive: Path, version: str, build: str, attrs: str, url: str) -> bytes:
    match = re.fullmatch(r'sparkle:edSignature="([A-Za-z0-9+/]{86}==)" length="([0-9]+)"', attrs.strip())
    if not match or len(base64.b64decode(match[1], validate=True)) != 64:
        raise ValueError("invalid Sparkle signature output")
    if int(match[2]) != archive.stat().st_size:
        raise ValueError("signed archive length does not match the ZIP")
    if not re.fullmatch(r"[0-9]+\.[0-9]+", build) or version != f"0.{build}":
        raise ValueError("preview version and build number disagree")
    run, attempt = build.split(".")
    expected = (f"https://github.com/tryapparent/apparent/releases/download/"
                f"preview-mac-{run}-{attempt}/Apparent-Preview-{version}-arm64.zip")
    if url != expected or archive.name != f"Apparent-Preview-{version}-arm64.zip":
        raise ValueError("archive URL must match this preview release")
    if previous.strip():
        root = ET.fromstring(previous)
        if root.tag != "rss" or root.get("version") != "2.0":
            raise ValueError("invalid previous appcast")
        channel = root.find("channel")
        if channel is None:
            raise ValueError("previous appcast has no channel")
        last = channel.find("item")
        last_build = last.findtext(f"{{{SPARKLE}}}version") if last is not None else None
        if last_build is not None:
            if not re.fullmatch(r"[0-9]+\.[0-9]+", last_build):
                raise ValueError("invalid previous build number")
            if tuple(map(int, build.split("."))) <= tuple(map(int, last_build.split("."))):
                raise ValueError("preview feed cannot move backwards or repeat a build")
    else:
        root = ET.Element("rss", {"version": "2.0"})
        channel = ET.SubElement(root, "channel")
        ET.SubElement(channel, "title").text = "Apparent Preview"
    item = ET.Element("item")
    ET.SubElement(item, "title").text = version
    ET.SubElement(item, "pubDate").text = format_datetime(datetime.now(timezone.utc))
    ET.SubElement(item, f"{{{SPARKLE}}}version").text = build
    ET.SubElement(item, f"{{{SPARKLE}}}shortVersionString").text = version
    ET.SubElement(item, f"{{{SPARKLE}}}minimumSystemVersion").text = "15.0"
    ET.SubElement(item, f"{{{SPARKLE}}}hardwareRequirements").text = "arm64"
    ET.SubElement(item, "enclosure", {
        "url": url, "length": match[2], "type": "application/octet-stream",
        f"{{{SPARKLE}}}edSignature": match[1],
    })
    channel.insert(1 if channel.find("title") is not None else 0, item)
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def main():
    parser = argparse.ArgumentParser()
    for name in ("previous", "zip", "version", "build-number", "signature-attributes", "url", "out"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    result = make_feed(Path(args.previous).read_text(), Path(args.zip), args.version,
                       args.build_number, args.signature_attributes, args.url)
    Path(args.out).write_bytes(result)


if __name__ == "__main__":
    main()
