// One house's page, with menus like Utilities → Electric: underlined tabs for the Overview (house information, service
// companies, photos) and each area (Heating/Cooling, Septic, Other Inside, Other Outside), and under an area's tab pills
// for its sub-pages (areaViews): Information (with photos), Records, and on Heating/Cooling also Maintenance (with a due
// banner per system on every Heating/Cooling sub-page) and Future improvements.
// Also the "Add house" page. Service companies and photos use the Vehicles views.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from '../../../vehicles/js/views/places.js';
import { renderImprovements, improvementsUnsaved, forgetImprovements } from './improvements.js';
import {
    HOUSE_PATH, AREAS, STORE, areaViews, areaInfo, saveHouses, houseAge, photosDir, newHouse, recordsPath, recordColumns, loadRecords, saveRecords,
    MAINTENANCE_SYSTEMS, maintenancePath, maintenanceColumns, loadMaintenance, saveMaintenance, maintenanceStatus,
} from '../house.js';

let table = null;
let maint = null; // the Maintenance table
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!maint?.hasUnsavedEdits() || !!info?.hasUnsavedEdits()
    || placesUnsaved() || improvementsUnsaved();
export const forget = () => {
    table = null; maint = null; info = null;
    closeFilterMenu(); releaseGalleries(); forgetPlaces(); forgetImprovements();
};

/** The menus under a house's name: the Overview and area tabs, then (on an area) the pills for its sub-pages. */
const menus = (h, a = null, view = '') => {
    const link = (path, label, active) => `<a href="#${esc([h.id, ...path].filter(Boolean).join('/'))}"${active ? ' class="active"' : ''}>${esc(label)}</a>`;
    return `<nav class="subnav">${link([], 'Overview', !a)}${AREAS.map(x => link([x.id], x.label, x === a)).join('')}</nav>`
        + (a ? `<nav class="pillnav">${areaViews(a).map(v => link([a.id, v.id], v.label, v.id === view)).join('')}</nav>` : '');
};

/** After the Year Built field: the age today (worked out, not saved). */
const ageItem = f => {
    if (!/built/i.test(f.label) || !f.value) return '';
    const age = houseAge(f.value);
    return age ? `<div class="info-item"><dt>Age</dt><dd>${esc(age)}</dd></div>` : '';
};

const monthName = m => new Date(2000, m - 1, 1).toLocaleString('en-US', { month: 'long' });

/**
 * One banner per system: green when done this year, red once its due month has come with nothing logged this year.
 * href: the Maintenance sub-page.
 */
const maintenanceBanners = (rows, href) => maintenanceStatus(rows, MAINTENANCE_SYSTEMS).map(({ system: s, level, done, last }) => {
    const entry = r => [showDate(r.Date), r.Description, r['Done By'] && `by ${r['Done By']}`].filter(Boolean).map(esc).join(' — ');
    const lastText = last ? ` Last done ${esc(showDate(last.Date))}.` : '';
    if (level === 'done') return `<div class="banner ok"><strong>${esc(s.what)} done this year:</strong> ${entry(done)}</div>`;
    if (level === 'due') return `<div class="banner bad"><strong>${esc(s.what)} is due.</strong> No “${esc(s.name)}” entry yet this year
        (due by ${monthName(s.dueMonth)}) — add one under <a href="${esc(href)}">Maintenance</a> once it's done.${lastText}</div>`;
    return `<div class="banner ok"><strong>${esc(s.what)} is due by ${monthName(s.dueMonth)}.</strong> No “${esc(s.name)}” entry yet this year.${lastText}</div>`;
}).join('');

/**
 * list: every house (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * part: an area id for that tab, otherwise the Overview; view: one of the area's sub-pages (areaViews ids).
 */
export async function renderHouse(el, list, h, onListChanged, part, view = '') {
    const area = AREAS.find(a => a.id === part);
    if (area) return renderArea(el, list, h, area, view);
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
    info = infoBox(el.querySelector('#info'), {
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
            info = null;
            toast(`Removed “${h.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== h.id)?.id || 'new');
        },
    });
    renderPlaces(el.querySelector('#places'), list, h, STORE);
    renderGallery(el.querySelector('#photos'), photosDir(h), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
}

/** One sub-page of an area's tab (view: an areaViews id), under the maintenance banners where the area has them. */
async function renderArea(el, list, h, a, view) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, maintRows] = await Promise.all([
        view === 'records' ? loadRecords(h, a) : [],
        a.maintenance ? loadMaintenance(h, a) : [],
    ]);
    const section = (title, id) => `<section><h2>${esc(title)}</h2><div id="${id}"></div></section>`;
    const page = {
        '': {
            lead: `Information in <code>${esc(HOUSE_PATH)}</code>, photos in <code>${esc(photosDir(h, a))}/</code>.`,
            body: section(`${a.label} information`, 'info') + section('Photos', 'photos'),
        },
        maintenance: { lead: `Kept in <code>${esc(maintenancePath(h, a))}</code>.`, body: section('Maintenance', 'maintenance') },
        records: { lead: `Kept in <code>${esc(recordsPath(h, a))}</code>.`, body: section('Records', 'records') },
        improvements: { lead: `Kept in <code>${esc(HOUSE_PATH)}</code>.`, body: section('Future improvements', 'improvements') },
    }[view];
    el.innerHTML = `
        <h1 class="page">${esc(h.name)}</h1>
        ${menus(h, a, view)}
        ${a.maintenance ? '<div id="maint-banners"></div>' : ''}
        <p class="lead">${page.lead}</p>
        ${page.body}`;
    const drawBanners = r => {
        if (a.maintenance) el.querySelector('#maint-banners').innerHTML = maintenanceBanners(r, `#${h.id}/${a.id}/maintenance`);
    };
    drawBanners(maintRows);
    if (view === '') {
        info = infoBox(el.querySelector('#info'), {
            info: areaInfo(h, a),
            noun: 'house',
            save: async newInfo => {
                const updated = { ...h, areas: { ...h.areas, [a.id]: { ...h.areas?.[a.id], info: newInfo } } };
                await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
                Object.assign(h, updated);
            },
        });
        renderGallery(el.querySelector('#photos'), photosDir(h, a), { noun: 'photo' }).catch(err => {
            el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
        });
    } else if (view === 'maintenance') {
        maint = recordTable(el.querySelector('#maintenance'), {
            columns: maintenanceColumns(h),
            rows: maintRows,
            choices: { System: { list: MAINTENANCE_SYSTEMS.map(s => s.name), noun: 'system' } },
            save: async r => { await saveMaintenance(h, a, r); drawBanners(r); },
        });
    } else if (view === 'records') {
        table = recordTable(el.querySelector('#records'), {
            columns: recordColumns(h, a),
            rows,
            save: r => saveRecords(h, a, r),
        });
    } else if (view === 'improvements') {
        renderImprovements(el.querySelector('#improvements'), list, h, a);
    }
}

/** The "＋ Add house" page (a second home, a camp, a rental…). */
export function renderNewHouse(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a house</h1>
        <p class="lead">It gets its own page with information, service companies and photos, plus Heating/Cooling, Septic,
            Other Inside and Other Outside tabs.</p>
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
