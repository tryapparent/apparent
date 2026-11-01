"""Selector contracts and real Git deltas; no compiler/native work in fixtures."""
import importlib.util
import os
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

    def test_independent_browser_selects_its_existing_build_and_fixtures(self):
        result = verification.select(["connect/web/src/Hosted.tsx", "connect/web/package.json"])
        self.assertFalse(result["root"])
        self.assertFalse(result["engine"])
        self.assertTrue(result["browser"])
        for path in ["connect/web/unknown.rs", "hosted/src/auth.ts", "build.rs"]:
            with self.subTest(path=path):
                self.assertTrue(verification.select(["connect/web/src/api.ts", path])["root"])

    def test_reviewed_moves_require_complete_exact_source_pairs(self):
        # Real immutable Git blobs, not a caller-supplied mechanical label.
        for name, recipe in verification.MOVES.items():
            with self.subTest(name=name):
                before = {p: ("100644", pair[0]) if pair[0] else None for p, pair in recipe["blobs"].items()}
                after = {p: ("100644", pair[1]) for p, pair in recipe["blobs"].items()}
                def tree(rev, path):
                    return (before if rev == "base" else after).get(path)
                with patch.object(verification, "tree_entry", side_effect=tree), patch.object(
                        verification, "changed_paths", return_value=list(after)):
                    result = verification.plan("base", "head")
                    self.assertTrue(result["root"])
                    self.assertFalse(result["engine"])
                    self.assertEqual(result["focused"], recipe["tests"])
                    # A changed security/lifecycle body, test deletion, executable
                    # mode or symlink must never retain the focused route.
                    for path in after:
                        original = after[path]
                        for altered in [("100644", "f" * 40), None, ("100755", original[1]), ("120000", original[1])]:
                            after[path] = altered
                            self.assertTrue(verification.plan("base", "head")["engine"])
                        after[path] = original
                with patch.object(verification, "tree_entry", side_effect=tree), patch.object(
                        verification, "changed_paths", return_value=[*after, "Cargo.lock"]):
                    self.assertTrue(verification.plan("base", "head")["engine"])

    def test_focused_checks_compile_root_and_reject_zero_matches(self):
        result = subprocess.CompletedProcess([], 0, stdout="test result: ok. 2 passed; 0 failed\n")
        selection = {"root": True, "engine": False, "browser": False, "focused": ["capture::"]}
        with patch.object(verification.subprocess, "run", return_value=result) as run:
            verification.run_checks(selection)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertTrue(any("build" in c for c in commands))
            self.assertTrue(any("capture::" in c for c in commands))
            self.assertFalse(any("capture/engine/Cargo.toml" in c for c in commands))
            self.assertFalse(any("test" in c and "capture::" not in c for c in commands))
        result.stdout = "test result: ok. 0 passed; 0 failed; 90 filtered out\n"
        with patch.object(verification.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError):
                verification.run_checks(selection)

    def test_real_rename_and_delete_include_old_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # A real pre-push inherits GIT_DIR for its own repository. The
            # fixture must isolate both its setup and the selector subprocess.
            env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
            def git(*args):
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
            with patch.object(verification, "ROOT", root), patch.dict(os.environ, env, clear=True):
                result = verification.plan(base, "HEAD")
                self.assertEqual(result["paths"], ["README.md", "source.rs"])
                self.assertTrue(result["root"])
                git("rm", "README.md")
                git("commit", "-qm", "delete")
                self.assertEqual(verification.changed_paths(base, "HEAD"), ["source.rs"])

    def test_real_git_preservation_gate_and_shared_delta(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, env=env, text=True).strip()
            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (root / "donor.rs").write_text("fn preserved() {}\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            old = git("rev-parse", "HEAD:donor.rs")
            (root / "moved.rs").write_text("fn preserved() {}\n")
            (root / "donor.rs").write_text("mod moved;\n")
            git("add", ".")
            git("commit", "-qm", "move")
            recipe = {"fixture": {"blobs": {
                "donor.rs": (old, git("rev-parse", "HEAD:donor.rs")),
                "moved.rs": (None, git("rev-parse", "HEAD:moved.rs")),
            }, "tests": ["preserved::"]}}
            with patch.object(verification, "ROOT", root), patch.object(verification, "MOVES", recipe), patch.dict(os.environ, env, clear=True):
                self.assertEqual(verification.plan(base, "HEAD")["focused"], ["preserved::"])
                (root / "Cargo.lock").write_text("shared dependency change\n")
                git("add", ".")
                git("commit", "-qm", "shared input")
                self.assertTrue(verification.plan(base, "HEAD")["engine"])
                self.assertEqual(verification.plan(base, "HEAD")["focused"], [])


if __name__ == "__main__":
    unittest.main()
