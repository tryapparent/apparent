"""The preview feed must advance only after a signed, published ZIP exists."""
import base64
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"


class PreviewAppcastTest(unittest.TestCase):
    def run_feed(self, directory, build, previous="", signature=None, url=None, length=None, version=None, tag=None):
        directory = Path(directory)
        (directory / "previous.xml").write_text(previous)
        version = version or f"0.{build}"
        tag = tag or f"preview-mac-{build.replace('.', '-')}"
        archive = directory / f"Apparent-Preview-{version}-arm64.zip"
        archive.write_bytes(b"signed preview archive")
        signature = signature or base64.b64encode(b"s" * 64).decode()
        url = url or f"https://github.com/tryapparent/apparent/releases/download/preview-mac-{build.replace('.', '-')}/{archive.name}"
        result = subprocess.run([
            "python3", str(ROOT / "capture/desktop/scripts/release/preview_appcast.py"),
            "--previous", str(directory / "previous.xml"),
            "--zip", str(archive), "--version", version,
            "--build-number", build,
            "--tag", tag,
            "--signature-attributes", f'sparkle:edSignature="{signature}" length="{length if length is not None else archive.stat().st_size}"',
            "--url", url, "--out", str(directory / "appcast.xml"),
        ], capture_output=True, text=True)
        return result, directory / "appcast.xml"

    def test_initial_feed_and_next_signed_release(self):
        with tempfile.TemporaryDirectory() as directory:
            first, path = self.run_feed(directory, "123.1")
            self.assertEqual(first.returncode, 0, first.stderr)
            root = ET.parse(path).getroot()
            item = root.find("channel/item")
            assert item is not None
            self.assertEqual(item.findtext(f"{{{SPARKLE}}}version"), "123.1")
            enclosure = item.find("enclosure")
            assert enclosure is not None
            self.assertIn("preview-mac-123-1", enclosure.attrib["url"])
            previous = path.read_text()
            next_result, path = self.run_feed(directory, "124.1", previous)
            self.assertEqual(next_result.returncode, 0, next_result.stderr)
            items = ET.parse(path).getroot().findall("channel/item")
            self.assertEqual([i.findtext(f"{{{SPARKLE}}}version") for i in items], ["124.1", "123.1"])

    def test_rollback_or_invalid_signature_does_not_write_feed(self):
        with tempfile.TemporaryDirectory() as directory:
            first, path = self.run_feed(directory, "123.1")
            self.assertEqual(first.returncode, 0, first.stderr)
            previous = path.read_text()
            for build, signature in [("122.1", None), ("123.1", None), ("124.1", "invalid")]:
                path.unlink(missing_ok=True)
                result, path = self.run_feed(directory, build, previous, signature)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(path.exists())

    def test_shared_version_advances_independently_of_monotonic_build_number(self):
        with tempfile.TemporaryDirectory() as directory:
            first, path = self.run_feed(directory, "21.1")
            self.assertEqual(first.returncode, 0, first.stderr)
            previous = path.read_text()
            result, path = self.run_feed(directory, "1234.2", previous, version="0.22.1", tag="preview-mac-22-1",
                url="https://github.com/tryapparent/apparent/releases/download/preview-mac-22-1/Apparent-Preview-0.22.1-arm64.zip")
            self.assertEqual(result.returncode, 0, result.stderr)
            items = ET.parse(path).getroot().findall("channel/item")
            self.assertEqual(items[0].findtext(f"{{{SPARKLE}}}version"), "1234.2")
            self.assertEqual(items[0].findtext(f"{{{SPARKLE}}}shortVersionString"), "0.22.1")
            self.assertEqual(items[1].findtext(f"{{{SPARKLE}}}version"), "21.1")
            for build, version in [("21.1", "0.23.1"), ("1235.1", "0.21.1"), ("1235.1", "0.22.1")]:
                current = path.read_text()
                path.unlink()
                rejected, path = self.run_feed(directory, build, current, version=version)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertFalse(path.exists())
                path.write_text(current)

    def test_wrong_download_host_or_length_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            result, path = self.run_feed(directory, "123.1", url="https://example.com/update.zip")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(path.exists())
            result, path = self.run_feed(directory, "123.1", length=999)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
