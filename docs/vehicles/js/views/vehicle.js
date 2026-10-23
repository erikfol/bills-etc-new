// One vehicle's page, in three tabs: Overview (information, current mileage for cars, service places, photos,
// maintenance table), Guides (long how-to notes with reference images) and Notes (a dated log). Also the "Add vehicle"
// page.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from './gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from './places.js';
import { renderGuides, guidesUnsaved, forgetGuides } from './guides.js';
import { renderNotes, notesUnsaved, forgetNotes } from './notes.js';
import {
    TYPES, VEHICLES_PATH, saveVehicles, photosDir, newVehicle, maintenancePath, maintenanceColumns, loadMaintenance, saveMaintenance,
    hasMileageLog, mileagePath, MILEAGE_COLUMNS, loadMileage, saveMileage, latestMileage, mileageRate,
} from '../vehicles.js';

let table = null;
let mileage = null; // the mileage log (cars)
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!mileage?.hasUnsavedEdits() || !!info?.hasUnsavedEdits()
    || placesUnsaved() || guidesUnsaved() || notesUnsaved();
export const forget = () => {
    table = null; mileage = null; info = null; closeFilterMenu(); releaseGalleries(); forgetPlaces(); forgetGuides(); forgetNotes();
};

/** The newest reading in the log (64,870 miles, Oct 23, 2026) and the miles a month and a year it works out to. */
const currentMileage = (v, rows) => {
    const r = latestMileage(rows);
    if (!r) return '<p class="muted">Nothing logged yet. Press Edit to add a reading.</p>';
    const rate = mileageRate(v, rows);
    const n = x => (Number.isNaN(Number(x)) ? String(x) : Number(x).toLocaleString('en-US'));
    const stat = (label, value, sub) => `<div class="info-item"><dt>${label}</dt><dd class="mileage-stat">${esc(value)}</dd>${
        sub ? `<dd class="muted mileage-sub">${esc(sub)}</dd>` : ''}</div>`;
    return `<dl class="info-grid mileage-stats">${stat('Latest reading', `${n(r.Mileage)} miles`, showDate(r.Date))}${rate.why
        ? stat('Miles per month / year', '—', rate.why)
        : stat('Miles per month', `≈ ${n(rate.perMonth)}`) + stat('Miles per year', `≈ ${n(rate.perYear)}`)}</dl>${rate.why ? ''
        : `<p class="muted mileage-sub">Averages from the purchase (${esc(rate.from)}) to the latest reading.</p>`}`;
};

/** The tabs under a vehicle's name. */
const tabs = (v, part) => {
    const tab = (sub, label, n) => `<a href="#${esc(v.id)}${sub ? '/' + sub : ''}"${(part || '') === sub ? ' class="active"' : ''}>${label}${n ? ` (${n})` : ''}</a>`;
    return `<nav class="pillnav">${tab('', 'Overview')}${tab('guides', 'Guides', (v.guides || []).length)}${tab('notes', 'Notes', (v.notes || []).length)}</nav>`;
};

/**
 * list: every vehicle (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * part: 'guides' / 'notes' for those tabs, otherwise the Overview.
 */
export async function renderVehicle(el, list, v, onListChanged, part) {
    if (part === 'guides') {
        el.innerHTML = `
            <h1 class="page">${esc(v.name)}</h1>
            <p class="lead">Guides are kept in <code>${esc(VEHICLES_PATH)}</code>; their images in <code>inputs/vehicles/guides/${esc(v.id)}/</code>.</p>
            ${tabs(v, part)}
            <section><h2>Guides</h2><div id="guides"><p class="muted">Loading…</p></div></section>`;
        return renderGuides(el.querySelector('#guides'), list, v);
    }
    if (part === 'notes') {
        el.innerHTML = `
            <h1 class="page">${esc(v.name)}</h1>
            <p class="lead">Notes are kept in <code>${esc(VEHICLES_PATH)}</code>; their images in <code>inputs/vehicles/notes/${esc(v.id)}/</code>.</p>
            ${tabs(v, part)}
            <section><h2>Notes</h2><div id="notes"></div></section>`;
        return renderNotes(el.querySelector('#notes'), list, v);
    }
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadMaintenance(v);
    const miles = hasMileageLog(v) ? await loadMileage(v) : null;
    el.innerHTML = `
        <h1 class="page" id="v-name"></h1>
        <p class="lead">${esc(TYPES[v.type]?.label || 'Vehicle')} · information in <code>${esc(VEHICLES_PATH)}</code>,
            ${miles ? `mileage in <code>${esc(mileagePath(v))}</code>, ` : ''}maintenance in <code>${esc(maintenancePath(v))}</code>.</p>
        ${tabs(v, part)}
        <section>
            <h2>Vehicle information</h2>
            <div id="info"></div>
        </section>
        ${miles ? `<section>
            <h2>Current mileage</h2>
            <div id="miles-now"></div>
            <div id="miles" class="mileage-log"></div>
        </section>` : ''}
        <section>
            <h2>Service places</h2>
            <div id="places"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>
        <section>
            <h2>Maintenance</h2>
            <div id="maint"></div>
        </section>`;
    el.querySelector('#v-name').textContent = v.name;
    info = infoBox(el.querySelector('#info'), {
        info: v.info,
        name: v.name,
        noun: 'vehicle',
        mono: /\b(vin|hin|serial|bow number|license plate)\b/i,
        save: async (newInfo, name) => {
            const updated = { ...v, name, info: newInfo };
            await saveVehicles(list.map(x => (x.id === v.id ? updated : x)));
            Object.assign(v, updated);
            onListChanged(v.id);
        },
        remove: async () => {
            if (!confirm(`Remove “${v.name}” from Vehicles?\n\nIts maintenance file (${maintenancePath(v)}) is kept in your folder.`)) return;
            try {
                await saveVehicles(list.filter(x => x.id !== v.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            info = null;
            toast(`Removed “${v.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== v.id)?.id || 'new');
        },
    });
    if (miles) {
        const now = el.querySelector('#miles-now');
        now.innerHTML = currentMileage(v, miles);
        mileage = recordTable(el.querySelector('#miles'), {
            columns: MILEAGE_COLUMNS,
            rows: miles,
            save: async rows => { await saveMileage(v, rows); now.innerHTML = currentMileage(v, rows); },
        });
    }
    renderPlaces(el.querySelector('#places'), list, v);
    renderGallery(el.querySelector('#photos'), photosDir(v), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#maint'), {
        columns: maintenanceColumns(v),
        rows,
        save: rows => saveMaintenance(v, rows),
    });
}

/** The "＋ Add vehicle" page. */
export function renderNewVehicle(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a vehicle</h1>
        <p class="lead">It gets its own page with an information section and a maintenance table.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required placeholder="e.g. 2015 Toyota Tacoma"></label>
                <label class="field">Type<select name="type">${Object.entries(TYPES).map(([k, t]) =>
                    `<option value="${k}">${esc(t.label)} — tracks ${esc(t.meter.toLowerCase())}</option>`).join('')}</select></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add vehicle</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const form = new FormData(e.target);
        const name = String(form.get('name')).trim();
        if (!name) return;
        const v = newVehicle(list, name, String(form.get('type')));
        try {
            await saveVehicles([...list, v]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(v.id);
    };
}
