// One Health section (General Health, Dental, Eye): a table that's read-only until Edit is pressed.
// While editing, every cell is an input; rows can be added and removed; Save writes the section's CSV.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { dataTable, closeFilterMenu } from '../../../bills-etc/js/datatable.js';
import { loadRecords, saveRecords, newestFirst, loadLocations, saveLocations } from '../records.js';

const NEW_LOCATION = '__new__'; // a location can't be named this, so it can't clash
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-15' → 'Oct 15, 2026'; anything else (typed into the file by hand) shows as it is. */
function showDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : esc(v);
}

let state = null; // { section, rows, draft, original } — draft is set while editing

export const hasUnsavedEdits = () => !!state?.draft && JSON.stringify(state.draft) !== state.original;
export const forget = () => { state = null; closeFilterMenu(); };

export async function renderSection(el, section) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, locations] = await Promise.all([loadRecords(section), loadLocations()]);
    state = { section, rows, locations, draft: null, original: null };
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <p class="lead">Saved in <code>${esc(section.path)}</code> in your folder.</p>
        <section>
            <div class="row table-tools" id="tools"></div>
            <div id="read" class="record-table"></div>
            <div class="table-wrap" id="edit-wrap" hidden><table class="record-table editing" id="tbl"></table></div>
            <div class="row" id="edit-actions" style="margin-top:14px" hidden>
                <button type="button" id="add">＋ Add entry</button>
                <span class="spacer"></span>
                <button type="button" id="cancel">Cancel</button>
                <button type="button" class="primary" id="save">Save</button>
            </div>
        </section>`;
    const tbl = el.querySelector('#tbl');
    const readEl = el.querySelector('#read');
    const editWrap = el.querySelector('#edit-wrap');
    const tools = el.querySelector('#tools');
    const actions = el.querySelector('#edit-actions');
    const cols = section.columns;

    // Read-only view: Excel-style sort and filter on every column (the Finance Table's menu).
    const ONGOING = 'ongoing';
    const column = c => {
        const get = r => r[c.name] ?? '';
        if (c.kind === 'date') return {
            id: c.name, label: c.name, value: get, text: showDate, tdClass: () => 'date',
            sortLabels: ['Oldest → Newest', 'Newest → Oldest'],
        };
        if (c.kind === 'end') return { // blank = ongoing: its own filter value, sorted after every end date
            id: c.name, label: c.name, value: r => get(r) || ONGOING,
            text: v => (v === ONGOING ? 'ongoing' : showDate(v)),
            cell: r => (get(r) ? showDate(get(r)) : '<span class="ongoing">ongoing</span>'),
            sortKey: v => (v === ONGOING ? '9999' : v), tdClass: () => 'date',
            sortLabels: ['Oldest → Newest (ongoing last)', 'Ongoing, then Newest → Oldest'],
        };
        if (c.kind === 'location') return {
            id: c.name, label: c.name, value: get,
            cell: r => (get(r) ? `<span class="cat-badge">${esc(get(r))}</span>` : ''),
        };
        return { id: c.name, label: c.name, value: get, tdClass: () => 'text' };
    };
    const firstDate = cols.find(c => c.kind === 'date');

    const showRead = () => {
        state.draft = null;
        actions.hidden = true;
        editWrap.hidden = true;
        tbl.innerHTML = '';
        readEl.hidden = false;
        tools.innerHTML = `<button type="button" class="small" id="edit">✎ Edit</button>
            <span class="muted edit-hint">Click a column name to sort, or ▾ to sort and filter. Turn on editing to add, change or remove entries.</span>`;
        tools.querySelector('#edit').onclick = startEdit;
        dataTable(readEl, {
            columns: cols.map(column),
            rows: state.rows,
            sort: firstDate ? { col: firstDate.name, dir: 'desc' } : null,
            empty: state.rows.length ? 'No entries match the filters' : 'No entries yet. Press Edit to add one.',
        });
    };

    const locationOptions = v => {
        const list = !v || state.locations.includes(v) ? state.locations : [v, ...state.locations];
        return `<option value=""${v ? '' : ' selected'}>—</option>`
            + list.map(l => `<option${l === v ? ' selected' : ''}>${esc(l)}</option>`).join('')
            + `<option value="${NEW_LOCATION}">＋ New location…</option>`;
    };

    const drawEdit = () => {
        const input = (c, i, v) => {
            const attrs = `data-i="${i}" data-k="${esc(c.name)}" aria-label="${esc(c.name)}"`;
            if (c.kind === 'date' || c.kind === 'end') return `<input type="date" ${attrs} value="${esc(v)}">`;
            if (c.kind === 'location') return `<select ${attrs}>${locationOptions(v)}</select>`;
            return `<textarea ${attrs} rows="1">${esc(v)}</textarea>`;
        };
        tbl.innerHTML = `<thead><tr>${cols.map(c => `<th>${esc(c.name)}${c.kind === 'end' ? ' <span class="muted">(blank = ongoing)</span>' : ''}</th>`).join('')}<th></th></tr></thead>
            <tbody>${state.draft.map((r, i) => `<tr>${cols.map(c => `<td>${input(c, i, r[c.name])}</td>`).join('')}
                <td class="remove"><button type="button" class="danger" data-remove="${i}" title="Remove this entry" aria-label="Remove this entry">✕</button></td></tr>`).join('')
                || `<tr><td colspan="${cols.length + 1}" class="muted">No entries. Press ＋ Add entry.</td></tr>`}</tbody>`;
        markChanged();
    };

    // Highlight cells that differ from what's saved (new rows count as changed).
    const markChanged = () => {
        tbl.querySelectorAll('[data-k]').forEach(inp => {
            const r = state.draft[+inp.dataset.i];
            const was = r._from == null ? '' : state.rows[r._from][inp.dataset.k];
            inp.classList.toggle('changed', r._from == null ? inp.value !== '' : inp.value !== was);
        });
    };

    function startEdit() {
        state.draft = [...state.rows].map((r, i) => ({ ...r, _from: i })).sort(newestFirst(section));
        state.original = JSON.stringify(state.draft);
        closeFilterMenu();
        readEl.hidden = true;
        readEl.innerHTML = '';
        editWrap.hidden = false;
        tools.innerHTML = `<span class="muted edit-hint">Editing — changed cells are highlighted. Nothing is written until you press Save.</span>`;
        actions.hidden = false;
        drawEdit();
    }

    tbl.addEventListener('input', e => {
        const t = e.target;
        if (!t.dataset.k || t.value === NEW_LOCATION) return;
        state.draft[+t.dataset.i][t.dataset.k] = t.value;
        markChanged();
    });
    tbl.addEventListener('change', async e => {
        const t = e.target;
        if (t.value !== NEW_LOCATION) return;
        const r = state.draft[+t.dataset.i];
        const name = prompt('Name of the new location:')?.trim();
        if (name) {
            const existing = state.locations.find(l => l.toLowerCase() === name.toLowerCase());
            if (existing) r.Location = existing;
            else {
                try {
                    await saveLocations([...state.locations, name]);
                    state.locations = [...state.locations, name];
                    r.Location = name;
                    toast(`Added location “${name}”`, 'ok');
                } catch (err) { toast(err.message, 'bad'); }
            }
        }
        // Offer the new location in every dropdown.
        tbl.querySelectorAll('select[data-k]').forEach(sel => { sel.innerHTML = locationOptions(state.draft[+sel.dataset.i][sel.dataset.k]); });
        markChanged();
    });
    tbl.addEventListener('click', e => {
        const b = e.target.closest('[data-remove]');
        if (!b) return;
        state.draft.splice(+b.dataset.remove, 1);
        drawEdit();
    });

    el.querySelector('#add').onclick = () => {
        state.draft.unshift({ ...Object.fromEntries(cols.map(c => [c.name, ''])), _from: null });
        drawEdit();
        tbl.querySelector('[data-k]')?.focus();
    };
    el.querySelector('#cancel').onclick = () => {
        if (hasUnsavedEdits() && !confirm('Discard your changes?')) return;
        showRead();
    };
    el.querySelector('#save').onclick = async () => {
        const blank = r => cols.every(c => !String(r[c.name]).trim());
        const rows = state.draft.filter(r => !blank(r)).map(r => Object.fromEntries(cols.map(c => [c.name, String(r[c.name]).trim()])));
        const start = cols.find(c => c.kind === 'date')?.name, end = cols.find(c => c.kind === 'end')?.name;
        const backwards = end && rows.find(r => r[start] && r[end] && r[end] < r[start]);
        if (backwards) {
            toast(`“${backwards.Description || 'An entry'}” ends before it starts — fix the dates, then Save.`, 'bad');
            return;
        }
        const btn = el.querySelector('#save');
        btn.disabled = true;
        try {
            await saveRecords(section, rows);
            state.rows = rows;
            toast('Saved', 'ok');
            showRead();
        } catch (err) {
            toast(`Couldn't save: ${err.message}`, 'bad');
        } finally {
            btn.disabled = false;
        }
    };

    showRead();
}
