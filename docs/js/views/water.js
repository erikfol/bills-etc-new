// Utilities → Water: quarterly bills from inputs/water/master_water.csv.
import { loadWater, addWaterBill, calcWater, nextQuarter, quarterDates, WATER_PATH } from '../water.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { dataTable } from '../datatable.js';
import {
    dLong, period, addMonths, today, axisMoney, axisNum, isoDate, dateOf, numOf,
    card, vsEarlier, dateCol, moneyCol, numCol, setResize,
} from './utilcommon.js';

let rememberedBill = null; // 'Q1 - 2026' while you move between pages
let rememberedYear = null;

const qShort = b => `Q${b.q} ’${String(b.year).slice(2)}`;
const qLong = b => `Q${b.q} ${b.year}`;
const gal = n => Number.isFinite(n) ? `${Math.round(n).toLocaleString('en-US')} gal` : '–';
/** $4.40, or $4.125 when the rate has a third decimal. */
const rateText = r => { if (!Number.isFinite(r)) return '–'; const t = r.toFixed(3); return '$' + (t.endsWith('0') ? r.toFixed(2) : t); };
// The town's online bill payment kiosk for water.
const WATER_PORTAL = 'https://nhtaxkiosk.com/?KIOSKID=ENFIELD';
const portalLink = `<a class="ext-link" href="${WATER_PORTAL}" target="_blank" rel="noopener">Enfield water bills ↗</a>`;
const COLORS = { fixed: '#8e9fb8', usage: '#4a90d9', other: '#f0b955', water: '#3fa7d6', prev: '#c5cbd6' };

