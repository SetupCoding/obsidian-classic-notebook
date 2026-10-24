"""Create the manual-install ZIP from the checked-in runtime files."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
source = json.loads(next((root / 'src').glob('*.manifest.json')).read_text(encoding='utf-8'))
assert manifest == source, 'Rebuild the runtime manifest first.'
assert manifest['version'] == json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
subprocess.run(['node', '--check', str(root / 'main.js')], check=True)
output = root / 'dist'
output.mkdir(exist_ok=True)
archive = output / f"{manifest['id']}-{manifest['version']}.zip"
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    for name in ['main.js', 'manifest.json', 'styles.css', 'LICENSE']:
        bundle.write(root / name, arcname=manifest['id'] + '/' + name)
files = [root / name for name in ['main.js', 'manifest.json', 'styles.css']] + [archive]
(output / 'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in files), encoding='utf-8')
print(archive.name)
