"""Exercise staged line limits through real commits in disposable repositories."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


HOOK = Path(__file__).resolve().parents[1] / ".githooks" / "pre-commit"
LOCKFILES = (
    "Cargo.lock", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
    "pnpm-lock.yaml", "bun.lock", "bun.lockb", "uv.lock", "poetry.lock",
    "Pipfile.lock", "composer.lock", "Gemfile.lock", "go.sum",
)


class PreCommitLineLimitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith("GIT_")}
        self.git("init", "-q")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        hooks = self.repo / "hooks"
        hooks.mkdir()
        if HOOK.exists():
            shutil.copy2(HOOK, hooks / "pre-commit")
            (hooks / "pre-commit").chmod(0o755)
        self.git("config", "core.hooksPath", str(hooks))

    def git(self, *args, check=True):
        result = subprocess.run(["git", *args], cwd=self.repo, env=self.env,
                                text=True, capture_output=True, timeout=20)
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def stage(self, name, content):
        (self.repo / name).write_bytes(content)
        self.git("add", "--", name)

    def commit(self):
        return self.git("commit", "-qm", "fixture", check=False)

    def test_rejects_2001_lines_on_initial_commit(self):
        self.stage("large.rs", b"code\n" * 2001)
        result = self.commit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("large.rs", result.stderr)
        self.assertIn("2001", result.stderr)
        self.assertIn("2000", result.stderr)
        self.assertNotEqual(self.git("rev-parse", "--verify", "HEAD", check=False).returncode, 0)

    def test_accepts_exactly_2000_lines(self):
        self.stage("limit.rs", b"code\n" * 2000)
        self.assertEqual(self.commit().returncode, 0)

    def test_dependency_lockfiles_allow_root_nested_and_changed_contents(self):
        for prefix in ("", "nested/deep/"):
            for name in LOCKFILES:
                with self.subTest(path=prefix + name):
                    path = prefix + name
                    (self.repo / path).parent.mkdir(parents=True, exist_ok=True)
                    self.stage(path, b"dependency\n" * 2001)
                    result = self.commit()
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.stage(path, b"updated dependency\n" * 2002)
                    result = self.commit()
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_lockfile_near_matches_and_ordinary_generated_text_stay_capped(self):
        for name in ("app.lock", "runtime.lock", "cargo.lock", "Cargo.lock.rs",
                     "not-Cargo.lock", "Cargo.lock.backup", "package.json",
                     "config.json", "generated.rs", "go.mod"):
            with self.subTest(name=name):
                self.stage(name, b"text\n" * 2001)
                result = self.commit()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)
                self.git("rm", "-f", "--", name)

    def test_lockfile_rename_to_source_is_checked(self):
        self.stage("Cargo.lock", b"dependency\n" * 2001)
        result = self.commit()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.git("mv", "Cargo.lock", "source.rs")
        self.assertNotEqual(self.commit().returncode, 0)

    def test_lockfile_exception_does_not_hide_oversized_staged_source(self):
        self.stage("Cargo.lock", b"dependency\n" * 2001)
        self.stage("source.rs", b"source\n" * 2001)
        (self.repo / "source.rs").write_bytes(b"small\n")
        result = self.commit()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source.rs", result.stderr)

    def test_counts_unterminated_final_line(self):
        self.stage("tail.txt", b"line\n" * 2000 + b"tail")
        self.assertNotEqual(self.commit().returncode, 0)

    def test_counts_comments_and_blank_lines(self):
        self.stage("comments.rs", b"// comment\n\n" * 1000 + b"\n")
        self.assertNotEqual(self.commit().returncode, 0)

    def test_rejects_oversized_index_even_when_worktree_is_small(self):
        self.stage("partial.rs", b"code\n" * 2001)
        (self.repo / "partial.rs").write_bytes(b"small\n")
        self.assertNotEqual(self.commit().returncode, 0)
        self.assertEqual((self.repo / "partial.rs").read_bytes(), b"small\n")

    def test_accepts_small_index_even_when_worktree_is_oversized(self):
        self.stage("partial.rs", b"small\n")
        (self.repo / "partial.rs").write_bytes(b"code\n" * 2001)
        result = self.commit()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("show", "HEAD:partial.rs").stdout, "small\n")

    def test_unchanged_legacy_file_does_not_block_but_edit_does(self):
        self.stage("legacy.rs", b"code\n" * 2001)
        self.git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "legacy")
        self.stage("small.rs", b"small\n")
        self.assertEqual(self.commit().returncode, 0)
        self.stage("legacy.rs", b"changed\n" + b"code\n" * 2000)
        self.assertNotEqual(self.commit().returncode, 0)

    def test_deletion_of_oversized_file_is_allowed(self):
        self.stage("legacy.rs", b"code\n" * 2001)
        self.git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "legacy")
        self.git("rm", "legacy.rs")
        self.assertEqual(self.commit().returncode, 0)

    def test_rename_of_oversized_file_is_rejected(self):
        self.stage("legacy.rs", b"code\n" * 2001)
        self.git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "legacy")
        self.git("mv", "legacy.rs", "renamed.rs")
        self.assertNotEqual(self.commit().returncode, 0)

    def test_unusual_names_are_checked(self):
        for name in ["space name.txt", "line\nbreak.txt", "-leading.txt", "colon:name.txt"]:
            with self.subTest(name=name):
                self.stage(name, b"line\n" * 2001)
                self.assertNotEqual(self.commit().returncode, 0)
                self.git("rm", "-f", "--", name)

    def test_binary_and_symlink_targets_are_not_counted(self):
        self.stage("image.bin", b"\x00" + b"data\n" * 2001)
        (self.repo / "link").symlink_to("missing-target")
        self.git("add", "link")
        self.assertEqual(self.commit().returncode, 0)

    def test_crlf_and_non_utf8_text_are_counted(self):
        self.stage("text.txt", b"\xff\r\n" * 2001)
        self.assertNotEqual(self.commit().returncode, 0)


if __name__ == "__main__":
    unittest.main()
