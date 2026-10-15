// Excel-style column menu: sort buttons plus a searchable checklist of the column's values.
import { esc } from './util.js';

const LIST_LIMIT = 1000;
let open = null; // { anchor, close }

export function closeFilterMenu() {
    open?.close();
}

/**
 * anchor: the header button the menu hangs from.
 * values: [{ key, label, count }] in display order.
 * selected: Set of allowed keys, or null when the column isn't filtered.
 * sortLabels: ['A → Z', 'Z → A'] (or date/number wording).
 * onSort(dir) with dir 'asc' | 'desc'; onApply(Set | null) where null clears the filter.
 */
export function openFilterMenu({ anchor, values, selected, sortLabels, onSort, onApply }) {
    // Clicking the same header button again closes the menu, like Excel.
    if (open?.anchor === anchor) return closeFilterMenu();
    closeFilterMenu();
    const checked = new Set(selected ?? values.map(v => v.key));
    const menu = document.createElement('div');
    menu.className = 'fmenu';
    menu.innerHTML = `
        <button class="fmenu-item" data-sort="asc">↑ Sort ${esc(sortLabels[0])}</button>
        <button class="fmenu-item" data-sort="desc">↓ Sort ${esc(sortLabels[1])}</button>
        <div class="fmenu-sep"></div>
        <input type="search" class="fmenu-search" placeholder="Search values">
        <label class="fmenu-all"><input type="checkbox" data-all> <span>(Select all)</span></label>
        <div class="fmenu-list"></div>
        <div class="fmenu-actions">
            <button class="small" data-clear${selected ? '' : ' disabled'}>Clear filter</button>
            <span class="spacer"></span>
            <button class="small" data-cancel>Cancel</button>
            <button class="small primary" data-ok>OK</button>
        </div>`;
    document.body.appendChild(menu);

    const search = menu.querySelector('.fmenu-search');
    const list = menu.querySelector('.fmenu-list');
    const all = menu.querySelector('[data-all]');
    const visible = () => {
        const q = search.value.trim().toLowerCase();
        return q ? values.filter(v => v.label.toLowerCase().includes(q)) : values;
    };

    const syncAll = () => {
        const vis = visible();
        const n = vis.filter(v => checked.has(v.key)).length;
        all.checked = vis.length > 0 && n === vis.length;
        all.indeterminate = n > 0 && n < vis.length;
        menu.querySelector('[data-ok]').disabled = n === 0;
    };

    const drawList = () => {
        const vis = visible();
        const shown = vis.slice(0, LIST_LIMIT);
        list.innerHTML = shown.map((v, i) => `
            <label class="fmenu-row"><input type="checkbox" data-i="${i}"${checked.has(v.key) ? ' checked' : ''}>
                <span class="fmenu-label">${esc(v.label)}</span><span class="fmenu-count">${v.count}</span></label>`).join('')
            + (vis.length > LIST_LIMIT ? `<div class="fmenu-more">${vis.length - LIST_LIMIT} more — type to narrow</div>` : '')
            + (vis.length ? '' : '<div class="fmenu-more">No matches</div>');
        list._shown = shown;
        syncAll();
    };

    list.addEventListener('change', e => {
        const v = list._shown[+e.target.dataset.i];
        e.target.checked ? checked.add(v.key) : checked.delete(v.key);
        syncAll();
    });
    all.addEventListener('change', () => {
        for (const v of visible()) all.checked ? checked.add(v.key) : checked.delete(v.key);
        drawList();
    });
    search.addEventListener('input', () => {
        // Like Excel: searching selects exactly the matching values.
        if (search.value.trim()) { checked.clear(); visible().forEach(v => checked.add(v.key)); }
        else { checked.clear(); (selected ?? values.map(v => v.key)).forEach(k => checked.add(k)); }
        drawList();
    });

    const apply = () => {
        const keys = search.value.trim() ? new Set(visible().map(v => v.key).filter(k => checked.has(k))) : checked;
        close();
        onApply(keys.size === values.length && values.every(v => keys.has(v.key)) ? null : new Set(keys));
    };
    menu.querySelector('[data-ok]').onclick = apply;
    search.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
    menu.querySelector('[data-cancel]').onclick = () => close();
    menu.querySelector('[data-clear]').onclick = () => { close(); onApply(null); };
    menu.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { close(); onSort(b.dataset.sort); });

    // Open under the column (left-aligned like Excel), kept on screen.
    const r = anchor.getBoundingClientRect();
    const colLeft = (anchor.closest('th') || anchor).getBoundingClientRect().left;
    const width = Math.min(280, window.innerWidth - 16);
    menu.style.width = width + 'px';
    menu.style.left = Math.max(8, Math.min(colLeft, window.innerWidth - width - 8)) + window.scrollX + 'px';
    menu.style.top = r.bottom + 4 + window.scrollY + 'px';

    const onDown = e => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    function close() {
        menu.remove();
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        open = null;
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    open = { anchor, close };

    drawList();
    search.focus();
}
