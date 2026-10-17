// One policy's page (information, contacts, documents and photos, records table), and the "Add policy" page.
// Contacts and documents use the Vehicles service-places and gallery views.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from '../../../vehicles/js/views/places.js';
import {
    INSURANCE_PATH, STORE, savePolicies, newPolicy, recordsPath, documentsDir, RECORD_COLUMNS, loadRecords, saveRecords,
} from '../insurance.js';

let table = null;
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!info?.hasUnsavedEdits() || placesUnsaved();
export const forget = () => { table = null; info = null; closeFilterMenu(); releaseGalleries(); forgetPlaces(); };

/** list: every policy (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo. */
export async function renderPolicy(el, list, p, onListChanged) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadRecords(p);
    el.innerHTML = `
        <h1 class="page">${esc(p.name)} insurance</h1>
        <p class="lead">Information in <code>${esc(INSURANCE_PATH)}</code>, records in <code>${esc(recordsPath(p))}</code>.</p>
        <section>
            <h2>Policy information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Contacts</h2>
            <div id="places"></div>
        </section>
        <section>
            <h2>Documents &amp; photos</h2>
            <div id="docs"></div>
        </section>
        <section>
            <h2>Records</h2>
            <div id="records"></div>
        </section>`;
    info = infoBox(el.querySelector('#info'), {
        info: p.info,
        name: p.name,
        noun: 'policy',
        mono: /\b(policy number|number|id)\b/i,
        save: async (newInfo, name) => {
            const updated = { ...p, name, info: newInfo };
            await savePolicies(list.map(x => (x.id === p.id ? updated : x)));
            Object.assign(p, updated);
            onListChanged(p.id);
        },
        remove: async () => {
            if (!confirm(`Remove “${p.name}” from Insurance?\n\nIts records file (${recordsPath(p)}) and documents are kept in your folder.`)) return;
            try {
                await savePolicies(list.filter(x => x.id !== p.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            info = null;
            toast(`Removed “${p.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== p.id)?.id || 'new');
        },
    });
    renderPlaces(el.querySelector('#places'), list, p, STORE);
    renderGallery(el.querySelector('#docs'), documentsDir(p), { noun: 'image' }).catch(err => {
        el.querySelector('#docs').innerHTML = `<div class="banner bad">Couldn't load images: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#records'), {
        columns: RECORD_COLUMNS,
        rows,
        save: rows => saveRecords(p, rows),
    });
}

/** The "＋ Add policy" page. */
export function renderNewPolicy(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a policy</h1>
        <p class="lead">It gets its own page with policy information, contacts, documents and a records table.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required placeholder="e.g. Umbrella, Life, Health"></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add policy</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name')).trim();
        if (!name) return;
        const p = newPolicy(list, name);
        try {
            await savePolicies([...list, p]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(p.id);
    };
}
