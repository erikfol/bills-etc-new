import { PATHS, readTable, writeTable } from '../data.js';
import { parseDate, yearMonth, monthLabel } from '../dates.js';
import { ALLOWED_CATEGORIES } from '../rules.js';
import { esc, money, amountOf, toast } from '../util.js';
import { openFilterMenu, closeFilterMenu } from '../filtermenu.js';
import { requireFolder } from '../app.js';

const MAX_ROWS = 400;
const FILES = {
    processed: { path: PATHS.processed, label: 'Current month (processed_current_month.csv)' },
    master: { path: PATHS.master, label: 'Master history (all_time_finances.csv)' },
};

const text = v => String(v ?? '').trim();
const fmtAmount = v => { const a = amountOf(v); return Number.isFinite(a) ? money(a, a > 0) : text(v); };
const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

// Column definitions: `value` is what filters match on, `sortKey` orders rows and checklist values.
const COLUMNS = [
    { id: 'date', label: 'Date', value: r => text(r.Date), sortKey: v => parseDate(v)?.getTime() ?? -Infinity, sortLabels: ['Oldest → Newest', 'Newest → Oldest'] },
    { id: 'desc', label: 'Description', value: r => text(r.Description) },
    { id: 'amount', label: 'Amount', num: true, value: r => text(r.Amount), sortKey: v => { const a = amountOf(v); return Number.isFinite(a) ? a : -Infinity; }, display: fmtAmount, sortLabels: ['Smallest → Largest', 'Largest → Smallest'] },
    { id: 'merchant', label: 'Merchant', value: r => text(r['Cleaned Merchant']) },
    { id: 'cat', label: 'Category', value: r => text(r['AI Category']) },
    { id: 'notes', label: 'Notes', value: r => text(r.Notes) },
];
const COL = Object.fromEntries(COLUMNS.map(c => [c.id, c]));

function compare(col, a, b) {
    if (col.sortKey) { const x = col.sortKey(a), y = col.sortKey(b); return x < y ? -1 : x > y ? 1 : 0; }
    // Blanks sort last, like Excel.
    if (!a || !b) return !a && !b ? 0 : !a ? 1 : -1;
    return byText(a, b);
}

let state = null; // { file, table, yms, dirty: Set<rowIndex>, filters: Map<colId, Set>, sort: {col, dir} }

