"""Real Git/index policy fixtures; no compiler, package install or network."""
import os
import importlib.util
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
# Keep this complete closure shared with the finite pre-push driver fixtures.
POLICY_FILES = (
    "scripts/git_policy.py", "scripts/architecture-baseline.json", ".githooks/pre-commit", ".githooks/pre-push",
    "Cargo.toml", "capture/engine/Cargo.toml", "capture/engine/src/lib.rs",
    "site/src/main.tsx", "site/src/entry-server.tsx", "connect/web/src/main.tsx", "hosted/package.json",
    "tools/narrator/Cargo.toml", "video/Cargo.toml",
)


def copy_policy(root):
    for name in POLICY_FILES:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)


def run(root, *args, data=None, env=None):
    clean = {k: v for k, v in (env or os.environ).items() if not k.startswith("GIT_")}
    clean["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(args, cwd=root, env=clean, input=data, text=True,
                          capture_output=True, timeout=60)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        copy_policy(self.root)
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")

    def git(self, *args):
        result = run(self.root, "git", *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        self.git("add", "--", name)

    def policy(self, *args):
        return run(self.root, "python3", "scripts/git_policy.py", *args)

    def test_baseline_index_and_revision_and_hook_environment(self):
        for args in [("tree",), ("staged",)]:
            result = self.policy(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
        env = dict(os.environ, GIT_DIR=str(ROOT / ".git"), GIT_WORK_TREE=str(ROOT))
        result = run(self.root, "python3", "scripts/git_policy.py", "tree", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_revision_checks_ignore_empty_or_different_index(self):
        self.write("capture/engine/Cargo.toml", '[package]\nname="apparent-capture-engine"\n[dependencies]\ngui={package="gpui",version="1"}\n')
        tree = self.git("write-tree")
        self.git("reset", "--quiet", "HEAD")
        result = self.policy("tree", "--revision", tree)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Engine dependency gui", result.stderr)
        self.assertEqual(self.policy("tree").returncode, 0)

    def test_forbidden_dependencies_all_cargo_tables_and_aliases(self):
        original = (self.root / "capture/engine/Cargo.toml").read_text()
        for tail in ['\n[target.\'cfg(unix)\'.dependencies]\ngui={package="gpui",version="1"}\n',
                     '\n[dev-dependencies]\nproduct={path="../../.."}\n',
                     '\n[build-dependencies]\npolicy={git="https://example.invalid/repo"}\n']:
            with self.subTest(tail=tail):
                self.write("capture/engine/Cargo.toml", original + tail)
                result = self.policy("staged")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Engine dependency", result.stderr)

    def test_source_escape_and_root_internal_dependency(self):
        self.write("capture/engine/src/escape.rs", 'include!("../../../src/handoff.rs");\n')
        self.assertIn("source inclusion", self.policy("staged").stderr)
        self.git("rm", "-f", "capture/engine/src/escape.rs")
        original = (self.root / "Cargo.toml").read_text()
        self.write("Cargo.toml", original + '\n[build-dependencies]\nagent={path="capture/agent"}\n')
        self.assertIn("not a supported Engine contract", self.policy("staged").stderr)

    def test_root_resolution_overrides_require_review(self):
        original = (self.root / "Cargo.toml").read_text()
        for tail in ['\n[workspace]\n', '\n[patch.crates-io]\n', '\n[replace]\n',
                     '\n[workspace]\nmembers=["capture/engine"]\n'
                     '[patch.crates-io]\nserde={git="https://example.invalid/serde"}\n']:
            with self.subTest(tail=tail):
                self.write("Cargo.toml", original + tail)
                tree = self.git("write-tree")
                for args in [("staged",), ("tree", "--revision", tree)]:
                    result = self.policy(*args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("root Cargo resolution", result.stderr)

    def test_engine_explicit_targets_require_review(self):
        original = (self.root / "capture/engine/Cargo.toml").read_text()
        for target in ("example", "test", "bench"):
            with self.subTest(target=target):
                self.write("capture/engine/Cargo.toml", original +
                           f'\n[[{target}]]\nname="escape"\npath="../../src/main.rs"\n')
                result = self.policy("staged")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Engine package/build roots changed", result.stderr)

    def test_nonregular_entries_skip_syntax_but_not_path_policy(self):
        link = self.root / "ordinary.json"
        link.symlink_to("missing target, not JSON")
        self.git("add", "ordinary.json")
        self.git("update-index", "--add", "--cacheinfo", "160000", self.git("rev-parse", "HEAD"), "submodule.py")
        before = self.git("write-tree")
        result = self.policy("staged")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("write-tree"), before)
        self.assertEqual(os.readlink(link), "missing target, not JSON")
        (self.root / ".env").symlink_to("ordinary.json")
        self.git("add", ".env")
        self.assertIn("contents not read", self.policy("staged").stderr)
        self.git("rm", "--cached", ".env")
        configured = self.root / "capture/engine/src/lib.rs"
        configured.unlink()
        configured.symlink_to("missing.rs")
        self.git("add", "capture/engine/src/lib.rs")
        self.assertIn("missing configured path", self.policy("staged").stderr)

    def test_old_python_reports_prerequisite_before_tomllib_import(self):
        result = run(self.root, sys.executable, "-c", '''
import builtins, runpy, sys
original = builtins.__import__
def guarded(name, *args, **kwargs):
    if name == "tomllib":
        raise AssertionError("tomllib imported before version check")
    return original(name, *args, **kwargs)
builtins.__import__ = guarded
sys.version_info = (3, 10, 0)
runpy.run_path("scripts/git_policy.py", run_name="__main__")
''')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Python 3.11+ required", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_forbidden_browser_edges_with_normalization_and_reexports(self):
        cases = {
            "site/src/leak.ts": 'export { Hosted } from "./x/../hosted/Hosted"\n',
            "site/src/absolute.ts": 'import "/src/hosted/Hosted"\n',
            "connect/web/src/leak.ts": 'const x = import("../../../src/handoff")\n',
            "hosted/src/leak.ts": 'import "../../src/handoff"\n',
            "site/src/hosted/leak.ts": 'import "../../../src/handoff"\n',
        }
        for name, text in cases.items():
            with self.subTest(name=name):
                self.write(name, text)
                result = self.policy("staged")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("forbidden browser owner reference", result.stderr)
                self.git("rm", "-f", name)

    def test_missing_paths_invalid_baseline_and_new_manifest_fail_closed(self):
        for name, text, reason in [
            ("scripts/architecture-baseline.json", '{}\n', "invalid reviewed"),
            ("scripts/architecture-baseline.json", '{"version":1,"browser_edges":[{}],"reason":"bad"}\n', "invalid reviewed"),
            ("capture/agent/Cargo.toml", '[package]\nname="agent"\n', "Cargo package"),
        ]:
            with self.subTest(name=name):
                self.write(name, text)
                self.assertIn(reason, self.policy("staged").stderr)
                self.git("reset", "--quiet", "HEAD", "--", name)
        self.git("rm", "site/src/main.tsx")
        self.assertIn("missing configured path", self.policy("staged").stderr)

    def test_private_artifacts_not_generic_images_or_synthetic_bundles(self):
        self.write("tests/fixtures/synthetic.apparent/apparent.json", '{}\n')
        self.write("site/public/art.png", "synthetic image placeholder\n")
        self.assertEqual(self.policy("staged").returncode, 0)
        for name in ["site/public/capture/contact-sheet.png", "connect/web/public/pitch-deck/page.svg",
                     "site/public/leak.apparent/apparent.json", "site/dist-apparent/recording.mov"]:
            with self.subTest(name=name):
                self.write(name, "do not inspect\n")
                result = self.policy("staged")
                self.assertIn("private capture/pitch artifact", result.stderr)
                self.git("rm", "-f", name)

    def test_credentials_never_echoed_or_read_by_diff(self):
        self.write(".env", "SECRET_SENTINEL=do-not-print\n")
        result = self.policy("staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("contents not read", result.stderr)
        self.assertNotIn("SECRET_SENTINEL", result.stderr + result.stdout)

    def test_index_bytes_not_worktree_and_no_mutations(self):
        self.write("example.json", '{}\n')
        (self.root / "example.json").write_text("invalid worktree\n")
        before = self.git("write-tree")
        result = self.policy("staged")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("write-tree"), before)
        self.assertEqual((self.root / "example.json").read_text(), "invalid worktree\n")
        self.write("example.json", 'invalid staged\n')
        (self.root / "example.json").write_text('{}\n')
        self.assertNotEqual(self.policy("staged").returncode, 0)

    @unittest.skipUnless(shutil.which("rustfmt"), "rustfmt unavailable (required for changed Rust)")
    def test_rustfmt_reads_staged_bytes_and_does_not_follow_modules(self):
        self.write("example.rs", 'mod absent;\nfn main() {}\n')
        (self.root / "example.rs").write_text('bad worktree\n')
        before = self.git("write-tree")
        result = self.policy("staged")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("write-tree"), before)
        self.write("example.rs", 'fn main(){ }\n')
        (self.root / "example.rs").write_text('fn main() {}\n')
        self.assertIn("staged Rust formatting failed", self.policy("staged").stderr)

    def test_conflict_whitespace_and_large_advisory(self):
        for text, reason in [("<<<<<<< ours\n", "conflict marker"), ("bad trailing \n", "whitespace")]:
            self.write("example.txt", text)
            self.assertIn(reason, self.policy("staged").stderr)
        self.write("example.txt", "a\n" * 501)
        result = self.policy("staged")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("advisory:", result.stderr)

    def test_real_precommit_blocks_bad_index_without_running_staged_python(self):
        self.git("config", "core.hooksPath", ".githooks")
        self.write("danger.py", 'from pathlib import Path\nPath("executed").touch()\n')
        self.write("example.json", 'bad\n')
        result = run(self.root, "git", "commit", "-qm", "bad index")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "executed").exists())

    def test_setup_and_doctor_in_linked_worktrees_only(self):
        linked = Path(self.tmp.name) / "linked"
        self.git("worktree", "add", "-qb", "linked", str(linked))
        self.assertNotEqual(self.policy("doctor").returncode, 0)
        result = self.policy("setup")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath"), ".githooks")
        result = run(linked, "python3", "scripts/git_policy.py", "doctor")
        self.assertEqual(result.returncode, 0, result.stderr)
        (linked / ".githooks/pre-commit").unlink()
        self.assertNotEqual(run(linked, "python3", "scripts/git_policy.py", "doctor").returncode, 0)

    def test_timeout_kills_owned_formatter_descendants(self):
        spec = importlib.util.spec_from_file_location("git_policy", ROOT / "scripts/git_policy.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        receipt = self.root / "escaped"
        with self.assertRaises(subprocess.TimeoutExpired):
            module.Runner(seconds=0.15).run(
                ["sh", "-c", '(sleep 0.5; touch "$1") & wait', "fixture", str(receipt)], cwd=self.root)
        time.sleep(0.6)
        self.assertFalse(receipt.exists(), "a formatter descendant survived its policy deadline")

    def test_exited_leader_still_cleans_owned_descendant(self):
        spec = importlib.util.spec_from_file_location("git_policy", ROOT / "scripts/git_policy.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        receipt = self.root / "escaped"
        module.Runner(seconds=2).run(
            ["sh", "-c", '(sleep 0.5; touch "$1") </dev/null >/dev/null 2>&1 & exit 0',
             "fixture", str(receipt)], cwd=self.root)
        time.sleep(0.6)
        self.assertFalse(receipt.exists(), "a descendant survived its exited leader")

    def test_sigterm_cancels_runner_and_owned_descendants(self):
        ready, receipt = self.root / "ready", self.root / "escaped"
        self.write("example.rs", "fn main() {}\n")
        tools = Path(self.tmp.name) / "tools"
        tools.mkdir()
        formatter = tools / "rustfmt"
        formatter.write_text('#!/bin/sh\n(touch "$READY"; sleep 0.5; touch "$RECEIPT") & wait\n')
        formatter.chmod(0o755)
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        env.update(PATH=str(tools) + os.pathsep + env["PATH"], READY=str(ready), RECEIPT=str(receipt),
                   PYTHONDONTWRITEBYTECODE="1")
        process = subprocess.Popen([sys.executable, "scripts/git_policy.py", "staged"],
                                   cwd=self.root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 3
            while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), "fixture did not reach the running tool")
            process.send_signal(signal.SIGTERM)
            out, err = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 1, (out, err))
            self.assertIn(b"policy interrupted", err)
            time.sleep(0.6)
            self.assertFalse(receipt.exists(), "a descendant survived policy SIGTERM")
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=3)


if __name__ == "__main__":
    unittest.main()
