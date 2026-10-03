// Utilities → Home Heating: oil deliveries from inputs/heat_home/master_heat_home.csv and Heatable price checks
// from inputs/heat_home/heatable_cost_trend.csv.
import {
    loadDeliveries, loadPriceChecks, addDelivery, addPriceCheck, setPaidBack, daysBetween, HEAT_PATH, PRICE_PATH,
} from '../heating.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { dataTable } from '../datatable.js';
import {
    MON, dLong, today, axisMoney, axisNum, isoDate, dateOf, numOf,
    card, vsEarlier, dateCol, moneyCol, numCol, setResize, yearChips,
} from './utilcommon.js';

let rememberedDelivery = null; // delivery date (ms) while you move between pages
let rememberedYear = null;
let chartYears = null; // years shown in the three big charts (null = all)

const PAID_BACK = ['Yes', 'Not Yet', 'Need To Check'];
const COLORS = { cost: '#e74c3c', price: '#e67e22', check: '#b9c2d0', usage: '#3fa7d6', prev: '#c5cbd6' };
const shortDate = d => `${MON[d.getMonth()]} ${d.getDate()} ’${String(d.getFullYear()).slice(2)}`;
const gal = n => Number.isFinite(n) ? `${(Math.round(n * 10) / 10).toLocaleString('en-US')} gal` : '–';
const perGal = n => Number.isFinite(n) ? `${money(n)}/gal` : '–';
const perDay = n => Number.isFinite(n) ? `${n.toFixed(2)} gal/day` : '–';
const paidBadge = d => d.isPaidBack ? '<span class="badge badge-ok">Paid back</span>'
    : `<span class="badge badge-over">${esc(d.paidBack || 'Not paid back')}</span>`;
const markBtn = (d, text = 'Mark paid back', cls = '') =>
    `<button type="button" class="small primary ${cls}" data-paid-back="${d.date.getTime()}">${text}</button>`;

