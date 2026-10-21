// One house's page, with menus like Utilities → Electric: underlined tabs for the Overview (house information, service
// companies, photos) and each area (Financing, Septic, Other Inside, Other Outside), each showing that area's
// information, photos and records table (Financing: Mortgage, Closing and Value & Taxes boxes, documents, no records;
// Updates: just a table); Heating/Cooling's
// tab has pills instead (Oil furnace, Mini-split, Water heater), each such a page with maintenance too (and a due
// banner, or Future improvements, where AREAS says).
// Also the "Add house" page. Service companies and photos use the Vehicles views.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from '../../../vehicles/js/views/places.js';
import { renderImprovements, improvementsUnsaved, forgetImprovements } from './improvements.js';
import {
    HOUSE_PATH, AREAS, STORE, areaBoxes, areaInfo, saveHouses, houseAge, photosDir, newHouse, recordsPath, recordColumns, loadRecords, saveRecords,
    maintenancePath, maintenanceColumns, loadMaintenance, saveMaintenance, maintenanceStatus, tablePath, loadTable, saveTable,
} from '../house.js';

let table = null;
let maint = null; // the Maintenance table
let infos = []; // the information boxes

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!maint?.hasUnsavedEdits() || infos.some(b => b.hasUnsavedEdits())
    || placesUnsaved() || improvementsUnsaved();
export const forget = () => {
    table = null; maint = null; infos = [];
    closeFilterMenu(); releaseGalleries(); forgetPlaces(); forgetImprovements();
};

/** The menus under a house's name: the Overview and area tabs, then (on a tab with parts) the pills for its parts. */
const menus = (h, tab = null, page = null) => {
    const link = (path, label, active) => `<a href="#${esc([h.id, ...path].filter(Boolean).join('/'))}"${active ? ' class="active"' : ''}>${esc(label)}</a>`;
    return `<nav class="subnav">${link([], 'Overview', !tab)}${AREAS.map(t => link([t.id], t.label, t === tab)).join('')}</nav>`
        + (tab?.parts ? `<nav class="pillnav">${tab.parts.map((p, i) => link([tab.id, i ? p.id : ''], `${p.icon} ${p.label}`, p === page)).join('')}</nav>` : '');
};

/** After a Year Built (house) or Manufactured (e.g. the boiler) field: the age today (worked out, not saved). */
const ageItem = f => {
    if (!/built|manufactured/i.test(f.label) || !f.value) return '';
    const age = houseAge(f.value);
    return age ? `<div class="info-item"><dt>Age</dt><dd>${esc(age)}</dd></div>` : '';
};

const monthName = m => new Date(2000, m - 1, 1).toLocaleString('en-US', { month: 'long' });

/** Green when area `a` has maintenance dated this year, red once its due month has come with nothing logged this year. */
const maintenanceBanner = (a, rows) => {
    const { level, done, last } = maintenanceStatus(rows, a.due);
    const what = esc(a.due.what), by = esc(monthName(a.due.month));
    const lastText = last ? ` Last done ${esc(showDate(last.Date))}.` : '';
    if (level === 'done') return `<div class="banner ok"><strong>${what} done this year:</strong> ${[showDate(done.Date), done.Description,
        done['Done By'] && `by ${done['Done By']}`].filter(Boolean).map(esc).join(' — ')}</div>`;
    if (level === 'due') return `<div class="banner bad"><strong>${what} is due.</strong> Nothing logged yet this year (due by ${by}) —
        add it under Maintenance once it's done.${lastText}</div>`;
    return `<div class="banner ok"><strong>${what} is due by ${by}.</strong> Nothing logged yet this year.${lastText}</div>`;
};

/**
 * list: every house (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * tab: the AREAS tab shown (none for the Overview); page: the area shown — the tab itself, or one of its parts.
 */
