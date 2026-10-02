// Read-only table with Excel-style sort and filter on every column (same menu as Edit Categories).
import { openFilterMenu, closeFilterMenu } from './filtermenu.js';
import { esc, money } from './util.js';
import { parseDate } from './dates.js';

/**
 * Column: {
 *   id, label,
 *   value: row => string | number    what sorting and filtering use
 *   text?: value => string           label in the filter list and default cell text
 *   cell?: row => html               custom cell (must escape its own text)
 *   num?: true                       right-aligned, numeric sort
 *   sortKey?: value => comparable    custom sort order (e.g. dates)
 *   tdClass?: row => string
 *   sortLabels?: [asc, desc]
 * }
 */
const isBlank = v => v === '' || v == null || (typeof v === 'number' && Number.isNaN(v));

function compare(col, a, b) {
    if (col.sortKey) { const x = col.sortKey(a), y = col.sortKey(b); return x < y ? -1 : x > y ? 1 : 0; }
    const blankA = isBlank(a), blankB = isBlank(b);
    if (blankA || blankB) return blankA && blankB ? 0 : blankA ? 1 : -1; // blanks last, like Excel
    if (col.num) return a - b;
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

const keyOf = (col, row) => { const v = col.value(row); return isBlank(v) ? '' : String(v); };
const textOf = (col, v) => isBlank(v) ? '(Blanks)' : col.text ? col.text(v) : String(v);

/**
 * Render into `container`. Options: { columns, rows, sort?: {col, dir}, footer?: (rows, filtered) => '<tr>…</tr>', rowClass?: row => string,
 * onChange?: (visibleRows) => void, rowLimit?: number, empty?: string }.
 * Returns { setRows(rows), setFilter(fn), redraw() }; setFilter adds an outside filter (e.g. a month picker).
 */
export function dataTable(container, opts) {
    const { columns, footer, onChange, rowClass, rowLimit = 0, empty = 'No rows' } = opts;
    let rows = opts.rows || [];
    let outside = null;
    let sort = opts.sort || null;
    const filters = new Map();
    const COL = Object.fromEntries(columns.map(c => [c.id, c]));

    container.innerHTML = `
        <div class="dt-bar" hidden><span class="dt-info"></span><button class="small" data-clear>Clear filters</button></div>
        <div class="table-wrap"><table class="filter-table">
            <thead><tr>${columns.map(c => `
                <th data-col="${c.id}"${c.num ? ' class="num"' : ''}>
                    <span class="th-inner"><span class="th-label" title="Click to sort">${esc(c.label)}<span class="sort-ind"></span></span><button class="fbtn" aria-label="Sort and filter ${esc(c.label)}" title="Sort and filter">▾</button></span>
                </th>`).join('')}</tr></thead>
            <tbody></tbody><tfoot></tfoot>
        </table></div>`;
    const tbody = container.querySelector('tbody'), tfoot = container.querySelector('tfoot');

    const passes = (r, skip) => (!outside || outside(r))
        && [...filters].every(([id, allowed]) => id === skip || allowed.has(keyOf(COL[id], r)));

    function draw() {
        const visible = rows.filter(r => passes(r));
        if (sort) {
            const col = COL[sort.col], sign = sort.dir === 'asc' ? 1 : -1;
            visible.sort((a, b) => sign * compare(col, col.value(a), col.value(b)));
        }
        const shown = rowLimit ? visible.slice(0, rowLimit) : visible;
        tbody.innerHTML = shown.length ? shown.map(r => `<tr${rowClass?.(r) ? ` class="${rowClass(r)}"` : ''}>${columns.map(c => {
            const cls = [c.num ? 'amt' : '', c.tdClass?.(r) || ''].filter(Boolean).join(' ');
            const v = c.value(r);
            const html = c.cell ? c.cell(r) : isBlank(v) ? '' : esc(textOf(c, v));
            return `<td${cls ? ` class="${cls}"` : ''}>${html}</td>`;
        }).join('')}</tr>`).join('')
            : `<tr><td colspan="${columns.length}" class="muted" style="text-align:center">${esc(empty)}</td></tr>`;
        if (rowLimit && visible.length > rowLimit) {
            tbody.insertAdjacentHTML('beforeend', `<tr><td colspan="${columns.length}" class="muted" style="text-align:center">Showing ${rowLimit} of ${visible.length}. Filter to narrow it down.</td></tr>`);
        }
        tfoot.innerHTML = footer ? footer(visible, filters.size > 0) : '';

        container.querySelectorAll('th[data-col]').forEach(th => {
            const id = th.dataset.col;
            th.classList.toggle('filtered', filters.has(id));
            th.querySelector('.sort-ind').textContent = sort?.col === id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
        });
        const bar = container.querySelector('.dt-bar');
        bar.hidden = !filters.size;
        bar.querySelector('.dt-info').textContent = `${visible.length} of ${rows.filter(r => !outside || outside(r)).length} rows shown`;
        onChange?.(visible);
    }

    container.querySelector('[data-clear]').onclick = () => { filters.clear(); draw(); };
    container.querySelectorAll('th[data-col]').forEach(th => {
        const col = COL[th.dataset.col];
        th.querySelector('.th-label').onclick = () => {
            sort = { col: col.id, dir: sort?.col === col.id && sort.dir === 'asc' ? 'desc' : 'asc' };
            draw();
        };
        th.querySelector('.fbtn').onclick = e => {
            // Checklist offers only values still visible under the other filters, like Excel.
            const counts = new Map(), raw = new Map();
            for (const r of rows) {
                if (!passes(r, col.id)) continue;
                const k = keyOf(col, r);
                counts.set(k, (counts.get(k) || 0) + 1);
                if (!raw.has(k)) raw.set(k, col.value(r));
            }
            const values = [...raw.entries()].sort((a, b) => compare(col, a[1], b[1]))
                .map(([k, v]) => ({ key: k, label: textOf(col, v), count: counts.get(k) }));
            openFilterMenu({
                anchor: e.currentTarget, values,
                selected: filters.get(col.id) || null,
                sortLabels: col.sortLabels || (col.num ? ['Smallest → Largest', 'Largest → Smallest'] : ['A → Z', 'Z → A']),
                onSort: dir => { sort = { col: col.id, dir }; draw(); },
                onApply: set => { set ? filters.set(col.id, set) : filters.delete(col.id); draw(); },
            });
        };
    });

    draw();
    return {
        setRows(r) { rows = r; draw(); },
        setFilter(fn) { outside = fn; draw(); },
        redraw: draw,
    };
}

export { closeFilterMenu };

// ── Column helpers shared by the views ──────────────────────────────────────

export const dateColumn = (id, label, get) => ({
    id, label, value: r => get(r) ?? '',
    sortKey: v => parseDate(v)?.getTime() ?? -Infinity,
    sortLabels: ['Oldest → Newest', 'Newest → Oldest'],
    tdClass: () => 'nowrap',
});

/** Money column. `signed`: show + for positives and colour income green / spending red. */
export const moneyColumn = (id, label, get, { signed = false, bold = false } = {}) => ({
    id, label, num: true, value: r => get(r),
    text: v => money(v, signed && v > 0),
    cell: r => { const v = get(r); if (v === '' || v == null || Number.isNaN(v)) return ''; const t = esc(money(v, signed && v > 0)); return bold ? `<strong>${t}</strong>` : t; },
    tdClass: signed ? r => (get(r) > 0 ? 'income-amt' : 'expense-amt') : undefined,
});

export const categoryColumn = (id, label, get) => ({
    id, label, value: r => get(r) ?? '',
    cell: r => {
        const c = get(r) ?? '';
        if (!c) return '';
        const extra = c === 'Credit Card' ? ' credit-card' : c === 'Income' ? ' income' : '';
        return `<span class="cat-badge${extra}">${esc(c)}</span>`;
    },
});
