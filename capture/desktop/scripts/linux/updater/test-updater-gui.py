#!/usr/bin/env python3
"""Fast harness-contract tests; these do NOT establish GUI behavior."""
import importlib.util
from pathlib import Path
import hashlib
import unittest
import json
import socket
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocatorTests(unittest.TestCase):
    def setUp(self):
        self.gui = load('updater-gui')

    def test_phrase_uses_visible_word_bounds(self):
        words = [{'text': t, 'left': x, 'top': 10, 'width': w, 'height': 12,
                  'block_num': 1, 'par_num': 1, 'line_num': 1}
                 for t, x, w in [('Check', 10, 20), ('for', 32, 10), ('Updates', 44, 30)]]
        self.assertEqual(self.gui.find_phrase(words, 'Check for Updates'), (42, 16))
        with self.assertRaises(ValueError):
            self.gui.find_phrase(words, 'Updates')

    def test_ocr_preprocessing_removes_outline_but_preserves_short_text_strokes(self):
        from PIL import Image, ImageDraw
        image = Image.new('L', (90, 70), 20)
        draw = ImageDraw.Draw(image)
        draw.rectangle((5, 5, 75, 55), outline=230)
        draw.line((20, 30, 25, 30), fill=230)
        cleaned = self.gui.erase_long_light_lines(image)
        self.assertEqual(cleaned.getpixel((40, 5)), 20)
        self.assertEqual(cleaned.getpixel((5, 30)), 20)
        self.assertEqual(cleaned.getpixel((23, 30)), 230)
        self.assertEqual(image.getpixel((40, 5)), 230)

    def test_missing_or_ambiguous_phrase_fails_closed(self):
        with self.assertRaises(ValueError):
            self.gui.find_phrase([], 'Update now')
        word = {'text': 'OK', 'left': 10, 'top': 10, 'width': 20, 'height': 12,
                'block_num': 1, 'par_num': 1, 'line_num': 1}
        with self.assertRaises(ValueError):
            self.gui.find_phrase([word, dict(word, line_num=2)], 'OK')

    def test_distinct_controls_on_same_ocr_line_are_not_one_label(self):
        words = [{'text': t, 'left': x, 'top': 10, 'width': w, 'height': 56 if x >= 168 else 19,
                  'block_num': 1, 'par_num': 1, 'line_num': 1}
                 for t, x, w in [('Update', 10, 60), ('later', 78, 42),
                                 ('Update', 168, 60), ('now', 236, 35)]]
        self.assertEqual(self.gui.find_phrase(words, 'Update later'), (65, 19))
        self.assertEqual(self.gui.find_phrase(words, 'Update now'), (219, 38))
        with self.assertRaises(ValueError):
            self.gui.find_phrase(words, 'later')

    def test_ignored_later_and_escape_cannot_satisfy_dismissal(self):
        words = [{'text': text, 'left': 10, 'top': row * 30, 'width': 160, 'height': 19,
                  'block_num': 1, 'par_num': 1, 'line_num': row}
                 for row, text in enumerate(['Check for Updates', 'Update available', 'Update now'])]
        # The former positive-only proof succeeds even with the modal still open.
        self.assertEqual(self.gui.find_phrase(words, 'Check for Updates'), (90, 9))
        for action in ['Later', 'Escape']:
            with self.subTest(action=action), tempfile.TemporaryDirectory() as directory:
                evidence = self.gui.Evidence(Path(directory))
                with patch.object(evidence, 'frame', return_value=Path(directory) / 'frame.png'), \
                     patch.object(evidence, 'words', return_value=words):
                    with self.assertRaisesRegex(RuntimeError, 'dialog did not disappear'):
                        evidence.perform({'op': 'assert-dismissed', 'timeout': 0, 'label': action})

    def test_dismissal_requires_visible_settings_and_no_modal_in_either_ocr_pass(self):
        background = [{'text': 'Check for Updates', 'left': 10, 'top': 10, 'width': 160,
                       'height': 19, 'block_num': 1, 'par_num': 1, 'line_num': 1}]
        modal = dict(background[0], text='Update available', line_num=2)
        self.assertTrue(self.gui.dialog_dismissed([background, background]))
        self.assertFalse(self.gui.dialog_dismissed([[], []]))
        self.assertFalse(self.gui.dialog_dismissed([background, background + [modal]]))