export default async function renderHeating(el) {
    el.innerHTML = '<p class="muted">Loading heating oil deliveries…</p>';
    const data = await loadDeliveries();
    if (!data) {
        el.innerHTML = `<div class="banner">No heating deliveries found. This page reads <code>${esc(HEAT_PATH)}</code> in your bills-etc folder.</div>`;
        return;
    }
    if (data.missing.length) {
        el.innerHTML = `<div class="banner bad"><code>${esc(HEAT_PATH)}</code> is missing columns this page needs (${esc(data.missing.join(', '))}). It expects Date Delivered, Gallons and Actual Price.</div>`;
        return;
    }
    const { deliveries } = data;
    if (!deliveries.length) {
        el.innerHTML = `<div class="banner"><code>${esc(HEAT_PATH)}</code> has no deliveries yet.</div>`;
        return;
    }
    const checks = await loadPriceChecks();
    const lastCheck = checks.at(-1) || null;
    let i = deliveries.findIndex(d => d.date.getTime() === rememberedDelivery);
    if (i < 0) i = deliveries.length - 1; // open on the latest delivery
    const last = deliveries.at(-1);
    const providers = [...new Set(deliveries.map(d => d.provider).filter(Boolean))];

    el.innerHTML = `
        <div id="status"></div>
        <div id="unpaid"></div>
        <div class="row dash-head">
            <h2 class="page-sub">Home Heating <span class="muted" style="font-weight:400;font-size:0.8em">heating oil</span></h2>
            <span class="spacer"></span>
            <div class="month-nav">
                <button id="prev" title="Previous delivery" aria-label="Previous delivery">◀</button>
                <select id="pick">${deliveries.map((d, k) => `<option value="${k}">${esc(dLong(d.date))} · ${esc(d.provider)} · ${esc(gal(d.gallons))}</option>`).join('')}</select>
                <button id="next" title="Next delivery" aria-label="Next delivery">▶</button>
            </div>
        </div>
        <p class="lead" id="lead"></p>
        <div class="cards kpis" id="kpis"></div>

        <section>
            <h2>Cost per delivery <span class="sub">hover for details · click a bar to open that delivery</span></h2>
            <div class="row year-chips"></div>
            <canvas id="c-cost" style="display:block;width:100%;height:230px;cursor:pointer"></canvas>
        </section>

        <section>
            <h2>Price per gallon <span class="sub">what you paid at each delivery, and the prices you checked</span></h2>
            <div class="row year-chips"></div>
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:${COLORS.price}"></span>Delivery price</span>
                <span><span class="legend-dot" style="background:${COLORS.check}"></span>Price check (Heatable)</span>
            </div>
            <canvas id="c-price" style="display:block;width:100%;height:230px"></canvas>
        </section>

        <section>
            <h2>Oil used <span class="sub">gallons a day between deliveries · click a bar to open that delivery</span></h2>
            <div class="row year-chips"></div>
            <canvas id="c-usage" style="display:block;width:100%;height:230px;cursor:pointer"></canvas>
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
                    <h3 class="chart-title">Cost by month</h3>
                    <div class="chart-legend">
                        <span><span class="legend-dot" style="background:${COLORS.cost}"></span><span class="yr-this"></span></span>
                        <span class="yr-prev-key"><span class="legend-dot" style="background:${COLORS.prev}"></span><span class="yr-last"></span></span>
                    </div>
                    <canvas id="c-yr-cost" style="display:block;width:100%;height:250px"></canvas>
                </div>
                <div>
                    <h3 class="chart-title">Gallons delivered by month</h3>
                    <div class="chart-legend">
                        <span><span class="legend-dot" style="background:${COLORS.usage}"></span><span class="yr-this"></span></span>
                        <span class="yr-prev-key"><span class="legend-dot" style="background:${COLORS.prev}"></span><span class="yr-last"></span></span>
                    </div>
                    <canvas id="c-yr-gal" style="display:block;width:100%;height:250px"></canvas>
                </div>
            </div>
            <p class="note" style="margin-top:6px">Each delivery counts in the month it was delivered.</p>
        </section>

        <section>
            <h2>Year by year <span class="sub">by the year of each delivery</span></h2>
            <div id="t-years"></div>
        </section>

        <section>
            <h2>Price checks <span class="sub">from ${esc(PRICE_PATH)}</span></h2>
            <div id="t-checks"></div>
            <form id="check-form" class="row" style="margin-top:12px;align-items:flex-end">
                <label class="field">Date checked<input type="date" name="date" required></label>
                <label class="field">Price per gallon ($)<input type="number" name="price" min="0" step="0.01" required placeholder="0.00"></label>
                <button type="submit" class="primary">Add price check</button>
            </form>
        </section>

        <section>
            <h2>All deliveries <span class="sub" id="count"></span></h2>
            <div id="t-deliveries" class="short-table"></div>
            <div class="row" style="margin-top:14px"><button class="primary" id="add-open">+ Add a delivery</button></div>
            <form id="add-form" class="add-bill" hidden>
                <h3>Add a delivery</h3>
                <div class="add-grid">
                    <label class="field">Date delivered<input type="date" name="date" required></label>
                    <label class="field">Provider<input type="text" name="provider" list="providers" required></label>
                    <label class="field">Price per gallon ($)<input type="number" name="price" min="0" step="0.001" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">Gallons<input type="number" name="gallons" min="0" step="0.1" required></label>
                    <label class="field">Actual price charged ($)<input type="number" name="actual" min="0" step="0.01" placeholder="same as calculated"></label>
                    <label class="field">Paid CC back?<select name="paidBack">${PAID_BACK.map(v => `<option${v === 'Need To Check' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
                </div>
                <div class="add-grid">
                    <label class="field" style="grid-column:1/-1">Notes<input type="text" name="notes" placeholder="optional"></label>
                </div>
                <datalist id="providers">${providers.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
                <p class="add-preview" id="add-preview"></p>
                <div class="row">
                    <button type="submit" class="primary" id="add-save">Save delivery</button>
                    <button type="button" id="add-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Adds a row to ${esc(HEAT_PATH)}. Close the file in Excel first.</span>
                </div>
            </form>
        </section>`;

    const $ = s => el.querySelector(s);

    // ── Big charts (each delivery; price chart also has the price checks), filtered by the year buttons ──
    const rows = () => deliveries.filter(d => !chartYears || chartYears.has(d.year));
    const draw = () => {
        const list = rows(), sel = list.indexOf(deliveries[i]);
        drawBars($('#c-cost'), {
            labels: list.map(d => shortDate(d.date)),
            series: [
                { name: 'Cost', values: list.map(d => d.actual), color: COLORS.cost },
                { name: 'Gallons', values: list.map(d => d.gallons), tipOnly: true, tipFmt: gal },
                { name: 'Price', values: list.map(d => d.price), tipOnly: true, tipFmt: perGal },
            ],
            selected: sel, fmt: axisMoney, tipFmt: money, tipHead: k => `${dLong(list[k].date)} · ${list[k].provider}`,
        });
        // Deliveries and price checks on one timeline.
        const points = [
            ...list.map(d => ({ date: d.date, delivery: d.price, provider: d.provider })),
            ...checks.filter(c => !chartYears || chartYears.has(c.date.getFullYear())).map(c => ({ date: c.date, check: c.price })),
        ].sort((a, b) => a.date - b.date);
        drawBars($('#c-price'), {
            labels: points.map(p => shortDate(p.date)),
            series: [
                { name: 'Delivery price', values: points.map(p => p.delivery ?? NaN), color: COLORS.price },
                { name: 'Price check', values: points.map(p => p.check ?? NaN), color: COLORS.check },
            ],
            stacked: true, // each date has one of the two prices, so one centred bar
            fmt: v => '$' + v.toFixed(2), tipFmt: perGal,
            tipHead: k => `${dLong(points[k].date)}${points[k].provider ? ` · ${points[k].provider}` : ''}`,
        });
        drawBars($('#c-usage'), {
            labels: list.map(d => shortDate(d.date)),
            series: [
                { name: 'Gallons a day', values: list.map(d => d.perDay), color: COLORS.usage },
                { name: 'Days since previous delivery', values: list.map(d => d.days), tipOnly: true, tipFmt: v => `${v} days` },
            ],
            selected: sel, fmt: v => v.toFixed(1), tipFmt: perDay,
            tipHead: k => `${dLong(list[k].date)}`,
        });
    };
    for (const id of ['#c-cost', '#c-usage']) {
        $(id).onclick = e => { const k = $(id)._hit?.(e.offsetX) ?? -1; if (k >= 0) show(deliveries.indexOf(rows()[k])); };
    }
    chartYears = yearChips([...el.querySelectorAll('.year-chips')], [...new Set(deliveries.map(d => d.year))].sort((a, b) => a - b),
        chartYears, sel => { chartYears = sel; draw(); });

    // ── One delivery ──
    const show = k => {
        i = k;
        const d = deliveries[i], prev = deliveries[i - 1] || null, prevLabel = prev ? dLong(prev.date) : null;
        rememberedDelivery = d.date.getTime();
        $('#pick').value = String(i);
        $('#prev').disabled = i === 0;
        $('#next').disabled = i === deliveries.length - 1;
        $('#lead').innerHTML = `${esc(dLong(d.date))} · ${esc(d.provider)}`
            + (d.notes ? `<br><span class="note-text">${esc(d.notes)}</span>` : '');
        const fees = Number.isFinite(d.extra) && Math.abs(d.extra) >= 0.005;
        $('#kpis').innerHTML = [
            card(`Cost <span class="paid-tag">${paidBadge(d)}</span>${d.isPaidBack ? '' : ` ${markBtn(d, 'Mark paid back', 'paid-btn')}`}`,
                money(d.actual),
                `<span class="muted">${esc(gal(d.gallons))} × ${esc(perGal(d.price))}${fees ? ` + ${esc(money(d.extra))} fees` : ''}</span><br>`
                + vsEarlier(d.actual, prev?.actual, prevLabel, { higherIsGood: false, fmt: money, none: 'first delivery on record' }), 'var(--red)'),
            card('Gallons delivered', gal(d.gallons),
                Number.isFinite(d.days) ? `<span class="muted">${d.days} days after the previous delivery</span>` : '<span class="muted">first delivery on record</span>'),
            card('Price per gallon', money(d.price),
                vsEarlier(d.price, prev?.price, prevLabel, { higherIsGood: false, fmt: money, none: 'first delivery on record' })
                + (lastCheck ? `<br><span class="muted">latest check ${esc(money(lastCheck.price))} (${esc(dLong(lastCheck.date))})</span>` : '')),
            card('Oil used', perDay(d.perDay),
                prev ? `<span class="muted">${esc(dLong(prev.date))} – ${esc(dLong(d.date))}</span><br>`
                    + vsEarlier(d.perDay, prev.perDay, prevLabel, { higherIsGood: false, fmt: perDay, fmtDiff: v => `${v.toFixed(2)} gal/day` })
                    : '<span class="muted">no earlier delivery to measure from</span>'),
        ].join('');
        draw();
    };
    $('#pick').onchange = e => show(+e.target.value);
    $('#prev').onclick = () => show(i - 1);
    $('#next').onclick = () => show(i + 1);

    // ── Year by year ──
    const yearList = [...new Set(deliveries.map(d => d.year))].sort((a, b) => a - b);
    const years = yearList.map(y => {
        const list = deliveries.filter(d => d.year === y);
        const gallons = sum(list.map(d => d.gallons)), cost = sum(list.map(d => d.actual));
        const days = sum(list.map(d => d.days).filter(Number.isFinite));
        const measured = sum(list.filter(d => Number.isFinite(d.days)).map(d => d.gallons));
        return { year: y, count: list.length, gallons, cost, avg: cost / list.length, price: gallons > 0 ? cost / gallons : NaN, perDay: days > 0 ? measured / days : NaN };
    });
    const totalOf = (list, f) => sum(list.map(f).filter(Number.isFinite));
    dataTable($('#t-years'), {
        columns: [
            { id: 'year', label: 'Year', value: r => r.year, num: true, cell: r => `<strong>${r.year}</strong>` },
            { id: 'count', label: 'Deliveries', value: r => r.count, num: true },
            numCol('gal', 'Gallons', r => r.gallons, gal),
            moneyCol('cost', 'Total cost', r => r.cost),
            moneyCol('avg', 'Average delivery', r => r.avg),
            numCol('price', 'Average price', r => r.price, perGal),
            numCol('perday', 'Oil used', r => r.perDay, perDay),
        ],
        rows: years,
        sort: { col: 'year', dir: 'desc' },
        footer: (list, filtered) => {
            const g = totalOf(list, r => r.gallons), c = totalOf(list, r => r.cost);
            return `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                <td class="amt"><strong>${totalOf(list, r => r.count)}</strong></td>
                <td class="amt"><strong>${esc(gal(g))}</strong></td>
                <td class="amt"><strong>${esc(money(c))}</strong></td><td></td>
                <td class="amt"><strong>${g > 0 ? esc(perGal(c / g)) : ''}</strong></td><td></td></tr>`;
        },
    });

    // ── Annual averages for one year, month by month next to the year before ──
    $('#yr').innerHTML = [...yearList].reverse().map(y => `<option value="${y}">${y}</option>`).join('');
    const byMonth = (y, f) => {
        const out = Array(12).fill(NaN);
        for (const d of deliveries) {
            if (d.year !== y) continue;
            const m = d.date.getMonth();
            out[m] = (Number.isFinite(out[m]) ? out[m] : 0) + f(d);
        }
        return out;
    };
    const drawYear = () => {
        const y = rememberedYear;
        if (y == null) return;
        const hasPrev = yearList.includes(y - 1);
        drawBars($('#c-yr-cost'), {
            labels: MON,
            series: [
                ...(hasPrev ? [{ name: String(y - 1), values: byMonth(y - 1, d => d.actual), color: COLORS.prev }] : []),
                { name: String(y), values: byMonth(y, d => d.actual), color: COLORS.cost, valueLabels: true },
            ],
            fmt: axisMoney, valueFmt: v => '$' + Math.round(v).toLocaleString('en-US'), tipFmt: money,
        });
        drawBars($('#c-yr-gal'), {
            labels: MON,
            series: [
                ...(hasPrev ? [{ name: String(y - 1), values: byMonth(y - 1, d => d.gallons), color: COLORS.prev }] : []),
                { name: String(y), values: byMonth(y, d => d.gallons), color: COLORS.usage, valueLabels: true },
            ],
            fmt: axisNum, valueFmt: v => (Math.round(v * 10) / 10).toLocaleString('en-US'), tipFmt: gal,
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
        $('#yr-sub').textContent = `${Y.count} deliver${Y.count === 1 ? 'y' : 'ies'} in ${y}`;
        $('#yr-cards').innerHTML = [
            card('Gallons delivered', gal(Y.gallons), `<span class="muted">${esc(gal(Y.gallons / Y.count))} per delivery on average</span>`),
            card('Average delivery', money(Y.avg), `<span class="muted">over ${Y.count} deliver${Y.count === 1 ? 'y' : 'ies'}</span>`, 'var(--red)'),
            card('Average price per gallon', Number.isFinite(Y.price) ? money(Y.price) : '–', '<span class="muted">year total ÷ gallons</span>'),
            card('Year total cost', money(Y.cost),
                `<span class="muted">oil used ${esc(perDay(Y.perDay))} on average</span>`, 'var(--red)'),
        ].join('');
        drawYear();
    };
    $('#yr').onchange = e => showYear(+e.target.value);
    $('#yr-prev').onclick = () => showYear(yearList[yearList.indexOf(rememberedYear) - 1]);
    $('#yr-next').onclick = () => showYear(yearList[yearList.indexOf(rememberedYear) + 1]);
    showYear(yearList.includes(rememberedYear) ? rememberedYear : yearList.at(-1));

    // ── Price checks ──
    dataTable($('#t-checks'), {
        columns: [
            dateCol('date', 'Date checked', r => r.date),
            numCol('price', 'Price per gallon', r => r.price, money),
            { id: 'chg', label: 'Change', num: true, value: r => r.change, text: v => (v > 0 ? '+' : '') + money(v),
                tdClass: r => `nowrap${r.change > 0 ? ' negative' : r.change < 0 ? ' positive' : ''}` },
        ],
        rows: checks.map((c, k) => ({ ...c, change: k ? c.price - checks[k - 1].price : NaN })),
        sort: { col: 'date', dir: 'desc' },
        empty: 'No price checks yet',
    });
    const checkForm = $('#check-form');
    checkForm.date.value = isoDate(new Date());
    checkForm.onsubmit = async e => {
        e.preventDefault();
        const date = dateOf(checkForm.date.value), price = numOf(checkForm.price.value);
        if (!date || !Number.isFinite(price)) { toast('Enter the date and the price per gallon', 'bad'); return; }
        try {
            await addPriceCheck({ date, price });
            toast(`Added a price check: ${money(price)}/gal on ${dLong(date)}`, 'ok');
            const y = scrollY;
            await renderHeating(el);
            scrollTo(0, y);
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
        }
    };

    // ── All deliveries ──
    dataTable($('#t-deliveries'), {
        columns: [
            dateCol('date', 'Delivered', r => r.date),
            { id: 'provider', label: 'Provider', value: r => r.provider },
            { id: 'days', label: 'Days since last', num: true, value: r => r.days },
            numCol('gal', 'Gallons', r => r.gallons, gal),
            numCol('price', 'Price/gal', r => r.price, money),
            moneyCol('calc', 'Calculated', r => r.calc),
            { ...moneyCol('actual', 'Actual price', r => r.actual), cell: r => `<strong>${esc(money(r.actual))}</strong>` },
            { id: 'extra', label: 'Extra fees', num: true, value: r => r.extra, text: v => (Math.abs(v) < 0.005 ? '–' : money(v)),
                tdClass: r => `nowrap${Math.abs(r.extra) >= 0.005 ? ' negative' : ''}` },
            numCol('perday', 'Gal/day', r => r.perDay, v => v.toFixed(2)),
            { id: 'paid', label: 'Paid CC back?', value: r => r.paidBack, tdClass: () => 'nowrap',
                cell: r => r.isPaidBack ? '<span class="badge badge-ok">Yes</span>' : `${paidBadge(r)} ${markBtn(r, 'Mark paid')}` },
            { id: 'notes', label: 'Notes', value: r => r.notes, tdClass: () => 'note-text bill-note' },
        ],
        rows: deliveries,
        sort: { col: 'date', dir: 'desc' },
        onChange: list => { $('#count').textContent = `${list.length} deliver${list.length === 1 ? 'y' : 'ies'} · from ${HEAT_PATH}`; },
    });

    // ── Banners: where things stand, and deliveries not yet paid back ──
    const since = daysBetween(last.date, today());
    $('#status').innerHTML = `<div class="banner ok">🛢️ <strong>Last delivery ${esc(dLong(last.date))}</strong> (${esc(gal(last.gallons))} from ${esc(last.provider)}), ${since} day${since === 1 ? '' : 's'} ago.`
        + (lastCheck ? ` Latest price check: <strong>${esc(money(lastCheck.price))}/gal</strong> on ${esc(dLong(lastCheck.date))}.` : '') + '</div>';
    const unpaid = deliveries.filter(d => !d.isPaidBack);
    $('#unpaid').innerHTML = unpaid.length
        ? `<div class="banner bad unpaid-list"><strong>Not paid back yet:</strong> ${unpaid.map(d => `<span class="nowrap">${esc(dLong(d.date))} (${esc(money(d.actual))}, ${esc(d.paidBack || 'blank')}) ${markBtn(d)}</span>`).join(' ')}</div>` : '';

    // Mark paid back: writes "Yes" in the Paid CC Back? column of that delivery.
    el.onclick = async e => {
        const btn = e.target.closest('[data-paid-back]');
        if (!btn) return;
        const date = new Date(+btn.dataset.paidBack);
        btn.disabled = true;
        try {
            await setPaidBack(date, 'Yes');
            toast(`${dLong(date)} delivery marked paid back`, 'ok');
            const y = scrollY;
            await renderHeating(el);
            scrollTo(0, y);
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            btn.disabled = false;
        }
    };

    // ── Add a delivery ──
    const form = $('#add-form');
    const readForm = () => {
        const f = Object.fromEntries(new FormData(form));
        const price = numOf(f.price), gallons = numOf(f.gallons);
        const calc = Math.round(price * gallons * 100) / 100;
        const actual = String(f.actual).trim() === '' ? calc : numOf(f.actual);
        return { date: dateOf(f.date), provider: String(f.provider).trim(), price, gallons, calc, actual, notes: f.notes, paidBack: f.paidBack };
    };
    const previousOf = date => [...deliveries].reverse().find(d => d.date < date)?.date || null;
    const problems = d => {
        const p = [];
        if (!d.date) p.push('Enter the delivery date.');
        else if (deliveries.some(x => x.date.getTime() === d.date.getTime())) p.push(`There is already a delivery on ${dLong(d.date)}.`);
        if (!d.provider) p.push('Enter the provider.');
        if (!Number.isFinite(d.price) || d.price <= 0) p.push('Enter the price per gallon.');
        if (!Number.isFinite(d.gallons) || d.gallons <= 0) p.push('Enter the gallons delivered.');
        if (!Number.isFinite(d.actual)) p.push('Enter the actual price, or leave it blank to use the calculated price.');
        return p;
    };
    const preview = () => {
        const d = readForm(), p = problems(d), bits = [];
        const prevDate = d.date ? previousOf(d.date) : null;
        if (prevDate) {
            const days = daysBetween(prevDate, d.date);
            bits.push(`${days} days since ${dLong(prevDate)}`);
            if (d.gallons > 0 && days > 0) bits.push(`${(d.gallons / days).toFixed(2)} gal/day`);
        }
        if (Number.isFinite(d.calc)) bits.push(`calculated ${money(d.calc)}`);
        if (Number.isFinite(d.calc) && Number.isFinite(d.actual) && Math.abs(d.actual - d.calc) >= 0.005) bits.push(`extra fees ${money(d.actual - d.calc)}`);
        $('#add-preview').innerHTML = esc(bits.join(' · '))
            + (form.dataset.tried && p.length ? `<br><span class="negative">${p.map(esc).join(' ')}</span>` : '');
    };
    $('#add-open').onclick = () => {
        form.reset();
        delete form.dataset.tried;
        form.date.value = isoDate(new Date());
        form.provider.value = last.provider;
        if (lastCheck) form.price.value = lastCheck.price;
        form.hidden = false;
        $('#add-open').hidden = true;
        preview();
        form.scrollIntoView({ block: 'center' });
        form.gallons.focus({ preventScroll: true });
    };
    $('#add-cancel').onclick = () => { form.hidden = true; $('#add-open').hidden = false; };
    form.oninput = preview;
    form.onsubmit = async e => {
        e.preventDefault();
        form.dataset.tried = '1';
        const d = readForm();
        if (problems(d).length) { preview(); return; }
        $('#add-save').disabled = true;
        try {
            await addDelivery(d, previousOf(d.date));
            toast(`Added the ${dLong(d.date)} delivery`, 'ok');
            rememberedDelivery = null; // open on the latest delivery
            await renderHeating(el);
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
