// One pet's page (appointment banner, information, photos, future appointments, records table), and the "Add pet" page. The information box works like Vehicles'.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from '../../../vehicles/js/views/gallery.js';
import { PETS_PATH, ageText, savePets, newPet, recordsPath, photosDir, RECORD_COLUMNS, loadRecords, saveRecords,
    appointmentsPath, APPOINTMENT_COLUMNS, loadAppointments, saveAppointments, appointmentStatus } from '../pets.js';

let table = null;
let appts = null; // the future appointments table
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!appts?.hasUnsavedEdits() || !!info?.hasUnsavedEdits();
export const forget = () => { table = null; appts = null; info = null; closeFilterMenu(); releaseGalleries(); };

/** After the Birthday field: the age today (worked out, not saved). */
const ageItem = f => {
    if (!/birth/i.test(f.label) || !f.value) return '';
    const age = ageText(f.value);
    return `<div class="info-item"><dt>Age</dt><dd>${age ? esc(age)
        : '<span class="muted">Can’t read the birthday — type it like 3/5/2018, Mar 5 2018 or March 2018</span>'}</dd></div>`;
};

const inDays = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** Red: no future appointment; yellow: the next one is within 2 weeks; green: one is booked further out. */
const appointmentBanner = (name, rows) => {
    const s = appointmentStatus(rows);
    if (s.level === 'none') return `<div class="banner bad"><strong>No future appointment</strong> for ${esc(name)}. Add one under Future appointments.</div>`;
    const r = s.next;
    const what = `${esc(showDate(r.Date))}${r.Time ? ` at ${esc(r.Time)}` : ''}${r.Description ? ` — ${esc(r.Description)}` : ''}`;
    return s.level === 'soon'
        ? `<div class="banner"><strong>Appointment coming up ${inDays(s.days)}:</strong> ${what}</div>`
        : `<div class="banner ok"><strong>Next appointment ${inDays(s.days)}:</strong> ${what}</div>`;
};

/** list: every pet (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo. */
export async function renderPet(el, list, p, onListChanged) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, apptRows] = await Promise.all([loadRecords(p), loadAppointments(p)]);
    el.innerHTML = `
        <h1 class="page" id="p-name"></h1>
        <div id="appt-banner"></div>
        <p class="lead">Information in <code>${esc(PETS_PATH)}</code>, appointments in <code>${esc(appointmentsPath(p))}</code>,
            records in <code>${esc(recordsPath(p))}</code>.</p>
        <section>
            <h2>General information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>
        <section>
            <h2>Future appointments</h2>
            <div id="appointments"></div>
        </section>
        <section>
            <h2>Records</h2>
            <div id="records"></div>
        </section>`;
    el.querySelector('#p-name').textContent = p.name;
    const drawBanner = r => { el.querySelector('#appt-banner').innerHTML = appointmentBanner(p.name, r); };
    drawBanner(apptRows);
    info = infoBox(el.querySelector('#info'), {
        info: p.info,
        name: p.name,
        noun: 'pet',
        mono: /\b(microchip|serial|license)\b/i,
        extra: ageItem,
        save: async (newInfo, name) => {
            const updated = { ...p, name, info: newInfo };
            await savePets(list.map(x => (x.id === p.id ? updated : x)));
            Object.assign(p, updated);
            onListChanged(p.id);
        },
        remove: async () => {
            if (!confirm(`Remove “${p.name}” from Pets?\n\nIts records and appointments files (${recordsPath(p)}, ${appointmentsPath(p)}) are kept in your folder.`)) return;
            try {
                await savePets(list.filter(x => x.id !== p.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            info = null;
            toast(`Removed “${p.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== p.id)?.id || 'new');
        },
    });
    renderGallery(el.querySelector('#photos'), photosDir(p), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    appts = recordTable(el.querySelector('#appointments'), {
        columns: APPOINTMENT_COLUMNS,
        rows: apptRows,
        save: async r => { await saveAppointments(p, r); drawBanner(r); },
    });
    table = recordTable(el.querySelector('#records'), {
        columns: RECORD_COLUMNS,
        rows,
        save: rows => saveRecords(p, rows),
    });
}

/** The "＋ Add pet" page. */
export function renderNewPet(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a pet</h1>
        <p class="lead">It gets its own page with general information, photos, future appointments and a records table.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add pet</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name')).trim();
        if (!name) return;
        const p = newPet(list, name);
        try {
            await savePets([...list, p]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(p.id);
    };
}
