// Health: General Health / Dental / Eye pages (#general, #dental, #eye). Uses the same folder as Bills Etc
// (the browser remembers it for the whole site); the records live in inputs/health/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { SECTIONS } from './records.js';
import { renderSection, hasUnsavedEdits, forget } from './views/section.js';

const viewEl = document.getElementById('view');
let currentHash = null;

function refreshStatus() {
    const f = document.getElementById('st-folder');
    const root = fs.folder();
    f.textContent = root ? `📁 ${root.name}` : 'No folder';
    f.className = 'pill ' + (root ? 'ok' : 'bad');
}

/** Shown until a folder is connected: reconnect the remembered one, or choose one. */
async function askForFolder(el) {
    const rem = await fs.rememberedFolder().catch(() => null);
    el.innerHTML = `
        <section>
            <h2>Connect your folder</h2>
            <p>Health records are saved in <code>inputs/health/</code> inside your <code>bills-etc-new</code> folder
            (the same folder Bills Etc uses). Nothing is uploaded, and <code>inputs/</code> is never put on GitHub.</p>
            ${fs.isSupported() ? '' : '<div class="banner bad" style="margin-top:12px">This browser can’t open local folders. Use Chrome or Edge.</div>'}
            <div class="row" style="margin-top:12px">
                ${rem ? `<button class="primary" id="reconnect">Reconnect “${esc(rem.handle.name)}”</button>` : ''}
                <button ${rem ? '' : 'class="primary"'} id="choose"${fs.isSupported() ? '' : ' disabled'}>Choose folder…</button>
            </div>
        </section>`;
    el.querySelector('#reconnect')?.addEventListener('click', async () => {
        if (await fs.reconnect(rem.handle)) { refreshStatus(); route(true); }
    });
    el.querySelector('#choose').addEventListener('click', async () => {
        try { await fs.pickFolder(); } catch { return; } // picker cancelled
        refreshStatus();
        route(true);
    });
}

async function route(force = false) {
    const hash = location.hash || '#general';
    if (!force && hash !== currentHash && hasUnsavedEdits()) {
        if (!confirm('You have unsaved edits. Leave without saving?')) {
            history.replaceState(null, '', currentHash);
            return;
        }
    }
    const section = SECTIONS.find(s => '#' + s.id === hash) || SECTIONS[0];
    currentHash = '#' + section.id;
    forget();
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === currentHash));
    if (!fs.folder()) return askForFolder(viewEl);
    try {
        await renderSection(viewEl, section);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', e => {
    if (hasUnsavedEdits()) { e.preventDefault(); e.returnValue = ''; }
});

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
