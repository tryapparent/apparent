"""Build the supplied preview into one HTML file, without changing its flow."""
from pathlib import Path
import re
root = Path(__file__).resolve().parent
source = (root / 'index.html').read_text()
for match in list(re.finditer(r'<script[^>]*src="((?:vendor/)?[^\"]+\.js)"[^>]*></script>', source)):
    script = (root / match.group(1)).read_text().replace('</script', '<\\/script')
    source = source.replace(match.group(0), '<script>' + script + '</script>')
source = source.replace('<link rel="stylesheet" href="desktop-practice.css">', '<style>' + (root / 'desktop-practice.css').read_text() + '</style>')
output = root / 'dist'
output.mkdir(exist_ok=True)
(output / 'onboarding.html').write_text(source)
print(output / 'onboarding.html')
