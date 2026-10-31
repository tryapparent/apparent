"""Credential-free composition and ordinary route readback contracts."""
import importlib.util
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('publisher_routes', Path(__file__).with_name('publish_site.py'))
assert spec is not None and spec.loader is not None
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class CompositionDeliveryTests(unittest.TestCase):
    def test_workflow_selects_and_builds_both_locked_products_before_upload(self):
        source = (ROOT / '.github/workflows/web-delivery.yml').read_text()
        self.assertEqual(source.count("'connect/web/**'"), 2)
        self.assertIn("bun-version: '1.3.10'", source)
        self.assertIn("bun-version: '1.4.4'", source)
        self.assertIn('working-directory: connect/web', source)
        self.assertIn('node scripts/build-public.mjs', source)
        self.assertIn('test-composed-package.mjs', source)
        self.assertIn('test-product-boundaries.mjs', source)
        self.assertLess(source.index('node scripts/build-public.mjs'), source.index('name: website-${{ github.sha }}'))
        self.assertLess(source.index('path: site/dist-apparent/'), source.index('VITE_HOSTED_API_ORIGIN: http://127.0.0.1:18809'))
        self.assertIn("vars.WEBSITE_CD_ENABLED == 'true'", source)
        self.assertIn("vars.HOSTED_CD_ENABLED == 'true'", source)

    def test_public_readback_checks_slash_aliases_and_query_without_auth_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in ['index.html', 'icon.svg', 'assets/test.js', 'connect/index.html', 'connect/device/index.html', 'hosted/index.html', 'hosted/device/index.html']:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'synthetic static page')
            urls = []
            def fetch(url, **kwargs):
                urls.append(url)
                return BytesIO(b'synthetic static page')
            with patch.object(publisher, 'urlopen', side_effect=fetch):
                publisher.verify_http(root)
            for route in ['connect', 'connect/device', 'hosted', 'hosted/device']:
                for suffix in ['', '/']:
                    self.assertIn('https://app.tryapparent.com/' + route + suffix, urls)
                    if route.endswith('/device'):
                        self.assertIn('https://app.tryapparent.com/' + route + suffix + '?code=CD-CHECK', urls)
            self.assertTrue(all(url.startswith('https://app.tryapparent.com/') for url in urls))
            self.assertFalse(any('/auth/' in url or '/v1/' in url for url in urls))


if __name__ == '__main__':
    unittest.main()
