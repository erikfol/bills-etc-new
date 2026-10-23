// House → ⚙ Settings (#<house>/settings): the maintenance due banners — for each page with a Maintenance table, whether
// it shows one, its name, how often it's due (every N years, by a month), when it turns yellow, and the month to count
// from while nothing's logged. Kept per house in house.json as banners: { <page id>: settings } (see bannerSettings).
// Also the banner itself (maintenanceBanner), which those pages show at the top.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { showDate } from '../../../shared/js/recordtable.js';
import { AREAS, MAINTENANCE_PAGES, bannerSettings, maintenanceStatus, loadMaintenance, saveHouses } from '../house.js';

let draft = null; // { start, read } while the banners are being edited

export const settingsUnsaved = () => !!draft && draft.read() !== draft.start;
export const forgetSettings = () => { draft = null; };

const MONTHS = [...Array(12)].map((_, i) => new Date(2000, i, 1).toLocaleString('en-US', { month: 'long' }));
const WARN = [[0, 'Never'], [14, '2 weeks before'], [30, '1 month before'], [61, '2 months before'], [91, '3 months before'],
    [182, '6 months before']]; // days before it's due
const warnText = d => WARN.find(([v]) => v === +d)?.[1] || `${+d} days before`;
const monthYear = ym => { const [y, m] = String(ym).split('-').map(Number); return m ? `${MONTHS[m - 1].slice(0, 3)} ${y}` : String(ym); };
const dueBy = d => d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
const everyText = n => (+n > 1 ? `Every ${+n} years` : 'Every year');

/** A maintenance page's due banner (b: its bannerSettings, rows: its Maintenance entries). */
export function maintenanceBanner(b, rows) {
    const { level, due, last } = maintenanceStatus(rows, b);
    const what = esc(b.what), by = esc(dueBy(due));
    const before = last ? `Last done ${esc(showDate(last.Date))}` : b.since ? `Nothing logged yet; counting from ${esc(monthYear(b.since))}`
        : 'Nothing logged yet';
    if (level === 'due') return `<div class="banner bad"><strong>${what} is due.</strong> ${before} (due by ${by}) — add it under
        Maintenance once it's done.</div>`;
    if (level === 'soon') return `<div class="banner"><strong>${what} is due by ${by}.</strong> ${before}.</div>`;
    if (!last) return `<div class="banner ok"><strong>${what} is due by ${by}.</strong> ${before}.</div>`;
    return `<div class="banner ok"><strong>${what} done ${esc(showDate(last.Date))}</strong>${[last.Description,
        last['Done By'] && `by ${last['Done By']}`].filter(Boolean).map(x => ` — ${esc(x)}`).join('')}. Next due by ${by}.</div>`;
}

/** The page of maintenance page `a` (a tab, or a pill of one). */
const pageHref = (h, a) => {
    const tab = AREAS.find(t => t === a || t.parts?.includes(a));
    return `#${h.id}/${tab.id}${tab.parts && tab.parts[0] !== a ? '/' + a.id : ''}`;
};
const pageName = a => (a.icon ? `${a.icon} ${a.label}` : a.label);

