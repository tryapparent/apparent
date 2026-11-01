"""Exercise a rebuilt CLI against an inert gh, never the network.

APPARENT_BIN=/absolute/path/to/apparent python3 desktop/scripts/tests/test_issue_cli.py
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[4]
BINARY = Path(os.environ.get("APPARENT_BIN", ROOT / "target/debug/apparent")).resolve()
URL = "https://github.com/tryapparent/apparent/issues/123"
TITLE = "Synthetic feedback 'quotes' $(not-a-command) 🐸"
BODY = "## Expected\nKeep Markdown and spaces.\n"

# This transport records actual argv and persists submitted text for readback.
FAKE_GH = '''import json, os, pathlib, sys
root = pathlib.Path(os.environ['ISSUE_FIXTURE'])
args = sys.argv[1:]
with (root / 'calls').open('a') as log:
    log.write(json.dumps({'args': args, 'host': os.environ.get('GH_HOST'),
        'no_prompt': os.environ.get('GH_PROMPT_DISABLED')}) + '\\n')
mode = os.environ.get('ISSUE_MODE', '')
if mode == 'failure' or (mode == 'read-failure' and args[:2] == ['issue', 'view']):
    print('SYNTHETIC_PRIVATE_DIAGNOSTIC', file=sys.stderr)
    sys.exit(1)
if args[:2] == ['issue', 'create']:
    value = {'url': 'https://github.com/tryapparent/apparent/issues/123', 'number': 123,
        'title': args[args.index('--title') + 1], 'body': args[args.index('--body') + 1]}
    (root / 'issue').write_text(json.dumps(value))
    print('https://evil.test/issues/123' if mode == 'bad-url' else value['url'])
elif args[:2] == ['issue', 'view']:
    value = json.loads((root / 'issue').read_text())
    if mode == 'mismatch': value['body'] = 'Unexpected text'
    if mode == 'bad-number': value['number'] = None
    print('not json' if mode == 'bad-json' else json.dumps(value))
else:
    sys.exit(99)
'''


class IssueCli(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="issue-cli-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        gh = self.root / "gh"
        gh.write_text(f"#!{sys.executable}\n" + FAKE_GH)
        gh.chmod(0o700)
        self.config = self.root / "config.json"
        self.config.write_text('{}')
        self.env = dict(os.environ, PATH=str(self.root), APPARENT_CONFIG=str(self.config),
                        ISSUE_FIXTURE=str(self.root), GH_HOST="wrong.example")
        # Do not inherit runtime benchmark or test experiment overrides.
        self.env.pop("APPARENT_BENCH_START", None)

    def run_cli(self, *args, **env):
        return subprocess.run([str(BINARY), "issue", *args], env=dict(self.env, **env),
                              cwd=self.root, capture_output=True, text=True, timeout=40)

    def calls(self):
        path = self.root / "calls"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_help_and_default_preview_never_call_gh(self):
        result = self.run_cli("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--submit", result.stdout)
        self.assertEqual(result.stderr, "")
        result = self.run_cli("--title", TITLE, "--body", BODY)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), dict(repository="tryapparent/apparent",
                         title=TITLE, body=BODY, submitted=False))
        self.assertEqual(self.calls(), [])

    def test_explicit_submission_preserves_text_and_verifies_exact_issue(self):
        result = self.run_cli("--title", TITLE, "--body", BODY, "--submit")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), dict(repository="tryapparent/apparent",
                         title=TITLE, body=BODY, submitted=True, url=URL, number=123))
        calls = self.calls()
        self.assertEqual([call['args'] for call in calls], [
            ['issue', 'create', '--repo', 'tryapparent/apparent', '--title', TITLE, '--body', BODY],
            ['issue', 'view', URL, '--repo', 'tryapparent/apparent', '--json', 'url,number,title,body']])
        self.assertTrue(all(c['host'] == 'github.com' and c['no_prompt'] == '1' for c in calls))

    def test_body_file_ignores_retired_experiment_setting(self):
        path = self.root / "feedback draft.md"
        path.write_text(BODY)
        self.config.write_text('{"experiments":{"issueReporting":false}}')
        result = self.run_cli("--title", TITLE, "--body-file", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['body'], BODY)
        self.assertEqual(self.calls(), [])

    def test_invalid_inputs_and_fifo_fail_before_gh(self):
        path = self.root / "bad.md"
        path.write_bytes(b'\xff')
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        for tail in [[], ['--body', ' '], ['--body', 'x' * 60001],
                     ['--body-file', str(path)], ['--body-file', str(fifo)],
                     ['--body-file', str(self.root / 'missing')],
                     ['--body', 'x', '--body-file', str(path)]]:
            with self.subTest(tail=tail[:1]):
                result = self.run_cli('--title', TITLE, '--submit', *tail)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
                self.assertEqual(self.calls(), [])

    def test_failures_never_claim_success_or_retry(self):
        for mode, count in [('failure', 1), ('bad-url', 1), ('read-failure', 2),
                            ('mismatch', 2), ('bad-number', 2), ('bad-json', 2)]:
            with self.subTest(mode=mode):
                (self.root / 'calls').unlink(missing_ok=True)
                result = self.run_cli('--title', TITLE, '--body', BODY, '--submit', ISSUE_MODE=mode)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertNotIn('SYNTHETIC_PRIVATE_DIAGNOSTIC', result.stderr)
                self.assertEqual(len(self.calls()), count)
                self.assertIn('retry', result.stderr)


if __name__ == '__main__':
    unittest.main()
