// One house's page, in three tabs like a vehicle's: Overview (information, service companies, photos, maintenance
// table), Guides (how-to notes with images) and Notes (a dated log). Also the "Add house" page.
// Service companies, guides, notes and photos use the Vehicles views, saving through house.js STORE.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from '../../../vehicles/js/views/places.js';
import { renderGuides, guidesUnsaved, forgetGuides } from '../../../vehicles/js/views/guides.js';
import { renderNotes, notesUnsaved, forgetNotes } from '../../../vehicles/js/views/notes.js';
import {
    HOUSE_DIR, HOUSE_PATH, STORE, saveHouses, houseAge, photosDir, newHouse, maintenancePath, maintenanceColumns, loadMaintenance, saveMaintenance,
} from '../house.js';

let table = null;
let infoDraft = null; // { json at start, read() } while the information is being edited

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || (!!infoDraft && infoDraft.read() !== infoDraft.start)
    || placesUnsaved() || guidesUnsaved() || notesUnsaved();
export const forget = () => { table = null; infoDraft = null; closeFilterMenu(); releaseGalleries(); forgetPlaces(); forgetGuides(); forgetNotes(); };

/** The tabs under a house's name. */
const tabs = (h, part) => {
    const tab = (sub, label, n) => `<a href="#${esc(h.id)}${sub ? '/' + sub : ''}"${(part || '') === sub ? ' class="active"' : ''}>${label}${n ? ` (${n})` : ''}</a>`;
    return `<nav class="pillnav">${tab('', 'Overview')}${tab('guides', 'Guides', (h.guides || []).length)}${tab('notes', 'Notes', (h.notes || []).length)}</nav>`;
};

/** After the Year Built field: the age today (worked out, not saved). */
const ageItem = f => {
    if (!/built/i.test(f.label) || !f.value) return '';
    const age = houseAge(f.value);
    return age ? `<div class="info-item"><dt>Age</dt><dd>${esc(age)}</dd></div>` : '';
};

/**
 * list: every house (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * part: 'guides' / 'notes' for those tabs, otherwise the Overview.
 */
