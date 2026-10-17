// Pets: one page per pet (#<id>) plus "＋ Add pet" (#new); the menu is built from pets.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/pets/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { setupPhoneCopy } from '../../shared/js/phonecopy.js';
import { loadPets } from './pets.js';
import { renderPet, renderNewPet, hasUnsavedEdits, forget } from './views/pet.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
let currentHash = null;

function drawNav(list, active) {
    navEl.innerHTML = list.map(p => `<a href="#${esc(p.id)}"${p.id === active ? ' class="active"' : ''}>${esc(p.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add pet</a>`;
}

/** After a pet is added, renamed or removed: re-read the list and open #goTo. */
function listChanged(goTo) {
    if (location.hash === '#' + goTo) route(true);
    else { currentHash = '#' + goTo; location.hash = goTo; } // hashchange routes; nothing unsaved to ask about
}

async function route(force = false) {
    const hash = location.hash;
    if (!force && hash !== currentHash && hasUnsavedEdits()) {
        if (!confirm('You have unsaved edits. Leave without saving?')) {
            history.replaceState(null, '', currentHash);
            return;
        }
    }
    forget();
    if (!fs.folder()) {
        navEl.innerHTML = '';
        return askForFolder(viewEl, { what: 'Pet records', where: 'inputs/pets/', onConnected: () => route(true) });
    }
    try {
        const list = await loadPets();
        const want = hash.slice(1);
        const p = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        currentHash = '#' + (p ? p.id : 'new');
        if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
        drawNav(list, p ? p.id : 'new');
        if (p) await renderPet(viewEl, list, p, listChanged);
        else renderNewPet(viewEl, list, listChanged);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', e => {
    if (hasUnsavedEdits()) { e.preventDefault(); e.returnValue = ''; }
});

setupPhoneCopy(document.getElementById('phone-copy'));

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
