// Helpers shared by the Utilities sub-pages (Electric, Water, …).
import { esc, money } from '../util.js';

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dShort = d => `${MON[d.getMonth()]} ${d.getDate()}`;
export const dLong = d => `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
/** "Jul 22 – Aug 19, 2026" (start year shown only when it differs). */
export const period = b => b.start ? `${dShort(b.start)}${b.start.getFullYear() !== b.end.getFullYear() ? ', ' + b.start.getFullYear() : ''} – ${dLong(b.end)}` : dLong(b.end);
/** Same day n months later, kept within the month (Jan 31 + 1 → Feb 28). */
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n,
    Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()));
export const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

/** Bill amounts: credits read as "$1,003.21 credit" rather than a minus sign. */
export const billText = v => v < 0 ? `${money(-v)} credit` : money(v);
export const billClass = v => v < 0 ? 'income-amt' : '';
export const axisMoney = v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const axisNum = v => Math.round(v).toLocaleString('en-US');

// Form values: <input type=date> gives YYYY-MM-DD.
export const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dateOf = v => { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
export const numOf = v => (String(v).trim() === '' ? NaN : Number(v));

/** A KPI card. `sub` is HTML; `value` is plain text. */
export const card = (label, value, sub, color = '') => `
    <div class="card"><div class="label">${label}</div>
    <div class="value"${color ? ` style="color:${color}"` : ''}>${esc(value)}</div>
    <div class="sub cmp">${sub}</div></div>`;

/** "▲ $12.00 more than Q1 2025 ($100.00)", coloured good/bad. `label` names the earlier bill. */
export function vsEarlier(cur, prev, label, { higherIsGood, fmt, fmtDiff = fmt, none = 'no bill a year earlier to compare' }) {
    if (label == null || !Number.isFinite(prev)) return `<span class="muted">${none}</span>`;
    const diff = cur - prev;
    if (Math.abs(diff) < 0.005) return `<span class="muted">same as ${esc(label)}</span>`;
    const good = (diff > 0) === higherIsGood;
    return `<span class="${good ? 'delta-good' : 'delta-bad'}">${diff > 0 ? '▲' : '▼'} ${esc(fmtDiff(Math.abs(diff)))} ${diff > 0 ? 'more' : 'less'}</span> <span class="muted">than ${esc(label)} (${esc(fmt(prev))})</span>`;
}

// Table columns.
export const dateCol = (id, label, get) => ({ id, label, value: r => get(r)?.getTime() ?? '', sortKey: v => (v === '' ? -Infinity : v),
    text: v => dLong(new Date(v)), tdClass: () => 'nowrap', sortLabels: ['Oldest → Newest', 'Newest → Oldest'] });
export const moneyCol = (id, label, get) => ({ id, label, num: true, value: get, text: billText, tdClass: r => `nowrap ${billClass(get(r))}` });
export const numCol = (id, label, get, text) => ({ id, label, num: true, value: get, text, tdClass: () => 'nowrap' });

// One window resize handler for whichever sub-page is showing.
let onResize = null;
export function setResize(fn) {
    clearResize();
    onResize = fn;
    window.addEventListener('resize', onResize);
}
export function clearResize() {
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = null;
}

/**
 * Year filter buttons ("All years", 2021, 2022, …) rendered into every element in `els`, all kept in step.
 * `selected` is a Set of years or null for all; onChange(selected) runs after each click; labelOf(year) → button text.
 * Returns the cleaned starting selection (years no longer in the data are dropped).
 */
export function yearChips(els, years, selected, onChange, labelOf = y => y, allText = 'All years') {
    let sel = selected ? new Set([...selected].filter(y => years.includes(y))) : null;
    if (sel && (!sel.size || sel.size === years.length)) sel = null;
    const render = () => {
        const html = `<button type="button" class="chip${sel ? '' : ' active'}" data-year="all">${allText}</button>`
            + years.map(y => `<button type="button" class="chip${sel?.has(y) ? ' active' : ''}" data-year="${y}">${labelOf(y)}</button>`).join('');
        for (const el of els) el.innerHTML = html;
    };
    for (const el of els) {
        el.onclick = e => {
            const b = e.target.closest('[data-year]');
            if (!b) return;
            if (b.dataset.year === 'all') sel = null;
            else {
                const set = sel || new Set();
                const y = +b.dataset.year;
                set.has(y) ? set.delete(y) : set.add(y);
                sel = set.size && set.size < years.length ? set : null;
            }
            render();
            onChange(sel);
        };
    }
    render();
    return sel;
}
