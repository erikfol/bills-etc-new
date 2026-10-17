// One pet's page (Jackie, Castle, Kona, Cosmo, Peaches): the shared record table over the pet's CSV.
import { esc } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { loadRecords, saveRecords, loadTypes, saveTypes } from '../records.js';

let table = null;

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits();
export const forget = () => { table = null; closeFilterMenu(); };

export async function renderSection(el, section) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, types] = await Promise.all([loadRecords(section), loadTypes()]);
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <p class="lead">Saved in <code>${esc(section.path)}</code> in your folder.</p>
        <section id="records"></section>`;
    const type = { list: types, noun: 'type', add: name => saveTypes([...type.list, name]) };
    table = recordTable(el.querySelector('#records'), {
        columns: section.columns,
        rows,
        save: rows => saveRecords(section, rows),
        choices: { Type: type },
    });
}
