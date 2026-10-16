// A vehicle's Guides tab: long how-to notes (draining, winterizing, …), each collapsed until its title is clicked,
// each with its own reference images. Kept on the vehicle in vehicles.json as guides: [{ id, title, text }];
// a guide's images are the files in inputs/vehicles/guides/<vehicle id>/<guide id>/.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { saveVehicles, guideDir } from '../vehicles.js';
import { renderGallery, listImages, releaseGalleries } from './gallery.js';

let draft = null; // { start, read } while a guide is being edited

export const guidesUnsaved = () => !!draft && draft.read() !== draft.start;
export const forgetGuides = () => { draft = null; };

/** Guide text → HTML: '1. …' lines become numbered steps, '- …' lines bullets, blank lines spacing. */
function textHtml(text) {
    return text.split('\n').map(line => {
        const t = line.trim();
        if (!t) return '<div class="g-gap"></div>';
        const step = /^(\d+[.)])\s+(.*)$/.exec(t);
        if (step) return `<div class="g-step"><span class="g-num">${esc(step[1])}</span><span>${esc(step[2])}</span></div>`;
        const bullet = /^[-•*]\s+(.*)$/.exec(t);
        if (bullet) return `<div class="g-step"><span class="g-num">•</span><span>${esc(bullet[1])}</span></div>`;
        return `<p>${esc(t)}</p>`;
    }).join('');
}

const newId = (guides, title) => {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guide';
    let id = base;
    for (let n = 2; guides.some(g => g.id === id); n++) id = `${base}-${n}`;
    return id;
};

/** list: every vehicle (saved back whole). openId: a guide to show opened (e.g. one just saved). */
export async function renderGuides(el, list, v, openId = null) {
    draft = null;
    releaseGalleries();
    const guides = v.guides || [];
    const tab = document.querySelector('.pillnav a[href$="/guides"]'); // keep "Guides (n)" in step after add/remove
    if (tab) tab.textContent = `Guides${guides.length ? ` (${guides.length})` : ''}`;
    const counts = await Promise.all(guides.map(g => listImages(guideDir(v, g)).then(n => n.length)));
    el.innerHTML = `
        <div class="row table-tools">
            <button type="button" class="small" id="g-add">＋ Add guide</button>
            <span class="muted edit-hint">${guides.length ? 'Click a guide to open it.' : 'No guides yet.'} Each guide can have reference images (manual figures, your own photos).</span>
        </div>
        <div id="g-list">${guides.map((g, i) => `
            <details class="guide" data-i="${i}"${g.id === openId ? ' open' : ''}>
                <summary><span class="g-title">${esc(g.title)}</span>
                    <span class="muted g-count">${counts[i] ? `${counts[i]} image${counts[i] === 1 ? '' : 's'}` : ''}</span></summary>
                <div class="g-body"></div>
            </details>`).join('')}</div>
        <div id="g-new"></div>`;

    const showGuide = (details, g) => {
        const body = details.querySelector('.g-body');
        body.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to change the title or text, or remove the guide.</span></div>
            <div class="g-text">${textHtml(g.text || '')}</div>
            <h3 class="g-images">Images</h3>
            <div class="g-gallery"></div>`;
        body.querySelector('[data-edit]').onclick = () => editGuide(body, g);
        const setCount = n => { details.querySelector('.g-count').textContent = n ? `${n} image${n === 1 ? '' : 's'}` : ''; };
        renderGallery(body.querySelector('.g-gallery'), guideDir(v, g), { noun: 'image', onChange: setCount })
            .catch(err => { body.querySelector('.g-gallery').innerHTML = `<div class="banner bad">Couldn't load images: ${esc(err.message)}</div>`; });
    };

    // Opening a guide draws it (and loads its images) the first time.
    el.querySelectorAll('details.guide').forEach(d => {
        const g = guides[+d.dataset.i];
        const draw = () => { if (d.open && !d.dataset.drawn) { d.dataset.drawn = '1'; showGuide(d, g); } };
        d.addEventListener('toggle', draw);
        draw();
    });

    /** Edit form for an existing guide (inside its body) or a new one (g = null, in #g-new). */
    const editGuide = (container, g) => {
        if (draft && guidesUnsaved() && !confirm('Discard your changes to the other guide?')) return;
        container.innerHTML = `
            <div class="guide-form">
                <label class="field">Title<input type="text" data-f="title" value="${esc(g?.title || '')}"></label>
                <label class="field">Text <span class="muted">(lines starting “1.” become numbered steps, “-” bullets)</span>
                    <textarea data-f="text" rows="18">${esc(g?.text || '')}</textarea></label>
                <div class="row">
                    ${g ? '<button type="button" class="danger" data-remove>Remove this guide</button>' : ''}
                    <span class="spacer"></span>
                    <button type="button" data-cancel>Cancel</button>
                    <button type="button" class="primary" data-save>Save</button>
                </div>
            </div>`;
        const read = () => JSON.stringify({
            title: container.querySelector('[data-f=title]').value,
            text: container.querySelector('[data-f=text]').value,
        });
        draft = { start: read(), read };
        container.querySelector('[data-f=title]').focus();

        const save = async next => {
            const before = v.guides;
            v.guides = next;
            try {
                await saveVehicles(list);
                return true;
            } catch (err) {
                v.guides = before;
                toast(`Couldn't save: ${err.message}`, 'bad');
                return false;
            }
        };
        container.querySelector('[data-cancel]').onclick = () => {
            if (guidesUnsaved() && !confirm('Discard your changes?')) return;
            renderGuides(el, list, v, g?.id);
        };
        container.querySelector('[data-save]').onclick = async () => {
            const d = JSON.parse(read());
            const title = d.title.trim(), text = d.text.replace(/\s+$/, '');
            if (!title) return toast('Give the guide a title, then Save.', 'bad');
            const updated = g ? { ...g, title, text } : { id: newId(guides, title), title, text };
            if (!await save(g ? guides.map(x => (x === g ? updated : x)) : [...guides, updated])) return;
            toast('Saved', 'ok');
            renderGuides(el, list, v, updated.id);
        };
        container.querySelector('[data-remove]')?.addEventListener('click', async () => {
            if (!confirm(`Remove the guide “${g.title}”?\n\nIts images stay in your folder (${guideDir(v, g)}/).`)) return;
            if (!await save(guides.filter(x => x !== g))) return;
            toast(`Removed “${g.title}”`, 'ok');
            renderGuides(el, list, v);
        });
    };

    el.querySelector('#g-add').onclick = () => editGuide(el.querySelector('#g-new'), null);
}
