import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = Path('shared/ui/scripts')


class ThemeGuard(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        for name in ('check-theme.py', 'check-theme.ts'):
            path = SCRIPTS / name
            self.write(path, (ROOT / path).read_text())
        self.write(SCRIPTS / 'legacy-colors.json', '{}')

    def write(self, path, content):
        path = self.root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def check(self, *args):
        return subprocess.run(['python3', str(SCRIPTS / 'check-theme.py'), *args],
                              cwd=self.root, capture_output=True, text=True)

    def index(self):
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)

    def test_prepared_desktop_archive_matches_indexed_sources(self):
        frontend = 'capture/desktop/ui/frontend'
        electron = frontend + '/electron'
        for path in ('.gitignore', frontend + '/.gitignore'):
            self.write(path, (ROOT / path).read_text())
        generated = ('pill/main.cjs', 'notes/record-transcription.cjs',
                     'settings/update-worker.cjs', 'storage-policy.cjs',
                     'record-completion/session.js')
        for path in generated:
            self.write(electron + '/' + path, 'const style = { backgroundColor: "#00000000" };')
        self.assertEqual(self.check().returncode, 0)
        authored = (electron + '/notes/main.cjs', frontend + '/src/new.tsx', 'connect/web/src/pill/main.cjs')
        for path in authored:
            self.write(path, 'const style = { backgroundColor: "#00000000" };')
        archive = self.check()
        self.index()
        indexed = self.check()
        self.assertEqual(indexed.returncode, 1)
        self.assertEqual(archive.returncode, indexed.returncode)
        self.assertEqual(archive.stderr, indexed.stderr)
        self.assertEqual(set(line.split(': ', 1)[0] for line in indexed.stderr.splitlines()[1:]), set(authored))

    def test_public_scope_includes_shared_colors_but_does_not_read_other_owners(self):
        for owner in ('public', 'shared', 'connect', 'capture'):
            self.write(f'{owner}/src/new.css', 'color:#abcdef;')
        self.write('public/enablement/proof.ts', 'const color = "#123456";')
        for git in (False, True):
            with self.subTest(git=git):
                if git:
                    self.index()
                scoped = self.check('--owner', 'public')
                self.assertEqual(scoped.returncode, 1)
                self.assertEqual(scoped.stderr.count('(1 > 0)'), 2)
                self.assertIn('public/src/new.css', scoped.stderr)
                self.assertIn('shared/src/new.css', scoped.stderr)
                self.assertEqual(self.check().stderr.count('(1 > 0)'), 4)

    def test_rejects_fixed_colors_in_new_files_and_growth_in_legacy_files(self):
        self.write(SCRIPTS / 'legacy-colors.json', json.dumps({'public/old.css': {'#fff': 1}}))
        self.write('public/old.css', 'color:#fff;')
        self.assertEqual(self.check().returncode, 0)
        self.write('public/old.css', 'color:#fff;background:#fff;')
        self.write('public/new.css', 'color:#fff;')
        response = self.check()
        self.assertEqual(response.returncode, 1)
        self.assertIn('public/new.css: #fff (1 > 0)', response.stderr)
        self.assertIn('public/old.css: #fff (2 > 1)', response.stderr)

    def test_detects_common_css_and_tailwind_bypasses(self):
        for value in ['color:#fff;', 'background:rgb(0 0 0 / .5)', 'bg-white', 'text-zinc-950', 'dark:bg-black', 'color-scheme: light;', 'background:white;color:black', 'backgroundColor: "red"']:
            with self.subTest(value=value):
                self.write('public/style.css', value)
                self.assertEqual(self.check().returncode, 1)
        self.write('public/style.css', 'bg-background text-foreground var(--color-surface) color:currentColor')
        self.assertEqual(self.check().returncode, 0)


if __name__ == '__main__':
    unittest.main()