/** list: every house (saved back whole). top: the house name and menus. */
export async function renderSettings(el, list, h, top) {
    forgetSettings();
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = Object.fromEntries(await Promise.all(MAINTENANCE_PAGES.map(async a => [a.id, await loadMaintenance(h, a)])));
    el.innerHTML = `
        ${top}
        <p class="lead">Settings for this house, kept in its information in <code>inputs/house/house.json</code>.</p>
        <section><h2>Maintenance banners</h2><div id="s-banners"></div></section>`;
    const box = el.querySelector('#s-banners');

    /** How the shown banners look today with these settings ({ <page id>: settings }). */
    const preview = settings => {
        const shown = MAINTENANCE_PAGES.filter(a => settings[a.id].show);
        return `<h3 class="settings-preview">How they look today</h3>${shown.map(a => `
            <p class="muted settings-page"><a href="${esc(pageHref(h, a))}">${esc(pageName(a))}</a></p>
            ${maintenanceBanner(settings[a.id], rows[a.id])}`).join('') || '<p class="muted">No banners are shown.</p>'}`;
    };
    const saved = () => Object.fromEntries(MAINTENANCE_PAGES.map(a => [a.id, bannerSettings(h, a)]));
    const hint = `A banner at the top of a page with a Maintenance table: green while it's done or not due yet, yellow
        when it's coming up, red once it's due. It's due by the 1st of the month, every so many years after the last
        Maintenance entry.`;

    const show = () => {
        draft = null;
        const s = saved();
        box.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">${hint}</span></div>
            <div class="table-wrap"><table class="settings-table">
                <thead><tr><th>Page</th><th>Banner</th><th>Name</th><th>Due</th><th>Turns yellow</th><th>While nothing's logged</th></tr></thead>
                <tbody>${MAINTENANCE_PAGES.map(a => {
                    const b = s[a.id];
                    return `<tr${b.show ? '' : ' class="muted"'}><td><a href="${esc(pageHref(h, a))}">${esc(pageName(a))}</a></td>
                        <td>${b.show ? 'Shown' : 'Off'}</td><td>${esc(b.what)}</td>
                        <td>${esc(everyText(b.every))}, by ${esc(MONTHS[(+b.month || 1) - 1])}</td><td>${esc(warnText(b.warn))}</td>
                        <td>${b.since ? `Count from ${esc(monthYear(b.since))}` : '—'}</td></tr>`;
                }).join('')}</tbody>
            </table></div>
            ${preview(s)}`;
        box.querySelector('[data-edit]').onclick = edit;
    };

    const edit = () => {
        const s = saved();
        const options = (choices, value) => choices.map(([v, label]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`).join('');
        box.innerHTML = `
            <div class="row table-tools"><span class="muted edit-hint">Editing — nothing is written until you press Save.
                The banners below show how each would look today.</span></div>
            <div class="table-wrap"><table class="settings-table editing">
                <thead><tr><th>Page</th><th>Banner</th><th>Name</th><th>Due</th><th>Turns yellow</th><th>While nothing's logged, count from</th></tr></thead>
                <tbody>${MAINTENANCE_PAGES.map(a => {
                    const b = s[a.id];
                    return `<tr data-id="${esc(a.id)}"><td>${esc(pageName(a))}</td>
                        <td><label class="check"><input type="checkbox" data-f="show"${b.show ? ' checked' : ''}> Show</label></td>
                        <td><input type="text" data-f="what" value="${esc(b.what)}" aria-label="Banner name"></td>
                        <td class="nowrap"><select data-f="every" aria-label="How often">${options([...Array(10)].map((_, i) => [i + 1, everyText(i + 1)]), b.every)}</select>
                            by <select data-f="month" aria-label="Due by">${options(MONTHS.map((m, i) => [i + 1, m]), b.month)}</select></td>
                        <td><select data-f="warn" aria-label="Turns yellow">${options(WARN.some(([v]) => v === +b.warn) ? WARN : [...WARN, [+b.warn, warnText(b.warn)]], b.warn)}</select></td>
                        <td><input type="month" data-f="since" value="${esc(b.since || '')}" aria-label="Count from"></td></tr>`;
                }).join('')}</tbody>
            </table></div>
            <div class="row" style="margin-top:14px"><span class="spacer"></span>
                <button type="button" data-cancel>Cancel</button>
                <button type="button" class="primary" data-save>Save</button></div>
            <div data-preview></div>`;
        const read = () => Object.fromEntries([...box.querySelectorAll('tbody tr')].map(tr => {
            const f = name => tr.querySelector(`[data-f=${name}]`);
            const a = MAINTENANCE_PAGES.find(x => x.id === tr.dataset.id);
            return [a.id, { show: f('show').checked, what: f('what').value.trim() || bannerSettings({}, a).what,
                every: +f('every').value, month: +f('month').value, warn: +f('warn').value, since: f('since').value }];
        }));
        const drawPreview = () => { box.querySelector('[data-preview]').innerHTML = preview(read()); };
        draft = { start: JSON.stringify(read()), read: () => JSON.stringify(read()) };
        drawPreview();
        box.querySelector('tbody').addEventListener('input', drawPreview);
        box.querySelector('tbody').addEventListener('change', drawPreview);
        box.querySelector('[data-cancel]').onclick = () => {
            if (settingsUnsaved() && !confirm('Discard your changes?')) return;
            show();
        };
        box.querySelector('[data-save]').onclick = async () => {
            const updated = { ...h, banners: read() };
            try {
                await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            Object.assign(h, updated);
            toast('Saved', 'ok');
            show();
        };
    };

    show();
}
