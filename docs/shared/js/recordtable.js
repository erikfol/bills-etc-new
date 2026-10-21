// Editable record table shared by the Home-page sections (Health, Vehicles): read-only with Excel-style sort and
// filter on every column until Edit is pressed; then every cell is an input, rows can be added and removed, and
// Save hands the rows back to be written.
import { esc, toast, money } from '../../bills-etc/js/util.js';
import { dataTable, closeFilterMenu } from '../../bills-etc/js/datatable.js';

const NEW_CHOICE = '__new__'; // a choice can't be named this, so it can't clash
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ONGOING = 'ongoing';
let tableCount = 0; // gives each table's suggestion lists their own ids (a page can have more than one table)

/** '2026-10-15' → 'Oct 15, 2026'; anything else (typed into the file by hand) shows as it is. */
export function showDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(v ?? '');
}

const numberOf = v => {
    const s = String(v ?? '').replace(/[$,]/g, '').trim();
    return s === '' ? '' : Number(s);
};

/** Newest first by the date columns; entries without a date go last. */
export const newestFirst = columns => {
    const dates = columns.filter(c => c.kind === 'date' || c.kind === 'end').map(c => c.name);
    return (a, b) => {
        for (const d of dates) {
            const cmp = (b[d] || '').localeCompare(a[d] || '');
            if (cmp) return cmp;
        }
        return 0;
    };
};

/**
 * Render into `container` (which it owns). Options:
 *   columns: [{ name, kind }] — kind: 'date' (YYYY-MM-DD), 'end' (date; blank = ongoing), 'number',
 *            'money' (stored as a plain number, shown as $1,234.56; a Total line sums the rows shown),
 *            'choice' (dropdown, see choices), 'suggest' (free text offering values already used + c.suggestions),
 *            'text' (multi-line)
 *   rows:    [{ [name]: string }]
 *   save:    async rows => void (rows already trimmed and without blank entries)
 *   choices: { [name]: { list: string[], noun: 'location', add: async name => void } } for 'choice' columns
 *            (without add the list is fixed: no "＋ New …" option)
 * Returns { hasUnsavedEdits() }.
 */
