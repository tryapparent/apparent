"""Packaging contract, not a native OS launch test."""
import pathlib
import plistlib
import re
import json
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[4]


class LaunchRegistration(unittest.TestCase):
    def test_mac_install_preview_and_release_claim_only_apparent(self):
        for name in ('install-app.sh', 'build-mac-preview.sh', 'release-app.sh'):
            with self.subTest(script=name):
                script = {
                    'install-app.sh': 'packaging/install-app.sh',
                    'build-mac-preview.sh': 'packaging/build-mac-preview.sh',
                    'release-app.sh': 'release/release-app.sh',
                }[name]
                text = ((ROOT / 'composition/enablement/release/mac/metadata.ts') if name == 'build-mac-preview.sh' else (ROOT / 'capture' / 'desktop' / 'scripts' / script)).read_text()
                match = re.search(r'<\?xml.*?</plist>', text, re.S)
                assert match is not None
                xml = match.group()
                info = plistlib.loads(xml.encode())
                self.assertEqual(info.get('CFBundleURLTypes'), [{
                    'CFBundleURLName': 'Apparent launch',
                    'CFBundleURLSchemes': ['apparent'],
                    'CFBundleTypeRole': 'Viewer',
                }])

    def test_appimage_desktop_dispatches_one_url_without_shell(self):
        text = '\n'.join(json.loads((ROOT / 'composition/enablement/release/linux/dev.simonvanlaak.apparent.desktop.json').read_text())) + '\n'
        self.assertIn('\nMimeType=x-scheme-handler/apparent;\n', text)
        self.assertIn('\nExec=apparent launch %u\n', text)


if __name__ == '__main__':
    unittest.main()
