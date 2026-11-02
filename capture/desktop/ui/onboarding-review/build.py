"""Build the supplied preview into one HTML file, without changing its flow."""
from pathlib import Path
import re
root = Path(__file__).resolve().parent
source = (root / 'index.html').read_text()
for match in list(re.finditer(r'<script[^>]*src="(vendor/[^\"]+)"[^>]*></script>', source)):
    script = (root / match.group(1)).read_text().replace('</script', '<\\/script')
    source = source.replace(match.group(0), '<script>' + script + '</script>')
output = root / 'dist'
output.mkdir(exist_ok=True)
(output / 'onboarding.html').write_text(source)
print(output / 'onboarding.html')
