// Editable Merchant / Category / Notes cells, shared by Finance Table and Checking Activity.
import { getCategories } from './rules.js';
import { addCategory } from './categories.js';
import { esc, toast } from './util.js';

export const NEW_CATEGORY = '__new__'; // category names can't start with _, so this can't clash

export function catOptions(value) {
    const all = getCategories();
    const cats = all.includes(value) ? all : [value ?? '', ...all];
    return cats.map(c => `<option${c === value ? ' selected' : ''}>${esc(c)}</option>`).join('')
        + `<option value="${NEW_CATEGORY}">＋ New category…</option>`;
}

export const merchantInput = (i, v) =>
    `<input type="text" class="cell-input" data-i="${i}" data-col="Cleaned Merchant" value="${esc(v)}" aria-label="Merchant">`;
export const notesInput = (i, v) =>
    `<input type="text" class="cell-input" data-i="${i}" data-col="Notes" value="${esc(v)}" placeholder="—" aria-label="Notes">`;
export const categorySelect = (i, v) =>
    `<select class="cell-input" data-i="${i}" data-col="AI Category" aria-label="Category">${catOptions(v)}</select>`;

/**
 * Listen for edits inside `container`. getValue(i, col) returns a row's current value;
 * onEdit(i, col, value, element) is called for each change. Handles "＋ New category…".
 */
export function bindCellEditing(container, getValue, onEdit) {
    const handler = async e => {
        const t = e.target;
        const col = t.dataset?.col;
        if (!col || t.dataset.i == null) return;
        const i = +t.dataset.i;
        if (t.value === NEW_CATEGORY) {
            if (e.type !== 'change') return;
            const name = prompt('Name of the new category:')?.trim();
            try {
                if (!name) throw null;
                await addCategory(name);
                toast(`Added category “${name}”`, 'ok');
            } catch (err) {
                if (err) toast(err.message, 'bad');
                t.value = getValue(i, col);
                return;
            }
            // Offer the new category in every dropdown.
            container.querySelectorAll('select[data-col="AI Category"]').forEach(sel => {
                sel.innerHTML = catOptions(sel === t ? name : getValue(+sel.dataset.i, 'AI Category'));
            });
        }
        if (t.value !== getValue(i, col)) onEdit(i, col, t.value, t);
    };
    container.addEventListener('input', handler);
    container.addEventListener('change', handler);
}
