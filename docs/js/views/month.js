import { PATHS, readTable, loadConfig, parseConfig, keyOf } from '../data.js';
import { computeProjection, statusBadge, withParsed } from '../finance.js';
import { parseBills, hasBills, billMatcher, schedColumn, paymentsByMonth, billMonth, STATUS } from '../bills.js';
import { lastSources } from '../workflow.js';
import { MONTH_NAMES, parseDate, yearMonth } from '../dates.js';
import { esc, money } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, dateColumn, moneyColumn, categoryColumn, closeFilterMenu } from '../datatable.js';

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
    let bills = null, exclude = null, fixedTotal = null, match = null;
    if (hasBills(cfg)) {
        const list = parseBills(cfg);
        match = billMatcher(list);
        exclude = r => !!match(r);
        const ym = yearMonth(today);
        const pays = paymentsByMonth(list, withParsed(processed.rows).filter(r => r._date));
        bills = list.map(b => billMonth(b, ym, pays.get(b.name).get(ym), { dataThrough: latest, today: now }))
            .filter(x => x.due || x.payments.length)
            .map(x => ({ ...x, counted: x.payments.length ? x.paid : x.due && !ended ? x.expected : 0 }));
        fixedTotal = bills.reduce((a, x) => a + x.counted, 0);
    }
    return { ...computeProjection({ config: parseConfig(cfg), rows: processed.rows, masterRows: master?.rows, today, exclude, fixedTotal }), ended, bills, match };
}

const SOURCE_TAGS = {
    edited: '<span class="source-tag source-edited">edited</span>',
    history: '<span class="source-tag source-history">history</span>',
    cache: '<span class="source-tag source-cache">cache</span>',
    ai: '<span class="source-tag source-ai">AI</span>',
    merchant: '<span class="source-tag source-history">merchant rule</span>',
    rules: '<span class="source-tag source-rules">rules</span>',
};

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
            <p class="lead">${p.ended ? 'Completed month: totals are actual, not projected.' : `Day ${p.daysElapsed} of ${p.daysInMonth} · ${p.pctMonth}% through the month`}</p>
            ${p.ended ? `<div class="banner">This file is for ${esc(label)}, which has ended. Add this month's bank export on <a href="#home">Setup</a> to see a live projection, or close ${esc(label)} with <strong>Close month</strong> on <a href="#home">Setup</a>.</div>` : ''}

            <div class="cards">
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
                ${p.bills ? `<h2>Scheduled Bills <span class="sub">paid, or still due this month</span><span class="spacer"></span><a href="#bills" style="font-size:0.85em;text-transform:none;letter-spacing:0">Manage bills →</a></h2>`
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
                { id: 'name', label: 'Bill', value: x => x.bill.name },
                dateColumn('due', 'Due', x => (x.due ? x.dueOn.toLocaleDateString('en-US') : '')),
                { id: 'status', label: 'Status', value: x => STATUS[x.status][1], cell: x => `<span class="badge ${STATUS[x.status][0]}">${STATUS[x.status][1]}</span>` },
                { ...moneyColumn('paid', 'Paid', x => (x.payments.length ? x.paid : NaN)), tdClass: x => (x.changed ? 'late-cell' : '') },
                moneyColumn('counted', p.ended ? 'Counted' : 'Counted in projection', x => x.counted, { bold: true }),
            ],
            rows: p.bills,
            sort: { col: 'due', dir: 'asc' },
            footer: (rows, filtered) => `<tr class="total-row"><td colspan="3"><strong>Total scheduled${filtered ? ' (filtered)' : ''}</strong></td><td class="amt">${money(sumOf(rows, x => x.paid))}</td><td class="amt"><strong>${money(sumOf(rows, x => x.counted))}</strong></td></tr>`,
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
    },

    destroy() {
        closeFilterMenu();
    },
};