function catOptions(value) {
    const cats = ALLOWED_CATEGORIES.includes(value) ? ALLOWED_CATEGORIES : [value ?? '', ...ALLOWED_CATEGORIES];
    return cats.map(c => `<option${c === value ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

export default {
    async render(el, file = state?.file || 'processed') {
        if (!requireFolder(el)) return;
        el.innerHTML = `
            <div class="row" style="margin-bottom:6px">
                <h1 class="page">Edit Categories</h1>
                <span class="spacer"></span>
                <select id="file">${Object.entries(FILES).map(([k, f]) => `<option value="${k}"${k === file ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
            </div>
            <p class="lead">Fix categories, merchant names and notes, then save. Use the ▾ on each column to sort or filter, like Excel. Edits in the current month are kept when you re-run step 3.</p>
            <div id="body"><p class="muted">Loading…</p></div>`;

        el.querySelector('#file').onchange = e => {
            if (!this.canLeave()) { e.target.value = state.file; return; }
            state = null;
            this.render(el, e.target.value);
        };

        const body = el.querySelector('#body');
        const table = await readTable(FILES[file].path);
        if (!table) {
            body.innerHTML = `<div class="banner">${esc(FILES[file].path)} doesn't exist yet. ${file === 'processed' ? 'Run step 3' : 'Run step 1'} on the <a href="#workflow">Workflow</a> page.</div>`;
            state = null;
            return;
        }
        for (const c of ['Cleaned Merchant', 'AI Category', 'Notes']) if (!table.columns.includes(c)) table.columns.push(c);
        const yms = table.rows.map(r => { const d = parseDate(r.Date); return d ? yearMonth(d) : ''; });
        state = { file, table, yms, dirty: new Set(), filters: new Map(), sort: { col: 'date', dir: 'asc' } };
        const months = [...new Set(yms.filter(Boolean))].sort();

        body.innerHTML = `
            <section>
                <div class="row" style="margin-bottom:12px">
                    <label class="check">Month: <select id="f-month"><option value="">All</option>${months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('')}</select></label>
                    <input type="search" id="f-q" placeholder="Search all columns" style="min-width:220px">
                    <button class="small" id="clear-filters" hidden>Clear all filters</button>
                    <span class="spacer"></span>
                    <span id="dirty" class="muted" style="font-size:0.85em"></span>
                    <button id="revert" disabled>Discard</button>
                    <button class="primary" id="save" disabled>Save</button>
                </div>
                <div id="count" class="muted" style="font-size:0.85em;margin-bottom:8px"></div>
                <div class="table-wrap"><table class="filter-table">
                    <thead><tr>${COLUMNS.map(c => `
                        <th data-col="${c.id}"${c.num ? ' class="num"' : ''}>
                            <span class="th-inner"><span class="th-label" title="Click to sort">${c.label}<span class="sort-ind"></span></span><button class="fbtn" aria-label="Sort and filter ${c.label}" title="Sort and filter">▾</button></span>
                        </th>`).join('')}</tr></thead>
                    <tbody id="rows"></tbody>
                </table></div>
            </section>`;

        const fMonth = body.querySelector('#f-month'), fQ = body.querySelector('#f-q');
        // The master is long; start on its latest month.
        if (file === 'master' && months.length) fMonth.value = months.at(-1);

        const updateDirty = () => {
            const n = state.dirty.size;
            body.querySelector('#dirty').textContent = n ? `${n} unsaved row${n === 1 ? '' : 's'}` : '';
            body.querySelector('#save').disabled = !n;
            body.querySelector('#revert').disabled = !n;
        };

        /** Row indexes passing the month, search and every column filter except `skipCol`. */
        const matching = (skipCol = null) => {
            const q = fQ.value.trim().toLowerCase();
            const out = [];
            table.rows.forEach((r, i) => {
                if (fMonth.value && yms[i] !== fMonth.value) return;
                if (q && !COLUMNS.some(c => c.value(r).toLowerCase().includes(q) || (c.display && c.display(c.value(r)).toLowerCase().includes(q)))) return;
                for (const [id, allowed] of state.filters) {
                    if (id !== skipCol && !allowed.has(COL[id].value(r))) return;
                }
                out.push(i);
            });
            return out;
        };

        const drawHeaders = () => {
            body.querySelectorAll('th[data-col]').forEach(th => {
                const id = th.dataset.col;
                th.classList.toggle('filtered', state.filters.has(id));
                th.querySelector('.sort-ind').textContent = state.sort.col === id ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
            });
            body.querySelector('#clear-filters').hidden = !state.filters.size;
        };

        const draw = () => {
            const idx = matching();
            const col = COL[state.sort.col], sign = state.sort.dir === 'asc' ? 1 : -1;
            idx.sort((a, b) => sign * compare(col, col.value(table.rows[a]), col.value(table.rows[b])) || a - b);
            const shown = idx.slice(0, MAX_ROWS);
            const filtered = state.filters.size || fQ.value.trim() || fMonth.value;
            body.querySelector('#count').textContent = (idx.length > MAX_ROWS
                ? `Showing ${MAX_ROWS} of ${idx.length} rows. Narrow the filters to see the rest.`
                : `${idx.length} row${idx.length === 1 ? '' : 's'}`) + (filtered ? ` (of ${table.rows.length} total)` : '');
            body.querySelector('#rows').innerHTML = shown.map(i => {
                const r = table.rows[i];
                const a = amountOf(r.Amount);
                return `<tr data-i="${i}"${state.dirty.has(i) ? ' class="dirty"' : ''}>
                    <td style="white-space:nowrap">${esc(r.Date)}</td>
                    <td class="desc-cell">${esc(r.Description)}</td>
                    <td class="${a > 0 ? 'income-amt' : 'expense-amt'}">${esc(fmtAmount(r.Amount))}</td>
                    <td class="edit-cell"><input type="text" data-col="Cleaned Merchant" value="${esc(r['Cleaned Merchant'])}"></td>
                    <td class="edit-cell"><select data-col="AI Category">${catOptions(r['AI Category'])}</select></td>
                    <td class="edit-cell"><input type="text" data-col="Notes" value="${esc(r.Notes)}" placeholder="—"></td>
                </tr>`;
            }).join('');
            drawHeaders();
        };

        const setSort = (id, dir) => { state.sort = { col: id, dir }; draw(); };

        body.querySelectorAll('th[data-col]').forEach(th => {
            const id = th.dataset.col, col = COL[id];
            th.querySelector('.th-label').onclick = () =>
                setSort(id, state.sort.col === id && state.sort.dir === 'asc' ? 'desc' : 'asc');
            th.querySelector('.fbtn').onclick = e => {
                // Checklist shows values still possible under the other columns' filters (Excel behaviour).
                const counts = new Map();
                for (const i of matching(id)) {
                    const v = col.value(table.rows[i]);
                    counts.set(v, (counts.get(v) || 0) + 1);
                }
                const values = [...counts.keys()].sort((a, b) => compare(col, a, b)).map(v => ({
                    key: v, count: counts.get(v),
                    label: v === '' ? '(Blanks)' : col.display ? col.display(v) : v,
                }));
                openFilterMenu({
                    anchor: e.currentTarget, values,
                    selected: state.filters.get(id) || null,
                    sortLabels: col.sortLabels || ['A → Z', 'Z → A'],
                    onSort: dir => setSort(id, dir),
                    onApply: set => { set ? state.filters.set(id, set) : state.filters.delete(id); draw(); },
                });
            };
        });

        const onEdit = e => {
            const col = e.target.dataset.col;
            if (!col) return;
            const tr = e.target.closest('tr');
            const i = +tr.dataset.i;
            table.rows[i][col] = e.target.value;
            state.dirty.add(i);
            tr.classList.add('dirty');
            updateDirty();
        };
        const tbody = body.querySelector('#rows');
        tbody.addEventListener('input', onEdit);
        tbody.addEventListener('change', onEdit);

        fMonth.onchange = draw;
        fQ.oninput = draw;
        body.querySelector('#clear-filters').onclick = () => { state.filters.clear(); fQ.value = ''; draw(); };

        body.querySelector('#save').onclick = async () => {
            try {
                await writeTable(FILES[file].path, table);
                state.dirty.clear();
                updateDirty();
                draw();
                toast(`Saved ${FILES[file].path}`, 'ok');
            } catch (e) {
                toast(`Save failed: ${e.message}. Is the file open in Excel?`, 'bad');
            }
        };
        body.querySelector('#revert').onclick = () => {
            if (!confirm('Discard unsaved changes?')) return;
            state.dirty.clear();
            this.render(el, file);
        };

        updateDirty();
        draw();
    },

    canLeave(unloading) {
        if (!state?.dirty.size) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved category edits. Leave without saving?')) return false;
        state.dirty.clear();
        return true;
    },

    destroy() {
        closeFilterMenu();
    },
};
