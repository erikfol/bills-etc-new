import * as fs from '../fs.js';
import { PATHS, loadConfig, DEFAULT_CONFIG } from '../data.js';
import { getCategories } from '../rules.js';
import { categoryUsage, addCategory, renameCategory, removeCategory, validateName, LOCKED } from '../categories.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { merchantSummary, suggestGroups, mergeMerchants, removeMerchantRule, setRuleCategory, getMerchantRules } from '../merchants.js';
import { dataTable, closeFilterMenu } from '../datatable.js';

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
        const varChoices = [...getCategories().filter(c => c !== 'Income'), ...[...vars].filter(c => !getCategories().includes(c))];

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
            </section></div>
            <section id="cats">
                <h2>Categories <span class="sub">add, rename or merge; changes apply right away</span></h2>
                <div id="cat-list"><p class="muted">Counting…</p></div>
                <div class="row" style="margin-top:12px">
                    <input type="text" id="new-cat" placeholder="New category name" style="width:220px">
                    <button id="add-cat">+ Add category</button>
                </div>
                <p class="note">Renaming updates every transaction in your history and current month. Renaming into an existing category merges the two.
                The built-in rules follow your renames. ${esc(LOCKED)} can't be renamed because the cash-flow totals depend on it.</p>
            </section>
            <section id="merchants">
                <h2>Merchants <span class="sub">merge different spellings of the same merchant</span></h2>
                <p style="font-size:0.9em;color:#555;margin-bottom:12px">Tick the spellings that are the same merchant (or start from a suggestion), choose the name to keep and, optionally, a category for all of them.</p>
                <div id="m-suggest"><p class="muted">Looking for similar names…</p></div>
                <div class="merge-bar" id="m-bar" hidden>
                    <div class="row">
                        <span id="m-what"></span>
                        <label class="field" style="flex-direction:row;align-items:center;gap:6px">into <input type="text" id="m-name" style="width:200px"></label>
                        <label class="field" style="flex-direction:row;align-items:center;gap:6px">Category <select id="m-cat"></select></label>
                    </div>
                    <div class="row" style="margin-top:8px">
                        <label class="check"><input type="checkbox" id="m-remember" checked> Apply to new transactions too</label>
                        <span class="muted" id="m-cats-now" style="font-size:0.85em"></span>
                        <span class="spacer"></span>
                        <button id="m-clear">Clear selection</button>
                        <button class="primary" id="m-go">Merge</button>
                    </div>
                </div>
                <div class="row" style="margin:12px 0 6px"><strong style="font-size:0.9em">All merchants</strong><span class="spacer"></span><button class="small" id="m-showall" hidden>Show all merchants</button></div>
                <div id="m-table"></div>
                <h3 style="font-size:0.95em;color:#555;margin:18px 0 8px">Merchant rules for new transactions</h3>
                <div id="m-rules"></div>
            </section>`;
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

        // ── Categories ──
        const busyGuard = () => {
            if (!dirty) return true;
            toast('Save or discard your config changes above first.', 'bad');
            return false;
        };
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
            if (!busyGuard()) return;
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
                    this.render(el);
                } else if (btn.dataset.act === 'remove') {
                    await removeCategory(name);
                    toast(`Removed “${name}”`, 'ok');
                    this.render(el);
                } else if (btn.dataset.act === 'adopt') {
                    await addCategory(name);
                    toast(`Added “${name}” to your categories`, 'ok');
                    this.render(el);
                }
            } catch (err) {
                toast(err.message, 'bad');
            }
        });
        el.querySelector('#add-cat').onclick = async () => {
            if (!busyGuard()) return;
            const input = el.querySelector('#new-cat');
            const err = validateName(input.value, getCategories());
            if (err) return toast(err, 'bad');
            try {
                await addCategory(input.value);
                toast(`Added “${input.value.trim()}”`, 'ok');
                this.render(el);
            } catch (e) { toast(e.message, 'bad'); }
        };
        el.querySelector('#new-cat').onkeydown = e => { if (e.key === 'Enter') el.querySelector('#add-cat').click(); };
        drawCats();

        // ── Merchants ──
        const summary = await merchantSummary();
        const selected = new Set();
        const ruleOf = new Map(getMerchantRules().flatMap(r => r.match.map(k => [k, r.name])));
        const catText = m => Object.entries(m.cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ');
        const mTable = dataTable(el.querySelector('#m-table'), {
            columns: [
                { id: 'sel', label: '✓', value: m => (selected.has(m.name) ? 'Selected' : ''), text: v => v,
                    cell: m => `<input type="checkbox" data-sp="${summary.indexOf(m)}"${selected.has(m.name) ? ' checked' : ''} aria-label="Select ${esc(m.name)}">` },
                { id: 'name', label: 'Merchant', value: m => m.name },
                { id: 'count', label: 'Transactions', num: true, value: m => m.count, text: v => String(v) },
                { id: 'cats', label: 'Categories', value: m => Object.entries(m.cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
                    cell: m => `<span class="muted" style="font-size:0.88em">${esc(catText(m))}</span>` },
                { id: 'rule', label: 'Rule', value: m => ruleOf.get(m.key) || '', cell: m => ruleOf.has(m.key) ? `<span class="badge badge-ok">→ ${esc(ruleOf.get(m.key))}</span>` : '' },
            ],
            rows: summary,
            sort: { col: 'count', dir: 'desc' },
            rowLimit: 300,
            empty: 'No merchants yet',
            rowClass: m => (selected.has(m.name) ? 'selected-row' : ''),
        });

        const catSelect = el.querySelector('#m-cat');
        const refreshBar = () => {
            const picked = summary.filter(m => selected.has(m.name));
            el.querySelector('#m-bar').hidden = !picked.length;
            if (!picked.length) return;
            const n = picked.reduce((a, m) => a + m.count, 0);
            el.querySelector('#m-what').innerHTML = `Merge <strong>${picked.length}</strong> spelling${picked.length === 1 ? '' : 's'} (${n} transaction${n === 1 ? '' : 's'})`;
            const nameInput = el.querySelector('#m-name');
            if (!nameInput.dataset.touched) nameInput.value = picked.slice().sort((a, b) => b.count - a.count)[0].name;
            const cats = {};
            for (const m of picked) for (const [c, k] of Object.entries(m.cats)) cats[c] = (cats[c] || 0) + k;
            el.querySelector('#m-cats-now').textContent = 'Now: ' + Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join(' · ');
            const keep = catSelect.value;
            catSelect.innerHTML = `<option value="">Keep each transaction's category</option>` + getCategories().map(c => `<option${c === keep ? ' selected' : ''}>${esc(c)}</option>`).join('');
        };
        el.querySelector('#m-name').addEventListener('input', e => { e.target.dataset.touched = '1'; });
        el.querySelector('#m-table').addEventListener('change', e => {
            const i = e.target.dataset?.sp;
            if (i == null) return;
            const m = summary[+i];
            e.target.checked ? selected.add(m.name) : selected.delete(m.name);
            e.target.closest('tr').classList.toggle('selected-row', e.target.checked);
            refreshBar();
        });
        const showOnly = names => {
            const set = names && new Set(names);
            mTable.setFilter(set ? m => set.has(m.name) : null);
            el.querySelector('#m-showall').hidden = !set;
        };
        el.querySelector('#m-showall').onclick = () => showOnly(null);
        el.querySelector('#m-clear').onclick = () => {
            selected.clear(); delete el.querySelector('#m-name').dataset.touched;
            showOnly(null); refreshBar();
        };

        const groups = suggestGroups(summary).filter(g => !g.spellings.every(m => ruleOf.get(m.key) === ruleOf.get(g.spellings[0].key) && ruleOf.has(m.key)));
        // Confident groups: 2+ spellings that are identical once cleaned up. Others are only possible matches.
        const sure = groups.filter(g => g.likely.length > 1), maybe = groups.filter(g => g.likely.length <= 1);
        const groupRow = g => `
            <div class="suggest-row">
                <span class="suggest-names">${g.spellings.map(m => `<span class="${g.likely.includes(m.name) ? '' : 'muted'}">${esc(m.name)} <small>(${m.count})</small></span>`).join(' · ')}</span>
                <button class="small" data-group="${groups.indexOf(g)}">Review</button>
            </div>`;
        const showGroups = limit => {
            el.querySelector('#m-suggest').innerHTML = `
                <p style="font-size:0.88em;color:#555;margin-bottom:6px"><strong>Same name, different spelling</strong> (${sure.length})</p>
                ${sure.length ? `<div class="suggest-list">${sure.slice(0, limit).map(groupRow).join('')}</div>
                    ${sure.length > limit ? `<button class="small" id="m-more" style="margin-top:6px">Show ${sure.length - limit} more</button>` : ''}`
                    : '<p class="muted" style="font-size:0.9em">None left. Nice and tidy.</p>'}
                ${maybe.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:0.88em;color:#555"><strong>Possible matches</strong> (${maybe.length}): names that start the same; check before merging</summary>
                    <div class="suggest-list" style="margin-top:6px">${maybe.map(groupRow).join('')}</div></details>` : ''}`;
            el.querySelector('#m-more')?.addEventListener('click', () => showGroups(sure.length));
        };
        el.querySelector('#m-suggest').addEventListener('click', e => {
            const gi = e.target.dataset?.group;
            if (gi == null) return;
            const g = groups[+gi];
            selected.clear();
            g.likely.forEach(n => selected.add(n));
            delete el.querySelector('#m-name').dataset.touched;
            showOnly(g.spellings.map(m => m.name));
            refreshBar();
            el.querySelector('#m-bar').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        showGroups(12);

        el.querySelector('#m-go').onclick = async () => {
            if (!busyGuard()) return;
            const spellings = [...selected];
            const name = el.querySelector('#m-name').value.trim();
            const category = catSelect.value || null;
            const n = summary.filter(m => selected.has(m.name)).reduce((a, m) => a + m.count, 0);
            if (!name) return toast('Enter the merchant name to keep.', 'bad');
            if (!confirm(`Rename ${n} transaction${n === 1 ? '' : 's'} to “${name}”${category ? ` and set their category to ${category}` : ''}?`)) return;
            try {
                const changed = await mergeMerchants({ spellings, name, category, remember: el.querySelector('#m-remember').checked });
                toast(`Updated ${changed} transaction${changed === 1 ? '' : 's'} → “${name}”`, 'ok');
                this.render(el);
            } catch (e) { toast(e.message, 'bad'); }
        };

        const drawRules = () => {
            const rules = getMerchantRules();
            el.querySelector('#m-rules').innerHTML = rules.length ? `<div class="table-wrap"><table class="summary-table">
                <thead><tr><th>Merchant</th><th>Matches spellings like</th><th>Category for new transactions</th><th></th></tr></thead>
                <tbody>${rules.map((r, ri) => `<tr>
                    <td><strong>${esc(r.name)}</strong></td>
                    <td class="muted" style="font-size:0.88em">${r.match.map(esc).join(', ')}</td>
                    <td><select data-rule-cat="${ri}"><option value="">Keep whatever it's categorized as</option>${getCategories().map(c => `<option${c === r.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
                    <td style="text-align:right"><button class="small danger" data-rule-del="${ri}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
                : '<p class="muted" style="font-size:0.9em">None yet. Merging with “Apply to new transactions too” ticked creates one.</p>';
        };
        el.querySelector('#m-rules').addEventListener('change', async e => {
            const ri = e.target.dataset?.ruleCat;
            if (ri == null || !busyGuard()) return;
            await setRuleCategory(getMerchantRules()[+ri].name, e.target.value || null);
            toast('Rule updated', 'ok');
        });
        el.querySelector('#m-rules').addEventListener('click', async e => {
            const ri = e.target.dataset?.ruleDel;
            if (ri == null || !busyGuard()) return;
            const r = getMerchantRules()[+ri];
            if (!confirm(`Stop renaming new transactions to “${r.name}”? Existing transactions keep their names.`)) return;
            await removeMerchantRule(r.name);
            toast(`Removed the rule for “${r.name}”`, 'ok');
            this.render(el);
        });
        drawRules();

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

    destroy() {
        closeFilterMenu();
    },

    canLeave(unloading) {
        if (!dirty) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved config changes. Leave without saving?')) return false;
        dirty = false;
        return true;
    },
};
