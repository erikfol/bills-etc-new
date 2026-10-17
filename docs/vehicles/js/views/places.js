// A vehicle's service places (shops, marinas): name, address (map link), phone (call link), hours, notes.
// Kept on the vehicle in vehicles.json as places: [{ name, address, phone, hours, notes }]; read-only until Edit.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { STORE } from '../vehicles.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIELDS = ['name', 'address', 'phone', 'hours', 'notes'];

let draft = null; // { start, read } while editing

export const placesUnsaved = () => !!draft && draft.read() !== draft.start;
export const forgetPlaces = () => { draft = null; };

const mapLink = a => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
const telLink = p => `tel:${p.replace(/[^\d+]/g, '')}`;

/** Hours text, one day per line ('Monday  9 AM–5 PM'); today's line is highlighted. */
function hoursHtml(hours) {
    const today = DAYS[new Date().getDay()].toLowerCase();
    return `<table class="hours">${hours.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const m = /^([A-Za-z]+)[\s:]+(.*)$/.exec(line);
        const isToday = m && m[1].toLowerCase() === today;
        return `<tr${isToday ? ' class="today"' : ''}>${m
            ? `<td>${esc(m[1])}</td><td${/closed/i.test(m[2]) ? ' class="muted"' : ''}>${esc(m[2])}${isToday ? ' <span class="today-tag">today</span>' : ''}</td>`
            : `<td colspan="2">${esc(line)}</td>`}</tr>`;
    }).join('')}</table>`;
}

/** list: every vehicle (saved back whole). store: how to save and what to say (vehicles.js STORE, or another app's). */
export function renderPlaces(el, list, v, store = STORE) {
    const show = () => {
        draft = null;
        const places = v.places || [];
        el.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" id="pl-edit">✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to add, change or remove places.</span></div>
            ${places.length ? `<div class="place-grid">${places.map(p => `
                <div class="place">
                    <h3>${esc(p.name)}</h3>
                    ${p.notes ? `<p class="place-notes">${esc(p.notes)}</p>` : ''}
                    ${p.address ? `<p>📍 <a href="${mapLink(p.address)}" target="_blank" rel="noopener">${esc(p.address)}</a></p>` : ''}
                    ${p.phone ? `<p>📞 <a href="${telLink(p.phone)}">${esc(p.phone)}</a></p>` : ''}
                    ${p.hours ? hoursHtml(p.hours) : ''}
                </div>`).join('')}</div>`
                : `<p class="muted">${esc(store.noPlaces)}</p>`}`;
        el.querySelector('#pl-edit').onclick = edit;
    };

    const placeForm = p => `
        <div class="place-form">
            <div class="row"><strong>Place</strong><span class="spacer"></span>
                <button type="button" class="danger small" data-remove title="Remove this place">✕ Remove</button></div>
            <div class="place-form-grid">
                <label class="field">Name<input type="text" data-f="name" value="${esc(p.name)}"></label>
                <label class="field">Phone<input type="text" data-f="phone" value="${esc(p.phone)}"></label>
                <label class="field wide">Address<input type="text" data-f="address" value="${esc(p.address)}"></label>
                <label class="field">Hours <span class="muted">(one day per line)</span><textarea data-f="hours" rows="7">${esc(p.hours)}</textarea></label>
                <label class="field">Notes<textarea data-f="notes" rows="7">${esc(p.notes)}</textarea></label>
            </div>
        </div>`;

    const edit = () => {
        el.innerHTML = `
            <div class="row table-tools"><span class="muted edit-hint">Editing — nothing is written until you press Save.</span></div>
            <div id="pl-forms">${(v.places || []).map(placeForm).join('')}</div>
            <div class="row" style="margin-top:14px">
                <button type="button" id="pl-add">＋ Add place</button>
                <span class="spacer"></span>
                <button type="button" id="pl-cancel">Cancel</button>
                <button type="button" class="primary" id="pl-save">Save</button>
            </div>`;
        const forms = el.querySelector('#pl-forms');
        const read = () => JSON.stringify([...forms.querySelectorAll('.place-form')].map(f =>
            Object.fromEntries(FIELDS.map(k => [k, f.querySelector(`[data-f=${k}]`).value]))));
        draft = { start: read(), read };

        forms.addEventListener('click', e => { if (e.target.closest('[data-remove]')) e.target.closest('.place-form').remove(); });
        el.querySelector('#pl-add').onclick = () => {
            forms.insertAdjacentHTML('beforeend', placeForm(Object.fromEntries(FIELDS.map(k => [k, '']))));
            forms.lastElementChild.querySelector('input').focus();
        };
        el.querySelector('#pl-cancel').onclick = () => {
            if (placesUnsaved() && !confirm('Discard your changes?')) return;
            show();
        };
        el.querySelector('#pl-save').onclick = async () => {
            const places = JSON.parse(read())
                .map(p => Object.fromEntries(FIELDS.map(k => [k, p[k].trim()])))
                .filter(p => FIELDS.some(k => p[k]));
            if (places.some(p => !p.name)) return toast('Every place needs a name — fill it in or remove it, then Save.', 'bad');
            const before = v.places;
            v.places = places;
            try {
                await store.save(list);
            } catch (err) {
                v.places = before;
                return toast(`Couldn't save: ${err.message}`, 'bad');
            }
            toast('Saved', 'ok');
            show();
        };
    };

    show();
}
