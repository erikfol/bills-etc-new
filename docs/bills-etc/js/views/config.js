import * as fs from '../fs.js';
import { PATHS, loadConfig, DEFAULT_CONFIG } from '../data.js';
import { getCategories } from '../rules.js';
import { categoryUsage, addCategory, renameCategory, removeCategory, validateName, LOCKED } from '../categories.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { closeFilterMenu } from '../datatable.js';
import { hasBills } from '../bills.js';
import { renderMerchants, merchantsCanLeave } from './merchantrules.js';

let dirty = false;

const TABS = [
    { id: 'income', label: 'Income & Bills' },
    { id: 'categories', label: 'Categories' },
    { id: 'merchants', label: 'Merchants' },
];

const kvRow = (name, value, placeholder) => `
    <div class="kv-row">
        <input type="text" class="k" value="${esc(name)}" placeholder="${placeholder}">
        <input type="number" class="v" step="0.01" value="${esc(value)}" placeholder="0.00">
        <button class="small danger" data-remove title="Remove">✕</button>
    </div>`;

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        const tab = TABS.find(t => t.id === location.hash.split('/')[1]) || TABS[0];
        dirty = false;
        el.innerHTML = `
            <h1 class="page">Config</h1>
            <nav class="subnav">${TABS.map(t => `<a href="#config/${t.id}"${t === tab ? ' class="active"' : ''}>${esc(t.label)}</a>`).join('')}</nav>
            <div id="tab"></div>`;
        const body = el.querySelector('#tab');
        if (tab.id === 'merchants') return renderMerchants(body, () => this.render(el));
        if (tab.id === 'categories') return this.categories(body, el);
        return this.income(body, el);
    },

    async income(el, page) {
        let cfg, error = null;
        try { cfg = await loadConfig(); } catch (e) { error = e.message; }
        const isNew = !cfg && !error;
        if (error) {
            el.innerHTML = `<div class="banner bad">config.json isn't valid JSON (${esc(error)}). Fix it in a text editor, or delete it to start fresh here.</div>`;
            return;
        }
        cfg = cfg || structuredClone(DEFAULT_CONFIG);

        const incomes = Object.entries(cfg).filter(([k, v]) => k.startsWith('monthly_income') && typeof v === 'number');
        const fixed = Object.entries(cfg.fixed_expenses || {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number');
        const billsMode = hasBills(cfg); // fixed expenses then come from the Bills page
        const fixedSum = fixed.reduce((a, [, v]) => a + v, 0);
        const vars = new Set((cfg.variable_categories || []).filter(c => typeof c === 'string' && !c.startsWith('_')));
        const varChoices = [...getCategories().filter(c => c !== 'Income'), ...[...vars].filter(c => !getCategories().includes(c))];

        el.innerHTML = `<div id="cfg">
            <div class="row" style="margin-bottom:6px">
                <p class="lead" style="margin:0">Expected income and bills that This Month uses for the projection. Saved to <code>config.json</code>; notes (keys starting with <code>_</code>) are kept.</p>
                <span class="spacer"></span>
                <span id="total" class="muted" style="font-size:0.9em"></span>
                <button class="primary" id="save">${isNew ? 'Create config.json' : 'Save'}</button>
            </div>
            ${isNew ? '<div class="banner">No config.json found. Fill this in and click <strong>Create config.json</strong>.</div>' : ''}
            <div class="grid-2">
                <section>
                    <h2>Monthly Income <span class="sub">take-home, after taxes</span></h2>
                    <div id="incomes">${incomes.map(([k, v]) => kvRow(k.replace(/^monthly_income_?/, ''), v, 'source name')).join('')}</div>
                    <button class="small" id="add-income">+ Add income source</button>
                    <p class="note">Don't count bonuses or tax refunds.</p>
                </section>
                <section>
                    ${billsMode ? `<h2>Scheduled Bills <span class="sub">monthly equivalent</span></h2>
                    <p>Your ${fixed.length} active bills come to <strong>${esc(money(fixedSum))}</strong> a month. Add or change them on the <a href="#bills">Bills</a> page.</p>
                    <p class="note">config.json's <code>fixed_expenses</code> is kept in step with your bills, so the Python scripts use them too.</p>`
                    : `<h2>Fixed Expenses <span class="sub">same amount every month</span></h2>
                    <div id="fixed">${fixed.map(([k, v]) => kvRow(k, v, 'e.g. Internet')).join('')}</div>
                    <button class="small" id="add-fixed">+ Add bill</button>
                    <p class="note">Tip: set up scheduled bills on the <a href="#bills">Bills</a> page instead, to see which are paid and which are still due.</p>`}
                </section>
            </div>
            <section style="margin-top:18px">
                <h2>Variable Categories <span class="sub">day-scaled to project the full month</span></h2>
                <div class="check-grid">${varChoices.map(c => `<label class="check"><input type="checkbox" value="${esc(c)}"${vars.has(c) ? ' checked' : ''}> ${esc(c)}</label>`).join('')}</div>
                <p class="note">Projection = (spent so far ÷ days elapsed) × days in month. ${billsMode ? 'Scheduled bills are left out of this and added on top.' : 'Fixed expenses are added on top.'}</p>
            </section></div>`;
        const root = el.querySelector('#cfg');

        const totals = () => {
            const sumOf = id => [...el.querySelectorAll(`#${id} .v`)].reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
            const inc = sumOf('incomes'), fix = billsMode ? fixedSum : sumOf('fixed');
            el.querySelector('#total').textContent = `Income ${money(inc)} − fixed ${money(fix)} = ${money(inc - fix, true)} for variable spending`;
        };
        const markDirty = () => { dirty = true; totals(); };
        root.addEventListener('input', markDirty);
        root.addEventListener('change', markDirty);
        root.addEventListener('click', e => {
            if (e.target.matches('[data-remove]')) { e.target.closest('.kv-row').remove(); markDirty(); }
        });
        el.querySelector('#add-income').onclick = () => { el.querySelector('#incomes').insertAdjacentHTML('beforeend', kvRow('', '', 'source name')); markDirty(); };
        if (!billsMode) el.querySelector('#add-fixed').onclick = () => { el.querySelector('#fixed').insertAdjacentHTML('beforeend', kvRow('', '', 'e.g. Internet')); markDirty(); };
        totals();

        el.querySelector('#save').onclick = async () => {
            const read = id => [...el.querySelectorAll(`#${id} .kv-row`)]
                .map(r => [r.querySelector('.k').value.trim(), parseFloat(r.querySelector('.v').value) || 0])
                .filter(([k]) => k);

            // Rebuild in place so `_` notes and key order survive.
            const out = {};
            let incomeWritten = false;
            const writeIncomes = () => {
                for (const [k, v] of read('incomes')) out['monthly_income_' + k.replace(/\s+/g, '_')] = v;
                incomeWritten = true;
            };
            for (const [k, v] of Object.entries(cfg)) {
                if (k.startsWith('monthly_income') && typeof v === 'number') { if (!incomeWritten) writeIncomes(); continue; }
                if (k === 'fixed_expenses' && !billsMode) {
                    out.fixed_expenses = Object.fromEntries(Object.entries(v || {}).filter(([fk]) => fk.startsWith('_')));
                    for (const [fk, fv] of read('fixed')) out.fixed_expenses[fk] = fv;
                    continue;
                }
                if (k === 'variable_categories') {
                    out.variable_categories = [
                        ...(v || []).filter(c => typeof c === 'string' && c.startsWith('_')),
                        ...[...el.querySelectorAll('.check-grid input:checked')].map(i => i.value),
                    ];
                    continue;
                }
                out[k] = v;
            }
            if (!incomeWritten) writeIncomes();
            if (!out.fixed_expenses && !billsMode) out.fixed_expenses = Object.fromEntries(read('fixed'));
            if (!out.variable_categories) out.variable_categories = [...el.querySelectorAll('.check-grid input:checked')].map(i => i.value);

            try {
                await fs.writeText(PATHS.config, JSON.stringify(out, null, 2) + '\n');
                dirty = false;
                toast('Saved config.json', 'ok');
                this.render(page);
            } catch (e) {
                toast(`Save failed: ${e.message}`, 'bad');
            }
        };
    },

    async categories(el, page) {
        el.innerHTML = `
            <section id="cats">
                <h2>Categories <span class="sub">add, rename or merge; changes apply right away</span></h2>
                <div id="cat-list"><p class="muted">Counting…</p></div>
                <div class="row" style="margin-top:12px">
                    <input type="text" id="new-cat" placeholder="New category name" style="width:220px">
                    <button id="add-cat">+ Add category</button>
                </div>
                <p class="note">Renaming updates every transaction in your history and current month. Renaming into an existing category merges the two.
                Your merchant rules follow your renames. ${esc(LOCKED)} can't be renamed because the cash-flow totals depend on it.</p>
            </section>`;
        const drawCats = async () => {
            const usage = await categoryUsage();
            const cats = getCategories();
            const unknown = Object.keys(usage).filter(c => !cats.includes(c)).sort();
            const row = (c, known) => `
                <tr data-cat="${esc(c)}">
                    <td class="cat-name">${esc(c)}${known ? '' : ' <span class="badge badge-warn" title="Used by transactions but not in your category list">not in list</span>'}</td>
                    <td class="amt">${(usage[c] || 0).toLocaleString()}</td>
                    <td style="text-align:right;white-space:nowrap">
                        ${known ? '' : '<button class="small" data-act="adopt">Add to list</button>'}
                        ${c === LOCKED ? '<span class="muted" style="font-size:0.85em">locked</span>' : '<button class="small" data-act="rename">Rename</button>'}
                        ${known && c !== LOCKED && !usage[c] ? '<button class="small danger" data-act="remove">Remove</button>' : ''}
                    </td>
                </tr>`;
            el.querySelector('#cat-list').innerHTML = `<div class="table-wrap"><table class="summary-table">
                <thead><tr><th>Category</th><th class="num">Transactions</th><th></th></tr></thead>
                <tbody>${cats.map(c => row(c, true)).join('')}${unknown.map(c => row(c, false)).join('')}</tbody></table></div>`;
        };
        const catList = el.querySelector('#cat-list');
        catList.addEventListener('click', async e => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const tr = btn.closest('tr'), name = tr.dataset.cat;
            try {
                if (btn.dataset.act === 'rename') {
                    tr.querySelector('.cat-name').innerHTML = `<input type="text" class="rename-to" value="${esc(name)}" style="width:200px">`;
                    tr.lastElementChild.innerHTML = '<button class="small primary" data-act="do-rename">Save</button> <button class="small" data-act="cancel">Cancel</button>';
                    const input = tr.querySelector('.rename-to');
                    input.focus(); input.select();
                    input.onkeydown = ev => {
                        if (ev.key === 'Enter') tr.querySelector('[data-act="do-rename"]').click();
                        if (ev.key === 'Escape') drawCats();
                    };
                } else if (btn.dataset.act === 'cancel') {
                    drawCats();
                } else if (btn.dataset.act === 'do-rename') {
                    const to = tr.querySelector('.rename-to').value.trim();
                    if (!to || to === name) return drawCats();
                    const merge = getCategories().find(c => c.toLowerCase() === to.toLowerCase() && c !== name);
                    if (merge && !confirm(`“${merge}” already exists. Merge “${name}” into “${merge}”? All its transactions move to “${merge}”.`)) return;
                    btn.disabled = true;
                    const n = await renameCategory(name, to);
                    toast(`${merge ? 'Merged' : 'Renamed'} “${name}” → “${merge || to}” (${n} transaction${n === 1 ? '' : 's'} updated)`, 'ok');
                    this.render(page);
                } else if (btn.dataset.act === 'remove') {
                    await removeCategory(name);
                    toast(`Removed “${name}”`, 'ok');
                    this.render(page);
                } else if (btn.dataset.act === 'adopt') {
                    await addCategory(name);
                    toast(`Added “${name}” to your categories`, 'ok');
                    this.render(page);
                }
            } catch (err) {
                toast(err.message, 'bad');
            }
        });
        el.querySelector('#add-cat').onclick = async () => {
            const input = el.querySelector('#new-cat');
            const err = validateName(input.value, getCategories());
            if (err) return toast(err, 'bad');
            try {
                await addCategory(input.value);
                toast(`Added “${input.value.trim()}”`, 'ok');
                this.render(page);
            } catch (e) { toast(e.message, 'bad'); }
        };
        el.querySelector('#new-cat').onkeydown = e => { if (e.key === 'Enter') el.querySelector('#add-cat').click(); };
        drawCats();

    },

    destroy() {
        closeFilterMenu();
    },

    canLeave(unloading) {
        if (!merchantsCanLeave(unloading)) return false;
        if (!dirty) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved config changes. Leave without saving?')) return false;
        dirty = false;
        return true;
    },
};
