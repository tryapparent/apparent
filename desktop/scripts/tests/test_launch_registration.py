"""Packaging contract, not a native OS launch test."""
import pathlib
import plistlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]


class LaunchRegistration(unittest.TestCase):
    def test_mac_install_preview_and_release_claim_only_apparent(self):
        for name in ('install-app.sh', 'build-mac-preview.sh', 'release-app.sh'):
            with self.subTest(script=name):
                text = (ROOT / 'desktop' / 'scripts' / name).read_text()
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
        text = (ROOT / 'desktop/packaging/linux/dev.kitlangton.apparent.desktop').read_text()
        self.assertIn('\nMimeType=x-scheme-handler/apparent;\n', text)
        self.assertIn('\nExec=apparent launch %u\n', text)


if __name__ == '__main__':
    unittest.main()