export async function renderHouse(el, list, h, onListChanged, part) {
    if (part === 'guides') {
        el.innerHTML = `
            <h1 class="page">${esc(h.name)}</h1>
            <p class="lead">Guides are kept in <code>${esc(HOUSE_PATH)}</code>; their images in <code>${esc(HOUSE_DIR)}/guides/${esc(h.id)}/</code>.</p>
            ${tabs(h, part)}
            <section><h2>Guides</h2><div id="guides"><p class="muted">Loading…</p></div></section>`;
        return renderGuides(el.querySelector('#guides'), list, h, null, STORE);
    }
    if (part === 'notes') {
        el.innerHTML = `
            <h1 class="page">${esc(h.name)}</h1>
            <p class="lead">Notes are kept in <code>${esc(HOUSE_PATH)}</code>; their images in <code>${esc(HOUSE_DIR)}/notes/${esc(h.id)}/</code>.</p>
            ${tabs(h, part)}
            <section><h2>Notes</h2><div id="notes"></div></section>`;
        return renderNotes(el.querySelector('#notes'), list, h, STORE);
    }
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadMaintenance(h);
    el.innerHTML = `
        <h1 class="page" id="h-name"></h1>
        <p class="lead">Information in <code>${esc(HOUSE_PATH)}</code>, maintenance in <code>${esc(maintenancePath(h))}</code>.</p>
        ${tabs(h, part)}
        <section>
            <h2>House information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Service companies</h2>
            <div id="places"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>
        <section>
            <h2>Maintenance</h2>
            <div id="maint"></div>
        </section>`;
    const infoEl = el.querySelector('#info');

    const showInfo = () => {
        infoDraft = null;
        el.querySelector('#h-name').textContent = h.name;
        infoEl.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" id="info-edit">✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to change, add or remove information.</span></div>
            <dl class="info-grid">${h.info.map(f => `<div class="info-item${/notes/i.test(f.label) ? ' wide' : ''}">
                <dt>${esc(f.label)}</dt><dd>${f.value ? esc(f.value) : '<span class="muted">—</span>'}</dd></div>${ageItem(f)}`).join('')
                || '<p class="muted">No information yet. Press Edit to add some.</p>'}</dl>`;
        infoEl.querySelector('#info-edit').onclick = editInfo;
    };

    const editInfo = () => {
        infoEl.innerHTML = `
            <div class="row table-tools"><span class="muted edit-hint">Editing — nothing is written until you press Save.</span></div>
            <label class="field info-name">Name (shown in the menu)<input type="text" id="i-name" value="${esc(h.name)}"></label>
            <div class="table-wrap"><table class="info-edit">
                <thead><tr><th>Field</th><th>Value</th><th></th></tr></thead>
                <tbody id="i-rows"></tbody>
            </table></div>
            <div class="row" style="margin-top:14px">
                <button type="button" id="i-add">＋ Add field</button>
                <button type="button" class="danger" id="i-remove">Remove this house</button>
                <span class="spacer"></span>
                <button type="button" id="i-cancel">Cancel</button>
                <button type="button" class="primary" id="i-save">Save</button>
            </div>`;
        const body = infoEl.querySelector('#i-rows');
        const fieldRow = f => `<tr>
            <td><input type="text" data-f="label" value="${esc(f.label)}" aria-label="Field name"></td>
            <td>${/notes/i.test(f.label)
                ? `<textarea data-f="value" rows="2" aria-label="Value">${esc(f.value)}</textarea>`
                : `<input type="text" data-f="value" value="${esc(f.value)}" aria-label="Value">`}</td>
            <td class="remove"><button type="button" class="danger" data-remove title="Remove this field" aria-label="Remove this field">✕</button></td></tr>`;
        body.innerHTML = h.info.map(fieldRow).join('');
        const read = () => JSON.stringify({
            name: infoEl.querySelector('#i-name').value,
            info: [...body.rows].map(tr => ({ label: tr.querySelector('[data-f=label]').value, value: tr.querySelector('[data-f=value]').value })),
        });
        infoDraft = { start: read(), read };

        body.addEventListener('click', e => { if (e.target.closest('[data-remove]')) e.target.closest('tr').remove(); });
        infoEl.querySelector('#i-add').onclick = () => {
            body.insertAdjacentHTML('beforeend', fieldRow({ label: '', value: '' }));
            body.lastElementChild.querySelector('input').focus();
        };
        infoEl.querySelector('#i-cancel').onclick = () => {
            if (infoDraft.read() !== infoDraft.start && !confirm('Discard your changes?')) return;
            showInfo();
        };
        infoEl.querySelector('#i-save').onclick = async () => {
            const draft = JSON.parse(read());
            const name = draft.name.trim();
            if (!name) return toast('Give the house a name, then Save.', 'bad');
            const info = draft.info.map(f => ({ label: f.label.trim(), value: f.value.trim() })).filter(f => f.label || f.value);
            if (info.some(f => !f.label)) return toast('Every value needs a field name — fill it in or remove the row, then Save.', 'bad');
            const updated = { ...h, name, info };
            try {
                await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            Object.assign(h, updated);
            toast('Saved', 'ok');
            infoDraft = null;
            onListChanged(h.id);
        };
        infoEl.querySelector('#i-remove').onclick = async () => {
            if (!confirm(`Remove “${h.name}” from House?\n\nIts maintenance file (${maintenancePath(h)}) is kept in your folder.`)) return;
            try {
                await saveHouses(list.filter(x => x.id !== h.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            infoDraft = null;
            toast(`Removed “${h.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== h.id)?.id || 'new');
        };
    };

    showInfo();
    renderPlaces(el.querySelector('#places'), list, h, STORE);
    renderGallery(el.querySelector('#photos'), photosDir(h), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#maint'), {
        columns: maintenanceColumns(h),
        rows,
        save: rows => saveMaintenance(h, rows),
    });
}

/** The "＋ Add house" page (a second home, a camp, a rental…). */
export function renderNewHouse(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a house</h1>
        <p class="lead">It gets its own page with information, service companies, photos, a maintenance table, guides and notes.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required placeholder="e.g. Camp"></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add house</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name')).trim();
        if (!name) return;
        const h = newHouse(list, name);
        try {
            await saveHouses([...list, h]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(h.id);
    };
}
