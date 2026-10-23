// One Health section (General Health, Dental, Eye, HSA): the shared record table over the section's CSV.
import { esc } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { loadRecords, saveRecords, loadLocations, saveLocations } from '../records.js';

let table = null;

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits();
export const forget = () => { table = null; closeFilterMenu(); };

export async function renderSection(el, section) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, locations] = await Promise.all([loadRecords(section), loadLocations()]);
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <p class="lead">Saved in <code>${esc(section.path)}</code> in your folder.</p>
        <section id="records"></section>`;
    const location = { list: locations, noun: 'location', add: name => saveLocations([...location.list, name]) };
    table = recordTable(el.querySelector('#records'), {
        columns: section.columns,
        rows,
        save: rows => saveRecords(section, rows),
        choices: { Location: location },
    });
}
