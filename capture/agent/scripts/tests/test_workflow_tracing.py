"""Exercise the shipped CLI, not a separate tracing implementation.

APPARENT_TEST_BINARY=/absolute/apparent python3 -m unittest discover \
    -s capture/agent/scripts/tests -p test_workflow_tracing.py -v
Uses isolated config/storage and synthetic files only; never launches a GUI,
records a screen, plays audio, accesses credentials or sends network requests.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('APPARENT_TEST_BINARY'), 'explicit rebuilt Apparent binary required')
class WorkflowTracingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='workflow-trace-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.binary = str(Path(os.environ['APPARENT_TEST_BINARY']).resolve(strict=True))
        self.config = self.root / 'config.json'
        self.store = self.root / 'traces'
        self.env = dict(os.environ, APPARENT_CONFIG=str(self.config),
                        APPARENT_TRACE_ROOT=str(self.store))
        self.env.pop('APPARENT_TRACE', None)
        # The benchmark shortcut runs before CLI parsing, even for fixture setup.
        self.env.pop('APPARENT_BENCH_START', None)
        self.enable(True)

    def enable(self, value):
        self.config.write_text(json.dumps({'experiments': {'videoTracing': value}}))

    def cli(self, *args, success=True, env=None):
        result = subprocess.run([self.binary, *map(str, args)], env=env or self.env,
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return result

    def start(self, mode='synthetic-test'):
        return json.loads(self.cli('trace', 'start', 'synthetic-fixture', '--mode', mode).stdout)['id']

    def report(self, ident):
        report = json.loads(self.cli('trace', 'report', ident).stdout)
        self.assertEqual(len(report['traces']), 1)
        return report['traces'][0]['trace']

    def synthetic_bundle(self):
        bundle = self.root / 'synthetic.apparent'
        self.cli('demo', '--out', bundle)
        manifest = bundle / 'apparent.json'
        data = json.loads(manifest.read_text())
        data.update(video='recording.mp4', audio=None, durationMs=2000,
                    videoOffsetMs=0, events=[], strokes=[], cursor=[])
        manifest.write_text(json.dumps(data))
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=size=320x180:rate=10:duration=2', '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p', str(bundle / 'recording.mp4')],
                       check=True, capture_output=True, timeout=30)
        return bundle

    def test_default_off_and_invalid_trace_prevent_command_side_effects(self):
        bundle = self.synthetic_bundle()
        output = self.root / 'must-not-exist.mp4'
        args = ['export', bundle, '--out', output, '--size', '320', '--fps', '10',
                '--no-zoom', '--no-audio']
        # Positive control: identical work really creates output without tracing.
        self.cli(*args)
        self.assertGreater(output.stat().st_size, 0)
        output.unlink()
        before = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in bundle.rglob('*') if p.is_file()}
        def refused(ident, env=None):
            result = self.cli('--trace', ident, *args, success=False, env=env)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertFalse(output.exists())
            after = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in bundle.rglob('*') if p.is_file()}
            self.assertEqual(before, after)
            return result.stderr
        self.enable(False)
        self.cli('trace', 'start', 'disabled', success=False)
        self.assertFalse(self.store.exists())
        self.assertIn('disabled', refused('unavailable'))
        self.assertFalse(self.store.exists())
        baseline = self.cli('skill').stdout
        self.assertIn('# Apparent captures', baseline)
        self.assertFalse(self.store.exists())
        self.enable(True)
        self.assertIn('token', refused('../escape'))
        self.assertFalse((self.root / 'escape').exists())
        self.assertIn('No such file', refused('unavailable'))
        ident = self.start()
        self.cli('trace', 'end', ident, '--status', 'abandoned')
        self.assertIn('closed', refused(ident))
        open_id = self.start()
        self.store.chmod(0o755)
        try:
            refused(open_id)
        finally:
            self.store.chmod(0o700)

    def test_non_unicode_environment_refuses_valid_work_but_explicit_id_wins(self):
        bundle = self.synthetic_bundle()
        output = self.root / 'never.mp4'
        env = dict(self.env, APPARENT_TRACE=b'\xff')
        failed = self.cli('export', bundle, '--out', output, '--no-audio', success=False, env=env)
        self.assertIn('APPARENT_TRACE must be valid UTF-8', failed.stderr)
        self.assertEqual(failed.returncode, 1)
        self.assertFalse(output.exists())
        ident = self.start()
        baseline = self.cli('skill').stdout
        self.assertEqual(self.cli('--trace', ident, 'skill', env=env).stdout, baseline)

    def test_attempt_passthrough_and_sensitive_arguments_not_retained(self):
        ident = self.start()
        baseline = self.cli('skill').stdout
        self.assertEqual(self.cli('--trace', ident, 'skill').stdout, baseline)
        self.assertEqual(self.cli('skill', '--trace', ident).stdout, baseline)
        marker = 'SYNTHETIC_PRIVATE_INPUT_DO_NOT_RETAIN'
        missing = self.root / (marker + '.apparent')
        failure = self.cli('--trace', ident, 'export', missing,
                           '--out', self.root / 'never.mp4', success=False)
        self.assertIn(marker, failure.stderr)  # Marker actually reaches the raw diagnostic.
        report = self.report(ident)
        serialized = json.dumps(report)
        self.assertNotIn(marker, serialized)
        self.assertNotIn(baseline, serialized)
        attempts = [e for e in report['events'] if e['kind'] == 'attempt']
        self.assertEqual([e['operation'] for e in attempts], ['skill', 'skill', 'export'])
        self.assertEqual([e['status'] for e in attempts], ['succeeded', 'succeeded', 'failed'])
        self.assertTrue(all(e['elapsed_ms'] >= 0 for e in attempts))
        self.cli('trace', 'end', ident, '--status', 'blocked')
        self.cli('--trace', ident, 'skill', success=False)

    def test_environment_selection_explicit_override_and_concurrent_processes(self):
        first, second = self.start(), self.start()
        selected = dict(self.env, APPARENT_TRACE=first)
        self.cli('skill', env=selected)
        self.cli('--trace', second, 'skill', env=selected)
        # Management must work without tracing itself or needing the env trace open.
        self.cli('trace', 'end', first, '--status', 'delivered', env=selected)
        self.cli('trace', 'report', second, env=selected)
        def note(i):
            self.cli('trace', 'note', second, '--phase', 'prepare', '--step', 'parallel',
                     '--kind', 'observation', '--text', str(i))
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(note, range(8)))
        events = self.report(second)['events']
        self.assertEqual(len(events), 9)
        self.assertEqual(len({e['id'] for e in events}), 9)
        self.assertEqual(len(self.report(first)['events']), 1)

    def test_retained_artifact_survives_original_then_detects_tampering(self):
        ident = self.start()
        source = self.root / 'synthetic-evidence.txt'
        payload = b'Synthetic trace evidence, not a video.'
        source.write_bytes(payload)
        result = json.loads(self.cli('trace', 'artifact', ident, '--phase', 'qa',
                                     '--step', 'evidence', '--path', source, '--keep').stdout)
        artifact = next(e for e in self.report(ident)['events'] if e['id'] == result['event'])
        self.assertEqual(artifact['sha256'], hashlib.sha256(payload).hexdigest())
        source.unlink()
        self.cli('trace', 'verify', ident)
        retained = self.store / artifact['retained']
        self.assertEqual(retained.read_bytes(), payload)
        self.assertEqual(retained.stat().st_mode & 0o777, 0o600)
        retained.write_bytes(b'changed')
        self.cli('trace', 'verify', ident, success=False)
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o700)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux export uses ffprobe on PATH')
    def test_completion_log_failure_preserves_real_export_result(self):
        bundle = self.synthetic_bundle()
        before = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in bundle.rglob('*') if p.is_file()}
        probe = shutil.which('ffprobe')
        self.assertIsNotNone(probe, 'real ffprobe required for export coverage')
        tools = self.root / 'tools'
        tools.mkdir()
        wrapper = tools / 'ffprobe'
        for fail_work in (False, True):
            with self.subTest(fail_work=fail_work):
                ident = self.start()
                trace_file = self.store / f'{ident}.json'
                # This dependency runs after admission. Make completion unsafe to
                # write without changing the real successful export path. No
                # sleeps, permission assumptions or production test seam.
                wrapper.write_text(
                    '#!/usr/bin/env python3\n'
                    'import os, sys\n'
                    f'os.chmod({str(trace_file)!r}, 0o644)\n'
                    + ("sys.stderr.write('TRACE_TEST_TOOL_FAILED\\n'); sys.exit(27)\n"
                       if fail_work else f'os.execv({probe!r}, [{probe!r}, *sys.argv[1:]])\n'))
                wrapper.chmod(0o700)
                env = dict(self.env, PATH=str(tools) + os.pathsep + self.env['PATH'])
                output = self.root / f'completion-{fail_work}.mp4'
                try:
                    result = self.cli('--trace', ident, 'export', bundle, '--out', output,
                                      '--size', '320', '--fps', '10', '--no-zoom', '--no-audio',
                                      env=env, success=not fail_work)
                    self.assertEqual(output.is_file(), not fail_work)
                    self.assertIn('could not record completion', result.stderr)
                    if fail_work:
                        self.assertIn('TRACE_TEST_TOOL_FAILED', result.stderr)
                    else:
                        self.assertGreater(output.stat().st_size, 0)
                finally:
                    trace_file.chmod(0o600)
                event, = self.report(ident)['events']
                self.assertEqual(event['status'], 'running')
                self.assertIsNone(event['elapsed_ms'])
                self.assertNotIn('TRACE_TEST_TOOL_FAILED', json.dumps(event))
                after = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in bundle.rglob('*') if p.is_file()}
                self.assertEqual(before, after)
                self.cli('trace', 'end', ident, '--status', 'delivered', success=False)
                self.cli('trace', 'resolve', ident, '--event', event['id'],
                         '--text', 'Test observed command exit and no remaining work')
                self.cli('trace', 'end', ident, '--status', 'blocked')

    def test_real_export_is_traced_without_changing_source_bundle(self):
        ident = self.start()
        bundle = self.synthetic_bundle()
        before = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in bundle.rglob('*') if p.is_file()}
        output = self.root / 'share.mp4'
        self.cli('--trace', ident, 'export', bundle, '--out', output,
                 '--size', '320', '--fps', '10', '--no-zoom', '--no-audio')
        self.assertGreater(output.stat().st_size, 0)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'],
                       check=True, capture_output=True, timeout=30)
        after = {str(p.relative_to(bundle)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in bundle.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        attempts = [e for e in self.report(ident)['events'] if e['kind'] == 'attempt']
        self.assertEqual(len(attempts), 1)
        self.assertEqual((attempts[0]['operation'], attempts[0]['status']), ('export', 'succeeded'))
        self.cli('trace', 'artifact', ident, '--phase', 'qa', '--step', 'export',
                 '--path', output, '--keep')
        self.cli('trace', 'verify', ident)
        self.cli('trace', 'end', ident, '--status', 'delivered')


if __name__ == '__main__':
    unittest.main()
