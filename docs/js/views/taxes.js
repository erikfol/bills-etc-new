// Utilities → Property Taxes: half-year bills from inputs/taxes_property_enfield/master_taxes_property.csv.
import { loadTaxes, addTaxBill, recalcTaxRow, taxDupKey, TAX_CALCULATED, TAX_PATH } from '../taxes.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { dataTable } from '../datatable.js';
import { editableSheet } from './sheeteditor.js';
import {
    dLong, addMonths, today, axisMoney, isoDate, dateOf, numOf,
    card, vsEarlier, dateCol, moneyCol, numCol, setResize, yearChips, sameDay, sameAmount, dupText,
} from './utilcommon.js';

let rememberedBill = null; // 'year-half' while you move between pages
let chartYears = null; // years shown in the charts (null = all)

// The town's online bill kiosk (same one as the water bills).
const TOWN_PORTAL = 'https://nhtaxkiosk.com/?KIOSKID=ENFIELD';
const portalLink = `<a class="ext-link" href="${TOWN_PORTAL}" target="_blank" rel="noopener">Enfield tax bills ↗</a>`;

const RATE_PARTS = [
    { id: 'school', label: 'School', color: '#4a90d9' },
    { id: 'town', label: 'Town', color: '#27ae60' },
    { id: 'state', label: 'State education', color: '#9b59b6' },
    { id: 'county', label: 'County', color: '#e67e22' },
];
const COLORS = { h1: '#9db7d9', h2: '#3a6ea5', land: '#a3c585', buildings: '#5b8c3a', escrow: '#8e9fb8' };
const halfText = h => (h === 1 ? '1st half' : '2nd half');
const billLabel = b => `${b.year} ${halfText(b.half)}`;
const shortLabel = b => `${b.year} H${b.half}`;
const rateText = v => (Number.isFinite(v) ? `${money(v)} per $1,000` : '–');
const wholeDollars = v => (Number.isFinite(v) ? '$' + Math.round(v).toLocaleString('en-US') : '–');
const axisK = v => (Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${Math.round(v)}`);

export default async function renderTaxes(el) {
    el.innerHTML = '<p class="muted">Loading property tax bills…</p>';
    const data = await loadTaxes();
    if (!data) {
        el.innerHTML = `<div class="banner">No property tax bills found. This page reads <code>${esc(TAX_PATH)}</code> in your bills-etc folder.</div>`;
        return;
    }
    if (data.missing.length) {
        el.innerHTML = `<div class="banner bad"><code>${esc(TAX_PATH)}</code> is missing columns this page needs (${esc(data.missing.join(', '))}). It expects Year, Half and Amount Due.</div>`;
        return;
    }
    const { bills } = data;
    if (!bills.length) {
        el.innerHTML = `<div class="banner"><code>${esc(TAX_PATH)}</code> has no bills yet.</div>`;
        return;
    }
    const keyOf = b => `${b.year}-${b.half}`;
    let i = bills.findIndex(b => keyOf(b) === rememberedBill);
    if (i < 0) i = bills.length - 1; // open on the latest bill
    const last = bills.at(-1);
    const find = (year, half) => bills.find(b => b.year === year && b.half === half) || null;

    // One row per tax year: the two halves, the full-year rate and assessment (from the 2nd half when there is one).
    const yearList = [...new Set(bills.map(b => b.year))].sort((a, b) => a - b);
    const years = yearList.map(y => {
        const h1 = find(y, 1), h2 = find(y, 2), full = h2 || h1;
        return {
            year: y, h1: h1?.amount ?? NaN, h2: h2?.amount ?? NaN, complete: !!(h1 && h2),
            total: sum([h1, h2].filter(Boolean).map(b => b.amount)),
            rate: h2?.rate ?? NaN, rates: h2?.rates ?? null,
            land: full.land, buildings: full.buildings, assessed: full.assessed,
            monthly: [h2, h1].map(b => b?.monthly).find(Number.isFinite) ?? NaN,
            increase: [h2, h1].map(b => b?.increase).find(v => Number.isFinite(v) && v) ?? NaN,
        };
    });
    years.forEach((Y, k) => {
        const P = years[k - 1];
        Y.change = P?.complete && Y.complete ? Y.total - P.total : NaN;
    });

    el.innerHTML = `
        <div id="catchup"></div>
        <div id="details-soon"></div>
        <div class="row dash-head">
            <h2 class="page-sub">Property Taxes <span class="muted" style="font-weight:400;font-size:0.8em">Enfield, NH · billed twice a year</span></h2>
            <span class="spacer"></span>
            <div class="month-nav">
                <button id="prev" title="Previous bill" aria-label="Previous bill">◀</button>
                <select id="pick">${bills.map((b, k) => `<option value="${k}">${esc(billLabel(b))}${b.due ? ` · due ${esc(dLong(b.due))}` : ''}</option>`).join('')}</select>
                <button id="next" title="Next bill" aria-label="Next bill">▶</button>
            </div>
        </div>
        <p class="lead" id="lead"></p>
        <div class="cards kpis" id="kpis"></div>

        <section>
            <h2>Tax bills <span class="sub">each half-year bill · click a bar to open it</span></h2>
            <div class="row year-chips"></div>
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:${COLORS.h1}"></span>1st half (estimate)</span>
                <span><span class="legend-dot" style="background:${COLORS.h2}"></span>2nd half (rest of the year)</span>
            </div>
            <canvas id="c-bills" style="display:block;width:100%;height:230px;cursor:pointer"></canvas>
        </section>

        <section>
            <h2>Property tax per year <span class="sub">the two halves added together</span></h2>
            <div class="row year-chips"></div>
            <canvas id="c-years" style="display:block;width:100%;height:250px"></canvas>
        </section>

        <div class="grid-2" style="margin-bottom:18px">
            <section>
                <h2>Tax rate <span class="sub">per $1,000 of value, for the full year</span></h2>
                <div class="chart-legend">${RATE_PARTS.map(p => `<span><span class="legend-dot" style="background:${p.color}"></span>${p.label}</span>`).join('')}</div>
                <canvas id="c-rate" style="display:block;width:100%;height:240px"></canvas>
            </section>
            <section>
                <h2>Assessed value</h2>
                <div class="chart-legend">
                    <span><span class="legend-dot" style="background:${COLORS.land}"></span>Land</span>
                    <span><span class="legend-dot" style="background:${COLORS.buildings}"></span>Buildings</span>
                </div>
                <canvas id="c-value" style="display:block;width:100%;height:240px"></canvas>
            </section>
        </div>

        <section>
            <h2>Year by year</h2>
            <div id="t-years"></div>
            <p class="note">Tax per year = 1st half + 2nd half. The rate shown is the full-year rate from the 2nd-half bill. Mortgage payment is the monthly payment with escrow noted on the bills.</p>
        </section>

        <section>
            <h2>All bills <span class="sub" id="count"></span><span class="spacer"></span>${portalLink}</h2>
            <div id="t-bills" class="short-table"></div>
            <div class="row" style="margin-top:14px"><button class="primary" id="add-open">+ Add a bill</button></div>
            <form id="add-form" class="add-bill" hidden>
                <h3 class="row">Add a tax bill <span class="spacer"></span><span style="font-weight:400">Get the bill from ${portalLink}</span></h3>
                <div class="add-grid">
                    <label class="field">Bill<select name="which"></select></label>
                    <label class="field">Billing date<input type="date" name="billed" required></label>
                    <label class="field">Payment due<input type="date" name="due"></label>
                </div>
                <div class="add-grid">
                    <label class="field">County rate ($)<input type="number" name="county" min="0" step="0.01" required></label>
                    <label class="field">School rate ($)<input type="number" name="school" min="0" step="0.01" required></label>
                    <label class="field">Town rate ($)<input type="number" name="town" min="0" step="0.01" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">State education rate ($)<input type="number" name="state" min="0" step="0.01" required></label>
                    <label class="field">Taxable land ($)<input type="number" name="land" min="0" step="1" required></label>
                    <label class="field">Buildings ($)<input type="number" name="buildings" min="0" step="1" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">Amount due ($)<input type="number" name="amount" min="0" step="0.01" placeholder="calculated"></label>
                    <label class="field">Monthly mortgage payment with escrow ($)<input type="number" name="monthly" min="0" step="0.01" placeholder="optional"></label>
                    <label class="field">Increase per month ($)<input type="number" name="increase" step="0.01" placeholder="optional"></label>
                </div>
                <div class="add-grid">
                    <label class="field" style="grid-column:1/-1">Notes<input type="text" name="notes" placeholder="optional"></label>
                </div>
                <p class="add-preview" id="add-preview"></p>
                <div class="row">
                    <button type="submit" class="primary" id="add-save">Save bill</button>
                    <button type="button" id="add-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Adds a row to ${esc(TAX_PATH)}. Close the file in Excel first.</span>
                </div>
            </form>
        </section>`;

    const $ = s => el.querySelector(s);

    // ── Charts, filtered by the year buttons ──
    const shownBills = () => bills.filter(b => !chartYears || chartYears.has(b.year));
    const shownYears = () => years.filter(Y => !chartYears || chartYears.has(Y.year));
    const draw = () => {
        const list = shownBills(), ys = shownYears();
        drawBars($('#c-bills'), {
            labels: list.map(shortLabel),
            series: [
                { name: '1st half', values: list.map(b => (b.half === 1 ? b.amount : NaN)), color: COLORS.h1, valueLabels: true },
                { name: '2nd half', values: list.map(b => (b.half === 2 ? b.amount : NaN)), color: COLORS.h2 },
                { name: 'Rate', values: list.map(b => b.rate), tipOnly: true, tipFmt: rateText },
            ],
            stacked: true, selected: list.indexOf(bills[i]), fmt: axisK, valueFmt: wholeDollars, tipFmt: money,
            tipHead: k => `${billLabel(list[k])}${list[k].due ? ` · due ${dLong(list[k].due)}` : ''}`,
        });
        drawBars($('#c-years'), {
            labels: ys.map(Y => String(Y.year)),
            series: [
                { name: '1st half', values: ys.map(Y => Y.h1), color: COLORS.h1 },
                { name: '2nd half', values: ys.map(Y => Y.h2), color: COLORS.h2, valueLabels: true },
                { name: 'Year total', values: ys.map(Y => Y.total), tipOnly: true },
            ],
            stacked: true, fmt: axisK, valueFmt: wholeDollars, tipFmt: money,
            tipHead: k => `${ys[k].year}${ys[k].complete ? '' : ' (2nd half not added yet)'}`,
        });
        const rated = ys.filter(Y => Y.rates);
        drawBars($('#c-rate'), {
            labels: rated.map(Y => String(Y.year)),
            series: [
                ...RATE_PARTS.map((p, k) => ({ name: p.label, values: rated.map(Y => Y.rates[p.id]), color: p.color, valueLabels: k === RATE_PARTS.length - 1 })),
                { name: 'Total rate', values: rated.map(Y => Y.rate), tipOnly: true },
            ],
            stacked: true, fmt: v => '$' + v.toFixed(0), valueFmt: v => money(v), tipFmt: money,
        });
        drawBars($('#c-value'), {
            labels: ys.map(Y => String(Y.year)),
            series: [
                { name: 'Land', values: ys.map(Y => Y.land), color: COLORS.land },
                { name: 'Buildings', values: ys.map(Y => Y.buildings), color: COLORS.buildings, valueLabels: true },
                { name: 'Total', values: ys.map(Y => Y.assessed), tipOnly: true },
            ],
            stacked: true, fmt: axisK, valueFmt: wholeDollars, tipFmt: wholeDollars,
        });
    };
    $('#c-bills').onclick = e => { const k = $('#c-bills')._hit?.(e.offsetX) ?? -1; if (k >= 0) show(bills.indexOf(shownBills()[k])); };
    chartYears = yearChips([...el.querySelectorAll('.year-chips')], yearList, chartYears, sel => { chartYears = sel; draw(); });

    // ── One bill ──
    const show = k => {
        i = k;
        const b = bills[i], prev = find(b.year - 1, b.half), prevLabel = prev ? billLabel(prev) : null;
        const Y = years.find(x => x.year === b.year), PY = years.find(x => x.year === b.year - 1);
        rememberedBill = keyOf(b);
        $('#pick').value = String(i);
        $('#prev').disabled = i === 0;
        $('#next').disabled = i === bills.length - 1;
        $('#lead').innerHTML = `${esc(billLabel(b))}${b.billed ? ` · billed ${esc(dLong(b.billed))}` : ''}${b.due ? ` · due ${esc(dLong(b.due))}` : ''}`
            + (b.notes ? `<br><span class="note-text">${esc(b.notes)}</span>` : '');
        const parts = RATE_PARTS.filter(p => Number.isFinite(b.rates[p.id])).map(p => `${p.label.toLowerCase()} ${money(b.rates[p.id])}`).join(' · ');
        $('#kpis').innerHTML = [
            card(`Amount due <span class="badge badge-neutral paid-tag">${b.half} of 2</span>`, money(b.amount),
                `<span class="muted">${b.half === 1 ? 'estimate for the first half of the year' : 'rest of the year at the full rate'}</span><br>`
                + vsEarlier(b.amount, prev?.amount, prevLabel, { higherIsGood: false, fmt: money, none: 'no bill a year earlier to compare' }), 'var(--red)'),
            card('Tax rate per $1,000', money(b.rate),
                `<span class="muted">${esc(parts)}${b.half === 1 ? '<br>1st-half rate is about half the yearly rate' : ''}</span><br>`
                + vsEarlier(b.rate, prev?.rate, prevLabel, { higherIsGood: false, fmt: money })),
            card('Assessed value', wholeDollars(b.assessed),
                `<span class="muted">land ${esc(wholeDollars(b.land))} · buildings ${esc(wholeDollars(b.buildings))}</span><br>`
                + vsEarlier(b.assessed, prev?.assessed, prevLabel, { higherIsGood: false, fmt: wholeDollars })),
            Y?.complete
                ? card(`${b.year} property tax`, money(Y.total),
                    `<span class="muted">${esc(money(Y.h1))} + ${esc(money(Y.h2))}</span><br>`
                    + vsEarlier(Y.total, PY?.complete ? PY.total : NaN, PY?.complete ? String(PY.year) : null, { higherIsGood: false, fmt: money, none: 'no full year before to compare' }), 'var(--red)')
                : card(`${b.year} property tax`, 'so far ' + money(Y?.total ?? b.amount),
                    `<span class="muted">the full year shows once the 2nd half is added</span>${PY?.complete ? `<br><span class="muted">${PY.year} was ${esc(money(PY.total))}</span>` : ''}`),
        ].join('');
        draw();
    };
    $('#pick').onchange = e => show(+e.target.value);
    $('#prev').onclick = () => show(i - 1);
    $('#next').onclick = () => show(i + 1);

    // ── Year by year ──
    const totalOf = (list, f) => sum(list.map(f).filter(Number.isFinite));
    dataTable($('#t-years'), {
        columns: [
            { id: 'year', label: 'Year', value: r => r.year, num: true, cell: r => `<strong>${r.year}</strong>` },
            moneyCol('h1', '1st half', r => r.h1),
            moneyCol('h2', '2nd half', r => r.h2),
            { ...moneyCol('total', 'Year total', r => r.total), cell: r => `<strong>${esc(money(r.total))}</strong>${r.complete ? '' : ' <span class="muted">(so far)</span>'}` },
            { id: 'change', label: 'Change', num: true, value: r => r.change, text: v => (v > 0 ? '+' : '') + money(v),
                tdClass: r => `nowrap${r.change > 0 ? ' negative' : r.change < 0 ? ' positive' : ''}` },
            numCol('rate', 'Tax rate', r => r.rate, money),
            numCol('assessed', 'Assessed value', r => r.assessed, wholeDollars),
            moneyCol('monthly', 'Mortgage payment', r => r.monthly),
            { id: 'inc', label: 'Increase/mo', num: true, value: r => r.increase, text: v => '+' + money(v), tdClass: () => 'nowrap' },
        ],
        rows: years,
        sort: { col: 'year', dir: 'desc' },
        footer: (list, filtered) => `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
            <td class="amt"><strong>${esc(money(totalOf(list, r => r.h1)))}</strong></td>
            <td class="amt"><strong>${esc(money(totalOf(list, r => r.h2)))}</strong></td>
            <td class="amt"><strong>${esc(money(totalOf(list, r => r.total)))}</strong></td><td colspan="5"></td></tr>`,
    });

    // ── All bills ──
    dataTable($('#t-bills'), {
        columns: [
            { id: 'bill', label: 'Bill', value: r => r.year * 10 + r.half, text: v => `${Math.floor(v / 10)} ${halfText(v % 10)}`,
                sortKey: v => v, sortLabels: ['Oldest → Newest', 'Newest → Oldest'], tdClass: () => 'nowrap' },
            dateCol('billed', 'Billed', r => r.billed),
            dateCol('due', 'Due', r => r.due),
            { ...moneyCol('amount', 'Amount due', r => r.amount), cell: r => `<strong>${esc(money(r.amount))}</strong>` },
            ...RATE_PARTS.map(p => numCol(p.id, p.label, r => r.rates[p.id], money)),
            numCol('rate', 'Total rate', r => r.rate, money),
            numCol('land', 'Land', r => r.land, wholeDollars),
            numCol('buildings', 'Buildings', r => r.buildings, wholeDollars),
            numCol('assessed', 'Assessed', r => r.assessed, wholeDollars),
            moneyCol('annual', 'Annual tax bill', r => r.annual),
            moneyCol('monthly', 'Mortgage payment', r => r.monthly),
            { id: 'notes', label: 'Notes', value: r => r.notes, tdClass: () => 'note-text bill-note' },
        ],
        rows: bills,
        sort: { col: 'bill', dir: 'desc' },
        onChange: list => { $('#count').textContent = `${list.length} bill${list.length === 1 ? '' : 's'} · from ${TAX_PATH}`; },
    });
    editableSheet($('#t-bills'), { path: TAX_PATH, onSaved: () => renderTaxes(el), recalc: recalcTaxRow, calculated: TAX_CALCULATED, dupKey: taxDupKey });

    // ── Caught up? Bills come every six months ──
    const next = last.half === 1 ? { year: last.year, half: 2 } : { year: last.year + 1, half: 1 };
    const lastBilled = last.billed || last.due;
    const expected = lastBilled ? addMonths(lastBilled, 6) : null;
    const nextText = `${next.year} ${halfText(next.half)}`;
    $('#catchup').innerHTML = !expected ? '' : today() >= expected
        ? `<div class="banner row">
            <span>📬 <strong>There's a new property tax bill to add (${esc(nextText)}).</strong> Your last bill (${esc(billLabel(last))}) was billed ${esc(dLong(lastBilled))}, so the next one was billed around ${esc(dLong(expected))}.</span>
            <span class="spacer"></span><button class="primary small" id="catchup-add">Add it now</button></div>`
        : `<div class="banner ok">✓ <strong>All property tax bills are caught up.</strong> The next one (${esc(nextText)}) is billed around ${esc(dLong(expected))}.</div>`;
    // About a month before the next bill the details can be looked up.
    // Green while waiting; yellow from that day on (something to do); gone once the bill is expected.
    const detailsOn = expected ? addMonths(expected, -1) : null;
    $('#details-soon').innerHTML = !expected || today() >= expected ? ''
        : today() >= detailsOn
            ? `<div class="banner">🔎 <strong>Around ${esc(dLong(detailsOn))} you should be able to get the details of this half (${esc(nextText)}).</strong> ${portalLink}</div>`
            : `<div class="banner ok">🗓️ <strong>Around ${esc(dLong(detailsOn))} you should be able to get the details of this half (${esc(nextText)}).</strong></div>`;

    // ── Add a bill: the next half, prefilled from the latest bill of the same half and the latest assessment ──
    const form = $('#add-form');
    const options = [next, next.half === 1 ? { year: next.year, half: 2 } : { year: next.year + 1, half: 1 }];
    form.which.innerHTML = options.map((o, k) => `<option value="${k}">${o.year} ${halfText(o.half)}</option>`).join('');
    const readForm = () => {
        const f = Object.fromEntries(new FormData(form));
        const o = options[+f.which];
        const b = {
            year: o.year, half: o.half, billed: dateOf(f.billed), due: dateOf(f.due),
            county: numOf(f.county), school: numOf(f.school), town: numOf(f.town), state: numOf(f.state),
            land: numOf(f.land), buildings: numOf(f.buildings),
            monthly: numOf(f.monthly), increase: numOf(f.increase), notes: f.notes,
        };
        b.rate = b.county + b.school + b.town + b.state;
        b.assessed = b.land + b.buildings;
        // The bill is value × rate ÷ 1,000; for the 2nd half, minus what the 1st half already charged.
        const h1 = find(o.year, 1);
        b.firstHalf = o.half === 2 ? (h1?.amount ?? NaN) : NaN;
        const yearTax = Math.round(b.assessed * b.rate / 10) / 100;
        b.calculated = o.half === 1 ? yearTax : Math.round((yearTax - b.firstHalf) * 100) / 100;
        b.amount = String(f.amount).trim() === '' ? b.calculated : numOf(f.amount);
        return b;
    };
    const problems = b => {
        const p = [];
        if (b.billed && bills.some(x => sameDay(x.billed, b.billed) && sameAmount(x.amount, b.amount))) p.push(dupText(b.billed, b.amount, 'a bill dated'));
        else if (find(b.year, b.half)) p.push(`The ${b.year} ${halfText(b.half)} bill is already in the file.`);
        if (!b.billed) p.push('Enter the billing date.');
        if (![b.county, b.school, b.town, b.state].every(Number.isFinite)) p.push('Enter all four tax rates.');
        if (![b.land, b.buildings].every(Number.isFinite)) p.push('Enter the land and buildings values.');
        if (!Number.isFinite(b.amount)) p.push(b.half === 2 && !Number.isFinite(b.firstHalf)
            ? `Enter the amount due (the ${b.year} 1st half isn't in the file, so it can't be worked out).` : 'Enter the amount due.');
        return p;
    };
    const preview = () => {
        const b = readForm(), p = problems(b), bits = [];
        if (Number.isFinite(b.rate)) bits.push(`total rate ${money(b.rate)}`);
        if (Number.isFinite(b.assessed)) bits.push(`assessed ${wholeDollars(b.assessed)}`);
        if (Number.isFinite(b.calculated)) {
            const typed = String(form.amount.value).trim() !== '';
            bits.push(typed && Math.abs(b.amount - b.calculated) >= 0.01
                ? `amount ${money(b.amount)} (calculated ${money(b.calculated)})`
                : `amount due ${money(b.calculated)}${typed ? ' ✓ matches' : ' (calculated)'}`);
        }
        if (b.half === 2 && Number.isFinite(b.firstHalf) && Number.isFinite(b.amount)) bits.push(`${b.year} total ${money(b.amount + b.firstHalf)}`);
        $('#add-preview').innerHTML = esc(bits.join(' · '))
            + (form.dataset.tried && p.length ? `<br><span class="negative">${p.map(esc).join(' ')}</span>` : '');
    };
    const prefill = () => {
        const o = options[+form.which.value];
        const sameHalf = [...bills].reverse().find(b => b.half === o.half) || last;
        for (const k of ['county', 'school', 'town', 'state']) form[k].value = Number.isFinite(sameHalf.rates[k]) ? sameHalf.rates[k] : '';
        form.land.value = Number.isFinite(last.land) ? last.land : '';
        form.buildings.value = Number.isFinite(last.buildings) ? last.buildings : '';
        const monthly = [...bills].reverse().map(b => b.monthly).find(Number.isFinite);
        form.monthly.value = Number.isFinite(monthly) ? monthly : '';
        // Usual dates: 1st half billed in May, due Jul 1; 2nd half billed in Nov, due mid-January.
        const ref = [...bills].reverse().find(b => b.half === o.half);
        const shift = d => (d ? new Date(d.getFullYear() + (o.year - ref.year), d.getMonth(), d.getDate()) : null);
        if (ref?.billed) form.billed.value = isoDate(shift(ref.billed));
        if (ref?.due) form.due.value = isoDate(shift(ref.due));
    };
    $('#add-open').onclick = () => {
        form.reset();
        delete form.dataset.tried;
        form.which.value = '0';
        prefill();
        form.hidden = false;
        $('#add-open').hidden = true;
        preview();
        form.scrollIntoView({ block: 'center' });
        form.billed.focus({ preventScroll: true });
    };
    $('#add-cancel').onclick = () => { form.hidden = true; $('#add-open').hidden = false; };
    $('#catchup-add')?.addEventListener('click', () => $('#add-open').click());
    form.which.onchange = () => { prefill(); preview(); };
    form.oninput = preview;
    form.onsubmit = async e => {
        e.preventDefault();
        form.dataset.tried = '1';
        const b = readForm();
        if (problems(b).length) { preview(); return; }
        $('#add-save').disabled = true;
        try {
            await addTaxBill(b, b.firstHalf);
            toast(`Added the ${b.year} ${halfText(b.half)} tax bill`, 'ok');
            rememberedBill = null; // open on the latest bill
            await renderTaxes(el);
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            $('#add-save').disabled = false;
        }
    };

    setResize(draw);
    show(i);
    requestAnimationFrame(draw); // canvases have their real width once laid out
}
