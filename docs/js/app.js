import * as fs from './fs.js';
import { pingOllama, ollamaSettings } from './ollama.js';
import { esc } from './util.js';
import home from './views/home.js';
import workflow from './views/workflow.js';
import month from './views/month.js';
import dashboard from './views/dashboard.js';
import edit from './views/edit.js';
import config from './views/config.js';

const VIEWS = { home, workflow, month, dashboard, edit, config };
const viewEl = document.getElementById('view');
let current = null;
let currentName = null;

// Pages that change files; hidden while a read-only snapshot is open.
const WRITE_VIEWS = ['workflow', 'edit', 'config'];

export async function refreshStatus() {
    const f = document.getElementById('st-folder');
    const o = document.getElementById('st-ollama');
    const snap = fs.snapshot();
    document.body.classList.toggle('readonly', !!snap);
    if (snap) {
        f.textContent = `🔒 Snapshot · ${snap.created.toLocaleDateString()}`;
        f.className = 'pill ok';
        o.hidden = true;
        return null;
    }
    o.hidden = false;
    const root = fs.folder();
    f.textContent = root ? `📁 ${root.name}` : 'No folder';
    f.className = 'pill ' + (root ? 'ok' : 'bad');

    o.textContent = 'Ollama …';
    o.className = 'pill';
    const st = await pingOllama();
    o.textContent = st.ok ? (st.hasModel ? `Ollama ✓ ${ollamaSettings.model}` : `Ollama: ${ollamaSettings.model} missing`) : 'Ollama offline';
    o.className = 'pill ' + (st.ok && st.hasModel ? 'ok' : 'bad');
    return st;
}

/** Placeholder for views that need the folder. Returns true if a folder is connected. */
export function requireFolder(el) {
    if (fs.hasData()) return true;
    el.innerHTML = `
        <section>
            <h2>No folder connected</h2>
            <p>On your computer, connect your <code>bills-etc-new</code> folder on the <a href="#home">Setup</a> page.
            On another device, open an encrypted snapshot there instead. Nothing is uploaded.</p>
        </section>`;
    return false;
}

async function route() {
    const name = location.hash.slice(1) || 'home';
    if (current?.canLeave && name !== currentName && !current.canLeave()) {
        history.replaceState(null, '', '#' + currentName);
        return;
    }
    const view = VIEWS[name] || VIEWS.home;
    current?.destroy?.();
    current = view;
    currentName = VIEWS[name] ? name : 'home';
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + currentName));
    viewEl.innerHTML = '';
    if (fs.isReadOnly() && WRITE_VIEWS.includes(currentName)) {
        viewEl.innerHTML = `<div class="banner">You're viewing a read-only snapshot. To run the workflow or make edits, lock it on the <a href="#home">Setup</a> page and connect your folder.</div>`;
        return;
    }
    try {
        await view.render(viewEl);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => {
    if (current?.canLeave && !current.canLeave(true)) { e.preventDefault(); e.returnValue = ''; }
});

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
