import { PATHS, readTable, loadConfig, parseConfig, keyOf } from '../data.js';
import { computeProjection, statusBadge } from '../finance.js';
import { parseBills, hasBills, billMatcher, schedColumn, paymentsByMonth, billMonth, firstPaid, allTransactions, STATUS } from '../bills.js';
import { leftToSpend, savePlan } from '../plan.js';
import { lastSources } from '../workflow.js';
import { MONTH_NAMES, parseDate, yearMonth } from '../dates.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, dateColumn, moneyColumn, categoryColumn, closeFilterMenu } from '../datatable.js';

const fmtDay = d => `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;

async function loadProjection() {
    const cfg = await loadConfig();
    if (!cfg) return { error: 'config.json not found — create it on the <a href="#config">Config</a> page.' };
    const processed = await readTable(PATHS.processed);
    if (!processed) return { error: 'No processed current month yet — add this month’s bank export on the <a href="#home">Setup</a> page.' };
    const master = await readTable(PATHS.master);
    // If the file is for a month that has already ended, show that month as complete instead of
    // scaling its full spending by today's day-of-month.
    const latest = processed.rows.map(r => parseDate(r.Date)).filter(Boolean).sort((a, b) => b - a)[0];
    const now = new Date();
    const ended = latest && yearMonth(latest) < yearMonth(now);
    const today = ended ? new Date(latest.getFullYear(), latest.getMonth() + 1, 0) : now;

    // Scheduled bills: what's been paid this month, plus what's still due; their payments aren't day-scaled.
    // Payments come from all history, so a bill paid a few days early (late last month) counts for this month.
    let bills = null, exclude = null, fixedTotal = null, match = null;
    const all = await allTransactions();
    if (hasBills(cfg)) {
        const list = parseBills(cfg);
        match = billMatcher(list);
        exclude = r => !!match(r);
        const ym = yearMonth(today);
        const pays = paymentsByMonth(list, all);
        bills = list.map(b => billMonth(b, ym, pays.get(b.name).get(ym), { dataThrough: latest, today: now, since: firstPaid(pays.get(b.name)) }))
            .filter(x => x.due || x.payments.length)
            .map(x => ({ ...x, counted: x.payments.length ? x.paid : x.due && !ended ? x.expected : 0 }));
        fixedTotal = bills.reduce((a, x) => a + x.counted, 0);
    }
    const proj = computeProjection({ config: parseConfig(cfg), rows: processed.rows, masterRows: master?.rows, today, exclude, fixedTotal });
    const plan = bills ? leftToSpend({ cfg, rows: all, ym: yearMonth(today), bills, match, dataThrough: latest, today: now, ended }) : null;
    return { ...proj, ended, bills, match, plan, dataThrough: latest };
}

const SOURCE_TAGS = {
    edited: '<span class="source-tag source-edited">edited</span>',
    history: '<span class="source-tag source-history">history</span>',
    cache: '<span class="source-tag source-cache">cache</span>',
    ai: '<span class="source-tag source-ai">AI</span>',
    merchant: '<span class="source-tag source-history">merchant rule</span>',
    rules: '<span class="source-tag source-rules">rules</span>',
};

/** Why a bill needs a look: late, a different amount, not loaded yet, several payments. */
const billNote = x => [
    x.status === 'late-paid' ? `${x.lateDays} days late` : '',
    x.changed ? `${money(x.paid - x.expected, true)} vs usual` : '',
    x.status === 'unknown' ? 'due date passed; bank data not loaded that far' : '',
    x.payments.length > 1 ? `${x.payments.length} payments` : '',
].filter(Boolean).join(' · ');

/** "3 of 14 paid · $3,051.52 still due · needs a look: Capital One" */
function billsSummary(p) {
    const due = p.bills.filter(x => x.due), paid = p.bills.filter(x => x.payments.length);
    const open = p.bills.filter(x => !x.payments.length && ['due', 'late', 'unknown'].includes(x.status));
    const trouble = p.bills.filter(x => ['late', 'missed', 'late-paid'].includes(x.status) || x.changed);
    return [
        `${paid.length} of ${due.length} paid`,
        open.length ? `${money(open.reduce((a, x) => a + x.expected, 0))} still due` : 'nothing left to pay',
        trouble.length ? `<span style="color:var(--red)">needs a look: ${esc(trouble.map(x => x.bill.name).join(', '))}</span>` : '',
    ].filter(Boolean).join(' · ');
}

const shortDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Left to spend: cards, where the money goes, and this month's paychecks with their savings transfers. */
function planHtml(p) {
    const L = p.plan, month = MONTH_NAMES[p.today.getMonth()];
    const coming = L.checks.filter(c => !c.received);
    const leftColor = L.left >= 0 ? 'var(--green)' : 'var(--red)';
    const leftLabel = p.ended ? 'Left over' : 'Left to spend';
    const line = (label, amt, sub, sign) => `<tr><td>${label}${sub ? `<div class="ledger-sub">${sub}</div>` : ''}</td>
        <td class="amt${sign > 0 ? ' income-amt' : ''}">${amt ? (sign > 0 ? '+' : '−') + money(amt) : money(0)}</td></tr>`;
    const byCat = {};
    for (const r of L.spentRows) { const c = r['AI Category'] || 'Uncategorized'; byCat[c] = (byCat[c] || 0) - r._amt; }
    const catList = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${esc(c)} ${money(v)}`).join(' · ');
    const inList = L.inRows.map(r => `${esc(shortDay(r._date))} ${esc(r['Cleaned Merchant'] || r.Description)} ${money(r._amt)}`).join(' · ');
    const untied = -L.otherSaved.reduce((a, r) => a + r._amt, 0);
    const checkStatus = c => c.saved && !c.toMove ? '<span class="badge badge-ok">Moved</span>'
        : c.saved ? `<span class="badge badge-warn">${money(c.toMove)} to go</span>`
        : p.ended ? '<span class="badge badge-neutral">None</span>' : '<span class="badge badge-neutral">To move</span>';

    return `
        <div class="cards">
            <div class="card"><div class="label">${leftLabel}</div><div class="value" style="color:${leftColor}">${money(L.left)}</div>
                <div class="sub">${L.perDay != null ? `about <strong>${money(L.perDay)}</strong> a day for the ${L.daysLeft} day${L.daysLeft === 1 ? '' : 's'} left` : `paychecks minus everything out in ${month}`}</div></div>
            <div class="card"><div class="label">Paychecks in ${month}</div><div class="value" style="color:#2980b9">${money(L.income)}</div>
                <div class="sub">${L.checks.length - coming.length} of ${L.checks.length} received${coming.length ? ` · next ${esc(shortDay(coming[0].date))}` : ''}</div></div>
            ${p.ended ? '' : `<div class="card"><div class="label">If the rest of ${month} is typical</div><div class="value" style="color:${L.typicalEnd >= 0 ? 'var(--green)' : 'var(--red)'}">${money(L.typicalEnd)}</div>
                <div class="sub">left at month end if you spend another ${money(L.typicalRest)} (${L.daysLeft} days of your typical ${money(L.typicalMonth)} a month: the median of your last ${L.typicalMonths} months, bills and savings left out)</div></div>`}
        </div>

        <section>
            <h2>${leftLabel} <span class="sub">${esc(month)}</span></h2>
            <div class="table-wrap"><table class="ledger"><tbody>
                ${line(`Paychecks (${esc(L.merchant || 'none found')})`, L.income, L.checks.length ? `received ${money(L.received)}${L.still ? ` · still coming ${money(L.still)}` : ''}` : 'no paychecks this month', 1)}
                ${L.otherIn ? line('Other money in', L.otherIn, inList, 1) : ''}
                ${line('Scheduled bills <a href="#bills" class="ledger-link">Bills →</a>', L.billsTotal, `paid ${money(L.billsPaid)}${L.billsDue ? ` · still due ${money(L.billsDue)}` : ''}`, -1)}
                ${line('Savings transfers <a href="#savings" class="ledger-link">Savings →</a>', L.savedSoFar + L.toMove,
                    `moved ${money(L.savedSoFar)}${untied ? ` (${money(untied)} of it not tied to a paycheck)` : ''}${L.toMove ? ` · still to move ${money(L.toMove)}` : ''}`, -1)}
                ${line('Spent so far (everything else)', L.spent, catList, -1)}
                <tr class="total-row"><td><strong>= ${leftLabel}</strong></td><td class="amt"><strong style="color:${leftColor}">${money(L.left)}</strong></td></tr>
            </tbody></table></div>
            ${L.still && !p.ended ? `<p class="note">${money(L.still)} of this hasn't arrived yet: it comes with your paycheck${coming.length > 1 ? 's' : ''} on ${coming.map(c => esc(shortDay(c.date))).join(' and ')}.</p>` : ''}
        </section>

        <section>
            <h2>Paychecks &amp; savings <span class="sub">each paycheck's savings transfer goes the Monday after</span><span class="spacer"></span><button class="small" id="plan-edit">Edit</button></h2>
            <div class="table-wrap"><table>
                <thead><tr><th>Payday</th><th class="num">Paycheck</th><th>Status</th><th>Savings on</th><th class="num">To savings</th><th>Status</th></tr></thead>
                <tbody>${L.checks.map(c => `<tr>
                    <td>${esc(shortDay(c.date))}</td>
                    <td class="amt">${money(c.amount)}</td>
                    <td>${c.received ? '<span class="badge badge-ok">Received</span>' : '<span class="badge badge-neutral">Expected</span>'}</td>
                    <td>${esc(shortDay(c.savedRows[0]?._date || c.moveOn))}</td>
                    <td class="amt">${money(c.saved + c.toMove)}</td>
                    <td>${checkStatus(c)}</td>
                </tr>`).join('') || '<tr><td colspan="6" class="muted">No paychecks found this month.</td></tr>'}</tbody>
            </table></div>
            <div id="plan-form"></div>
            <p class="note">Paycheck: ${money(L.paycheck)} every ${L.every} days from ${esc(L.merchant || '—')} (${L.plan.paycheck != null ? 'your setting' : L.paycheckDetected ? `your latest, ${esc(shortDay(L.paycheckDetected.date))}` : 'none found'}).
                To savings per paycheck: ${money(L.perCheck)} (${L.plan.savings != null ? 'your setting' : L.savingsFrom ? `what moved after your ${esc(shortDay(L.savingsFrom.date))} paycheck` : 'none found'}).
                Savings transfers are the money-out rows in the ${esc(L.savingsCategory)} category.</p>
        </section>`;
}

function wirePlan(el, L, rerender) {
    el.querySelector('#plan-edit').onclick = () => {
        const box = el.querySelector('#plan-form');
        if (box.innerHTML) { box.innerHTML = ''; return; }
        box.innerHTML = `<div class="add-bill">
            <h3>Paycheck and savings <span class="muted" style="font-weight:400">(leave blank to use your history)</span></h3>
            <div class="add-grid">
                <label class="field">Paycheck merchant<select name="merchant">
                    <option value="">From history (${esc(L.merchants[0] || 'none')})</option>
                    ${L.merchants.map(m => `<option${m === L.plan.merchant ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
                <label class="field">Paycheck amount<input type="number" name="paycheck" step="0.01" min="0" value="${L.plan.paycheck ?? ''}" placeholder="${L.paycheckDetected ? L.paycheckDetected.amount.toFixed(2) : ''}"></label>
                <label class="field">To savings per paycheck<input type="number" name="savings" step="0.01" min="0" value="${L.plan.savings ?? ''}" placeholder="${L.detectedSavings.toFixed(2)}"></label>
            </div>
            <div class="row"><button class="primary" id="plan-save">Save</button><button id="plan-cancel">Cancel</button></div>
        </div>`;
        const get = n => box.querySelector(`[name=${n}]`).value.trim();
        box.querySelector('#plan-cancel').onclick = () => { box.innerHTML = ''; };
        box.querySelector('#plan-save').onclick = async () => {
            if ([get('paycheck'), get('savings')].some(v => v !== '' && !Number.isFinite(+v))) { toast('Amounts must be numbers', 'bad'); return; }
            const num = v => (v === '' ? null : Math.abs(+v));
            try {
                await savePlan({ merchant: get('merchant') || null, paycheck: num(get('paycheck')), savings: num(get('savings')) });
                toast('Saved', 'ok');
                rerender();
            } catch (e) { toast(`Save failed: ${e.message}`, 'bad'); }
        };
    };
}

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading…</p>';
        // Re-read from disk so edits made in the editor (or Excel) show up.
        const p = await loadProjection();
        if (p.error) { el.innerHTML = `<div class="banner">${p.error}</div>`; return; }

        const label = `${MONTH_NAMES[p.today.getMonth()]} ${p.today.getFullYear()}`;
        const sdColor = p.surplus >= 0 ? 'var(--green)' : 'var(--red)';
        const hasSources = lastSources.size > 0;

        el.innerHTML = `
            <div class="row" style="margin-bottom:6px">
                <h1 class="page">Current Month Projection: ${esc(label)}</h1>
                <span class="spacer"></span>
                <button id="reload">Refresh</button>
            </div>
            <p class="lead">${p.ended ? 'Completed month: totals are actual, not projected.' : `Day ${p.daysElapsed} of ${p.daysInMonth} · ${p.pctMonth}% through the month`}${p.dataThrough ? ` · bank data through ${esc(shortDay(p.dataThrough))}` : ''}</p>
            ${p.ended ? `<div class="banner">This file is for ${esc(label)}, which has ended. Add this month's bank export on <a href="#home">Setup</a> to see a live projection, or close ${esc(label)} with <strong>Close month</strong> on <a href="#home">Setup</a>.</div>` : ''}

            ${p.plan ? planHtml(p) : `<div class="banner">Set up your scheduled bills on the <a href="#bills">Bills</a> page to see how much you have left to spend this month.</div>`}

            <div class="cards"${p.plan ? ' hidden' : ''}>
                <div class="card"><div class="label">Expected Income</div><div class="value" style="color:#2980b9">${money(p.income)}</div><div class="sub">per month, from config</div></div>
                <div class="card"><div class="label">Total Projected Spend</div><div class="value" style="color:var(--red)">${money(p.totalProjected)}</div><div class="sub">${p.bills ? 'scheduled bills + unscheduled projection' : 'fixed + variable projection'}</div></div>
                <div class="card"><div class="label">${p.surplus >= 0 ? 'Projected Surplus' : 'Projected Deficit'}</div><div class="value" style="color:${sdColor}">${money(p.surplus, true)}</div><div class="sub">end-of-month estimate</div></div>
            </div>

            <section>
                <h2>Month Progress</h2>
                <div class="progress-label"><span>Day ${p.daysElapsed} of ${p.daysInMonth}</span><span>${p.pctMonth}% elapsed</span></div>
                <div class="progress-bar"><div class="progress-fill" style="width:${p.pctMonth}%"></div></div>
                <p class="note">Variable spending is projected by scaling your current pace to the full month: (spent ÷ ${p.daysElapsed} days) × ${p.daysInMonth} days.</p>
            </section>

            <section>
                ${p.bills ? `<h2>Scheduled Bills <span class="sub">${billsSummary(p)}</span><span class="spacer"></span><a href="#bills" style="font-size:0.85em;text-transform:none;letter-spacing:0">Manage bills →</a></h2>`
                    : `<h2>Fixed Expenses <span class="sub">(from config)</span></h2>`}
                <div id="t-fixed"></div>
                ${p.bills ? '' : '<p class="note">Set up your scheduled bills on the <a href="#bills">Bills</a> page to see which are paid and which are still due.</p>'}
            </section>
            <section>
                <h2>${p.bills ? 'Unscheduled Spending' : 'Variable Spending'}</h2>
                <div id="t-var"></div>
                <p class="note">Historical average covers ${p.hist.months} completed month(s); the current month is excluded.${p.bills ? ' Scheduled bill payments are left out here (and from the averages) so they aren’t counted twice.' : ''}</p>
            </section>
            <section>
                <h2>Transactions <span class="sub">(${p.rows.length} rows)</span><span class="spacer"></span><a href="#edit" style="font-size:0.85em;text-transform:none;letter-spacing:0">Open in Finance Table →</a></h2>
                <div id="t-tx"></div>
                ${hasSources ? `<p class="note">Source: ${SOURCE_TAGS.edited} your manual edit · ${SOURCE_TAGS.history} same category as this merchant in your history · ${SOURCE_TAGS.cache} AI-categorized on an earlier run · ${SOURCE_TAGS.merchant} your merchant rule (bank text) · ${SOURCE_TAGS.ai} AI-categorized this run · ${SOURCE_TAGS.rules} override/keyword rules only</p>` : ''}
            </section>`;

        const sumOf = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);

        if (p.bills) dataTable(el.querySelector('#t-fixed'), {
            columns: [
                { id: 'name', label: 'Bill', value: x => x.bill.name, cell: x => `<strong>${esc(x.bill.name)}</strong>` },
                { id: 'due', label: 'Due', value: x => x.dueOn.getTime(), text: v => fmtDay(new Date(v)), num: true, sortLabels: ['Earliest → Latest', 'Latest → Earliest'],
                    cell: x => (x.due ? esc(fmtDay(x.dueOn)) : '<span class="muted">not due</span>') },
                { ...moneyColumn('exp', 'Expected', x => (x.due ? x.expected : NaN)), cell: x => (x.due ? `${x.bill.varies ? '≈ ' : ''}${esc(money(x.expected))}` : '') },
                { id: 'status', label: 'Status', value: x => STATUS[x.status][1], cell: x => `<span class="badge ${STATUS[x.status][0]}">${STATUS[x.status][1]}</span>` },
                { id: 'on', label: 'Paid on', value: x => x.payments.map(r => fmtDay(r._date)).join(', ') },
                { ...moneyColumn('paid', 'Paid', x => (x.payments.length ? x.paid : NaN)), tdClass: x => (x.changed ? 'late-cell' : '') },
                moneyColumn('counted', p.ended ? 'Counted' : 'Counted in left to spend', x => x.counted, { bold: true }),
                { id: 'note', label: 'Note', value: billNote, tdClass: () => 'muted' },
            ],
            rows: p.bills,
            sort: { col: 'due', dir: 'asc' },
            footer: (rows, filtered) => `<tr class="total-row"><td colspan="2"><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                <td class="amt"><strong>${money(sumOf(rows, x => (x.due ? x.expected : 0)))}</strong></td><td></td><td></td>
                <td class="amt"><strong>${money(sumOf(rows, x => x.paid))}</strong></td><td class="amt"><strong>${money(sumOf(rows, x => x.counted))}</strong></td><td></td></tr>`,
            empty: 'No scheduled bills this month',
        });
        else dataTable(el.querySelector('#t-fixed'), {
            columns: [
                { id: 'item', label: 'Item', value: r => r.item },
                moneyColumn('amt', 'Monthly', r => r.amount),
            ],
            rows: Object.entries(p.fixed).map(([k, v]) => ({ item: k.replace(/_/g, ' '), amount: v })),
            footer: (rows, filtered) => `<tr class="total-row"><td><strong>Total Fixed${filtered ? ' (filtered)' : ''}</strong></td><td class="amt"><strong>${money(sumOf(rows, r => r.amount))}</strong></td></tr>`,
            empty: 'No fixed expenses in config',
        });

        const STATUS_ORDER = { 'On track': 0, 'Watch': 1, 'Over': 2, 'No history': 3 };
        dataTable(el.querySelector('#t-var'), {
            columns: [
                { id: 'cat', label: 'Category', value: r => r.cat },
                moneyColumn('spent', 'Spent', r => r.spent),
                moneyColumn('proj', 'Projected', r => r.proj, { bold: true }),
                { ...moneyColumn('hist', `Avg (${p.hist.months} mo)`, r => r.hist || NaN), tdClass: () => 'muted' },
                { ...moneyColumn('delta', 'vs Avg', r => r.hist ? r.delta : NaN),
                    cell: r => r.hist ? `<span style="color:${r.delta > 0 ? 'var(--red)' : 'var(--green)'}">${money(r.delta, true)}</span>` : '<span class="muted">—</span>',
                    text: v => money(v, true) },
                { id: 'status', label: 'Status', value: r => r.status[1], sortKey: v => STATUS_ORDER[v] ?? 9,
                    cell: r => `<span class="badge ${r.status[0]}">${r.status[1]}</span>`, sortLabels: ['On track → Over', 'Over → On track'] },
            ],
            rows: p.variableCats.map(cat => {
                const hist = p.hist.avgs[cat] || 0;
                return { cat, spent: p.spent[cat], proj: p.projected[cat], hist, delta: p.projected[cat] - hist, status: statusBadge(p.projected[cat], hist) };
            }),
            footer: (rows, filtered) => `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                <td class="amt">${money(sumOf(rows, r => r.spent))}</td><td class="amt"><strong>${money(sumOf(rows, r => r.proj))}</strong></td><td></td><td></td><td></td></tr>`,
        });

        dataTable(el.querySelector('#t-tx'), {
            columns: [
                dateColumn('date', 'Date', r => r.Date),
                { id: 'desc', label: 'Description', value: r => r.Description ?? '', tdClass: () => 'desc-cell' },
                { id: 'merchant', label: 'Merchant', value: r => r['Cleaned Merchant'] ?? '' },
                moneyColumn('amt', 'Amount', r => r._amt, { signed: true }),
                categoryColumn('cat', 'Category', r => r['AI Category']),
                ...(p.match ? [schedColumn(p.match)] : []),
                ...(hasSources ? [{ id: 'src', label: 'Source', value: r => lastSources.get(keyOf(r)) || '', cell: r => SOURCE_TAGS[lastSources.get(keyOf(r))] || '' }] : []),
            ],
            rows: p.rows,
            sort: { col: 'date', dir: 'asc' },
        });

        el.querySelector('#reload').onclick = () => this.render(el);
        if (p.plan) wirePlan(el, p.plan, () => this.render(el));
    },

    destroy() {
        closeFilterMenu();
    },
};
