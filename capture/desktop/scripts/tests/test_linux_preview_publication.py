"""Exercise the Linux publication boundary with a fake GitHub CLI."""

import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / "capture/desktop/scripts/linux/maintenance/publish-main-preview.py"
SHA = "a" * 40
NEW_SHA = "b" * 40
OLD_SHA = "c" * 40
OTHER_SHA = "d" * 40


def preview(sha):
    return dict(tag_name=f"linux-main-v2-{sha}", draft=False, prerelease=True)


class LinuxPreviewPublicationTest(unittest.TestCase):
    def run_case(self, heads, *, bad_checksum=False, missing_asset=False,
                 create_fails=False, existing_draft=False, existing_public=False,
                 sha=SHA, ref="refs/heads/main", pages=None, later_pages=None,
                 comparisons=None, history_fails=False, bad_digest=False,
                 edit_fails=False, public_read_fails=False):
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
                if args[0] == 'api' and '/git/ref/heads/main' in args[1]:
                    heads = json.loads((root / 'heads').read_text())
                    head = heads.pop(0) if len(heads) > 1 else heads[0]
                    (root / 'heads').write_text(json.dumps(heads))
                    print(json.dumps({'object': {'sha': head}}))
                elif args[0] == 'api' and '/compare/' in args[1]:
                    pair = args[1].split('/compare/')[1]
                    base, tip = pair.split('...')
                    comparisons = json.loads((root / 'comparisons').read_text())
                    if base == tip:
                        status = 'identical'
                    else:
                        status = comparisons[pair]
                    if status == 'FAIL':
                        sys.exit(1)
                    print(json.dumps({'status': status}))
                elif args[0] == 'api' and '/releases?' in args[1]:
                    assert '--paginate' in args and '--slurp' in args
                    if os.environ.get('HISTORY_FAILS') == '1':
                        # gh may emit an earlier page before a later request fails.
                        print('[[]]')
                        sys.exit(1)
                    source = 'later_pages' if (root / 'draft').exists() and (root / 'later_pages').exists() else 'pages'
                    print((root / source).read_text())
                elif args[:2] == ['release', 'create']:
                    (root / 'draft').write_text('true')
                    if os.environ.get('CREATE_FAILS') == '1':
                        sys.exit(1)
                elif args[:2] == ['release', 'delete']:
                    (root / 'draft').unlink(missing_ok=True)
                elif args[:2] == ['release', 'edit']:
                    (root / 'draft').write_text('false')
                    if os.environ.get('EDIT_FAILS') == '1':
                        sys.exit(1)
                elif args[:2] == ['release', 'view']:
                    if not (root / 'draft').exists():
                        print('release not found (HTTP 404)', file=sys.stderr)
                        sys.exit(1)
                    if (root / 'draft').read_text() == 'false' and os.environ.get('PUBLIC_READ_FAILS') == '1':
                        print('HTTP 503', file=sys.stderr)
                        sys.exit(1)
                    assets = []
                    for file in sorted((root / 'dist').iterdir()):
                        if os.environ.get('MISSING_ASSET') == '1' and 'aarch64.AppImage.sha256' in file.name:
                            continue
                        assets.append({'name': file.name, 'state': 'uploaded',
                                       'digest': 'sha256:' + ('0' * 64 if os.environ.get('BAD_DIGEST') == '1' else hashlib.sha256(file.read_bytes()).hexdigest())})
                    print(json.dumps({'isDraft': (root / 'draft').read_text() == 'true',
                                      'assets': assets}))
                else:
                    sys.exit(2)
            '''))
            stub.chmod(0o755)
            (root / "heads").write_text(json.dumps(heads))
            (root / "pages").write_text(json.dumps([[]] if pages is None else pages))
            if later_pages is not None:
                (root / "later_pages").write_text(json.dumps(later_pages))
            (root / "comparisons").write_text(json.dumps(comparisons if comparisons is not None else {
                f"{SHA}...{NEW_SHA}": "ahead",
                f"{NEW_SHA}...{SHA}": "behind",
                f"{OLD_SHA}...{SHA}": "ahead",
                f"{SHA}...{OLD_SHA}": "behind",
                f"{OTHER_SHA}...{SHA}": "diverged",
            }))
            if existing_draft:
                (root / "draft").write_text("true")
            if existing_public:
                (root / "draft").write_text("false")
            env = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}',
                       FAKE_ROOT=tmp, GITHUB_SHA=sha, GITHUB_REF=ref,
                       GITHUB_REPOSITORY="tryapparent/apparent",
                       APPARENT_VERSION="1.2.3", MISSING_ASSET=str(int(missing_asset)),
                       HISTORY_FAILS=str(int(history_fails)), BAD_DIGEST=str(int(bad_digest)),
                       EDIT_FAILS=str(int(edit_fails)), PUBLIC_READ_FAILS=str(int(public_read_fails)),
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
        create = next(c for c in calls if c[:2] == ["release", "create"])
        self.assertEqual(create[2], f"linux-main-v2-{SHA}")
        self.assertEqual(create[create.index("--target") + 1], SHA)
        for flag in ("--draft", "--prerelease", "--latest=false"):
            self.assertIn(flag, create)

    def test_checked_ancestor_can_publish_after_main_advances(self):
        result, calls, draft = self.run_case([NEW_SHA])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")
        self.assertFalse(any(c[:2] == ["workflow", "run"] for c in calls))

    def test_legacy_bridges_and_feed_do_not_block_canonical_publication(self):
        legacy = dict(preview(NEW_SHA), tag_name=f"linux-main-{NEW_SHA}")
        feed = dict(preview(NEW_SHA), tag_name="linux-main-feed")
        result, calls, draft = self.run_case([SHA], pages=[[legacy, feed]])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")
        self.assertFalse(any('/compare/' + NEW_SHA in c[1] for c in calls if c[0] == 'api'))

    def test_divergent_or_future_commit_cannot_publish(self):
        for status in ("diverged", "behind", "FAIL", "unknown"):
            with self.subTest(status=status):
                result, calls, draft = self.run_case(
                    [NEW_SHA], comparisons={f"{SHA}...{NEW_SHA}": status})
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(draft)
                self.assertFalse(any(c[0] == "release" for c in calls))

    def test_malformed_identity_and_non_main_ref_fail_before_gh(self):
        for sha, ref in (("a" * 39, "refs/heads/main"), ("g" * 40, "refs/heads/main"),
                         (SHA + "\n", "refs/heads/main"), (SHA, "refs/pull/278/merge")):
            with self.subTest(sha=sha, ref=ref):
                result, calls, draft = self.run_case([SHA], sha=sha, ref=ref)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])
                self.assertIsNone(draft)

    def test_newer_published_ancestor_on_later_page_blocks_old_rerun(self):
        result, calls, draft = self.run_case(
            [NEW_SHA], pages=[[preview(OLD_SHA)], [preview(NEW_SHA)]],
            comparisons={f"{SHA}...{NEW_SHA}": "ahead", f"{OLD_SHA}...{NEW_SHA}": "ahead",
                         f"{SHA}...{OLD_SHA}": "behind"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("not promoted", result.stdout)
        self.assertIsNone(draft)
        self.assertFalse(any(c[0] == "release" for c in calls))

    def test_selection_ignores_old_draft_stable_and_divergent_previews(self):
        draft_release = dict(preview(NEW_SHA), draft=True)
        stable_release = dict(preview(NEW_SHA), prerelease=False)
        result, calls, draft = self.run_case(
            [SHA], pages=[[preview(OLD_SHA), draft_release, stable_release, preview(OTHER_SHA)]])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")

    def test_history_failures_and_malformed_shas_fail_closed(self):
        for history_fails, pages in ((True, [[]]), (False, []), (False, [{}]),
                                     (False, [[preview("not-a-sha")]]),
                                     (False, [[preview(SHA), preview("bad")]])):
            with self.subTest(history_fails=history_fails, pages=pages):
                result, calls, draft = self.run_case([SHA], history_fails=history_fails, pages=pages)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(draft)
                self.assertFalse(any(c[0] == "release" for c in calls))

    def test_newer_release_before_promotion_removes_only_private_draft(self):
        result, calls, draft = self.run_case([NEW_SHA], later_pages=[[preview(NEW_SHA)]])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(draft)
        self.assertTrue(any(c[:2] == ["release", "delete"] for c in calls))
        self.assertFalse(any(c[:2] == ["release", "edit"] for c in calls))

    def test_main_diverging_during_draft_never_promotes(self):
        result, calls, draft = self.run_case(
            [SHA, OTHER_SHA], comparisons={f"{SHA}...{OTHER_SHA}": "diverged"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not an ancestor", result.stderr)
        self.assertIsNone(draft)
        self.assertTrue(any(c[:2] == ["release", "create"] for c in calls))
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

    def test_remote_digest_mismatch_never_promotes(self):
        result, calls, draft = self.run_case([SHA], bad_digest=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Remote asset differs", result.stderr)
        self.assertIsNone(draft)
        self.assertFalse(any(c[:2] == ["release", "edit"] for c in calls))

    def test_unchanged_published_build_is_not_replaced(self):
        result, calls, draft = self.run_case([SHA], existing_public=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")
        self.assertFalse(any(c[0] == "release" and c[1] != "view" for c in calls))

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

    def test_main_moving_during_publication_does_not_retract_or_dispatch(self):
        result, calls, draft = self.run_case([SHA, NEW_SHA])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(draft, "false")
        self.assertTrue(any(c[:2] == ["release", "edit"] for c in calls))
        self.assertFalse(any(c[:2] == ["release", "delete"] for c in calls))
        self.assertFalse(any(c[:2] == ["workflow", "run"] for c in calls))

    def test_failed_edit_response_or_readback_never_retracts_public_release(self):
        for options in ({"edit_fails": True}, {"public_read_fails": True}):
            with self.subTest(options=options):
                result, calls, draft = self.run_case([SHA], **options)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(draft, "false")
                self.assertTrue(any(c[:2] == ["release", "edit"] for c in calls))
                self.assertFalse(any(c[:2] == ["release", "delete"] for c in calls))



if __name__ == "__main__":
    unittest.main()
