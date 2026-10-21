// An area's Future improvements (e.g. the water heater's heat pump water heater), or the Projects tab's projects: cards,
// each collapsed until its title is clicked, with a status, an estimated cost and free text (headings, bullets, a ☐
// next-steps checklist). Kept on the house in house.json as areas.<area id>.improvements: [{ id, title, status, cost, text }].
// The area's `cards` ({ noun, list, hint }) names them; without it they're Future improvements.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { textHtml } from '../../../vehicles/js/views/guides.js';
import { IMPROVEMENT_STATUSES, areaImprovements, saveHouses } from '../house.js';

let draft = null; // { start, read } while an improvement is being edited

export const improvementsUnsaved = () => !!draft && draft.read() !== draft.start;
export const forgetImprovements = () => { draft = null; };

const newId = (items, title) => {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'improvement';
    let id = base;
    for (let n = 2; items.some(x => x.id === id); n++) id = `${base}-${n}`;
    return id;
};

const isDone = x => /^done$/i.test((x.status || '').trim());

const IMPROVEMENT_WORDS = { noun: 'improvement', list: 'Future improvements',
    hint: "Upgrades you're thinking about or planning, with what they'd cost and what's left to do." };

/** list: every house (saved back whole). openId: an improvement to show opened (e.g. one just saved). */
export function renderImprovements(el, list, h, a, openId = null) {
    draft = null;
    const items = areaImprovements(h, a);
    const w = a.cards || IMPROVEMENT_WORDS;
    el.innerHTML = `
        <div class="row table-tools">
            <button type="button" class="small" id="i-add">＋ Add ${esc(w.noun)}</button>
            <span class="muted edit-hint">${items.length ? 'Click one to open it.' : `No ${esc(w.list.toLowerCase())} yet.`}
                ${esc(w.hint)}</span>
        </div>
        <div>${items.map((x, i) => `
            <details class="guide${isDone(x) ? ' imp-done' : ''}" data-i="${i}"${x.id === openId ? ' open' : ''}>
                <summary><span class="g-title">${esc(x.title)}</span>
                    ${x.status ? `<span class="cat-badge">${esc(x.status)}</span>` : ''}
                    <span class="muted g-count">${esc(x.cost || '')}</span></summary>
                <div class="g-body"></div>
            </details>`).join('')}</div>
        <div id="g-new"></div>`;

    const show = (body, x) => {
        body.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">Turn on editing to change it, tick off next steps, or remove it.</span></div>
            ${x.cost ? `<p><strong>Estimated cost:</strong> ${esc(x.cost)}</p>` : ''}
            <div class="g-text">${textHtml(x.text || '')}</div>`;
        body.querySelector('[data-edit]').onclick = () => edit(body, x);
    };
    el.querySelectorAll('details.guide').forEach(d => show(d.querySelector('.g-body'), items[+d.dataset.i]));

    const save = async next => {
        const updated = { ...h, areas: { ...h.areas, [a.id]: { ...h.areas?.[a.id], improvements: next } } };
        try {
            await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
        } catch (err) {
            toast(`Couldn't save: ${err.message}`, 'bad');
            return false;
        }
        Object.assign(h, updated);
        return true;
    };

    /** Edit form for an existing improvement (inside its body) or a new one (x = null, in #g-new). */
    const edit = (container, x) => {
        if (draft && improvementsUnsaved() && !confirm(`Discard your changes to the other ${w.noun}?`)) return;
        container.innerHTML = `
            <div class="guide-form">
                <label class="field">Title<input type="text" data-f="title" value="${esc(x?.title || '')}"></label>
                <div class="place-form-grid">
                    <label class="field">Status<input type="text" data-f="status" list="i-statuses" value="${esc(x?.status ?? 'Idea')}"></label>
                    <label class="field">Estimated cost<input type="text" data-f="cost" value="${esc(x?.cost || '')}" placeholder="e.g. ~$3,750 after rebates"></label>
                </div>
                <datalist id="i-statuses">${IMPROVEMENT_STATUSES.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
                <label class="field">Details <span class="muted">(“## ” starts a heading, “1.” numbered steps, “-” bullets,
                    “[ ]” a step to do and “[x]” one that's done)</span>
                    <textarea data-f="text" rows="20">${esc(x?.text || '')}</textarea></label>
                <div class="row">
                    ${x ? `<button type="button" class="danger" data-remove>Remove this ${esc(w.noun)}</button>` : ''}
                    <span class="spacer"></span>
                    <button type="button" data-cancel>Cancel</button>
                    <button type="button" class="primary" data-save>Save</button>
                </div>
            </div>`;
        const field = f => container.querySelector(`[data-f=${f}]`).value;
        const read = () => JSON.stringify({ title: field('title'), status: field('status'), cost: field('cost'), text: field('text') });
        draft = { start: read(), read };
        container.querySelector('[data-f=title]').focus();

        container.querySelector('[data-cancel]').onclick = () => {
            if (improvementsUnsaved() && !confirm('Discard your changes?')) return;
            renderImprovements(el, list, h, a, x?.id);
        };
        container.querySelector('[data-save]').onclick = async () => {
            const d = JSON.parse(read());
            const title = d.title.trim();
            if (!title) return toast(`Give the ${w.noun} a title, then Save.`, 'bad');
            const fields = { title, status: d.status.trim(), cost: d.cost.trim(), text: d.text.replace(/\s+$/, '') };
            const updated = x ? { ...x, ...fields } : { id: newId(items, title), ...fields };
            if (!await save(x ? items.map(y => (y === x ? updated : y)) : [...items, updated])) return;
            toast('Saved', 'ok');
            renderImprovements(el, list, h, a, updated.id);
        };
        container.querySelector('[data-remove]')?.addEventListener('click', async () => {
            if (!confirm(`Remove “${x.title}” from ${w.list}?`)) return;
            if (!await save(items.filter(y => y !== x))) return;
            toast(`Removed “${x.title}”`, 'ok');
            renderImprovements(el, list, h, a);
        });
    };

    el.querySelector('#i-add').onclick = () => edit(el.querySelector('#g-new'), null);
}
