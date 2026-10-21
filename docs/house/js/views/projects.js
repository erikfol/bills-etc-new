// The Projects tab: the list of house projects (#<house>/projects) and one page per project (#<house>/projects/<id>) to
// plan it — status, plan & notes (headings, bullets, a [ ]/[x] step checklist), materials, measurements & specs, cost
// estimates (with a total), photos & sketches, and the Future updates linked to it (their Project column).
import { esc, toast, money } from '../../../bills-etc/js/util.js';
import { recordTable, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery } from '../../../vehicles/js/views/gallery.js';
import { textHtml } from '../../../vehicles/js/views/guides.js';
import {
    HOUSE_DIR, HOUSE_PATH, IMPROVEMENT_STATUSES, FUTURE_UPDATES, MATERIAL_COLUMNS, COST_COLUMNS, PROJECT_SPECS, houseProjects, projectDir,
    saveHouses, loadTable, saveTable,
} from '../house.js';

let draft = null; // { start, read } while the project's heading or its plan is being edited
let materials = null; // the Materials table
let specs = null; // the Measurements & specs box
let costs = null; // the Cost estimates table

export const projectUnsaved = () => (!!draft && draft.read() !== draft.start) || !!materials?.hasUnsavedEdits()
    || !!specs?.hasUnsavedEdits() || !!costs?.hasUnsavedEdits();
export const forgetProject = () => { draft = null; materials = null; specs = null; costs = null; };

const isDone = p => /^done$/i.test((p.status || '').trim());
const total = p => (p.costs || []).reduce((t, r) => t + (Number(r.Estimate) || 0), 0);
const projectHref = (h, p) => `#${h.id}/projects/${p.id}`;

/** '3 of 5 steps done' from the plan's [ ] / [x] lines, or ''. */
const steps = p => {
    const lines = (p.text || '').split('\n').map(l => l.trim());
    const all = lines.filter(l => /^\[[ xX]\]/.test(l)).length, done = lines.filter(l => /^\[[xX]\]/.test(l)).length;
    return all ? `${done} of ${all} step${all === 1 ? '' : 's'} done` : '';
};

/** Save the house with these projects. */
async function saveProjects(list, h, items) {
    const updated = { ...h, areas: { ...h.areas, projects: { ...h.areas?.projects, items } } };
    await saveHouses(list.map(x => (x.id === h.id ? updated : x)));
    Object.assign(h, updated);
}

const newId = (items, title) => {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    let id = base;
    for (let n = 2; items.some(x => x.id === id); n++) id = `${base}-${n}`;
    return id;
};

