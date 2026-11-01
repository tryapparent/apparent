"""Exercise the Linux publication boundary with a fake GitHub CLI."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "desktop/scripts/linux/publish-main-preview.py"
SHA = "a" * 40
NEW_SHA = "b" * 40


class LinuxPreviewPublicationTest(unittest.TestCase):
    def run_case(self, heads, *, bad_checksum=False, missing_asset=False,
                 dispatch_fails=False, create_fails=False, existing_draft=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dist = root / "dist"
            dist.mkdir()
            for arch in ("aarch64", "x86_64"):
                image = dist / f"Apparent-1.2.3-linux-{arch}.AppImage"
                image.write_bytes(arch.encode())
                digest = hashlib.sha256(image.read_bytes()).hexdigest()
                (dist / (image.name + ".sha256")).write_text(
                    f"{'0' * 64 if bad_checksum else digest}  {image.name}\n"
                )
            bin_dir = root / "bin"
            bin_dir.mkdir()
            stub = bin_dir / "gh"
            stub.write_text(textwrap.dedent('''\
                #!/usr/bin/env python3
                import hashlib, json, os, pathlib, sys
                root = pathlib.Path(os.environ['FAKE_ROOT'])
                args = sys.argv[1:]
                with (root / 'calls').open('a') as log:
                    log.write(json.dumps(args) + '\\n')
                if args[0] == 'api':
                    heads = json.loads((root / 'heads').read_text())
                    head = heads.pop(0) if len(heads) > 1 else heads[0]
                    (root / 'heads').write_text(json.dumps(heads))
                    print(json.dumps({'object': {'sha': head}}))
                elif args[:2] == ['workflow', 'run']:
                    if os.environ.get('DISPATCH_FAILS') == '1':
                        sys.exit(1)
                elif args[:2] == ['release', 'create']:
                    (root / 'draft').write_text('true')
                    if os.environ.get('CREATE_FAILS') == '1':
                        sys.exit(1)
                elif args[:2] == ['release', 'delete']:
                    (root / 'draft').unlink(missing_ok=True)
                elif args[:2] == ['release', 'edit']:
                    (root / 'draft').write_text('false')
                elif args[:2] == ['release', 'view']:
                    if not (root / 'draft').exists():
                        print('release not found (HTTP 404)', file=sys.stderr)
                        sys.exit(1)
                    assets = []
                    for file in sorted((root / 'dist').iterdir()):
                        if os.environ.get('MISSING_ASSET') == '1' and 'aarch64.AppImage.sha256' in file.name:
                            continue
                        assets.append({'name': file.name, 'state': 'uploaded',
                                       'digest': 'sha256:' + hashlib.sha256(file.read_bytes()).hexdigest()})
                    print(json.dumps({'isDraft': (root / 'draft').read_text() == 'true',
                                      'assets': assets}))
                else:
                    sys.exit(2)
            '''))
            stub.chmod(0o755)
            (root / "heads").write_text(json.dumps(heads))
            if existing_draft:
                (root / "draft").write_text("true")
            env = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}',
                       FAKE_ROOT=tmp, GITHUB_SHA=SHA, GITHUB_REPOSITORY="tryapparent/apparent",
                       APPARENT_VERSION="1.2.3", MISSING_ASSET=str(int(missing_asset)),
                       DISPATCH_FAILS=str(int(dispatch_fails)),
                       CREATE_FAILS=str(int(create_fails)))
            result = subprocess.run([sys.executable, str(SCRIPT)], cwd=root, env=env,
                                    capture_output=True, text=True)
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()] \
                if (root / "calls").exists() else []
            return result, calls, (root / "draft").read_text() if (root / "draft").exists() else None

    def test_publishes_only_after_remote_asset_verification(self):
        result, calls, draft = self.run_case([SHA])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")
        self.assertLess(next(i for i, c in enumerate(calls) if c[:2] == ["release", "view"]),
                        next(i for i, c in enumerate(calls) if c[:2] == ["release", "edit"]))

    def test_superseded_before_draft_queues_replacement_and_fails(self):
        result, calls, draft = self.run_case([NEW_SHA])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Superseded", result.stderr)
        self.assertIsNone(draft)
        self.assertIn(["workflow", "run", "release-linux.yml", "--repo", "tryapparent/apparent",
                       "--ref", "main", "-f", "publish_main=true"], calls)
        self.assertFalse(any(c[:2] == ["release", "create"] for c in calls))

    def test_superseded_draft_is_removed_and_replacement_queued(self):
        result, calls, draft = self.run_case([SHA, NEW_SHA])
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(draft)
        self.assertTrue(any(c[:2] == ["release", "delete"] for c in calls))
        self.assertTrue(any(c[:2] == ["workflow", "run"] for c in calls))
        self.assertFalse(any(c[:2] == ["release", "edit"] for c in calls))

    def test_bad_checksum_never_creates_release(self):
        result, calls, draft = self.run_case([SHA], bad_checksum=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(draft)
        self.assertFalse(any(c[:2] == ["release", "create"] for c in calls))

    def test_incomplete_remote_assets_keep_release_private(self):
        result, calls, draft = self.run_case([SHA], missing_asset=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(draft)
        self.assertTrue(any(c[:2] == ["release", "delete"] for c in calls))
        self.assertFalse(any(c[:2] == ["release", "edit"] for c in calls))

    def test_dispatch_failure_is_not_reported_as_requeued(self):
        result, calls, draft = self.run_case([NEW_SHA], dispatch_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("replacement workflow dispatched", result.stderr)
        self.assertIsNone(draft)

    def test_partial_create_failure_removes_its_draft(self):
        result, calls, draft = self.run_case([SHA], create_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(draft)
        self.assertTrue(any(c[:2] == ["release", "delete"] for c in calls))

    def test_interrupted_draft_is_replaced(self):
        result, calls, draft = self.run_case([SHA], existing_draft=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")
        self.assertLess(next(i for i, c in enumerate(calls) if c[:2] == ["release", "delete"]),
                        next(i for i, c in enumerate(calls) if c[:2] == ["release", "create"]))

    def test_main_moving_after_publication_retracts_and_requeues(self):
        result, calls, draft = self.run_case([SHA, SHA, NEW_SHA])
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(draft)
        self.assertTrue(any(c[:2] == ["release", "edit"] for c in calls))
        self.assertTrue(any(c[:2] == ["release", "delete"] for c in calls))
        self.assertTrue(any(c[:2] == ["workflow", "run"] for c in calls))

    def test_main_preview_job_runs_the_checked_publisher(self):
        workflow = (ROOT / ".github/workflows/release-linux.yml").read_text()
        job = workflow.split("  main-preview:\n", 1)[1]
        build = workflow.split("  linux:\n", 1)[1].split("  main-preview:\n", 1)[0]
        self.assertIn("actions: write", workflow)
        self.assertIn("--json isDraft --jq .isDraft", workflow)
        self.assertIn("ref: ${{ inputs.tag || github.sha }}", build)
        self.assertIn('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', build)
        self.assertIn("ref: ${{ github.sha }}", job)
        self.assertIn("python3 desktop/scripts/linux/publish-main-preview.py", job)
        self.assertNotIn("exit 0", job)


if __name__ == "__main__":
    unittest.main()
