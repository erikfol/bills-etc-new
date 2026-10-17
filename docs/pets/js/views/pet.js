// One pet's page (information + records table), and the "Add pet" page. The information box works like Vehicles'.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { PETS_PATH, ageText, savePets, newPet, recordsPath, photosDir, RECORD_COLUMNS, loadRecords, saveRecords } from '../pets.js';

let table = null;
let infoDraft = null; // { json at start, read() } while the information is being edited

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || (!!infoDraft && infoDraft.read() !== infoDraft.start);
export const forget = () => { table = null; infoDraft = null; closeFilterMenu(); releaseGalleries(); };

/** After the Birthday field: the age today (worked out, not saved). */
const ageItem = f => {
    if (!/birth/i.test(f.label) || !f.value) return '';
    const age = ageText(f.value);
    return `<div class="info-item"><dt>Age</dt><dd>${age ? esc(age)
        : '<span class="muted">Can’t read the birthday — type it like 3/5/2018, Mar 5 2018 or March 2018</span>'}</dd></div>`;
};

/** list: every pet (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo. */
export async function renderPet(el, list, p, onListChanged) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadRecords(p);
    el.innerHTML = `
        <h1 class="page" id="p-name"></h1>
        <p class="lead">Information in <code>${esc(PETS_PATH)}</code>, records in <code>${esc(recordsPath(p))}</code>.</p>
        <section>
            <h2>General information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>
        <section>
            <h2>Records</h2>
            <div id="records"></div>
        </section>`;
    const infoEl = el.querySelector('#info');

    const showInfo = () => {
        infoDraft = null;
        el.querySelector('#p-name').textContent = p.name;
        infoEl.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" id="info-edit">✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to change, add or remove information.</span></div>
            <dl class="info-grid">${p.info.map(f => `<div class="info-item${/notes/i.test(f.label) ? ' wide' : ''}">
                <dt>${esc(f.label)}</dt><dd${/\b(microchip|serial|license)\b/i.test(f.label) ? ' class="mono"' : ''}>${f.value ? esc(f.value) : '<span class="muted">—</span>'}</dd></div>${ageItem(f)}`).join('')
                || '<p class="muted">No information yet. Press Edit to add some.</p>'}</dl>`;
        infoEl.querySelector('#info-edit').onclick = editInfo;
    };

    const editInfo = () => {
        infoEl.innerHTML = `
            <div class="row table-tools"><span class="muted edit-hint">Editing — nothing is written until you press Save.</span></div>
            <label class="field info-name">Name (shown in the menu)<input type="text" id="i-name" value="${esc(p.name)}"></label>
            <div class="table-wrap"><table class="info-edit">
                <thead><tr><th>Field</th><th>Value</th><th></th></tr></thead>
                <tbody id="i-rows"></tbody>
            </table></div>
            <div class="row" style="margin-top:14px">
                <button type="button" id="i-add">＋ Add field</button>
                <button type="button" class="danger" id="i-remove">Remove this pet</button>
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
        body.innerHTML = p.info.map(fieldRow).join('');
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
            if (!name) return toast('Give the pet a name, then Save.', 'bad');
            const info = draft.info.map(f => ({ label: f.label.trim(), value: f.value.trim() })).filter(f => f.label || f.value);
            if (info.some(f => !f.label)) return toast('Every value needs a field name — fill it in or remove the row, then Save.', 'bad');
            const updated = { ...p, name, info };
            try {
                await savePets(list.map(x => (x.id === p.id ? updated : x)));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            Object.assign(p, updated);
            toast('Saved', 'ok');
            infoDraft = null;
            onListChanged(p.id);
        };
        infoEl.querySelector('#i-remove').onclick = async () => {
            if (!confirm(`Remove “${p.name}” from Pets?\n\nIts records file (${recordsPath(p)}) is kept in your folder.`)) return;
            try {
                await savePets(list.filter(x => x.id !== p.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            infoDraft = null;
            toast(`Removed “${p.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== p.id)?.id || 'new');
        };
    };

    showInfo();
    renderGallery(el.querySelector('#photos'), photosDir(p), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#records'), {
        columns: RECORD_COLUMNS,
        rows,
        save: rows => saveRecords(p, rows),
    });
}

/** The "＋ Add pet" page. */
export function renderNewPet(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a pet</h1>
        <p class="lead">It gets its own page with general information, photos and a records table.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add pet</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name')).trim();
        if (!name) return;
        const p = newPet(list, name);
        try {
            await savePets([...list, p]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(p.id);
    };
}
