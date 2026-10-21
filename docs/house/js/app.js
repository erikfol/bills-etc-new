// House: one page per house (#<id>, its tabs #<id>/heating, /septic, /inside, /outside; Heating/Cooling's pills
// #<id>/heating/mini-split etc., its first pill being #<id>/heating) plus "＋ Add house" (#new); the menu is built
// from house.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/house/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { setupPhoneCopy } from '../../shared/js/phonecopy.js';
import { loadHouses, AREAS } from './house.js';
import { renderHouse, renderNewHouse, hasUnsavedEdits, forget } from './views/house.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
let currentHash = null;

function drawNav(list, active) {
    navEl.innerHTML = list.map(h => `<a href="#${esc(h.id)}"${h.id === active ? ' class="active"' : ''}>${esc(h.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add house</a>`;
}

/** After a house is added, renamed or removed: re-read the list and open #goTo. */
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
        return askForFolder(viewEl, { what: 'House records', where: 'inputs/house/', onConnected: () => route(true) });
    }
    try {
        const list = await loadHouses();
        const [want, part, sub] = hash.slice(1).split('/');
        const h = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        const tab = h && h.id === want ? AREAS.find(a => a.id === part) : null;
        const page = tab?.parts ? tab.parts.find(p => p.id === sub) || tab.parts[0] : tab;
        currentHash = '#' + (h ? h.id : 'new') + (tab ? '/' + tab.id : '') + (page && page !== tab && page !== tab.parts[0] ? '/' + page.id : '');
        if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
        drawNav(list, h ? h.id : 'new');
        if (h) await renderHouse(viewEl, list, h, listChanged, tab, page);
        else renderNewHouse(viewEl, list, listChanged);
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
