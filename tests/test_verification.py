"""Selector contracts and real Git deltas; no compiler/native work in fixtures."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verification.py"
spec = importlib.util.spec_from_file_location("verification", SCRIPT)
assert spec is not None and spec.loader is not None
verification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verification)


class SelectionTests(unittest.TestCase):
    def test_documents_do_not_compile_app(self):
        result = verification.select(["refactor.md", "AGENTS.md", "docs/capture.md"])
        self.assertFalse(result["root"])
        self.assertFalse(result["engine"])

    def test_engine_tests_compile_and_test_package(self):
        result = verification.select(["capture/engine/tests/process.rs"])
        self.assertFalse(result["root"])
        self.assertTrue(result["engine"])

    def test_unknown_shared_build_security_lifecycle_and_tooling_broaden(self):
        for path in ["new-owner/foo.rs", "Cargo.toml", "Cargo.lock", "build.rs",
                     "assets/icon.png", "src/ui/recording_completion.rs", "src/handoff.rs",
                     "capture/engine/src/session.rs", "helper/Media.swift",
                     "scripts/verification.py", ".githooks/pre-push",
                     ".github/workflows/verification.yml", "site/package.json", "hosted/src/auth.ts"]:
            with self.subTest(path=path):
                result = verification.select([path])
                self.assertTrue(result["root"])
                self.assertTrue(result["engine"])

    def test_mixed_delta_cannot_hide_broad_path(self):
        self.assertTrue(verification.select(["README.md", "src/main.rs"])["root"])

    def test_empty_or_missing_history_is_broad(self):
        self.assertTrue(verification.select([])["root"])
        self.assertTrue(verification.plan("nonexistent-base", "HEAD")["root"])

    def test_deterministic_union(self):
        self.assertEqual(verification.select(["README.md", "src/main.rs", "README.md"]),
                         verification.select(["src/main.rs", "README.md"]))

    def test_real_rename_and_delete_include_old_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                # Match the hook fixture's Git environment isolation.
                import os
                env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
                return subprocess.check_output(["git", *args], cwd=root, env=env, text=True).strip()
            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (root / "source.rs").write_text("original")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            git("mv", "source.rs", "README.md")
            git("commit", "-qm", "rename")
            with patch.object(verification, "ROOT", root):
                result = verification.plan(base, "HEAD")
                self.assertEqual(result["paths"], ["README.md", "source.rs"])
                self.assertTrue(result["root"])
                git("rm", "README.md")
                git("commit", "-qm", "delete")
                self.assertEqual(verification.changed_paths(base, "HEAD"), ["source.rs"])


if __name__ == "__main__":
    unittest.main()
