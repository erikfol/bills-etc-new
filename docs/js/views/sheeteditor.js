// "Edit" for the hand-kept utility sheets: swaps a page's table for an editable grid of the file's own rows and
// columns. Only the cells you change are rewritten on Save; everything else in the file stays byte-for-byte.
import { readSheet, sheetMoney } from '../sheet.js';
import * as fs from '../fs.js';
import { esc, toast } from '../util.js';

/** How a raw cell shows in the grid: trimmed, '$   22.75' → '$22.75'. */
const show = raw => String(raw ?? '').trim().replace(/\$\s+/g, '$').replace(/\s{2,}/g, ' ');

let unsaved = 0; // grids with unsaved edits, so the page can warn before you leave
export const hasUnsavedEdits = () => unsaved > 0;

/**
 * Re-format what was typed the way the old cell was written: money cells stay Excel-accounting style
 * (' $25.15 ', ' $(1,003.21)', ' $ -   '), so the file keeps looking like the rest of the sheet.
 */
function formatLike(oldRaw, typed) {
    const v = typed.trim();
    if (v === '') return '';
    if (oldRaw.includes('$')) {
        const t = v.replace(/[$,\s]/g, '');
        const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
        const n = Number(t.replace(/[()-]/g, ''));
        if (t !== '' && Number.isFinite(n)) return sheetMoney(neg ? -n : n, /\$\s*-\s*$/.test(oldRaw.trim()));
    }
    return v;
}

/**
 * Put an Edit button above `tableEl` (the page's normal table). Edit shows every row of the file at `path` as
 * text boxes, in the file's own order; Save writes the changed cells and calls onSaved() (re-render the page).
 * recalc(cells, sheet, changedColumns) works out a changed row's calculated cells again before it's written;
 * `calculated` names them for the hint.
 */
export function editableSheet(tableEl, { path, onSaved, recalc = null, calculated = '' }) {
    const tools = document.createElement('div');
    tools.className = 'row table-tools';
    tools.innerHTML = `<button type="button" class="small" data-edit>✎ Edit</button>
        <span class="muted edit-hint">Turn on editing to change any cell in ${esc(path)}.</span>`;
    tableEl.before(tools);
    const grid = document.createElement('div');
    grid.className = 'sheet-grid';
    grid.hidden = true;
    tableEl.after(grid);

    let sheet = null, dirty = new Map(); // "row:col" → typed text

    const close = () => {
        if (dirty.size) unsaved--;
        dirty = new Map();
        sheet = null;
        grid.hidden = true;
        grid.innerHTML = '';
        tableEl.hidden = false;
        tools.innerHTML = `<button type="button" class="small" data-edit>✎ Edit</button>
            <span class="muted edit-hint">Turn on editing to change any cell in ${esc(path)}.</span>`;
    };
    const status = () => {
        const n = dirty.size;
        tools.querySelector('.edit-hint').textContent = n
            ? `${n} unsaved change${n === 1 ? '' : 's'}`
            : `Editing ${path}. Change any cell, then Save.${calculated ? ` ${calculated} are worked out again when you change the cells they come from.` : ''}`;
        tools.querySelector('[data-save]').disabled = !n;
    };

    const open = async () => {
        sheet = await readSheet(path);
        if (!sheet) { toast(`${path} not found`, 'bad'); return; }
        const [head, ...rows] = sheet.records;
        tools.innerHTML = `<button type="button" class="small primary" data-save disabled>Save changes</button>
            <button type="button" class="small" data-cancel>Cancel</button>
            <span class="muted edit-hint"></span>`;
        grid.innerHTML = `<div class="table-wrap"><table class="sheet-table">
            <thead><tr><th class="rownum">#</th>${head.map(h => `<th>${esc(h.trim())}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((r, ri) => `<tr><td class="rownum">${ri + 1}</td>${head.map((_, ci) => {
                const v = show(r[ci]);
                return `<td><input type="text" data-r="${ri}" data-c="${ci}" value="${esc(v)}" size="${Math.max(6, Math.min(40, v.length + 2))}" aria-label="${esc(head[ci].trim())} row ${ri + 1}"></td>`;
            }).join('')}</tr>`).join('')}</tbody></table></div>`;
        tableEl.hidden = true;
        grid.hidden = false;
        status();
        grid.querySelector('input')?.focus();
    };

    grid.addEventListener('input', e => {
        const inp = e.target;
        if (!inp.dataset?.r) return;
        const key = `${inp.dataset.r}:${inp.dataset.c}`;
        const orig = show(sheet.records[+inp.dataset.r + 1][+inp.dataset.c]);
        const had = dirty.size;
        if (inp.value.trim() === orig) dirty.delete(key); else dirty.set(key, inp.value);
        inp.classList.toggle('changed', dirty.has(key));
        if (!had && dirty.size) unsaved++;
        if (had && !dirty.size) unsaved--;
        status();
    });

    const save = async () => {
        // Re-read the file and check the rows being changed are as they were when editing started (e.g. not edited in Excel since).
        const fresh = await readSheet(path);
        const { delim, eol } = fresh;
        const lines = fresh.text.split(/\r?\n/);
        // Line number of each record (parseRecords skips lines that are blank).
        const lineOf = [];
        lines.forEach((l, n) => { if (!(l.split(delim).length === 1 && l.trim() === '')) lineOf.push(n); });
        const rowsChanged = new Map(); // record index → cells
        const colsChanged = new Map(); // record index → Set of column indexes typed in
        for (const [key, typed] of dirty) {
            const [r, c] = key.split(':').map(Number), rec = r + 1;
            const was = sheet.records[rec], now = fresh.records[rec];
            if (!now || now.join('\u0001') !== was.join('\u0001')) {
                toast(`${path} changed since you started editing (row ${r + 1}). Cancel and edit again.`, 'bad');
                return;
            }
            const cells = rowsChanged.get(rec) || [...now];
            while (cells.length <= c) cells.push('');
            cells[c] = formatLike(now[c] ?? '', typed);
            rowsChanged.set(rec, cells);
            colsChanged.set(rec, (colsChanged.get(rec) || new Set()).add(c));
        }
        for (const [rec, cells] of rowsChanged) {
            recalc?.(cells, fresh, colsChanged.get(rec));
            lines[lineOf[rec]] = cells.map(v => (delim === ',' && /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(delim);
        }
        try {
            await fs.writeText(path, lines.join(eol));
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            return;
        }
        const n = dirty.size;
        toast(`Saved ${n} change${n === 1 ? '' : 's'} to ${path}`, 'ok');
        close();
        onSaved?.();
    };

    tools.addEventListener('click', e => {
        if (e.target.closest('[data-edit]')) open();
        else if (e.target.closest('[data-save]')) save();
        else if (e.target.closest('[data-cancel]')) {
            if (dirty.size && !confirm(`Discard ${dirty.size} unsaved change${dirty.size === 1 ? '' : 's'}?`)) return;
            close();
        }
    });
    return { isDirty: () => dirty.size > 0 };
}

/** Called when a page is left or re-rendered: forget grids that no longer exist. */
export function resetUnsaved() { unsaved = 0; }
