// A vehicle's Notes tab: a running log of dated notes (newest first) with a search box; each note has a title, text
// and optional images. Kept on the vehicle in vehicles.json as notes: [{ id, date, title, text }]; a note's images
// are the files in inputs/vehicles/notes/<vehicle id>/<note id>/.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { showDate } from '../../../shared/js/recordtable.js';
import { STORE } from '../vehicles.js';
import { renderGallery, releaseGalleries } from './gallery.js';

let draft = null; // { start, read } while a note is being edited

export const notesUnsaved = () => !!draft && draft.read() !== draft.start;
export const forgetNotes = () => { draft = null; };

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const newestFirst = (a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id);

const newId = (notes, date, title) => {
    const base = `${date || 'undated'}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note'}`;
    let id = base;
    for (let n = 2; notes.some(x => x.id === id); n++) id = `${base}-${n}`;
    return id;
};

/** list: every vehicle (saved back whole). */
export function renderNotes(el, list, v, store = STORE) {
    const noteDir = store.noteDir;
    draft = null;
    releaseGalleries();
    const notes = [...(v.notes || [])].sort(newestFirst);
    const tab = document.querySelector('.pillnav a[href$="/notes"]'); // keep "Notes (n)" in step after add/remove
    if (tab) tab.textContent = `Notes${notes.length ? ` (${notes.length})` : ''}`;
    el.innerHTML = `
        <div class="row table-tools">
            <input type="search" id="n-search" placeholder="Search notes…" aria-label="Search notes"${notes.length ? '' : ' hidden'}>
            <button type="button" class="small" id="n-add">＋ Add note</button>
            <span class="muted edit-hint" id="n-count">${notes.length ? '' : esc(store.noNotes)}</span>
        </div>
        <div id="n-new"></div>
        <div id="n-list">${notes.map((n, i) => `
            <article class="vnote" data-i="${i}">
                <div class="note-head">
                    <span class="note-date">${esc(n.date ? showDate(n.date) : 'No date')}</span>
                    <span class="note-title">${esc(n.title)}</span>
                    <span class="spacer"></span>
                    <button type="button" class="small" data-edit>✎ Edit</button>
                </div>
                <div class="note-body">
                    ${n.text ? `<div class="vnote-text">${esc(n.text)}</div>` : ''}
                    <div class="note-gallery"></div>
                </div>
            </article>`).join('')}</div>`;

    const cards = [...el.querySelectorAll('article.vnote')];
    cards.forEach(card => {
        const n = notes[+card.dataset.i];
        renderGallery(card.querySelector('.note-gallery'), noteDir(v, n), { noun: 'image', compact: true })
            .catch(err => { card.querySelector('.note-gallery').innerHTML = `<div class="banner bad">Couldn't load images: ${esc(err.message)}</div>`; });
        card.querySelector('[data-edit]').onclick = () => edit(card.querySelector('.note-body'), n);
    });

    const search = el.querySelector('#n-search');
    search.oninput = () => {
        const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        let shown = 0;
        cards.forEach(card => {
            const n = notes[+card.dataset.i];
            const hay = `${n.date} ${showDate(n.date)} ${n.title} ${n.text}`.toLowerCase();
            card.hidden = !words.every(w => hay.includes(w));
            if (!card.hidden) shown++;
        });
        el.querySelector('#n-count').textContent = words.length ? `${shown} of ${notes.length} notes` : '';
    };

    /** Edit form for an existing note (inside its card) or a new one (n = null, at the top). */
    const edit = (container, n) => {
        if (draft && notesUnsaved() && !confirm('Discard your changes to the other note?')) return;
        container.innerHTML = `
            <div class="note-form">
                <div class="note-form-row">
                    <label class="field">Date<input type="date" data-f="date" value="${esc(n ? n.date : today())}"></label>
                    <label class="field note-form-title">Title<input type="text" data-f="title" value="${esc(n?.title || '')}" placeholder="e.g. Leak at the stern"></label>
                </div>
                <label class="field">Note<textarea data-f="text" rows="8">${esc(n?.text || '')}</textarea></label>
                <div class="row">
                    ${n ? '<button type="button" class="danger" data-remove>Remove this note</button>' : ''}
                    <span class="spacer"></span>
                    <button type="button" data-cancel>Cancel</button>
                    <button type="button" class="primary" data-save>Save</button>
                </div>
                ${n ? '' : '<p class="muted">You can add images after saving.</p>'}
            </div>`;
        const read = () => JSON.stringify(Object.fromEntries(['date', 'title', 'text'].map(k => [k, container.querySelector(`[data-f=${k}]`).value])));
        draft = { start: read(), read };
        container.querySelector('[data-f=title]').focus();

        const save = async next => {
            const before = v.notes;
            v.notes = next;
            try {
                await store.save(list);
                return true;
            } catch (err) {
                v.notes = before;
                toast(`Couldn't save: ${err.message}`, 'bad');
                return false;
            }
        };
        container.querySelector('[data-cancel]').onclick = () => {
            if (notesUnsaved() && !confirm('Discard your changes?')) return;
            renderNotes(el, list, v, store);
        };
        container.querySelector('[data-save]').onclick = async () => {
            const d = JSON.parse(read());
            const date = d.date, title = d.title.trim(), text = d.text.replace(/\s+$/, '');
            if (!title && !text) return toast('Write a title or some text, then Save.', 'bad');
            const all = v.notes || [];
            const updated = n ? { ...n, date, title, text } : { id: newId(all, date, title), date, title, text };
            if (!await save(n ? all.map(x => (x.id === n.id ? updated : x)) : [...all, updated])) return;
            toast('Saved', 'ok');
            renderNotes(el, list, v, store);
        };
        container.querySelector('[data-remove]')?.addEventListener('click', async () => {
            if (!confirm(`Remove the note “${n.title || showDate(n.date)}”?\n\nIts images stay in your folder (${noteDir(v, n)}/).`)) return;
            if (!await save((v.notes || []).filter(x => x.id !== n.id))) return;
            toast('Note removed', 'ok');
            renderNotes(el, list, v, store);
        });
    };

    el.querySelector('#n-add').onclick = () => edit(el.querySelector('#n-new'), null);
}
