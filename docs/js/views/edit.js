import { PATHS, readTable, writeTable } from '../data.js';
import { parseDate, yearMonth, monthLabel } from '../dates.js';
import { ALLOWED_CATEGORIES } from '../rules.js';
import { esc, money, amountOf, toast } from '../util.js';
import { requireFolder } from '../app.js';

const MAX_ROWS = 400;
const FILES = {
    processed: { path: PATHS.processed, label: 'Current month (processed_current_month.csv)' },
    master: { path: PATHS.master, label: 'Master history (all_time_finances.csv)' },
};

let state = null; // { file, table, ym: [] per row, dirty: Set<rowIndex> }

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
            <p class="lead">Fix categories, merchant names and notes, then save. Edits in the current month are kept when you re-run step 3.</p>
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
        state = { file, table, yms, dirty: new Set() };
        const months = [...new Set(yms.filter(Boolean))].sort();

        body.innerHTML = `
            <section>
                <div class="row" style="margin-bottom:12px">
                    <label class="check">Month: <select id="f-month"><option value="">All</option>${months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('')}</select></label>
                    <label class="check">Category: <select id="f-cat"><option value="">All</option>${ALLOWED_CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
                    <input type="search" id="f-q" placeholder="Search description / merchant" style="min-width:220px">
                    <span class="spacer"></span>
                    <span id="dirty" class="muted" style="font-size:0.85em"></span>
                    <button id="revert" disabled>Discard</button>
                    <button class="primary" id="save" disabled>Save</button>
                </div>
                <div id="count" class="muted" style="font-size:0.85em;margin-bottom:8px"></div>
                <div class="table-wrap"><table>
                    <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Merchant</th><th>Category</th><th>Notes</th></tr></thead>
                    <tbody id="rows"></tbody>
                </table></div>
            </section>`;

        const fMonth = body.querySelector('#f-month'), fCat = body.querySelector('#f-cat'), fQ = body.querySelector('#f-q');
        // The master is long; start on its latest month.
        if (file === 'master' && months.length) fMonth.value = months.at(-1);

        const updateDirty = () => {
            const n = state.dirty.size;
            body.querySelector('#dirty').textContent = n ? `${n} unsaved row${n === 1 ? '' : 's'}` : '';
            body.querySelector('#save').disabled = !n;
            body.querySelector('#revert').disabled = !n;
        };

        const draw = () => {
            const q = fQ.value.trim().toLowerCase();
            const idx = [];
            table.rows.forEach((r, i) => {
                if (fMonth.value && yms[i] !== fMonth.value) return;
                if (fCat.value && r['AI Category'] !== fCat.value) return;
                if (q && !`${r.Description} ${r['Cleaned Merchant']} ${r.Notes}`.toLowerCase().includes(q)) return;
                idx.push(i);
            });
            idx.sort((a, b) => (parseDate(table.rows[a].Date)?.getTime() ?? 0) - (parseDate(table.rows[b].Date)?.getTime() ?? 0));
            const shown = idx.slice(0, MAX_ROWS);
            body.querySelector('#count').textContent = idx.length > MAX_ROWS
                ? `Showing ${MAX_ROWS} of ${idx.length} rows. Narrow the filters to see the rest.`
                : `${idx.length} row${idx.length === 1 ? '' : 's'}`;
            body.querySelector('#rows').innerHTML = shown.map(i => {
                const r = table.rows[i];
                const a = amountOf(r.Amount);
                return `<tr data-i="${i}"${state.dirty.has(i) ? ' class="dirty"' : ''}>
                    <td style="white-space:nowrap">${esc(r.Date)}</td>
                    <td class="desc-cell">${esc(r.Description)}</td>
                    <td class="${a > 0 ? 'income-amt' : 'expense-amt'}">${Number.isFinite(a) ? money(a, a > 0) : esc(r.Amount)}</td>
                    <td class="edit-cell"><input type="text" data-col="Cleaned Merchant" value="${esc(r['Cleaned Merchant'])}"></td>
                    <td class="edit-cell"><select data-col="AI Category">${catOptions(r['AI Category'])}</select></td>
                    <td class="edit-cell"><input type="text" data-col="Notes" value="${esc(r.Notes)}" placeholder="—"></td>
                </tr>`;
            }).join('');
        };

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
        fCat.onchange = draw;
        fQ.oninput = draw;

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
};
