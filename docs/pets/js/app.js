// Pets: one page per pet (#jackie, #castle, …). Uses the same folder as Bills Etc
// (the browser remembers it for the whole site); the records live in inputs/pets/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { SECTIONS } from './records.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { renderSection, hasUnsavedEdits, forget } from './views/section.js';

const viewEl = document.getElementById('view');
let currentHash = null;

document.getElementById('nav').innerHTML = SECTIONS.map(s => `<a href="#${s.id}">${esc(s.label)}</a>`).join('');

async function route(force = false) {
    const hash = location.hash || '#' + SECTIONS[0].id;
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
    if (!fs.folder()) return askForFolder(viewEl, { what: 'Pet records', where: 'inputs/pets/', onConnected: () => route(true) });
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
