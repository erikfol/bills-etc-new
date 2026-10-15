// Bills page: scheduled bills (config.json `scheduled_bills`), a 12-month payment grid and
// suggestions from your history. This month's bill status is on the This Month page.
import { loadConfig } from '../data.js';
import { parseBills, hasBills, billMonth, paymentsByMonth, firstPaid, suggestBills, saveBills, allTransactions, addMonths, STATUS, EVERY } from '../bills.js';
import { merchantNameKey } from '../merchants.js';
import { longMonthLabel, monthLabel, yearMonth, MONTH_NAMES } from '../dates.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, moneyColumn, categoryColumn, closeFilterMenu } from '../datatable.js';

let remembered = null; // selected month while moving between pages
let formOpen = false;  // an add/edit form with possible unsaved input

const fmtDay = d => `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading your bills…</p>';
        formOpen = false;
        const cfg = (await loadConfig()) || {};
        const bills = parseBills(cfg);
        const rows = await allTransactions();
        const today = new Date();
        const thisYm = yearMonth(today);
        const dataThrough = rows.reduce((a, r) => (!a || r._date > a ? r._date : a), null);
        const pays = paymentsByMonth(bills, rows);

        // Months to pick from: first month of data through next month.
        const firstYm = rows.length ? rows.reduce((a, r) => (r._ym < a ? r._ym : a), rows[0]._ym) : thisYm;
        const yms = [];
        for (let ym = firstYm; ym <= addMonths(thisYm, 1); ym = addMonths(ym, 1)) yms.push(ym);
        let ym = yms.includes(remembered) ? remembered : thisYm;

        // Category each bill's payments usually have (for display only).
        const catOf = new Map();
        for (const b of bills) {
            const counts = new Map();
            for (const list of pays.get(b.name).values()) for (const r of list) counts.set(r['AI Category'], (counts.get(r['AI Category']) || 0) + 1);
            catOf.set(b.name, [...counts].sort((a, c) => c[1] - a[1])[0]?.[0] || '');
        }
        const merchants = [...new Set(rows.filter(r => r._amt < 0).map(r => String(r['Cleaned Merchant'] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const legacy = Object.entries(cfg.fixed_expenses || {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number');

        el.innerHTML = `
            <div class="row dash-head">
                <h1 class="page">Bills</h1>
                <span class="spacer"></span>
                <div class="month-nav">
                    <button id="prev" title="Previous month" aria-label="Previous month">◀</button>
                    <select id="month">${yms.map(m => `<option value="${m}">${longMonthLabel(m)}</option>`).join('')}</select>
                    <button id="next" title="Next month" aria-label="Next month">▶</button>
                </div>
            </div>
            <p class="lead">Scheduled bills leave on about the same day every month (or every few months). Everything else is unscheduled. This month's bills (paid, still due, late) are on <a href="#month">This Month</a>.
                ${dataThrough ? `Bank data is loaded through <strong>${esc(dataThrough.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</strong>.` : ''}</p>
            ${bills.length ? '' : `<div class="banner"><strong>No scheduled bills yet.</strong> Add them from <strong>Suggested from your history</strong> below, or with <strong>+ Add a bill</strong>.
                ${!hasBills(cfg) && legacy.length ? `Until you add one, This Month keeps using the ${legacy.length} fixed expenses from Config:
                ${legacy.map(([k, v]) => `${esc(k.replace(/_/g, ' '))} ${esc(money(v))}`).join(' · ')}. Once you add a bill, your bills replace that list (a copy is kept in config.json).` : ''}</div>`}

            <section>
                <h2>Your bills <span class="sub">${bills.length} bill${bills.length === 1 ? '' : 's'}</span><span class="spacer"></span><button class="small" id="add">+ Add a bill</button></h2>
                <form id="bill-form" class="add-bill" hidden style="margin-bottom:14px"></form>
                <div id="t-bills"></div>
                <p class="note">A transaction counts as this bill when its merchant (as shown in Finance Table) is one of the bill's merchants. Rename or merge merchants on <a href="#config/merchants">Config → Merchants</a> and your bills follow.</p>
            </section>

            <section id="grid-sec"${bills.length ? '' : ' hidden'}>
                <h2 id="grid-title">Last 12 months <span class="sub">day paid and amount · <span class="late-cell">orange</span> = late or a different amount · ✕ = missed</span></h2>
                <div id="grid"></div>
            </section>

            <section>
                <h2>Suggested from your history <span class="sub">charged on about the same day, or for the same amount, most months</span></h2>
                <div id="t-suggest"></div>
            </section>
            <datalist id="merchant-list">${merchants.map(m => `<option value="${esc(m)}">`).join('')}</datalist>`;

        const $ = s => el.querySelector(s);

        // ── Add / edit form ──
        const form = $('#bill-form');
        const openForm = (b, title, editing = null) => {
            form.innerHTML = `
                <h3>${esc(title)}</h3>
                <div class="add-grid">
                    <label class="field">Name<input type="text" name="name" value="${esc(b.name || '')}" placeholder="e.g. Mortgage"></label>
                    <label class="field">Merchant(s)<input type="text" name="merchants" list="merchant-list" value="${esc((b.merchants || []).join('; '))}" placeholder="as shown in Finance Table">
                        <span class="muted" style="font-size:0.8em">Separate several with ;</span></label>
                    <label class="field">Day of month<input type="number" name="day" min="1" max="31" value="${esc(b.day || '')}"></label>
                    <label class="field">Usual amount<input type="number" name="amount" step="0.01" min="0" value="${esc(b.amount ?? '')}"></label>
                    <label class="field">How often<select name="every">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}"${+k === (b.every || 1) ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
                    <label class="field">First month due<input type="month" name="start" value="${esc(b.start || '')}">
                        <span class="muted" style="font-size:0.8em">Needed when it isn't monthly</span></label>
                    <label class="field" style="grid-column:1/-1">Notes<input type="text" name="notes" value="${esc(b.notes || '')}"></label>
                </div>
                <div class="row" style="margin-bottom:12px">
                    <label class="check"><input type="checkbox" name="varies"${b.varies ? ' checked' : ''}> Amount changes month to month (like electric)</label>
                    <label class="check"><input type="checkbox" name="active"${b.active === false ? '' : ' checked'}> Active</label>
                </div>
                <div class="row"><button type="submit" class="primary">${editing ? 'Save bill' : 'Add bill'}</button><button type="button" data-cancel>Cancel</button>
                    ${editing ? '<span class="spacer"></span><button type="button" class="danger" data-remove>Remove bill</button>' : ''}</div>`;
            form.hidden = false;
            formOpen = true;
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            form.querySelector('[name=name]').focus();
            form.querySelector('[data-cancel]').onclick = () => { form.hidden = true; formOpen = false; };
            form.querySelector('[data-remove]')?.addEventListener('click', async () => {
                if (!confirm(`Remove ${editing.name}? Its transactions become unscheduled.`)) return;
                await save(bills.filter(x => x !== editing), `Removed ${editing.name}`);
            });
            form.onsubmit = async e => {
                e.preventDefault();
                const f = Object.fromEntries([...form.querySelectorAll('[name]')].map(i => [i.name, i]));
                const nb = {
                    ...(editing || {}),
                    name: f.name.value.trim(),
                    merchants: f.merchants.value.split(';').map(s => s.trim()).filter(Boolean),
                    day: Math.round(+f.day.value),
                    amount: Math.abs(+f.amount.value || 0),
                    every: +f.every.value,
                    start: f.start.value,
                    notes: f.notes.value.trim(),
                    varies: f.varies.checked,
                    active: f.active.checked,
                };
                if (!nb.notes) delete nb.notes;
                const problem = !nb.name ? 'Give the bill a name.'
                    : bills.some(x => x !== editing && x.name.toLowerCase() === nb.name.toLowerCase()) ? `There is already a bill called ${nb.name}.`
                    : !nb.merchants.length ? 'Pick the merchant this bill is paid to.'
                    : !(nb.day >= 1 && nb.day <= 31) ? 'Day of month must be 1 to 31.'
                    : nb.every > 1 && !nb.start ? 'Pick the first month it is due, so the app knows which months to expect it.'
                    : '';
                if (problem) { toast(problem, 'bad'); return; }
                const unknown = nb.merchants.filter(m => !merchants.some(x => merchantNameKey(x) === merchantNameKey(m)));
                if (unknown.length && !confirm(`No transactions have the merchant ${unknown.join(', ')} yet. Save anyway?`)) return;
                const list = editing ? bills.map(x => (x === editing ? nb : x)) : [...bills, nb];
                await save(list, editing ? `Saved ${nb.name}` : `Added ${nb.name}`);
            };
        };
        const save = async (list, msg, extra) => {
            try {
                await saveBills(list, extra);
                formOpen = false;
                toast(msg, 'ok');
                this.render(el);
            } catch (e) {
                toast(`Save failed: ${e.message}`, 'bad');
            }
        };
        $('#add').onclick = () => openForm({ every: 1, active: true }, 'Add a bill');

        // ── Your bills ──
        dataTable($('#t-bills'), {
            columns: [
                { id: 'name', label: 'Bill', value: b => b.name, cell: b => `<strong>${esc(b.name)}</strong>${b.notes ? `<div class="muted" style="font-size:0.85em">${esc(b.notes)}</div>` : ''}` },
                { id: 'merch', label: 'Merchant(s)', value: b => b.merchants.join('; ') },
                categoryColumn('cat', 'Category', b => catOf.get(b.name)),
                { id: 'day', label: 'Day', num: true, value: b => b.day, text: ordinal },
                { ...moneyColumn('amt', 'Amount', b => b.amount), cell: b => `${b.varies ? '≈ ' : ''}${esc(money(b.amount))}` },
                { id: 'every', label: 'How often', value: b => EVERY[b.every], cell: b => esc(EVERY[b.every]) + (b.every > 1 && b.start ? ` <span class="muted">from ${esc(monthLabel(b.start))}</span>` : '') },
                { id: 'active', label: 'Status', value: b => (b.active ? 'Active' : 'Paused'), cell: b => (b.active ? '<span class="badge badge-ok">Active</span>' : '<span class="badge badge-neutral">Paused</span>') },
                { id: 'edit', label: '', value: () => '', cell: b => `<button class="small" data-edit="${esc(b.name)}">Edit</button>` },
            ],
            rows: bills,
            sort: { col: 'day', dir: 'asc' },
            empty: 'No bills yet',
            footer: list => list.length ? `<tr class="total-row"><td colspan="4"><strong>Monthly equivalent (active)</strong></td><td class="amt"><strong>${esc(money(list.filter(b => b.active).reduce((a, b) => a + b.amount / b.every, 0)))}</strong></td><td colspan="3"></td></tr>` : '',
        });
        $('#t-bills').addEventListener('click', e => {
            const btn = e.target.closest('[data-edit]');
            if (!btn) return;
            const b = bills.find(x => x.name === btn.dataset.edit);
            if (b) openForm(b, `Edit ${b.name}`, b);
        });

        // ── Suggestions ──
        const ignored = Array.isArray(cfg.bill_suggestions_ignored) ? cfg.bill_suggestions_ignored : [];
        const sugg = suggestBills(rows, bills, ignored);
        dataTable($('#t-suggest'), {
            columns: [
                { id: 'm', label: 'Merchant', value: s => s.merchant, cell: s => `<strong>${esc(s.merchant)}</strong>${s.names.length > 1 ? `<div class="muted" style="font-size:0.85em">also ${esc(s.names.filter(n => n !== s.merchant).join(', '))}</div>` : ''}` },
                categoryColumn('cat', 'Category', s => s.category),
                { id: 'day', label: 'Usual day', num: true, value: s => s.day, text: ordinal },
                { ...moneyColumn('amt', 'Usual amount', s => s.amount), cell: s => `${s.varies ? '≈ ' : ''}${esc(money(s.amount))}` },
                { id: 'n', label: 'Months seen', num: true, value: s => s.months, cell: s => `${s.months} <span class="muted">of last 12</span>` },
                { id: 'why', label: 'Why', value: s => s.reason, tdClass: () => 'muted' },
                { id: 'act', label: '', value: () => '', cell: (s) => `<span class="nowrap"><button class="small primary" data-add="${esc(s.merchant)}">Add</button> <button class="small" data-ignore="${esc(s.merchant)}" title="Stop suggesting this">Not a bill</button></span>` },
            ],
            rows: sugg,
            sort: { col: 'day', dir: 'asc' },
            empty: bills.length ? 'No more suggestions. Everything that looks scheduled is already a bill.' : 'Nothing in your history looks scheduled yet.',
        });
        $('#t-suggest').addEventListener('click', e => {
            const add = e.target.closest('[data-add]'), ign = e.target.closest('[data-ignore]');
            if (add) {
                const s = sugg.find(x => x.merchant === add.dataset.add);
                openForm({ name: s.merchant, merchants: s.names, day: s.day, amount: s.amount, varies: s.varies, every: 1, active: true }, `Add ${s.merchant} as a bill`);
            } else if (ign) {
                save(bills, `Won't suggest ${ign.dataset.ignore} again`, { bill_suggestions_ignored: [...ignored, ign.dataset.ignore] });
            }
        });
        if (ignored.length) {
            $('#t-suggest').insertAdjacentHTML('beforeend', `<p class="note">Hidden as "not a bill": ${ignored.map(esc).join(', ')}. <button class="small" id="unignore">Show them again</button></p>`);
            $('#unignore').onclick = () => save(bills, 'Suggestions reset', { bill_suggestions_ignored: [] });
        }

        // ── Month picker: the 12-month grid ends at the selected month ──
        const show = next => {
            ym = remembered = next;
            const i = yms.indexOf(ym);
            $('#month').value = ym;
            $('#prev').disabled = i <= 0;
            $('#next').disabled = i >= yms.length - 1;
            drawGrid();
        };

        // ── 12-month grid ending at the selected month ──
        const drawGrid = () => {
            if (!bills.length) return;
            const months = Array.from({ length: 12 }, (_, k) => addMonths(ym, k - 11));
            const shown = [...bills].sort((a, b) => a.day - b.day);
            $('#grid').innerHTML = `<div class="table-wrap"><table class="summary-table bill-grid">
                <thead><tr><th>Bill</th><th class="num">Day</th>${months.map(m => `<th class="num">${esc(MONTH_NAMES[+m.slice(5) - 1].slice(0, 3))} ’${m.slice(2, 4)}</th>`).join('')}</tr></thead>
                <tbody>${shown.map(b => `<tr><td><strong>${esc(b.name)}</strong></td><td class="amt muted">${ordinal(b.day)}</td>${months.map(m => {
                    const x = billMonth(b, m, pays.get(b.name).get(m), { dataThrough, today, since: firstPaid(pays.get(b.name)) });
                    if (x.payments.length) {
                        const late = x.status === 'late-paid';
                        const title = `${x.payments.map(r => `${fmtDay(r._date)} ${money(-r._amt)}`).join(', ')}${late ? ` · ${x.lateDays} days late` : ''}${x.changed ? ` · usual ${money(x.expected)}` : ''}`;
                        return `<td class="amt${late || x.changed ? ' late-cell' : ''}" title="${esc(title)}">${x.payments[0]._date.getDate()} · ${esc(money(x.paid))}</td>`;
                    }
                    if (x.status === 'missed' || x.status === 'late') return `<td class="amt missed-cell" title="${esc(STATUS[x.status][1])}: due ${esc(fmtDay(x.dueOn))}">✕</td>`;
                    if (x.status === 'due' || x.status === 'unknown') return `<td class="amt muted" title="Due ${esc(fmtDay(x.dueOn))}">…</td>`;
                    return '<td class="amt zero">·</td>';
                }).join('')}</tr>`).join('')}</tbody>
            </table></div>`;
        };

        $('#month').onchange = e => show(e.target.value);
        $('#prev').onclick = () => show(yms[yms.indexOf(ym) - 1]);
        $('#next').onclick = () => show(yms[yms.indexOf(ym) + 1]);
        show(ym);
    },

    canLeave(unloading) {
        if (!formOpen) return true;
        if (unloading) return false;
        if (!confirm('You have a bill form open. Leave without saving?')) return false;
        formOpen = false;
        return true;
    },

    destroy() {
        closeFilterMenu();
    },
};
