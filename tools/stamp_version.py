"""Stamp each app's index.html (docs/bills-etc/, docs/health/, docs/vehicles/, docs/pets/) with a new version and the list of its files.

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
# app folder → (localStorage key, files from other apps it imports, relative to docs/)
SHARED = ['bills-etc/css/app.css', 'bills-etc/js/csv.js', 'bills-etc/js/datatable.js', 'bills-etc/js/dates.js',
          'bills-etc/js/filtermenu.js', 'bills-etc/js/fs.js', 'bills-etc/js/util.js', 'shared/css/records.css',
          'shared/js/fileguard.js', 'shared/js/folder.js', 'shared/js/phonecopy.js', 'shared/js/recordtable.js',
          'health/js/records.js', 'vehicles/js/vehicles.js', 'pets/js/pets.js']  # the phone copy reads every app's data
APPS = {
    'bills-etc': ('billsetc-version', []),
    'health': ('health-version', SHARED),
    'vehicles': ('vehicles-version', SHARED),
    'pets': ('pets-version', SHARED + ['vehicles/css/vehicles.css', 'vehicles/js/views/gallery.js']),  # borrows Vehicles' info box + photos
}


def own_files(app_dir):
    return sorted(p.relative_to(app_dir).as_posix() for p in list(app_dir.glob('js/**/*.js')) + list(app_dir.glob('css/*.css')))


version = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
for app, (key, shared) in APPS.items():
    app_dir = DOCS / app
    index = app_dir / 'index.html'
    files = own_files(app_dir) + ['../' + f for f in shared]
    block = (
        '<!-- app-version:start (written by tools/stamp_version.py) -->\n'
        '    <script type="module">\n'
        f'        const VERSION = {json.dumps(version)};\n'
        f'        const FILES = {json.dumps(files)};\n'
        '        // After an update, fetch every file fresh once so new pages never run with old cached code.\n'
        '        try {\n'
        f"            if (localStorage.getItem('{key}') !== VERSION) {{\n"
        "                await Promise.all(FILES.map(f => fetch(f, { cache: 'reload' }).catch(() => null)));\n"
        f"                localStorage.setItem('{key}', VERSION);\n"
        "                document.querySelectorAll('link[rel=stylesheet]').forEach(l => { l.href = l.getAttribute('href') + '?v=' + VERSION; });\n"
        '            }\n'
        '        } catch { /* storage blocked: just start */ }\n'
        "        await import('./js/app.js');\n"
        '    </script>\n'
        '    <!-- app-version:end -->'
    )
    html = index.read_text(encoding='utf-8')
    if '<!-- app-version:start' in html:
        html = re.sub(r'<!-- app-version:start.*?<!-- app-version:end -->', lambda m: block, html, flags=re.S)
    else:
        html = html.replace('<script type="module" src="js/app.js"></script>', block)
    index.write_text(html, encoding='utf-8', newline='\n')
    print(f'{app}: version {version}, {len(files)} files')