export function recordTable(container, { columns: cols, rows: initial, save, choices = {} }) {
    const tableNo = ++tableCount;
    const state = { rows: initial, draft: null, original: null };
    const dlId = c => `dl-${tableNo}-${cols.indexOf(c)}`;
    container.innerHTML = `
        <div class="row table-tools" data-tools></div>
        <div class="record-table" data-read></div>
        <div class="table-wrap" data-edit-wrap hidden><table class="record-table editing"></table></div>
        <div class="row" data-actions style="margin-top:14px" hidden>
            <button type="button" data-add>＋ Add entry</button>
            <span class="spacer"></span>
            <button type="button" data-cancel>Cancel</button>
            <button type="button" class="primary" data-save>Save</button>
        </div>`;
    const tbl = container.querySelector('table');
    const readEl = container.querySelector('[data-read]');
    const editWrap = container.querySelector('[data-edit-wrap]');
    const tools = container.querySelector('[data-tools]');
    const actions = container.querySelector('[data-actions]');
    const hasUnsavedEdits = () => !!state.draft && JSON.stringify(state.draft) !== state.original;

    // Read-only view: Excel-style sort and filter on every column (the Finance Table's menu).
    const column = c => {
        const get = r => r[c.name] ?? '';
        const base = { id: c.name, label: c.name };
        if (c.kind === 'date') return {
            ...base, value: get, text: showDate, tdClass: () => 'date',
            sortLabels: ['Oldest → Newest', 'Newest → Oldest'],
        };
        if (c.kind === 'end') return { // blank = ongoing: its own filter value, sorted after every end date
            ...base, value: r => get(r) || ONGOING,
            text: v => (v === ONGOING ? 'ongoing' : showDate(v)),
            cell: r => (get(r) ? esc(showDate(get(r))) : '<span class="ongoing">ongoing</span>'),
            sortKey: v => (v === ONGOING ? '9999' : v), tdClass: () => 'date',
            sortLabels: ['Oldest → Newest (ongoing last)', 'Ongoing, then Newest → Oldest'],
        };
        if (c.kind === 'number') return { // a value that isn't a number (typed into the file by hand) shows as it is
            ...base, num: true,
            value: r => { const n = numberOf(get(r)); return Number.isNaN(n) ? get(r) : n; },
            text: v => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v)),
        };
        if (c.kind === 'money') return {
            ...base, num: true,
            value: r => { const n = numberOf(get(r)); return Number.isNaN(n) ? get(r) : n; },
            text: v => (typeof v === 'number' ? money(v) : String(v)),
        };
        if (c.kind === 'choice') return {
            ...base, value: get,
            cell: r => (get(r) ? `<span class="cat-badge">${esc(get(r))}</span>` : ''),
        };
        return { ...base, value: get, tdClass: () => 'text' };
    };
    const firstDate = cols.find(c => c.kind === 'date');

    const showRead = () => {
        state.draft = null;
        actions.hidden = true;
        editWrap.hidden = true;
        tbl.innerHTML = '';
        readEl.hidden = false;
        tools.innerHTML = `<button type="button" class="small" data-edit>✎ Edit</button>
            <span class="muted edit-hint">Click a column name to sort, or ▾ to sort and filter. Turn on editing to add, change or remove entries.</span>`;
        tools.querySelector('[data-edit]').onclick = startEdit;
        dataTable(readEl, {
            columns: cols.map(column),
            rows: state.rows,
            sort: firstDate ? { col: firstDate.name, dir: 'desc' } : null,
            empty: state.rows.length ? 'No entries match the filters' : 'No entries yet. Press Edit to add one.',
            footer: cols.some(c => c.kind === 'money') ? totalRow : undefined,
        });
    };

    // Under a table with money columns: their totals over the rows currently shown (so filtering by Action or a year
    // gives what that cost).
    const totalRow = visible => !visible.length ? '' : `<tr class="total-row">${cols.map((c, i) => {
        if (c.kind !== 'money') return `<td>${i === 0 ? `<strong>Total</strong> <span class="muted">(${visible.length} shown)</span>` : ''}</td>`;
        const total = visible.reduce((t, r) => { const n = numberOf(r[c.name]); return t + (typeof n === 'number' && !Number.isNaN(n) ? n : 0); }, 0);
        return `<td class="amt"><strong>${esc(money(total))}</strong></td>`;
    }).join('')}</tr>`;

    const choiceOptions = (c, v) => {
        const all = choices[c.name].list;
        const list = !v || all.includes(v) ? all : [v, ...all];
        return `<option value=""${v ? '' : ' selected'}>—</option>`
            + list.map(l => `<option${l === v ? ' selected' : ''}>${esc(l)}</option>`).join('')
            + (choices[c.name].add ? `<option value="${NEW_CHOICE}">＋ New ${esc(choices[c.name].noun)}…</option>` : '');
    };
    // Values offered by a 'suggest' column: what's been used before, most-used first, then its suggestions.
    const suggestions = c => {
        const counts = new Map();
        for (const r of state.rows) { const v = (r[c.name] || '').trim(); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
        const used = [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
        const seen = new Set(used.map(v => v.toLowerCase()));
        return [...used, ...(c.suggestions || []).filter(v => !seen.has(v.toLowerCase()))];
    };

    const drawEdit = () => {
        const input = (c, i, v) => {
            const attrs = `data-i="${i}" data-k="${esc(c.name)}" aria-label="${esc(c.name)}"`;
            if (c.kind === 'date' || c.kind === 'end') return `<input type="date" ${attrs} value="${esc(v)}">`;
            if (c.kind === 'number' || c.kind === 'money') return `<input type="text" inputmode="decimal" class="num-input" ${attrs} value="${esc(v)}">`;
            if (c.kind === 'choice') return `<select ${attrs}>${choiceOptions(c, v)}</select>`;
            if (c.kind === 'suggest') return `<input type="text" list="${dlId(c)}" ${attrs} value="${esc(v)}">`;
            return `<textarea ${attrs} rows="1">${esc(v)}</textarea>`;
        };
        const lists = cols.filter(c => c.kind === 'suggest').map(c =>
            `<datalist id="${dlId(c)}">${suggestions(c).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`).join('');
        tbl.innerHTML = `<thead><tr>${cols.map(c => `<th>${esc(c.name)}${c.kind === 'end' ? ' <span class="muted">(blank = ongoing)</span>' : ''}</th>`).join('')}<th>${lists}</th></tr></thead>
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
        state.draft = state.rows.map((r, i) => ({ ...r, _from: i })).sort(newestFirst(cols));
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
        if (!t.dataset.k || t.value === NEW_CHOICE) return;
        state.draft[+t.dataset.i][t.dataset.k] = t.value;
        markChanged();
    });
    tbl.addEventListener('change', async e => {
        const t = e.target;
        if (t.value !== NEW_CHOICE) return;
        const r = state.draft[+t.dataset.i], ch = choices[t.dataset.k];
        const name = prompt(`Name of the new ${ch.noun}:`)?.trim();
        if (name) {
            const existing = ch.list.find(l => l.toLowerCase() === name.toLowerCase());
            if (existing) r[t.dataset.k] = existing;
            else {
                try {
                    await ch.add(name);
                    ch.list = [...ch.list, name];
                    r[t.dataset.k] = name;
                    toast(`Added ${ch.noun} “${name}”`, 'ok');
                } catch (err) { toast(err.message, 'bad'); }
            }
        }
        // Offer the new choice in every dropdown of that column.
        tbl.querySelectorAll(`select[data-k="${CSS.escape(t.dataset.k)}"]`).forEach(sel => {
            sel.innerHTML = choiceOptions(cols.find(c => c.name === t.dataset.k), state.draft[+sel.dataset.i][t.dataset.k]);
        });
        markChanged();
    });
    tbl.addEventListener('click', e => {
        const b = e.target.closest('[data-remove]');
        if (!b) return;
        state.draft.splice(+b.dataset.remove, 1);
        drawEdit();
    });

    container.querySelector('[data-add]').onclick = () => {
        state.draft.unshift({ ...Object.fromEntries(cols.map(c => [c.name, ''])), _from: null });
        drawEdit();
        tbl.querySelector('[data-k]')?.focus();
    };
    container.querySelector('[data-cancel]').onclick = () => {
        if (hasUnsavedEdits() && !confirm('Discard your changes?')) return;
        showRead();
    };
    container.querySelector('[data-save]').onclick = async () => {
        const blank = r => cols.every(c => !String(r[c.name]).trim());
        const rows = state.draft.filter(r => !blank(r)).map(r => Object.fromEntries(cols.map(c => [c.name, String(r[c.name]).trim()])));
        const label = r => `“${r.Description || r.Action || 'An entry'}”`;
        const start = firstDate?.name, end = cols.find(c => c.kind === 'end')?.name;
        const backwards = end && rows.find(r => r[start] && r[end] && r[end] < r[start]);
        if (backwards) return toast(`${label(backwards)} ends before it starts — fix the dates, then Save.`, 'bad');
        for (const c of cols.filter(c => c.kind === 'number' || c.kind === 'money')) {
            const bad = rows.find(r => Number.isNaN(numberOf(r[c.name])));
            if (bad) return toast(`${label(bad)}: ${c.name} “${bad[c.name]}” isn't a number — fix it, then Save.`, 'bad');
            for (const r of rows) r[c.name] = String(numberOf(r[c.name])); // '52,340' is stored as 52340, '$1,250' as 1250
        }
        const btn = container.querySelector('[data-save]');
        btn.disabled = true;
        try {
            await save(rows);
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
    return { hasUnsavedEdits };
}

export { closeFilterMenu };
