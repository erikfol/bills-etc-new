// Config → Merchants: one table of your merchant rules plus the merchant names no rule covers yet.
// A rule says "bank text containing X → name it Y and/or categorize it Z" (config.json merchant_rules).
import { getCategories } from '../rules.js';
import { esc, toast } from '../util.js';
import { dataTable } from '../datatable.js';
import {
    merchantSummary, suggestGroups, mergeMerchants, getMerchantRules, saveRule, removeRule, applyRuleToExisting,
    sharedBankText, compactText, merchantNameKey, MIN_BANK_TEXT,
} from '../merchants.js';

let formOpen = false;
let view = 'all'; // which rows are shown; kept while you move around

export function merchantsCanLeave(unloading) {
    if (!formOpen) return true;
    if (unloading) return false;
    if (!confirm('You have a rule form open. Leave without saving?')) return false;
    formOpen = false;
    return true;
}

// Names the bank's transaction type sets (not merchants).
const TX_TYPES = new Set(['ATM', 'CHECK', 'TRANSFER']);
const pieces = text => String(text ?? '').split(',').map(compactText).filter(Boolean);
const topCats = cats => Object.entries(cats).sort((a, b) => b[1] - a[1]);

export async function renderMerchants(el, rerender) {
    el.innerHTML = '<p class="muted">Loading merchants…</p>';
    formOpen = false;
    const summary = (await merchantSummary()).filter(m => !TX_TYPES.has(m.name));
    const rules = getMerchantRules();

    /** Transactions a rule (or rule being edited) would apply to, counted over the merchant summary. */
    const reach = ({ name, match = [], bank = [] }) => {
        const keys = new Set([...match.map(merchantNameKey), ...(name ? [merchantNameKey(name)] : [])]);
        let n = 0;
        const names = [];
        for (const m of summary) {
            const k = keys.has(m.key) ? m.count : bank.length ? m.descs.filter(d => bank.some(b => d.includes(b))).length : 0;
            if (k) { n += k; names.push(m.name); }
        }
        return { n, names };
    };
    // A named rule covers a spelling when it lists it, or its bank text is in every one of its transactions.
    const covers = (r, m) => !!r.name && (r.match.includes(m.key) || merchantNameKey(r.name) === m.key
        || (r.bank.length > 0 && m.descs.every(d => r.bank.some(b => d.includes(b)))));

    const ruleRows = rules.map(r => {
        const { n, names } = reach(r);
        return { id: 'r' + r.i, kind: 'rule', rule: r, name: r.name || '', count: n, spellings: r.name ? summary.filter(m => covers(r, m)).map(m => m.name) : names };
    });
    const covered = new Set(ruleRows.filter(x => x.rule.name).flatMap(x => x.spellings));
    const needRows = summary.filter(m => !covered.has(m.name)).map((m, k) => ({
        id: 'm' + k, kind: 'needs', m, name: m.name, count: m.count, spellings: [m.name], bankHint: sharedBankText(m.descs),
    }));
    const rows = [...ruleRows, ...needRows];

    // Possible duplicates: spellings that look alike where at least one has no rule yet.
    const groups = suggestGroups(summary).filter(g => g.spellings.some(m => !covered.has(m.name)));
    const groupOf = new Map();
    groups.forEach((g, gi) => g.spellings.forEach(m => groupOf.set(m.name, gi)));
    const dupGroup = row => (row.kind === 'rule' && !row.rule.name ? null : row.spellings.map(n => groupOf.get(n)).find(g => g != null));
    const isDup = row => dupGroup(row) != null;

    const counts = { all: rows.length, needs: needRows.length, dups: rows.filter(isDup).length, rules: ruleRows.length };
    const VIEWS = { all: 'All', needs: 'Needs a rule', dups: 'Possible duplicates', rules: 'Rules' };
    if (!counts[view]) view = 'all';

    el.innerHTML = `
        <p class="lead">Each <strong>rule</strong> says: when the bank's text contains these letters, use this merchant name and/or category.
            Rules run on every new transaction (before the AI, in the app and the Python scripts). Merchants without a rule keep whatever name history or the AI gave them.</p>
        <div class="row" style="margin-bottom:10px">
            <span id="views">${Object.entries(VIEWS).map(([k, v]) => `<button class="chip${k === view ? ' active' : ''}" data-view="${k}">${v} <span class="muted">${counts[k]}</span></button>`).join(' ')}</span>
            <span class="spacer"></span>
            <input type="search" id="q" placeholder="Search names and bank text" style="min-width:220px">
            <button class="small" id="new-rule">+ New rule</button>
        </div>
        <form id="rule-form" class="add-bill" hidden style="margin:0 0 14px"></form>
        <div class="merge-bar" id="m-bar" hidden>
            <div class="row">
                <span id="m-what"></span>
                <label class="field" style="flex-direction:row;align-items:center;gap:6px">into <input type="text" id="m-name" style="width:200px"></label>
                <label class="field" style="flex-direction:row;align-items:center;gap:6px">Category <select id="m-cat"></select></label>
            </div>
            <div class="row" style="margin-top:8px">
                <label class="field" style="flex-direction:row;align-items:center;gap:6px">Bank text contains <input type="text" id="m-bank" style="width:200px" placeholder="e.g. STRAIGHTTALK"></label>
                <span class="muted" id="m-bank-info" style="font-size:0.85em"></span>
            </div>
            <div class="row" style="margin-top:8px">
                <label class="check"><input type="checkbox" id="m-remember" checked> Save as a rule for new transactions</label>
                <span class="spacer"></span>
                <button type="button" id="m-clear">Clear selection</button>
                <button type="button" class="primary" id="m-go">Merge</button>
            </div>
        </div>
        <div id="t-merchants"></div>`;
    const $ = s => el.querySelector(s);
    const selected = new Set();

    // ── The table ──
    const catCell = row => {
        if (row.kind === 'rule') return row.rule.category ? `<span class="cat-badge">${esc(row.rule.category)}</span>` : '<span class="muted">keeps its own</span>';
        const c = topCats(row.m.cats);
        return `<span class="cat-badge">${esc(c[0]?.[0] || '')}</span>${c.length > 1 ? ` <span class="muted" style="font-size:0.85em">+${c.length - 1} more</span>` : ''}`;
    };
    const covers_ = r => {
        const o = r.spellings.filter(n => n !== r.name);
        return o.length ? `<div class="muted" style="font-size:0.82em">covers ${esc(o.slice(0, 4).join(', '))}${o.length > 4 ? `, +${o.length - 4} more` : ''}</div>` : '';
    };
    const table = dataTable($('#t-merchants'), {
        columns: [
            { id: 'sel', label: '✓', value: r => (selected.has(r.id) ? 'Selected' : ''),
                cell: r => (r.kind === 'rule' && !r.rule.name ? '' : `<input type="checkbox" data-sel="${r.id}"${selected.has(r.id) ? ' checked' : ''} aria-label="Select ${esc(r.name || 'rule')}">`) },
            { id: 'name', label: 'Merchant', value: r => r.name || '(any merchant)',
                cell: r => `${r.kind === 'rule' && !r.rule.name ? '<em class="muted">any merchant</em>' : `<strong>${esc(r.name)}</strong>`}${
                    isDup(r) ? ` <button class="small" data-dup="${dupGroup(r)}" title="Show the names that look like this one">possible duplicate</button>` : ''}${
                    r.kind === 'rule' && r.rule.notes ? `<div class="muted" style="font-size:0.85em">${esc(r.rule.notes)}</div>` : ''}${covers_(r)}` },
            { id: 'status', label: 'Status', value: r => (r.kind === 'rule' ? 'Rule' : 'Needs a rule'),
                cell: r => (r.kind === 'rule' ? '<span class="badge badge-ok">Rule</span>' : '<span class="badge badge-warn">Needs a rule</span>') },
            { id: 'bank', label: 'Bank text contains', value: r => (r.kind === 'rule' ? r.rule.bank.join(', ') : ''),
                cell: r => (r.kind === 'rule'
                    ? (r.rule.bank.length ? r.rule.bank.map(b => `<code>${esc(b.toUpperCase())}</code>`).join(' ') : '<span class="muted">exact names only</span>')
                    : (r.bankHint ? `<span class="muted" title="Suggested from its transactions">${esc(r.bankHint.toUpperCase())}?</span>` : '')) },
            { id: 'cat', label: 'Category', value: r => (r.kind === 'rule' ? r.rule.category || '' : topCats(r.m.cats)[0]?.[0] || ''), cell: catCell },
            { id: 'count', label: 'Transactions', num: true, value: r => r.count, text: v => String(v) },
            { id: 'act', label: '', value: () => '',
                cell: r => (r.kind === 'rule' ? `<button class="small" data-edit="${r.rule.i}">Edit</button>` : `<button class="small" data-make="${r.id}">Make rule</button>`) },
        ],
        rows,
        sort: { col: 'count', dir: 'desc' },
        rowLimit: 300,
        empty: 'Nothing here',
        rowClass: r => (selected.has(r.id) ? 'selected-row' : ''),
    });
    let only = null; // a duplicate group being reviewed
    const applyView = () => {
        const q = compactText($('#q').value);
        table.setFilter(r => (only ? only.has(r.id) : view === 'all' || (view === 'needs' && r.kind === 'needs') || (view === 'rules' && r.kind === 'rule') || (view === 'dups' && isDup(r)))
            && (!q || compactText(`${r.name} ${r.spellings.join(' ')} ${r.kind === 'rule' ? r.rule.bank.join(' ') : r.bankHint}`).includes(q)));
        el.querySelectorAll('#views [data-view]').forEach(b => b.classList.toggle('active', !only && b.dataset.view === view));
    };
    el.querySelectorAll('#views [data-view]').forEach(b => { b.onclick = () => { view = b.dataset.view; only = null; applyView(); }; });
    $('#q').oninput = applyView;
    applyView();

    // ── Selecting rows to merge ──
    const byId = new Map(rows.map(r => [r.id, r]));
    const pickedRows = () => [...selected].map(id => byId.get(id));
    const bankPieces = () => pieces($('#m-bank').value).filter(b => b.length >= MIN_BANK_TEXT);
    const bankInfo = () => {
        const raw = $('#m-bank').value.trim();
        if (!raw) { $('#m-bank-info').textContent = 'optional: also catches future misspellings'; return; }
        if (!bankPieces().length) { $('#m-bank-info').textContent = `use at least ${MIN_BANK_TEXT} letters`; return; }
        const spell = new Set(pickedRows().flatMap(r => r.spellings));
        const { n, names } = reach({ bank: bankPieces() });
        const others = names.filter(x => !spell.has(x));
        $('#m-bank-info').innerHTML = `matches ${n} transaction${n === 1 ? '' : 's'}${others.length ? `, <strong>including ones named ${others.slice(0, 5).map(esc).join(', ')}${others.length > 5 ? ', …' : ''}</strong>` : ''}`;
    };
    const refreshBar = () => {
        const picked = pickedRows();
        $('#m-bar').hidden = !picked.length;
        if (!picked.length) return;
        const spell = [...new Set(picked.flatMap(r => r.spellings))];
        const n = summary.filter(m => spell.includes(m.name)).reduce((a, m) => a + m.count, 0);
        $('#m-what').innerHTML = `Merge <strong>${spell.length}</strong> name${spell.length === 1 ? '' : 's'} (${n} transaction${n === 1 ? '' : 's'})`;
        const named = picked.find(r => r.kind === 'rule');
        if (!$('#m-name').dataset.touched) $('#m-name').value = named?.name || [...picked].sort((a, b) => b.count - a.count)[0].name;
        if (!$('#m-bank').dataset.touched) {
            const ruleBank = picked.flatMap(r => (r.kind === 'rule' ? r.rule.bank : []));
            $('#m-bank').value = (ruleBank.length ? ruleBank : [sharedBankText(summary.filter(m => spell.includes(m.name)).flatMap(m => m.descs))].filter(Boolean)).map(b => b.toUpperCase()).join(', ');
        }
        const keep = $('#m-cat').value || named?.rule.category || '';
        $('#m-cat').innerHTML = `<option value="">Keep each transaction's category</option>` + getCategories().map(c => `<option${c === keep ? ' selected' : ''}>${esc(c)}</option>`).join('');
        bankInfo();
    };
    $('#m-name').addEventListener('input', e => { e.target.dataset.touched = '1'; });
    $('#m-bank').addEventListener('input', e => { e.target.dataset.touched = '1'; bankInfo(); });
    $('#t-merchants').addEventListener('change', e => {
        const id = e.target.dataset?.sel;
        if (!id) return;
        e.target.checked ? selected.add(id) : selected.delete(id);
        e.target.closest('tr').classList.toggle('selected-row', e.target.checked);
        refreshBar();
    });
    $('#m-clear').onclick = () => {
        selected.clear(); only = null;
        delete $('#m-name').dataset.touched; delete $('#m-bank').dataset.touched;
        applyView(); table.redraw(); refreshBar();
    };
    $('#m-go').onclick = async () => {
        const picked = pickedRows();
        const spellings = [...new Set(picked.flatMap(r => r.spellings))];
        const name = $('#m-name').value.trim();
        const category = $('#m-cat').value || null;
        const bankText = bankPieces();
        if (!name) return toast('Enter the merchant name to keep.', 'bad');
        const extra = reach({ bank: bankText }).names.filter(x => !spellings.includes(x));
        if (!confirm(`Rename ${spellings.length} name${spellings.length === 1 ? '' : 's'}${extra.length ? ` (plus transactions under ${extra.length} other name${extra.length === 1 ? '' : 's'} that the bank text catches)` : ''} to “${name}”${category ? ` and set the category to ${category}` : ''}?`)) return;
        try {
            const changed = await mergeMerchants({ spellings, name, category, remember: $('#m-remember').checked, bankText });
            toast(`Updated ${changed} transaction${changed === 1 ? '' : 's'} → “${name}”`, 'ok');
            rerender();
        } catch (e) { toast(e.message, 'bad'); }
    };

    // Review a duplicate group: show just those names with the likely matches ticked.
    $('#t-merchants').addEventListener('click', e => {
        const dup = e.target.closest('[data-dup]');
        if (!dup) return;
        const g = groups[+dup.dataset.dup];
        const names = new Set(g.spellings.map(m => m.name));
        const ids = rows.filter(r => r.spellings.some(n => names.has(n))).map(r => r.id);
        only = new Set(ids);
        selected.clear();
        rows.filter(r => ids.includes(r.id) && (r.kind === 'rule' ? r.rule.name : g.likely.includes(r.name))).forEach(r => selected.add(r.id));
        delete $('#m-name').dataset.touched; delete $('#m-bank').dataset.touched;
        applyView(); table.redraw(); refreshBar();
        $('#m-bar').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    // ── Add / edit one rule ──
    const form = $('#rule-form');
    const openForm = (r, title, index = null) => {
        form.innerHTML = `
            <h3>${esc(title)}</h3>
            <div class="add-grid">
                <label class="field">Bank text contains<input type="text" name="bank" value="${esc((r.bank || []).map(b => b.toUpperCase()).join(', '))}" placeholder="e.g. STRAIGHTTALK">
                    <span class="muted" style="font-size:0.8em">Letters from the bank's description; separate several with commas</span></label>
                <label class="field">Merchant name<input type="text" name="name" value="${esc(r.name || '')}" placeholder="leave blank to keep each name">
                    <span class="muted" style="font-size:0.8em">Blank = only set the category</span></label>
                <label class="field">Category<select name="category"><option value="">Keep each transaction's category</option>${getCategories().map(c => `<option${c === r.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
                <label class="field">Also these exact names<input type="text" name="match" value="${esc((r.match || []).join(', '))}" placeholder="optional">
                    <span class="muted" style="font-size:0.8em">Names (as the AI or history wrote them) that mean this merchant</span></label>
                <label class="field" style="grid-column:1/-1">Notes<input type="text" name="notes" value="${esc(r.notes || '')}"></label>
            </div>
            <div class="row" style="margin-bottom:12px">
                <label class="check"><input type="checkbox" name="existing" checked> Also update existing transactions it matches</label>
                <span class="muted" id="f-reach" style="font-size:0.85em"></span>
            </div>
            <div class="row"><button type="submit" class="primary">${index == null ? 'Add rule' : 'Save rule'}</button><button type="button" data-cancel>Cancel</button>
                ${index != null ? '<span class="spacer"></span><button type="button" class="danger" data-remove>Remove rule</button>' : ''}</div>`;
        form.hidden = false;
        formOpen = true;
        const f = n => form.querySelector(`[name=${n}]`);
        const draft = () => ({
            name: f('name').value.trim(), bank: pieces(f('bank').value).filter(b => b.length >= MIN_BANK_TEXT),
            match: f('match').value.split(',').map(s => s.trim()).filter(Boolean), category: f('category').value,
        });
        const showReach = () => {
            const d = draft(), { n, names } = reach(d);
            f('existing').closest('label').hidden = !(d.name || d.category);
            form.querySelector('#f-reach').textContent = n ? `${n} existing transaction${n === 1 ? '' : 's'} (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})` : 'matches no existing transactions';
        };
        form.oninput = showReach;
        showReach();
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        f('bank').focus();
        form.querySelector('[data-cancel]').onclick = () => { form.hidden = true; formOpen = false; };
        form.querySelector('[data-remove]')?.addEventListener('click', async () => {
            if (!confirm(`Remove this rule? Existing transactions keep their names and categories.`)) return;
            await removeRule(index);
            formOpen = false;
            toast('Rule removed', 'ok');
            rerender();
        });
        form.onsubmit = async e => {
            e.preventDefault();
            const d = draft();
            if (pieces(f('bank').value).some(b => b.length < MIN_BANK_TEXT)) return toast(`Use at least ${MIN_BANK_TEXT} letters for each piece of bank text.`, 'bad');
            try {
                const saved = await saveRule({ name: d.name, match: d.match, bank_text: d.bank, category: d.category || null, notes: f('notes').value }, index);
                let msg = index == null ? 'Rule added' : 'Rule saved';
                if (f('existing').checked && (saved.name || saved.category)) {
                    const n = await applyRuleToExisting(saved);
                    msg += `; ${n} existing transaction${n === 1 ? '' : 's'} updated`;
                }
                formOpen = false;
                toast(msg, 'ok');
                rerender();
            } catch (err) { toast(err.message, 'bad'); }
        };
    };
    $('#new-rule').onclick = () => openForm({}, 'New rule');
    $('#t-merchants').addEventListener('click', e => {
        const ed = e.target.closest('[data-edit]'), mk = e.target.closest('[data-make]');
        if (ed) {
            const r = rules.find(x => x.i === +ed.dataset.edit);
            openForm(r, r.name ? `Edit rule: ${r.name}` : `Edit rule: ${r.category}`, r.i);
        } else if (mk) {
            const row = byId.get(mk.dataset.make);
            openForm({ name: row.name, bank: row.bankHint ? [row.bankHint] : [], category: topCats(row.m.cats)[0]?.[0] || '' }, `New rule for ${row.name}`);
        }
    });
}