/** The list of projects (#<house>/projects). top: the house name and menus. */
export function renderProjectList(el, list, h, top) {
    forgetProject();
    const items = houseProjects(h);
    el.innerHTML = `
        ${top}
        <p class="lead">Kept in <code>${esc(HOUSE_PATH)}</code>; each project's photos and sketches in its own folder in
            <code>${esc(HOUSE_DIR)}/projects/</code>.</p>
        <section>
            <h2>Projects</h2>
            <div class="row table-tools">
                <button type="button" class="small" id="p-add">＋ Add project</button>
                <span class="muted edit-hint">${items.length ? 'Click a project to open it.' : 'No projects yet.'}
                    Plan a project: its steps, sizes and specs, cost estimates, and photos or sketches.</span>
            </div>
            <div id="p-new"></div>
            <div class="place-grid">${items.map(p => `
                <a class="place project-card${isDone(p) ? ' crossed' : ''}" href="${esc(projectHref(h, p))}">
                    <h3>${isDone(p) ? `<s>${esc(p.title)}</s>` : esc(p.title)}</h3>
                    ${p.status ? `<p><span class="cat-badge">${esc(p.status)}</span></p>` : ''}
                    <p>Estimated total: <strong>${esc(money(total(p)))}</strong></p>
                    ${steps(p) ? `<p class="muted">${esc(steps(p))}</p>` : ''}
                </a>`).join('')}</div>
        </section>`;
    el.querySelector('#p-add').onclick = () => {
        const form = el.querySelector('#p-new');
        form.innerHTML = `
            <form class="place-form">
                <label class="field">Project name<input type="text" name="title" required placeholder="e.g. Replace front steps"></label>
                <div class="row" style="margin-top:8px"><span class="spacer"></span>
                    <button type="button" data-cancel>Cancel</button><button class="primary">Add project</button></div>
            </form>`;
        const f = form.querySelector('form');
        f.title.focus();
        f.querySelector('[data-cancel]').onclick = () => { form.innerHTML = ''; };
        f.onsubmit = async e => {
            e.preventDefault();
            const title = f.title.value.trim();
            if (!title) return;
            const p = { id: newId(items, title), title, status: 'Idea', text: '', materials: [],
                specs: PROJECT_SPECS.map(label => ({ label, value: '' })), costs: [] };
            try {
                await saveProjects(list, h, [...items, p]);
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            location.hash = projectHref(h, p).slice(1);
        };
    };
}

/** One project's page (#<house>/projects/<id>). top: the house name and menus. */
export async function renderProject(el, list, h, top, p) {
    forgetProject();
    el.innerHTML = '<p class="muted">Loading…</p>';
    const linked = (await loadTable(h, FUTURE_UPDATES)).filter(r => r.Project === p.title);
    const section = (title, id) => `<section><h2>${esc(title)}</h2><div id="${id}"></div></section>`;
    el.innerHTML = `
        ${top}
        <p><a href="#${esc(h.id)}/projects">← All projects</a></p>
        <section><h2 id="p-title"></h2><div id="p-head"></div></section>
        <p class="lead">Kept in <code>${esc(HOUSE_PATH)}</code>; photos and sketches in <code>${esc(projectDir(h, p))}/</code>.</p>
        ${section('Plan & notes', 'p-plan')}
        ${section('Materials', 'p-materials')}
        ${section('Measurements & specs', 'p-specs')}
        ${section('Cost estimates', 'p-costs')}
        ${section('Photos & sketches', 'p-photos')}
        ${section('Future updates', 'p-updates')}`;

    /** Save changes to this project (throws if it can't). */
    const update = async fields => {
        await saveProjects(list, h, houseProjects(h).map(x => (x.id === p.id ? { ...x, ...fields } : x)));
        Object.assign(p, fields);
    };

    const head = el.querySelector('#p-head');
    const showHead = () => {
        el.querySelector('#p-title').textContent = p.title;
        head.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">Change the name or status, or remove the project.</span></div>
            <dl class="info-grid">
                <div class="info-item"><dt>Status</dt><dd>${p.status ? `<span class="cat-badge">${esc(p.status)}</span>` : '<span class="muted">—</span>'}</dd></div>
                <div class="info-item"><dt>Estimated total</dt><dd>${esc(money(total(p)))}</dd></div>
                <div class="info-item"><dt>Steps</dt><dd>${esc(steps(p) || 'None yet — add [ ] steps to the plan')}</dd></div>
            </dl>`;
        head.querySelector('[data-edit]').onclick = editHead;
    };
    const editHead = () => {
        head.innerHTML = `
            <div class="guide-form">
                <div class="place-form-grid">
                    <label class="field">Name<input type="text" data-f="title" value="${esc(p.title)}"></label>
                    <label class="field">Status<input type="text" data-f="status" list="p-statuses" value="${esc(p.status || '')}"></label>
                </div>
                <datalist id="p-statuses">${IMPROVEMENT_STATUSES.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
                <div class="row">
                    <button type="button" class="danger" data-remove>Remove this project</button>
                    <span class="spacer"></span>
                    <button type="button" data-cancel>Cancel</button>
                    <button type="button" class="primary" data-save>Save</button>
                </div>
            </div>`;
        const field = f => head.querySelector(`[data-f=${f}]`).value;
        const read = () => JSON.stringify({ title: field('title'), status: field('status') });
        draft = { start: read(), read };
        head.querySelector('[data-cancel]').onclick = () => {
            if (projectUnsaved() && !confirm('Discard your changes?')) return;
            draft = null;
            showHead();
        };
        head.querySelector('[data-save]').onclick = async () => {
            const title = field('title').trim(), status = field('status').trim(), was = p.title;
            if (!title) return toast('Give the project a name, then Save.', 'bad');
            try {
                await update({ title, status });
                if (title !== was) await renameLinks(h, was, title);
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            draft = null;
            toast('Saved', 'ok');
            showHead();
        };
        head.querySelector('[data-remove]').onclick = async () => {
            if (!confirm(`Remove the project “${p.title}”?\n\nIts photos and sketches are kept in your folder (${projectDir(h, p)}).`)) return;
            try {
                await saveProjects(list, h, houseProjects(h).filter(x => x.id !== p.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            draft = null;
            toast(`Removed “${p.title}”`, 'ok');
            location.hash = `${h.id}/projects`;
        };
    };
    showHead();

    const plan = el.querySelector('#p-plan');
    const showPlan = () => {
        plan.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">The plan, steps and anything else worth writing down.</span></div>
            ${p.text ? `<div class="g-text">${textHtml(p.text)}</div>`
                : '<p class="muted">Nothing yet. Press Edit to write the plan.</p>'}`;
        plan.querySelector('[data-edit]').onclick = editPlan;
    };
    const editPlan = () => {
        plan.innerHTML = `
            <div class="guide-form">
                <label class="field">Plan &amp; notes <span class="muted">(“## ” starts a heading, “1.” numbered steps, “-” bullets,
                    “[ ]” a step to do and “[x]” one that's done)</span>
                    <textarea data-f="text" rows="18">${esc(p.text || '')}</textarea></label>
                <div class="row"><span class="spacer"></span>
                    <button type="button" data-cancel>Cancel</button>
                    <button type="button" class="primary" data-save>Save</button></div>
            </div>`;
        const area = plan.querySelector('textarea');
        draft = { start: area.value, read: () => area.value };
        area.focus();
        plan.querySelector('[data-cancel]').onclick = () => {
            if (projectUnsaved() && !confirm('Discard your changes?')) return;
            draft = null;
            showPlan();
        };
        plan.querySelector('[data-save]').onclick = async () => {
            try {
                await update({ text: area.value.replace(/\s+$/, '') });
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            draft = null;
            toast('Saved', 'ok');
            showPlan();
            showHead(); // steps done
        };
    };
    showPlan();

    const places = (h.places || []).map(x => x.name); // offered as a Source
    materials = recordTable(el.querySelector('#p-materials'), {
        columns: MATERIAL_COLUMNS.map(c => (c.name === 'Source' ? { ...c, suggestions: places } : c)),
        rows: p.materials || [],
        save: rows => update({ materials: rows }),
    });

    specs = infoBox(el.querySelector('#p-specs'), {
        info: p.specs || [],
        noun: 'project',
        save: async info => update({ specs: info }),
    });

    costs = recordTable(el.querySelector('#p-costs'), {
        columns: COST_COLUMNS.map(c => (c.name === 'Source' ? { ...c, suggestions: places } : c)),
        rows: p.costs || [],
        save: async rows => { await update({ costs: rows }); showHead(); }, // the total
    });

    renderGallery(el.querySelector('#p-photos'), projectDir(h, p), { noun: 'image' }).catch(err => {
        el.querySelector('#p-photos').innerHTML = `<div class="banner bad">Couldn't load images: ${esc(err.message)}</div>`;
    });

    const futureHref = `#${h.id}/updates/${FUTURE_UPDATES.id}`;
    el.querySelector('#p-updates').innerHTML = linked.length
        ? `<ul class="project-updates">${linked.map(r => `<li><strong>${esc(r.Update || '(no description)')}</strong>
                ${r['Planned Date'] ? ` — planned ${esc(showDate(r['Planned Date']))}` : ''}${r.Location ? ` · ${esc(r.Location)}` : ''}</li>`).join('')}</ul>
            <p class="muted">Change them under <a href="${esc(futureHref)}">Updates → Future Updates</a>.</p>`
        : `<p class="muted">None linked yet. Under <a href="${esc(futureHref)}">Updates → Future Updates</a>, pick this project in
            an update's Project column.</p>`;
}

/** After a project is renamed: Future Updates rows that named it get the new name (that's how they're linked). */
async function renameLinks(h, from, to) {
    const rows = await loadTable(h, FUTURE_UPDATES);
    if (!rows.some(r => r.Project === from)) return;
    await saveTable(h, FUTURE_UPDATES, rows.map(r => (r.Project === from ? { ...r, Project: to } : r)));
}