export default async function renderWater(el) {
    el.innerHTML = '<p class="muted">Loading water bills…</p>';
    const data = await loadWater();
    if (!data) {
        el.innerHTML = `<div class="banner">No water bills found. This page reads <code>${esc(WATER_PATH)}</code> in your bills-etc folder.</div>`;
        return;
    }
    if (data.missing.length) {
        el.innerHTML = `<div class="banner bad"><code>${esc(WATER_PATH)}</code> is missing columns this page needs (${esc(data.missing.join(', '))}). It expects Quarter, Bill Period End, Gallons Used and Total Due.</div>`;
        return;
    }
    const { bills } = data;
    if (!bills.length) {
        el.innerHTML = `<div class="banner"><code>${esc(WATER_PATH)}</code> has no bills yet.</div>`;
        return;
    }
    let i = bills.findIndex(b => b.quarter === rememberedBill);
    if (i < 0) i = bills.length - 1; // open on the latest quarter
    const sameQuarterLastYear = b => bills.find(x => x.q === b.q && x.year === b.year - 1) || null;

    el.innerHTML = `
        <div id="catchup"></div>
        <div id="unpaid"></div>
        <div class="row dash-head">
            <h2 class="page-sub">Water</h2>
            <span class="spacer"></span>
            <div class="month-nav">
                <button id="prev" title="Previous quarter" aria-label="Previous quarter">◀</button>
                <select id="bill">${bills.map((b, k) => `<option value="${k}">${esc(qLong(b))} · ${esc(period(b))}</option>`).join('')}</select>
                <button id="next" title="Next quarter" aria-label="Next quarter">▶</button>
            </div>
        </div>
        <p class="lead" id="lead"></p>
        <div class="cards kpis" id="kpis"></div>

        <section>
            <h2>Cost per quarter <span class="sub">click a bar to open that quarter</span></h2>
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:${COLORS.fixed}"></span>Fixed charges (flat unit, fixed cost, meter)</span>
                <span><span class="legend-dot" style="background:${COLORS.usage}"></span>Usage (gallons × rate)</span>
                <span><span class="legend-dot" style="background:${COLORS.other}"></span>ACH fee and adjustments</span>
            </div>
            <canvas id="c-cost" style="display:block;width:100%;height:240px;cursor:pointer"></canvas>
        </section>

        <section>
            <h2>Water use <span class="sub">gallons per quarter</span></h2>
            <canvas id="c-gal" style="display:block;width:100%;height:220px;cursor:pointer"></canvas>
        </section>

        <section>
            <div class="row" style="margin-bottom:14px">
                <h2 style="margin:0;border:0;padding:0">Annual averages <span class="sub" id="yr-sub"></span></h2>
                <span class="spacer"></span>
                <div class="month-nav">
                    <button id="yr-prev" title="Previous year" aria-label="Previous year">◀</button>
                    <select id="yr" style="min-width:100px"></select>
                    <button id="yr-next" title="Next year" aria-label="Next year">▶</button>
                </div>
            </div>
            <div class="cards kpis" id="yr-cards" style="margin-bottom:0"></div>
            <div class="grid-2 yr-charts">
                <div>
                    <h3 class="chart-title">Cost by quarter</h3>
                    <div class="chart-legend">
                        <span><span class="legend-dot" style="background:${COLORS.usage}"></span><span class="yr-this"></span></span>
                        <span class="yr-prev-key"><span class="legend-dot" style="background:${COLORS.prev}"></span><span class="yr-last"></span></span>
                    </div>
                    <canvas id="c-yr-cost" style="display:block;width:100%;height:250px"></canvas>
                </div>
                <div>
                    <h3 class="chart-title">Water use by quarter</h3>
                    <div class="chart-legend">
                        <span><span class="legend-dot" style="background:${COLORS.water}"></span><span class="yr-this"></span></span>
                        <span class="yr-prev-key"><span class="legend-dot" style="background:${COLORS.prev}"></span><span class="yr-last"></span></span>
                    </div>
                    <canvas id="c-yr-gal" style="display:block;width:100%;height:250px"></canvas>
                </div>
            </div>
        </section>

        <section>
            <h2>Year by year <span class="sub">by the year of each quarter</span></h2>
            <div id="t-years"></div>
        </section>

        <section>
            <h2>All bills <span class="sub" id="bill-count"></span><span class="spacer"></span>${portalLink}</h2>
            <div id="t-bills"></div>
            <div class="row" style="margin-top:14px"><button class="primary" id="add-open">+ Add a bill</button></div>
            <form id="add-form" class="add-bill" hidden>
                <h3 class="row">Add a bill <span class="spacer"></span><span style="font-weight:400">Get the statement from ${portalLink}</span></h3>
                <div class="add-grid">
                    <label class="field">Quarter<select name="quarter"></select></label>
                    <label class="field">Bill period start<input type="date" name="start" required></label>
                    <label class="field">Bill period end<input type="date" name="end" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">Payment due date<input type="date" name="due"></label>
                    <label class="field">Gallons used<input type="number" name="gallons" min="0" step="1" required></label>
                    <label class="field">Rate per 1,000 gallons ($)<input type="number" name="rate" min="0" step="0.001" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">Flat unit cost ($)<input type="number" name="flat" min="0" step="0.01" required></label>
                    <label class="field">Water fixed cost ($)<input type="number" name="fixed" min="0" step="0.01" required></label>
                    <label class="field">Meter charge ($)<input type="number" name="meter" min="0" step="0.01" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">True amount due on the statement ($)<input type="number" name="statement" min="0" step="0.01" required placeholder="0.00"></label>
                    <label class="field">Service fee (ACH) ($)<input type="number" name="fee" min="0" step="0.01" required></label>
                    <label class="check" style="align-self:end;padding-bottom:8px"><input type="checkbox" name="paid" checked> Paid</label>
                </div>
                <p class="add-preview" id="add-preview"></p>
                <div class="row">
                    <button type="submit" class="primary" id="add-save">Save bill</button>
                    <button type="button" id="add-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Adds a row to ${esc(WATER_PATH)}. Close the file in Excel first.</span>
                </div>
            </form>
        </section>`;

    const $ = s => el.querySelector(s);

    // ── Big charts: every quarter ──
    const other = b => b.total - b.fixedAll - (Number.isFinite(b.usage) ? b.usage : 0);
    const draw = () => {
        drawBars($('#c-cost'), {
            labels: bills.map(qShort),
            series: [
                { values: bills.map(b => b.fixedAll), color: COLORS.fixed },
                { values: bills.map(b => b.usage), color: COLORS.usage },
                { values: bills.map(b => Math.max(0, other(b))), color: COLORS.other },
            ],
            stacked: true, selected: i, fmt: axisMoney,
        });
        drawBars($('#c-gal'), {
            labels: bills.map(qShort),
            series: [{ values: bills.map(b => b.gallons), color: COLORS.water }],
            selected: i, fmt: axisNum,
        });
    };
    for (const id of ['#c-cost', '#c-gal']) {
        $(id).onclick = e => { const k = $(id)._hit?.(e.offsetX) ?? -1; if (k >= 0) show(k); };
    }

    // ── One quarter ──
    const show = k => {
        i = k;
        const b = bills[i], prev = sameQuarterLastYear(b), prevLabel = prev ? qLong(prev) : null;
        rememberedBill = b.quarter;
        $('#bill').value = String(i);
        $('#prev').disabled = i === 0;
        $('#next').disabled = i === bills.length - 1;
        $('#lead').innerHTML = `${esc(qLong(b))} · ${esc(period(b))}${Number.isFinite(b.days) ? ` · ${b.days} days` : ''}`
            + `${b.due ? ` · due ${esc(dLong(b.due))}` : ''}`;

        const perDay = b.days > 0 ? b.gallons / b.days : NaN;
        const breakdown = [
            Number.isFinite(b.flat) ? `flat unit ${money(b.flat)}` : '',
            Number.isFinite(b.fixed) ? `fixed ${money(b.fixed)}` : '',
            Number.isFinite(b.meter) ? `meter ${money(b.meter)}` : '',
        ].filter(Boolean).join(' · ');
        const diffNote = Number.isFinite(b.diff) && Math.abs(b.diff) >= 0.005
            ? `<br><span class="delta-bad">Statement was ${esc(money(Math.abs(b.diff)))} ${b.diff < 0 ? 'more' : 'less'} than calculated (${esc(money(b.calc))})</span>` : '';
        $('#kpis').innerHTML = [
            card(`Total due ${b.isPaid ? '<span class="badge badge-ok paid-tag">Paid</span>' : '<span class="badge badge-over paid-tag">Not Paid</span>'}`, money(b.total),
                `<span class="muted">statement ${esc(money(b.statement))}${Number.isFinite(b.fee) ? ` + ACH fee ${esc(money(b.fee))}` : ''}</span><br>`
                + vsEarlier(b.total, prev?.total, prevLabel, { higherIsGood: false, fmt: money }), 'var(--red)'),
            card('Water used', gal(b.gallons),
                (Number.isFinite(perDay) ? `<span class="muted">about ${Math.round(perDay)} gallons a day</span><br>` : '')
                + vsEarlier(b.gallons, prev?.gallons, prevLabel, { higherIsGood: false, fmt: gal })),
            card('Usage rate per 1,000 gal', rateText(b.rate),
                `<span class="muted">usage charge ${esc(money(b.usage))}</span><br>`
                + vsEarlier(b.rate, prev?.rate, prevLabel, { higherIsGood: false, fmt: rateText })),
            card('Fixed charges', money(b.fixedAll), `<span class="muted">${esc(breakdown)}</span>${diffNote}`),
        ].join('');
        draw();
    };
    $('#bill').onchange = e => show(+e.target.value);
    $('#prev').onclick = () => show(i - 1);
    $('#next').onclick = () => show(i + 1);

    // ── Year by year ──
    const yearList = [...new Set(bills.map(b => b.year))].sort((a, b) => a - b);
    const years = yearList.map(y => {
        const list = bills.filter(b => b.year === y);
        const gallons = sum(list.map(b => b.gallons)), total = sum(list.map(b => b.total));
        const rates = list.map(b => b.rate).filter(Number.isFinite);
        return {
            year: y, count: list.length, gallons, total,
            usage: sum(list.map(b => b.usage).filter(Number.isFinite)),
            fixedAll: sum(list.map(b => b.fixedAll)),
            avg: total / list.length,
            perThousand: gallons > 0 ? total / gallons * 1000 : NaN,
            rateLo: Math.min(...rates), rateHi: Math.max(...rates),
        };
    });
    const totalOf = (list, f) => sum(list.map(f).filter(Number.isFinite));
    dataTable($('#t-years'), {
        columns: [
            { id: 'year', label: 'Year', value: r => r.year, num: true, cell: r => `<strong>${r.year}</strong>` },
            { id: 'count', label: 'Quarters', value: r => r.count, num: true },
            numCol('gal', 'Gallons', r => r.gallons, gal),
            moneyCol('usage', 'Usage', r => r.usage),
            moneyCol('fixed', 'Fixed charges', r => r.fixedAll),
            moneyCol('total', 'Total', r => r.total),
            moneyCol('avg', 'Average bill', r => r.avg),
            numCol('per', 'Cost per 1,000 gal', r => r.perThousand, money),
        ],
        rows: years,
        sort: { col: 'year', dir: 'desc' },
        footer: (list, filtered) => {
            const g = totalOf(list, r => r.gallons), t = totalOf(list, r => r.total);
            return `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                <td class="amt"><strong>${totalOf(list, r => r.count)}</strong></td>
                <td class="amt"><strong>${esc(gal(g))}</strong></td>
                <td class="amt"><strong>${esc(money(totalOf(list, r => r.usage)))}</strong></td>
                <td class="amt"><strong>${esc(money(totalOf(list, r => r.fixedAll)))}</strong></td>
                <td class="amt"><strong>${esc(money(t))}</strong></td><td></td>
                <td class="amt"><strong>${g > 0 ? esc(money(t / g * 1000)) : ''}</strong></td></tr>`;
        },
    });

    // ── Annual averages for one year, with its quarters next to the year before ──
    $('#yr').innerHTML = [...yearList].reverse().map(y => `<option value="${y}">${y}</option>`).join('');
    const byQuarter = (y, f) => [1, 2, 3, 4].map(q => { const b = bills.find(x => x.year === y && x.q === q); return b ? f(b) : NaN; });
    const drawYear = () => {
        const y = rememberedYear;
        if (y == null) return;
        const hasPrev = yearList.includes(y - 1);
        const QL = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];
        drawBars($('#c-yr-cost'), {
            labels: QL,
            series: [
                ...(hasPrev ? [{ values: byQuarter(y - 1, b => b.total), color: COLORS.prev }] : []),
                { values: byQuarter(y, b => b.total), color: COLORS.usage, valueLabels: true },
            ],
            fmt: axisMoney, valueFmt: v => money(v),
        });
        drawBars($('#c-yr-gal'), {
            labels: QL,
            series: [
                ...(hasPrev ? [{ values: byQuarter(y - 1, b => b.gallons), color: COLORS.prev }] : []),
                { values: byQuarter(y, b => b.gallons), color: COLORS.water, valueLabels: true },
            ],
            fmt: axisNum, valueFmt: axisNum,
        });
    };
    const showYear = y => {
        rememberedYear = y;
        const Y = years.find(x => x.year === y), k = yearList.indexOf(y);
        el.querySelectorAll('.yr-this').forEach(s => { s.textContent = y; });
        el.querySelectorAll('.yr-last').forEach(s => { s.textContent = `${y - 1} (for comparison)`; });
        el.querySelectorAll('.yr-prev-key').forEach(s => { s.hidden = !yearList.includes(y - 1); });
        $('#yr').value = String(y);
        $('#yr-prev').disabled = k === 0;
        $('#yr-next').disabled = k === yearList.length - 1;
        $('#yr-sub').textContent = `${Y.count} quarter${Y.count === 1 ? '' : 's'} in ${y}${Y.count < 4 ? ' (not a full year)' : ''}`;
        const rates = Y.rateLo === Y.rateHi ? rateText(Y.rateLo) : `${rateText(Y.rateLo)}–${rateText(Y.rateHi)}`;
        $('#yr-cards').innerHTML = [
            card('Average water used', gal(Y.gallons / Y.count), `<span class="muted">per quarter · ${esc(gal(Y.gallons))} in total</span>`),
            card('Average bill', money(Y.avg), '<span class="muted">per quarter</span>', 'var(--red)'),
            card('Cost per 1,000 gallons', Number.isFinite(Y.perThousand) ? money(Y.perThousand) : '–',
                `<span class="muted">year total ÷ gallons, fixed charges included<br>usage rate alone: ${esc(rates)} per 1,000</span>`),
            card('Year total cost', money(Y.total),
                `<span class="muted">usage ${esc(money(Y.usage))} · fixed ${esc(money(Y.fixedAll))}<br>over ${Y.count} quarter${Y.count === 1 ? '' : 's'}</span>`, 'var(--red)'),
        ].join('');
        drawYear();
    };
    $('#yr').onchange = e => showYear(+e.target.value);
    $('#yr-prev').onclick = () => showYear(yearList[yearList.indexOf(rememberedYear) - 1]);
    $('#yr-next').onclick = () => showYear(yearList[yearList.indexOf(rememberedYear) + 1]);
    showYear(yearList.includes(rememberedYear) ? rememberedYear : yearList.at(-1));

    // ── All bills ──
    dataTable($('#t-bills'), {
        columns: [
            { id: 'quarter', label: 'Quarter', value: r => r.year * 10 + (r.q || 0), num: false, text: v => `Q${v % 10} ${Math.floor(v / 10)}`,
                sortKey: v => v, sortLabels: ['Oldest → Newest', 'Newest → Oldest'], tdClass: () => 'nowrap' },
            dateCol('start', 'Period start', r => r.start),
            dateCol('end', 'Period end', r => r.end),
            dateCol('due', 'Due', r => r.due),
            numCol('gal', 'Gallons', r => r.gallons, gal),
            numCol('rate', 'Rate / 1,000', r => r.rate, rateText),
            moneyCol('usage', 'Usage', r => r.usage),
            moneyCol('fixed', 'Fixed charges', r => r.fixedAll),
            moneyCol('statement', 'Statement', r => r.statement),
            { id: 'diff', label: 'Diff', num: true, value: r => r.diff, text: v => (Math.abs(v) < 0.005 ? '–' : money(v)),
                tdClass: r => `nowrap${Math.abs(r.diff) >= 0.005 ? ' negative' : ''}` },
            moneyCol('fee', 'ACH fee', r => r.fee),
            { ...moneyCol('total', 'Total due', r => r.total), cell: r => `<strong>${esc(money(r.total))}</strong>` },
            { id: 'paid', label: 'Paid?', value: r => r.paid, cell: r => (r.isPaid ? '<span class="badge badge-ok">Yes</span>' : `<span class="badge badge-over">${esc(r.paid || 'No')}</span>`) },
        ],
        rows: bills,
        sort: { col: 'quarter', dir: 'desc' },
        onChange: list => { $('#bill-count').textContent = `${list.length} quarter${list.length === 1 ? '' : 's'} · from ${WATER_PATH}`; },
    });

    // ── Banners: a quarter to add, and anything not marked paid ──
    const last = bills.at(-1), lastDue = last.due || last.end;
    const nextDue = addMonths(lastDue, 3); // quarterly
    const nq = last.q ? nextQuarter(last) : null;
    const nqText = nq ? `Q${nq.q} ${nq.year}` : 'next quarter';
    $('#catchup').innerHTML = today() >= nextDue
        ? `<div class="banner row">
            <span>📬 <strong>There's a new water statement to add (${esc(nqText)}).</strong> Your last bill (${esc(qLong(last))}) was due ${esc(dLong(lastDue))}, so the next one was due around ${esc(dLong(nextDue))}.</span>
            <span class="spacer"></span><button class="primary small" id="catchup-add">Add it now</button></div>`
        : `<div class="banner ok">✓ <strong>All water statements are caught up.</strong> The next one (${esc(nqText)}) is due around ${esc(dLong(nextDue))}.</div>`;
    const unpaid = bills.filter(b => !b.isPaid);
    $('#unpaid').innerHTML = unpaid.length
        ? `<div class="banner bad"><strong>Not marked paid:</strong> ${unpaid.map(b => `${esc(qLong(b))} (${esc(money(b.total))}${b.due ? `, due ${esc(dLong(b.due))}` : ''})`).join(', ')}. Change the Paid? column in the file once it's paid.</div>` : '';

    // ── Add a bill: the next quarter, prefilled with the latest bill's rates and charges ──
    const form = $('#add-form');
    const have = new Set(bills.map(b => `${b.year}-${b.q}`));
    const options = [];
    for (let qy = nq || { q: 1, year: new Date().getFullYear() }, n = 0; n < 4; qy = nextQuarter(qy), n++) options.push(qy);
    form.quarter.innerHTML = options.map((o, k) => `<option value="${k}">Q${o.q} ${o.year}</option>`).join('');
    const setPeriod = () => {
        const [s, e] = quarterDates(options[+form.quarter.value]);
        form.start.value = isoDate(s);
        form.end.value = isoDate(e);
    };
    const readForm = () => {
        const f = Object.fromEntries(new FormData(form));
        const qy = options[+f.quarter];
        return {
            q: qy.q, year: qy.year, start: dateOf(f.start), end: dateOf(f.end), due: dateOf(f.due),
            gallons: numOf(f.gallons), rate: numOf(f.rate), flat: numOf(f.flat), fixed: numOf(f.fixed), meter: numOf(f.meter),
            statement: numOf(f.statement), fee: numOf(f.fee), paid: f.paid === 'on',
        };
    };
    const problems = b => {
        const p = [];
        if (have.has(`${b.year}-${b.q}`)) p.push(`Q${b.q} ${b.year} is already in the file.`);
        if (!b.start || !b.end) p.push('Enter the bill period start and end.');
        else if (b.end <= b.start) p.push('The period end must be after the start.');
        if (!Number.isFinite(b.gallons)) p.push('Enter the gallons used.');
        if (!Number.isFinite(b.rate)) p.push('Enter the rate per 1,000 gallons.');
        if (![b.flat, b.fixed, b.meter, b.fee].every(Number.isFinite)) p.push('Fill in the flat unit, fixed cost, meter charge and ACH fee (0 if none).');
        if (!Number.isFinite(b.statement)) p.push('Enter the true amount due from the statement.');
        return p;
    };
    const preview = () => {
        const b = readForm(), p = problems(b), bits = [];
        if ([b.gallons, b.rate, b.flat, b.fixed, b.meter].every(Number.isFinite)) {
            const { usage, calc } = calcWater(b);
            bits.push(`usage ${money(usage)}`, `calculated ${money(calc)}`);
            if (Number.isFinite(b.statement)) {
                const diff = calc - b.statement;
                bits.push(Math.abs(diff) < 0.005 ? 'statement matches' : `statement ${money(b.statement)} is ${money(Math.abs(diff))} ${diff < 0 ? 'more' : 'less'} than calculated`);
            }
        }
        if (Number.isFinite(b.statement) && Number.isFinite(b.fee)) bits.push(`total due ${money(b.statement + b.fee)}`);
        $('#add-preview').innerHTML = esc(bits.join(' · '))
            + (form.dataset.tried && p.length ? `<br><span class="negative">${p.map(esc).join(' ')}</span>` : '');
    };
    $('#add-open').onclick = () => {
        form.reset();
        delete form.dataset.tried;
        form.quarter.value = '0';
        setPeriod();
        if (Number.isFinite(last.rate)) form.rate.value = last.rate;
        if (Number.isFinite(last.flat)) form.flat.value = last.flat;
        if (Number.isFinite(last.fixed)) form.fixed.value = last.fixed;
        if (Number.isFinite(last.meter)) form.meter.value = last.meter;
        if (Number.isFinite(last.fee)) form.fee.value = last.fee;
        form.hidden = false;
        $('#add-open').hidden = true;
        preview();
        form.scrollIntoView({ block: 'center' });
        form.due.focus({ preventScroll: true });
    };
    $('#add-cancel').onclick = () => { form.hidden = true; $('#add-open').hidden = false; };
    $('#catchup-add')?.addEventListener('click', () => $('#add-open').click());
    form.quarter.onchange = () => { setPeriod(); preview(); };
    form.oninput = preview;
    form.onsubmit = async e => {
        e.preventDefault();
        form.dataset.tried = '1';
        const b = readForm();
        if (problems(b).length) { preview(); return; }
        $('#add-save').disabled = true;
        try {
            await addWaterBill(b);
            toast(`Added the Q${b.q} ${b.year} water bill`, 'ok');
            rememberedBill = null; // open on the latest quarter
            await renderWater(el);
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            $('#add-save').disabled = false;
        }
    };

    const redraw = () => { draw(); drawYear(); };
    setResize(redraw);
    show(i);
    requestAnimationFrame(redraw); // canvases have their real width once laid out
}
