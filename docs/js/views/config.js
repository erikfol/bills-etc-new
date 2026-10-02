import * as fs from '../fs.js';
import { PATHS, loadConfig, DEFAULT_CONFIG } from '../data.js';
import { ALLOWED_CATEGORIES } from '../rules.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';

let dirty = false;

const kvRow = (name, value, placeholder) => `
    <div class="kv-row">
        <input type="text" class="k" value="${esc(name)}" placeholder="${placeholder}">
        <input type="number" class="v" step="0.01" value="${esc(value)}" placeholder="0.00">
        <button class="small danger" data-remove title="Remove">✕</button>
    </div>`;

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        let cfg, error = null;
        try { cfg = await loadConfig(); } catch (e) { error = e.message; }
        const isNew = !cfg && !error;
        if (error) {
            el.innerHTML = `<div class="banner bad">config.json isn't valid JSON (${esc(error)}). Fix it in a text editor, or delete it to start fresh here.</div>`;
            return;
        }
        cfg = cfg || structuredClone(DEFAULT_CONFIG);
        dirty = false;

        const incomes = Object.entries(cfg).filter(([k, v]) => k.startsWith('monthly_income') && typeof v === 'number');
        const fixed = Object.entries(cfg.fixed_expenses || {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number');
        const vars = new Set((cfg.variable_categories || []).filter(c => typeof c === 'string' && !c.startsWith('_')));
        const varChoices = [...ALLOWED_CATEGORIES.filter(c => c !== 'Income'), ...[...vars].filter(c => !ALLOWED_CATEGORIES.includes(c))];

        el.innerHTML = `<div id="cfg">
            <div class="row" style="margin-bottom:6px">
                <h1 class="page">Config</h1>
                <span class="spacer"></span>
                <span id="total" class="muted" style="font-size:0.9em"></span>
                <button class="primary" id="save">${isNew ? 'Create config.json' : 'Save'}</button>
            </div>
            <p class="lead">Expected income and bills that step 3 uses for the projection. Saved to <code>config.json</code>; notes (keys starting with <code>_</code>) are kept.</p>
            ${isNew ? '<div class="banner">No config.json found. Fill this in and click <strong>Create config.json</strong>.</div>' : ''}
            <div class="grid-2">
                <section>
                    <h2>Monthly Income <span class="sub">take-home, after taxes</span></h2>
                    <div id="incomes">${incomes.map(([k, v]) => kvRow(k.replace(/^monthly_income_?/, ''), v, 'source name')).join('')}</div>
                    <button class="small" id="add-income">+ Add income source</button>
                    <p class="note">Don't count bonuses or tax refunds.</p>
                </section>
                <section>
                    <h2>Fixed Expenses <span class="sub">same amount every month</span></h2>
                    <div id="fixed">${fixed.map(([k, v]) => kvRow(k, v, 'e.g. Internet')).join('')}</div>
                    <button class="small" id="add-fixed">+ Add bill</button>
                </section>
            </div>
            <section style="margin-top:18px">
                <h2>Variable Categories <span class="sub">day-scaled to project the full month</span></h2>
                <div class="check-grid">${varChoices.map(c => `<label class="check"><input type="checkbox" value="${esc(c)}"${vars.has(c) ? ' checked' : ''}> ${esc(c)}</label>`).join('')}</div>
                <p class="note">Projection = (spent so far ÷ days elapsed) × days in month. Fixed expenses are added on top.</p>
            </section></div>`;
        const root = el.querySelector('#cfg');

        const totals = () => {
            const sumOf = id => [...el.querySelectorAll(`#${id} .v`)].reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
            const inc = sumOf('incomes'), fix = sumOf('fixed');
            el.querySelector('#total').textContent = `Income ${money(inc)} − fixed ${money(fix)} = ${money(inc - fix, true)} for variable spending`;
        };
        const markDirty = () => { dirty = true; totals(); };
        root.addEventListener('input', markDirty);
        root.addEventListener('change', markDirty);
        root.addEventListener('click', e => {
            if (e.target.matches('[data-remove]')) { e.target.closest('.kv-row').remove(); markDirty(); }
        });
        el.querySelector('#add-income').onclick = () => { el.querySelector('#incomes').insertAdjacentHTML('beforeend', kvRow('', '', 'source name')); markDirty(); };
        el.querySelector('#add-fixed').onclick = () => { el.querySelector('#fixed').insertAdjacentHTML('beforeend', kvRow('', '', 'e.g. Internet')); markDirty(); };
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
                if (k === 'fixed_expenses') {
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
            if (!out.fixed_expenses) out.fixed_expenses = Object.fromEntries(read('fixed'));
            if (!out.variable_categories) out.variable_categories = [...el.querySelectorAll('.check-grid input:checked')].map(i => i.value);

            try {
                await fs.writeText(PATHS.config, JSON.stringify(out, null, 2) + '\n');
                dirty = false;
                toast('Saved config.json', 'ok');
                this.render(el);
            } catch (e) {
                toast(`Save failed: ${e.message}`, 'bad');
            }
        };
    },

    canLeave(unloading) {
        if (!dirty) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved config changes. Leave without saving?')) return false;
        dirty = false;
        return true;
    },
};
