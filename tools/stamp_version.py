"""Stamp docs/index.html with a new version and the list of the app's files.

GitHub Pages lets browsers cache files for up to 10 minutes, so right after an update a browser can get the new
index.html but old JavaScript. index.html compares this version with the one the browser last ran; when it changed,
it re-downloads every file listed here (bypassing the cache) before starting the app.

Run before committing changes to docs/:  python tools/stamp_version.py
"""
from datetime import datetime, timezone
from pathlib import Path
import json
import re

DOCS = Path(__file__).resolve().parent.parent / 'docs'
INDEX = DOCS / 'index.html'

files = sorted(p.relative_to(DOCS).as_posix() for p in list(DOCS.glob('js/**/*.js')) + list(DOCS.glob('css/*.css')))
version = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
block = (
    '<!-- app-version:start (written by tools/stamp_version.py) -->\n'
    '    <script type="module">\n'
    f'        const VERSION = {json.dumps(version)};\n'
    f'        const FILES = {json.dumps(files)};\n'
    '        // After an update, fetch every file fresh once so new pages never run with old cached code.\n'
    '        try {\n'
    "            if (localStorage.getItem('billsetc-version') !== VERSION) {\n"
    "                await Promise.all(FILES.map(f => fetch(f, { cache: 'reload' }).catch(() => null)));\n"
    "                localStorage.setItem('billsetc-version', VERSION);\n"
    "                document.querySelector('link[rel=stylesheet]').href = 'css/app.css?v=' + VERSION;\n"
    '            }\n'
    '        } catch { /* storage blocked: just start */ }\n'
    "        await import('./js/app.js');\n"
    '    </script>\n'
    '    <!-- app-version:end -->'
)
html = INDEX.read_text(encoding='utf-8')
if '<!-- app-version:start' in html:
    html = re.sub(r'<!-- app-version:start.*?<!-- app-version:end -->', lambda m: block, html, flags=re.S)
else:
    html = html.replace('<script type="module" src="js/app.js"></script>', block)
INDEX.write_text(html, encoding='utf-8', newline='\n')
print(f'version {version}, {len(files)} files')