class CandidateTests(unittest.TestCase):
    def test_transferred_digest_must_equal_the_recorded_candidate(self):
        gui = load('updater-gui')
        expected = hashlib.sha256(b'exact packaged candidate').hexdigest()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'candidate.sha256'
            self.assertFalse(gui.candidate_matches(path, expected))
            path.write_text(expected + '\n')
            self.assertTrue(gui.candidate_matches(path, expected))
            path.write_text(hashlib.sha256(b'different package with same revision').hexdigest() + '\n')
            self.assertFalse(gui.candidate_matches(path, expected))


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixture = load('updater-fixture')

    def test_release_contract_and_digest_are_exact(self):
        import hashlib
        payload = b'test AppImage bytes, not a published release'
        control = {'version': '1.2.3', 'mode': 'available'}
        status, body = self.fixture.response(control, '/repos/tryapparent/apparent/releases/latest', payload)
        import json
        release = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(release['tag_name'], 'v999.0.0')
        url = release['assets'][1]['browser_download_url']
        status, checksum = self.fixture.response(control, url.split('github.com')[1], payload)
        self.assertEqual(status, 200)
        self.assertEqual(checksum.decode(), hashlib.sha256(payload).hexdigest() + '  Apparent-999.0.0-linux-x86_64.AppImage\n')

    def test_only_expected_routes_and_modes(self):
        self.assertEqual(self.fixture.response({'version': '1.2.3', 'mode': 'error'},
                         '/repos/tryapparent/apparent/releases/latest', b'')[0], 503)
        self.assertEqual(self.fixture.response({'version': '1.2.3', 'mode': 'current'},
                         '/unexpected', b'')[0], 404)
        self.assertEqual(self.fixture.response({'version': '1.2.3', 'mode': 'bad-checksum'},
                         '/tryapparent/apparent/releases/download/v999.0.0/Apparent-999.0.0-linux-x86_64.AppImage.sha256', b'x')[1].split()[0], b'0' * 64)

    def test_real_curl_connect_requires_trusted_tls_and_refuses_foreign_hosts(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'payload').write_bytes(b'fixture bytes')
            (directory / 'control.json').write_text(json.dumps({'version':'1.2.3','mode':'current','serial':1}))
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-subj', '/CN=api.github.com', '-addext', 'subjectAltName=DNS:api.github.com,DNS:github.com',
                            '-keyout', str(directory / 'key.pem'), '-out', str(directory / 'cert.pem')],
                           check=True, capture_output=True, timeout=10)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            server = subprocess.Popen([sys.executable, str(Path(__file__).with_name('updater-fixture.py')),
                                       str(directory), str(directory / 'payload'), '--port', str(port)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not (directory / 'server-ready').exists():
                    if server.poll() is not None or time.monotonic() > deadline:
                        self.fail('fixture server did not start')
                    time.sleep(.05)
                curl = ['curl', '--silent', '--show-error', '--fail', '--max-time', '3',
                        '--proxy', f'http://127.0.0.1:{port}', '--noproxy', '']
                url = 'https://api.github.com' + self.fixture.API
                untrusted = subprocess.run(curl + [url], capture_output=True)
                self.assertEqual(untrusted.returncode, 60)
                trusted = subprocess.run(curl + ['--cacert', str(directory / 'cert.pem'), url],
                                         check=True, capture_output=True)
                self.assertEqual(json.loads(trusted.stdout)['tag_name'], 'v1.2.3')
                foreign = subprocess.run(curl + ['--cacert', str(directory / 'cert.pem'), 'https://foreign.invalid/'],
                                         capture_output=True)
                self.assertNotEqual(foreign.returncode, 0)
                self.assertIn(b'403', foreign.stderr)
            finally:
                server.terminate()
                server.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
