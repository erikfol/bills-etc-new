// One house's page, in tabs: Overview (house information, service companies, photos), then one tab per area
// (Heating/Cooling, Septic, Other Inside, Other Outside) with that area's information, photos and records table.
// Also the "Add house" page. Service companies and photos use the Vehicles views.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from '../../../vehicles/js/views/places.js';
import {
    HOUSE_PATH, AREAS, STORE, areaInfo, saveHouses, houseAge, photosDir, newHouse, recordsPath, recordColumns, loadRecords, saveRecords,
} from '../house.js';

let table = null;
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!info?.hasUnsavedEdits()
    || placesUnsaved();
export const forget = () => { table = null; info = null; closeFilterMenu(); releaseGalleries(); forgetPlaces(); };

/** The tabs under a house's name. */
const tabs = (h, part) => {
    const tab = (sub, label) => `<a href="#${esc(h.id)}${sub ? '/' + sub : ''}"${(part || '') === sub ? ' class="active"' : ''}>${esc(label)}</a>`;
    return `<nav class="pillnav">${tab('', 'Overview')}${AREAS.map(a => tab(a.id, a.label)).join('')}</nav>`;
};

/** After the Year Built field: the age today (worked out, not saved). */
const ageItem = f => {
    if (!/built/i.test(f.label) || !f.value) return '';
    const age = houseAge(f.value);
    return age ? `<div class="info-item"><dt>Age</dt><dd>${esc(age)}</dd></div>` : '';
};

/**
 * list: every house (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * part: an area id for that tab, otherwise the Overview.
 */
export async function renderHouse(el, list, h, onListChanged, part) {
    const area = AREAS.find(a => a.id === part);
    if (area) return renderArea(el, list, h, area);
    el.innerHTML = `
        <h1 class="page">${esc(h.name)}</h1>
        <p class="lead">Information in <code>${esc(HOUSE_PATH)}</code>, photos in <code>${esc(photosDir(h))}/</code>.</p>
        ${tabs(h, part)}
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

/** One area's tab: its information, photos and records table. */
async function renderArea(el, list, h, a) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadRecords(h, a);
    el.innerHTML = `
        <h1 class="page">${esc(h.name)}</h1>
        <p class="lead">Information in <code>${esc(HOUSE_PATH)}</code>, records in <code>${esc(recordsPath(h, a))}</code>.</p>
        ${tabs(h, a.id)}
        <section>
            <h2>${esc(a.label)} information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>
        <section>
            <h2>Records</h2>
            <div id="records"></div>
        </section>`;
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
    table = recordTable(el.querySelector('#records'), {
        columns: recordColumns(h, a),
        rows,
        save: rows => saveRecords(h, a, rows),
    });
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