export async function renderHouse(el, list, h, onListChanged, tab = null, page = null) {
    if (tab?.table) return renderTableTab(el, h, tab);
    if (tab) return renderArea(el, list, h, tab, page);
    el.innerHTML = `
        <h1 class="page">${esc(h.name)}</h1>
        ${menus(h)}
        <p class="lead">Information in <code>${esc(HOUSE_PATH)}</code>, photos in <code>${esc(photosDir(h))}/</code>.</p>
        <section>
            <h2>House information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Service companies</h2>
            <div id="places"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>`;
    infos = [infoBox(el.querySelector('#info'), {
        info: h.info,
        name: h.name,
        noun: 'house',
        extra: ageItem,
        save: async (newInfo, name) => {
            const updated = { ...h, name, info: newInfo };
            await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
            const renamed = name !== h.name;
            Object.assign(h, updated);
            if (renamed) onListChanged(h.id); // the menu shows the name
        },
        remove: async () => {
            if (!confirm(`Remove “${h.name}” from House?\n\nIts records files and photos are kept in your folder.`)) return;
            try {
                await saveHouses(list.filter(x => x.id !== h.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            infos = [];
            toast(`Removed “${h.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== h.id)?.id || 'new');
        },
    })];
    renderPlaces(el.querySelector('#places'), list, h, STORE);
    renderGallery(el.querySelector('#photos'), photosDir(h), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
}

/** One area's page (a tab, or a part of one): its information, photos and records table, plus what AREAS gives it. */
async function renderArea(el, list, h, tab, a) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const hasRecords = a.records !== false, boxes = areaBoxes(a), gallery = a.gallery || { label: 'Photos', noun: 'photo' };
    const [rows, maintRows] = await Promise.all([hasRecords ? loadRecords(h, a) : [], a.maintenance ? loadMaintenance(h, a) : []]);
    const section = (title, id) => `<section><h2>${esc(title)}</h2><div id="${id}"></div></section>`;
    const kept = [['Information', HOUSE_PATH], a.maintenance && ['maintenance', maintenancePath(h, a)], hasRecords && ['records', recordsPath(h, a)],
        ].filter(Boolean).map(([what, path]) => `${what} in <code>${esc(path)}</code>`).join(', ');
    el.innerHTML = `
        <h1 class="page">${esc(h.name)}</h1>
        ${menus(h, tab, a)}
        ${a.due ? '<div id="maint-banner"></div>' : ''}
        <p class="lead">${kept}.</p>
        ${boxes.map((b, i) => section(b.label, `info-${i}`)).join('')}
        ${section(gallery.label, 'photos')}
        ${a.improvements ? section('Future improvements', 'improvements') : ''}
        ${a.maintenance ? section('Maintenance', 'maintenance') : ''}
        ${hasRecords ? section('Records', 'records') : ''}`;
    const drawBanner = r => { if (a.due) el.querySelector('#maint-banner').innerHTML = maintenanceBanner(a, r); };
    drawBanner(maintRows);
    infos = boxes.map((b, i) => infoBox(el.querySelector(`#info-${i}`), {
        info: areaInfo(h, a, b),
        noun: 'house',
        extra: ageItem,
        save: async newInfo => {
            const updated = { ...h, areas: { ...h.areas, [a.id]: { ...h.areas?.[a.id], [b.key]: newInfo } } };
            await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
            Object.assign(h, updated);
        },
    }));
    renderGallery(el.querySelector('#photos'), photosDir(h, a), { noun: gallery.noun }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load ${esc(gallery.noun)}s: ${esc(err.message)}</div>`;
    });
    if (a.improvements) renderImprovements(el.querySelector('#improvements'), list, h, a);
    if (a.maintenance) maint = recordTable(el.querySelector('#maintenance'), {
        columns: maintenanceColumns(h),
        rows: maintRows,
        save: async r => { await saveMaintenance(h, a, r); drawBanner(r); },
    });
    if (hasRecords) table = recordTable(el.querySelector('#records'), {
        columns: recordColumns(h, a),
        rows,
        save: r => saveRecords(h, a, r),
    });
}

/** A tab that's just one table (Updates). */
async function renderTableTab(el, h, t) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadTable(h, t);
    el.innerHTML = `
        <h1 class="page">${esc(h.name)}</h1>
        ${menus(h, t)}
        <p class="lead">Kept in <code>${esc(tablePath(h, t))}</code>.</p>
        <section><h2>${esc(t.label)}</h2><div id="records"></div></section>`;
    table = recordTable(el.querySelector('#records'), {
        columns: t.table,
        rows,
        save: r => saveTable(h, t, r),
    });
}

/** The "＋ Add house" page (a second home, a camp, a rental…). */
export function renderNewHouse(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a house</h1>
        <p class="lead">It gets its own page with information, service companies and photos, plus
            ${esc(AREAS.map(a => a.label).join(', ').replace(/, ([^,]*)$/, ' and $1'))} tabs.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required placeholder="e.g. Camp"></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add house</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name')).trim();
        if (!name) return;
        const h = newHouse(list, name);
        try {
            await saveHouses([...list, h]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(h.id);
    };
}
