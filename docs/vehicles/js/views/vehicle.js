// One vehicle's page, in two tabs: Overview (information, service places, photos, maintenance table) and Guides
// (long how-to notes with reference images). Also the "Add vehicle" page.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { renderGallery, releaseGalleries } from './gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from './places.js';
import { renderGuides, guidesUnsaved, forgetGuides } from './guides.js';
import {
    TYPES, VEHICLES_PATH, saveVehicles, photosDir, newVehicle, maintenancePath, maintenanceColumns, loadMaintenance, saveMaintenance,
} from '../vehicles.js';

let table = null;
let infoDraft = null; // { json at start, read() } while the information is being edited

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || (!!infoDraft && infoDraft.read() !== infoDraft.start)
    || placesUnsaved() || guidesUnsaved();
export const forget = () => { table = null; infoDraft = null; closeFilterMenu(); releaseGalleries(); forgetPlaces(); forgetGuides(); };

/** The tabs under a vehicle's name. */
const tabs = (v, part) => {
    const n = (v.guides || []).length;
    return `<nav class="pillnav">
        <a href="#${esc(v.id)}"${part === 'guides' ? '' : ' class="active"'}>Overview</a>
        <a href="#${esc(v.id)}/guides"${part === 'guides' ? ' class="active"' : ''}>Guides${n ? ` (${n})` : ''}</a>
    </nav>`;
};

/**
 * list: every vehicle (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * part: 'guides' for the Guides tab, otherwise the Overview.
 */
export async function renderVehicle(el, list, v, onListChanged, part) {
    if (part === 'guides') {
        el.innerHTML = `
            <h1 class="page">${esc(v.name)}</h1>
            <p class="lead">Guides are kept in <code>${esc(VEHICLES_PATH)}</code>; their images in <code>inputs/vehicles/guides/${esc(v.id)}/</code>.</p>
            ${tabs(v, part)}
            <section><h2>Guides</h2><div id="guides"><p class="muted">Loading…</p></div></section>`;
        return renderGuides(el.querySelector('#guides'), list, v);
    }
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadMaintenance(v);
    el.innerHTML = `
        <h1 class="page" id="v-name"></h1>
        <p class="lead">${esc(TYPES[v.type]?.label || 'Vehicle')} · information in <code>${esc(VEHICLES_PATH)}</code>,
            maintenance in <code>${esc(maintenancePath(v))}</code>.</p>
        ${tabs(v, part)}
        <section>
            <h2>Vehicle information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Service places</h2>
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
        el.querySelector('#v-name').textContent = v.name;
        infoEl.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" id="info-edit">✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to change, add or remove information.</span></div>
            <dl class="info-grid">${v.info.map(f => `<div class="info-item${/notes/i.test(f.label) ? ' wide' : ''}">
                <dt>${esc(f.label)}</dt><dd${/\b(vin|hin|serial|bow number|license plate)\b/i.test(f.label) ? ' class="mono"' : ''}>${f.value ? esc(f.value) : '<span class="muted">—</span>'}</dd></div>`).join('')
                || '<p class="muted">No information yet. Press Edit to add some.</p>'}</dl>`;
        infoEl.querySelector('#info-edit').onclick = editInfo;
    };

    const editInfo = () => {
        infoEl.innerHTML = `
            <div class="row table-tools"><span class="muted edit-hint">Editing — nothing is written until you press Save.</span></div>
            <label class="field info-name">Name (shown in the menu)<input type="text" id="i-name" value="${esc(v.name)}"></label>
            <div class="table-wrap"><table class="info-edit">
                <thead><tr><th>Field</th><th>Value</th><th></th></tr></thead>
                <tbody id="i-rows"></tbody>
            </table></div>
            <div class="row" style="margin-top:14px">
                <button type="button" id="i-add">＋ Add field</button>
                <button type="button" class="danger" id="i-remove">Remove this vehicle</button>
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
        body.innerHTML = v.info.map(fieldRow).join('');
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
            if (!name) return toast('Give the vehicle a name, then Save.', 'bad');
            const info = draft.info.map(f => ({ label: f.label.trim(), value: f.value.trim() })).filter(f => f.label || f.value);
            if (info.some(f => !f.label)) return toast('Every value needs a field name — fill it in or remove the row, then Save.', 'bad');
            const updated = { ...v, name, info };
            try {
                await saveVehicles(list.map(x => (x.id === v.id ? updated : x)));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            Object.assign(v, updated);
            toast('Saved', 'ok');
            infoDraft = null;
            onListChanged(v.id);
        };
        infoEl.querySelector('#i-remove').onclick = async () => {
            if (!confirm(`Remove “${v.name}” from Vehicles?\n\nIts maintenance file (${maintenancePath(v)}) is kept in your folder.`)) return;
            try {
                await saveVehicles(list.filter(x => x.id !== v.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            infoDraft = null;
            toast(`Removed “${v.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== v.id)?.id || 'new');
        };
    };

    showInfo();
    renderPlaces(el.querySelector('#places'), list, v);
    renderGallery(el.querySelector('#photos'), photosDir(v), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#maint'), {
        columns: maintenanceColumns(v),
        rows,
        save: rows => saveMaintenance(v, rows),
    });
}

/** The "＋ Add vehicle" page. */
export function renderNewVehicle(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a vehicle</h1>
        <p class="lead">It gets its own page with an information section and a maintenance table.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required placeholder="e.g. 2015 Toyota Tacoma"></label>
                <label class="field">Type<select name="type">${Object.entries(TYPES).map(([k, t]) =>
                    `<option value="${k}">${esc(t.label)} — tracks ${esc(t.meter.toLowerCase())}</option>`).join('')}</select></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add vehicle</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const form = new FormData(e.target);
        const name = String(form.get('name')).trim();
        if (!name) return;
        const v = newVehicle(list, name, String(form.get('type')));
        try {
            await saveVehicles([...list, v]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(v.id);
    };
}
