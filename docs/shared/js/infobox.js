// The information box on Vehicles, House and Pets pages: label/value fields shown read-only until Edit; while editing,
// fields can be changed, added, removed and moved up or down. Also the ↑ ↓ buttons other edit lists use.
import { esc, toast } from '../../bills-etc/js/util.js';

/** ↑ ↓ buttons for one item of an edit list; moveItem() handles their clicks. */
export const moveButtons = () => `<span class="move-btns">`
    + `<button type="button" class="small" data-move="-1" title="Move up" aria-label="Move up">↑</button>`
    + `<button type="button" class="small" data-move="1" title="Move down" aria-label="Move down">↓</button></span>`;

/** Click handler part: if `e` hit a ↑/↓ button, move its item (the closest `itemSelector`) and return true. */
export function moveItem(e, itemSelector) {
    const b = e.target.closest('[data-move]');
    if (!b) return false;
    const item = b.closest(itemSelector);
    if (b.dataset.move === '-1') item.previousElementSibling?.before(item);
    else item.nextElementSibling?.after(item);
    b.focus(); // so repeated clicks / Enter keep moving the same item
    return true;
}

/**
 * Draw the box into `el`.
 *   info: [{ label, value }]; name: also edit this name (shown in the menu), or null; noun: 'vehicle', 'house', 'pet'
 *   save(info, name) writes it (throws to refuse); remove(): adds a "Remove this <noun>" button while editing
 *   extra(field): html to show after a field (e.g. a worked-out Age); mono: field labels shown in a fixed-width font
 * Returns { hasUnsavedEdits() }.
 */
export function infoBox(el, { info, name = null, noun = 'item', save, remove = null, extra = () => '', mono = null }) {
    let draft = null; // { json at start, read() } while editing

    const show = () => {
        draft = null;
        el.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to change, add, remove or reorder information.</span></div>
            <dl class="info-grid">${info.map(f => `<div class="info-item${/notes/i.test(f.label) ? ' wide' : ''}">
                <dt>${esc(f.label)}</dt><dd${mono?.test(f.label) ? ' class="mono"' : ''}>${f.value ? esc(f.value) : '<span class="muted">—</span>'}</dd></div>${extra(f)}`).join('')
                || '<p class="muted">No information yet. Press Edit to add some.</p>'}</dl>`;
        el.querySelector('[data-edit]').onclick = edit;
    };

    const edit = () => {
        el.innerHTML = `
            <div class="row table-tools"><span class="muted edit-hint">Editing — nothing is written until you press Save. ↑ ↓ move a field.</span></div>
            ${name === null ? '' : `<label class="field info-name">Name (shown in the menu)<input type="text" data-name value="${esc(name)}"></label>`}
            <div class="table-wrap"><table class="info-edit">
                <thead><tr><th></th><th>Field</th><th>Value</th><th></th></tr></thead>
                <tbody></tbody>
            </table></div>
            <div class="row" style="margin-top:14px">
                <button type="button" data-add>＋ Add field</button>
                ${remove ? `<button type="button" class="danger" data-remove-all>Remove this ${esc(noun)}</button>` : ''}
                <span class="spacer"></span>
                <button type="button" data-cancel>Cancel</button>
                <button type="button" class="primary" data-save>Save</button>
            </div>`;
        const body = el.querySelector('tbody');
        const fieldRow = f => `<tr>
            <td class="move">${moveButtons()}</td>
            <td><input type="text" data-f="label" value="${esc(f.label)}" aria-label="Field name"></td>
            <td>${/notes/i.test(f.label)
                ? `<textarea data-f="value" rows="2" aria-label="Value">${esc(f.value)}</textarea>`
                : `<input type="text" data-f="value" value="${esc(f.value)}" aria-label="Value">`}</td>
            <td class="remove"><button type="button" class="danger" data-remove title="Remove this field" aria-label="Remove this field">✕</button></td></tr>`;
        body.innerHTML = info.map(fieldRow).join('');
        const read = () => JSON.stringify({
            name: el.querySelector('[data-name]')?.value ?? null,
            info: [...body.rows].map(tr => ({ label: tr.querySelector('[data-f=label]').value, value: tr.querySelector('[data-f=value]').value })),
        });
        draft = { start: read(), read };

        body.addEventListener('click', e => {
            if (moveItem(e, 'tr')) return;
            if (e.target.closest('[data-remove]')) e.target.closest('tr').remove();
        });
        el.querySelector('[data-add]').onclick = () => {
            body.insertAdjacentHTML('beforeend', fieldRow({ label: '', value: '' }));
            body.lastElementChild.querySelector('input').focus();
        };
        el.querySelector('[data-cancel]').onclick = () => {
            if (draft.read() !== draft.start && !confirm('Discard your changes?')) return;
            show();
        };
        el.querySelector('[data-save]').onclick = async () => {
            const d = JSON.parse(read());
            const newName = d.name?.trim() ?? null;
            if (newName === '') return toast(`Give the ${noun} a name, then Save.`, 'bad');
            const newInfo = d.info.map(f => ({ label: f.label.trim(), value: f.value.trim() })).filter(f => f.label || f.value);
            if (newInfo.some(f => !f.label)) return toast('Every value needs a field name — fill it in or remove the row, then Save.', 'bad');
            draft = null; // save() may re-draw the whole page
            try {
                await save(newInfo, newName);
            } catch (err) {
                draft = { start: '', read };
                return toast(`Couldn't save: ${err.message}`, 'bad');
            }
            info = newInfo;
            toast('Saved', 'ok');
            if (el.isConnected) show();
        };
        el.querySelector('[data-remove-all]')?.addEventListener('click', remove);
    };

    show();
    return { hasUnsavedEdits: () => !!draft && draft.read() !== draft.start };
}
