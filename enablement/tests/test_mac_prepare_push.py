"""Host-safe packet regressions, included by the existing cheap *push* route."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'capture/desktop/scripts/mac/prepare.py'
spec = importlib.util.spec_from_file_location('mac_prepare', SCRIPT)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        context = patch.dict(os.environ, self.env, clear=True)
        context.start()
        self.addCleanup(context.stop)
        self.git('init', '-q')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        self.git('config', 'user.name', 'Synthetic fixture')
        for name in prepare.INPUTS:
            dest = self.repo / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((ROOT / name).read_bytes())
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.head = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True, env=self.env)

    def test_real_input_closure_and_unrun_gates(self):
        receipt = prepare.prepare(self.repo, self.head)
        self.assertEqual(len(receipt['inputs']), 5)
        self.assertEqual(set(receipt['gates'].values()), {'UNRUN'})
        self.assertEqual(receipt['command'], ['python3', prepare.ENTRY])

    def test_stale_candidate(self):
        with self.assertRaisesRegex(ValueError, 'stale candidate'):
            prepare.prepare(self.repo, '0' * 40)

    def test_missing_swift_fixture_in_committed_packet(self):
        self.git('rm', prepare.INPUTS[1])
        self.git('commit', '-qm', 'incomplete packet')
        with self.assertRaisesRegex(ValueError, 'missing'):
            prepare.prepare(self.repo, self.git('rev-parse', 'HEAD').strip())

    def test_dirty_and_hidden_input(self):
        fixture = self.repo / prepare.INPUTS[1]
        fixture.write_text('broken')
        with self.assertRaisesRegex(ValueError, 'clean'):
            prepare.prepare(self.repo, self.head)
        self.git('update-index', '--assume-unchanged', prepare.INPUTS[1])
        with self.assertRaisesRegex(ValueError, 'hidden index'):
            prepare.prepare(self.repo, self.head)

    def test_private_exclusive_receipt(self):
        output = self.base / 'receipt.json'
        command = ['python3', str(SCRIPT), '--repo', str(self.repo), '--candidate',
                   self.head, '--receipt', str(output)]
        subprocess.run(command, check=True, env=self.env)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(output.read_text())['status'], 'PREPARED_ONLY')
        self.assertNotEqual(subprocess.run(command, capture_output=True, env=self.env).returncode, 0)
        self.base.chmod(0o755)
        self.assertNotEqual(subprocess.run(command[:-1] + [str(self.base / 'other')],
                                           capture_output=True, env=self.env).returncode, 0)
