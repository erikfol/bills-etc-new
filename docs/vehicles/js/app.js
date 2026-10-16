// Vehicles: one page per vehicle (#<id>, its Guides tab #<id>/guides) plus "＋ Add vehicle" (#new); the menu is
// built from vehicles.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/vehicles/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { loadVehicles } from './vehicles.js';
import { renderVehicle, renderNewVehicle, hasUnsavedEdits, forget } from './views/vehicle.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
let currentHash = null;

function drawNav(list, active) {
    navEl.innerHTML = list.map(v => `<a href="#${esc(v.id)}"${v.id === active ? ' class="active"' : ''}>${esc(v.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add vehicle</a>`;
}

/** After a vehicle is added, renamed or removed: re-read the list and open #goTo. */
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
        return askForFolder(viewEl, { what: 'Vehicle records', where: 'inputs/vehicles/', onConnected: () => route(true) });
    }
    try {
        const list = await loadVehicles();
        const [want, part] = hash.slice(1).split('/');
        const v = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        const sub = v && v.id === want && part === 'guides' ? 'guides' : '';
        currentHash = '#' + (v ? v.id : 'new') + (sub ? '/' + sub : '');
        if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
        drawNav(list, v ? v.id : 'new');
        if (v) await renderVehicle(viewEl, list, v, listChanged, sub);
        else renderNewVehicle(viewEl, list, listChanged);
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
