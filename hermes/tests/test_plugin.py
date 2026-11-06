import base64
import importlib.util
import io
import json
import re
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("apparent_plugin", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
from apparent_plugin.adapter import Adapter
from apparent_plugin.evidence import result
from apparent_plugin.process import AdapterError, execute


class Context:
    def __init__(self):
        self.tools = {}
        self.hooks = {}

    def get_config(self, name, default=None):
        return default

    def register_tool(self, **entry):
        self.tools[entry["name"]] = entry

    def register_skill(self, name, path, **kwargs):
        assert path.is_file()

    def register_hook(self, name, callback):
        self.hooks[name] = callback


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name) / "test.apparent"
        self.bundle.mkdir()
        Image.new("RGB", (200, 100), "red").save(self.bundle / "contact-sheet.png")
        (self.bundle / "frames").mkdir()
        Image.new("RGB", (80, 100), "blue").save(self.bundle / "frames/frame-01.png")
        self.manifest = {"contactSheet": "contact-sheet.png", "keyframes": [{"file": "frames/frame-01.png"}]}
        self.adapter = Adapter("/installed/apparent")

    def test_inspect_contains_decodable_pixels_and_transcript(self):
        with patch("apparent_plugin.adapter.execute", side_effect=["Make this blue", json.dumps(self.manifest)]) as run:
            value = self.adapter.inspect(str(self.bundle))
        self.assertTrue(value["_multimodal"])
        self.assertIn("Make this blue", value["text_summary"])
        encoded = value["content"][1]["image_url"]["url"].split(",")[1]
        with Image.open(io.BytesIO(base64.b64decode(encoded))) as image:
            self.assertEqual(image.size, (200, 100))
        self.assertEqual(run.call_args_list[0].args[1], ["inspect", str(self.bundle)])

    def test_frame_uses_manifest_reference(self):
        with patch("apparent_plugin.adapter.execute", side_effect=["#1", json.dumps(self.manifest)]):
            value = self.adapter.inspect(str(self.bundle), 1)
        self.assertIn("frames/frame-01.png", value["text_summary"])

    def test_missing_image_keeps_clear_instructions(self):
        (self.bundle / "contact-sheet.png").unlink()
        value = result("Fix spelling", self.bundle, "contact-sheet.png")
        self.assertIn("Fix spelling", value)
        self.assertIn("Visual evidence unavailable", value)

    def test_manifest_failure_keeps_transcript(self):
        with patch("apparent_plugin.adapter.execute", side_effect=["Fix spelling", "not JSON"]):
            value = self.adapter.inspect(str(self.bundle))
        self.assertIn("Fix spelling", value)

    def test_symlink_and_traversal_images_are_not_attached(self):
        (self.bundle / "outside.png").symlink_to(self.bundle / "contact-sheet.png")
        for ref in ("../contact-sheet.png", "/etc/passwd", "outside.png"):
            self.assertIsInstance(result("Transcript", self.bundle, ref), str)
        (self.bundle / "linked").symlink_to(self.bundle / "frames", target_is_directory=True)
        self.assertIsInstance(result("Transcript", self.bundle, "linked/frame-01.png"), str)

    def test_bad_image_is_fallback(self):
        (self.bundle / "bad.png").write_bytes(b"not an image")
        self.assertIn("Visual evidence unavailable", result("Transcript", self.bundle, "bad.png"))

    def test_image_is_bounded(self):
        Image.new("RGB", (2400, 1200)).save(self.bundle / "wide.png")
        value = result("Transcript", self.bundle, "wide.png")
        with Image.open(io.BytesIO(base64.b64decode(value["content"][1]["image_url"]["url"].split(",")[1]))) as image:
            self.assertEqual(image.size, (1600, 800))

    def test_sources_require_explicit_identity(self):
        for source in ("latest", "--help", "https://other.test/capture", "relative.apparent", ""):
            with self.assertRaises(AdapterError):
                self.adapter.source(source)

    def test_connect_fetch_gets_fresh_private_workspace(self):
        capture = "a" * 32
        with patch("apparent_plugin.adapter.tempfile.mkdtemp", return_value=self.temp.name):
            with patch("apparent_plugin.adapter.execute", side_effect=["Instructions", json.dumps(self.manifest)]) as run:
                value = self.adapter.inspect(capture)
        self.assertEqual(run.call_args_list[0].kwargs["cwd"], Path(self.temp.name))
        self.assertIn(capture + ".evidence.apparent", str(value))

    def test_zoom_exact_focus_and_image(self):
        (self.bundle / "zoom").mkdir()
        Image.new("RGB", (20, 20)).save(self.bundle / "zoom/moment.png")
        with patch("apparent_plugin.adapter.execute", return_value=str(self.bundle / "zoom/moment.png") + "\nSaid: width changes") as run:
            value = self.adapter.zoom(str(self.bundle), at="width changes")
        self.assertTrue(value["_multimodal"])
        self.assertIn("width changes", run.call_args.args[1])

    def test_zoom_rejects_ambiguous_or_option_injected_focus(self):
        for kwargs in ({}, {"at": "1", "mark": "m1"}, {"at": "--help"}, {"at": "1", "span": float("nan")}, {"at": "1", "frames": True}):
            with self.assertRaises(AdapterError):
                self.adapter.zoom(str(self.bundle), **kwargs)

    def test_registration_and_scoped_guidance(self):
        context = Context()
        plugin.register(context)
        self.assertEqual(set(context.tools), {"apparent_inspect", "apparent_frame", "apparent_zoom", "apparent_status"})
        self.assertIsNone(plugin.recording_context(user_message="Fix spelling"))
        self.assertIn("clear transcript", plugin.recording_context(user_message="apparent inspect /test.apparent")["context"])
        value = context.tools["apparent_inspect"]["handler"]({})
        self.assertFalse(json.loads(value)["success"])

    def test_real_subprocess_bounds_and_timeout(self):
        self.assertEqual(execute(sys.executable, ["-c", "print('ok')"]), "ok\n")
        with self.assertRaises(AdapterError) as error:
            execute(sys.executable, ["-c", "print('x'*100000)"], limit=1024)
        self.assertEqual(error.exception.code, "output_limit")
        with self.assertRaises(AdapterError) as error:
            execute(sys.executable, ["-c", "import time; time.sleep(10)"], timeout=0.1)
        self.assertEqual(error.exception.code, "timeout")

    def test_release_version_matches_readme(self):
        version = re.search(r'^version: "([^"]+)"', (ROOT / "plugin.yaml").read_text(), re.M).group(1)
        self.assertIn("version **" + version + "**", (ROOT / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
