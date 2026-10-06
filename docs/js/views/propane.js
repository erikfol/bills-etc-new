// Utilities → Propane: oven propane fill-ups from inputs/propane_oven/master_propane_oven.csv.
import { loadPropane, addPropaneFill, daysBetween, recalcPropaneRow, propaneDupKey, PROPANE_CALCULATED, PROPANE_PATH } from '../propane.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { dataTable } from '../datatable.js';
import { editableSheet } from './sheeteditor.js';
import {
    MON, dLong, today, axisMoney, isoDate, dateOf, numOf,
    card, vsEarlier, dateCol, moneyCol, numCol, setResize, sameDay, sameAmount, dupText,
} from './utilcommon.js';

let rememberedFill = null; // fill-up date (ms) while you move between pages

const COLORS = { propane: '#e67e22', safety: '#5c7a99', transport: '#9b59b6', allIn: '#e74c3c' };
const shortDate = d => `${MON[d.getMonth()]} ${d.getDate()} ’${String(d.getFullYear()).slice(2)}`;
const gal = n => Number.isFinite(n) ? `${(Math.round(n * 10) / 10).toLocaleString('en-US')} gal` : '–';
const perGal = n => Number.isFinite(n) ? `${money(n)}/gal` : '–';
const months = days => (days < 60 ? `${days} day${days === 1 ? '' : 's'}` : `${(days / 30.44).toFixed(1)} months`);

export default async function renderPropane(el) {
    el.innerHTML = '<p class="muted">Loading propane fill-ups…</p>';
    const data = await loadPropane();
    if (!data) {
        el.innerHTML = `<div class="banner">No propane fill-ups found. This page reads <code>${esc(PROPANE_PATH)}</code> in your bills-etc folder.</div>`;
        return;
    }
    if (data.missing.length) {
        el.innerHTML = `<div class="banner bad"><code>${esc(PROPANE_PATH)}</code> is missing columns this page needs (${esc(data.missing.join(', '))}). It expects date, quantity and propane cost.</div>`;
        return;
    }
    const { fills } = data;
    if (!fills.length) {
        el.innerHTML = `<div class="banner"><code>${esc(PROPANE_PATH)}</code> has no fill-ups yet.</div>`;
        return;
    }
    let i = fills.findIndex(f => f.date.getTime() === rememberedFill);
    if (i < 0) i = fills.length - 1; // open on the latest fill-up
    const last = fills.at(-1);

    el.innerHTML = `
        <div id="status"></div>
        <div class="row dash-head">
            <h2 class="page-sub">Propane <span class="muted" style="font-weight:400;font-size:0.8em">oven</span></h2>
            <span class="spacer"></span>
            <div class="month-nav">
                <button id="prev" title="Previous fill-up" aria-label="Previous fill-up">◀</button>
                <select id="pick">${fills.map((f, k) => `<option value="${k}">${esc(dLong(f.date))} · ${esc(gal(f.gallons))} · ${esc(money(f.total))}</option>`).join('')}</select>
                <button id="next" title="Next fill-up" aria-label="Next fill-up">▶</button>
            </div>
        </div>
        <div class="cards kpis" id="kpis"></div>

        <section>
            <h2>Cost per fill-up <span class="sub">propane plus fees · hover for details · click a bar to open that fill-up</span></h2>
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:${COLORS.propane}"></span>Propane</span>
                <span><span class="legend-dot" style="background:${COLORS.safety}"></span>Safety fee</span>
                <span><span class="legend-dot" style="background:${COLORS.transport}"></span>Transportation fee</span>
            </div>
            <canvas id="c-cost" style="display:block;width:100%;height:230px;cursor:pointer"></canvas>
        </section>

        <section>
            <h2>Price per gallon <span class="sub">propane alone, and with the fees spread over the gallons</span></h2>
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:${COLORS.propane}"></span>Propane only</span>
                <span><span class="legend-dot" style="background:${COLORS.allIn}"></span>With fees</span>
            </div>
            <canvas id="c-price" style="display:block;width:100%;height:230px;cursor:pointer"></canvas>
        </section>

        <section>
            <h2>Year by year</h2>
            <div id="t-years"></div>
        </section>

        <section>
            <h2>All fill-ups <span class="sub" id="count"></span></h2>
            <div id="t-fills" class="short-table"></div>
            <div class="row" style="margin-top:14px"><button class="primary" id="add-open">+ Add a fill-up</button></div>
            <form id="add-form" class="add-bill" hidden>
                <h3>Add a fill-up</h3>
                <div class="add-grid">
                    <label class="field">Date<input type="date" name="date" required></label>
                    <label class="field">Gallons<input type="number" name="gallons" min="0" step="0.1" required></label>
                    <label class="field">Propane cost ($)<input type="number" name="propane" min="0" step="0.01" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">Safety fee ($)<input type="number" name="safety" min="0" step="0.01"></label>
                    <label class="field">Transportation fee ($)<input type="number" name="transport" min="0" step="0.01"></label>
                </div>
                <p class="add-preview" id="add-preview"></p>
                <div class="row">
                    <button type="submit" class="primary" id="add-save">Save fill-up</button>
                    <button type="button" id="add-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Adds a row to ${esc(PROPANE_PATH)} with the total cost added up. Close the file in Excel first.</span>
                </div>
            </form>
        </section>`;

    const $ = s => el.querySelector(s);

    // ── Charts: one bar per fill-up ──
    const draw = () => {
        const labels = fills.map(f => shortDate(f.date));
        drawBars($('#c-cost'), {
            labels,
            series: [
                { name: 'Propane', values: fills.map(f => f.propane), color: COLORS.propane, valueLabels: true },
                { name: 'Safety fee', values: fills.map(f => f.safety), color: COLORS.safety },
                { name: 'Transportation fee', values: fills.map(f => f.transport), color: COLORS.transport },
                { name: 'Gallons', values: fills.map(f => f.gallons), tipOnly: true, tipFmt: gal },
            ],
            stacked: true, selected: i, fmt: axisMoney, valueFmt: money, tipFmt: money,
            tipHead: k => `${dLong(fills[k].date)} · ${money(fills[k].total)} total`,
        });
        drawBars($('#c-price'), {
            labels,
            series: [
                { name: 'Propane only', values: fills.map(f => f.price), color: COLORS.propane },
                { name: 'With fees', values: fills.map(f => f.allIn), color: COLORS.allIn },
            ],
            selected: i, fmt: v => '$' + v.toFixed(2), tipFmt: perGal, tipHead: k => dLong(fills[k].date),
        });
    };
    for (const id of ['#c-cost', '#c-price']) {
        $(id).onclick = e => { const k = $(id)._hit?.(e.offsetX) ?? -1; if (k >= 0) show(k); };
    }

    // ── One fill-up ──
    const show = k => {
        i = k;
        const f = fills[i], prev = fills[i - 1] || null, prevLabel = prev ? dLong(prev.date) : null;
        rememberedFill = f.date.getTime();
        $('#pick').value = String(i);
        $('#prev').disabled = i === 0;
        $('#next').disabled = i === fills.length - 1;
        const none = 'first fill-up on record';
        $('#kpis').innerHTML = [
            card('Total cost', money(f.total),
                `<span class="muted">${esc(money(f.propane))} propane + ${esc(money(f.safety || 0))} safety + ${esc(money(f.transport || 0))} transportation</span><br>`
                + vsEarlier(f.total, prev?.total, prevLabel, { higherIsGood: false, fmt: money, none }), 'var(--red)'),
            card('Gallons', gal(f.gallons),
                prev ? `<span class="muted">${esc(months(f.days))} after the previous fill-up</span><br>`
                    + `<span class="muted">about ${esc(gal(f.perMonth))} a month used</span>`
                    : `<span class="muted">${none}</span>`),
            card('Propane price', perGal(f.price),
                vsEarlier(f.price, prev?.price, prevLabel, { higherIsGood: false, fmt: perGal, fmtDiff: money, none })),
            card('With fees', perGal(f.allIn),
                `<span class="muted">fees are ${esc(money(f.fees))}, ${Math.round(f.fees / f.total * 100)}% of the total</span>`),
        ].join('');
        draw();
    };
    $('#pick').onchange = e => show(+e.target.value);
    $('#prev').onclick = () => show(i - 1);
    $('#next').onclick = () => show(i + 1);

    // ── Year by year ──
    const yearList = [...new Set(fills.map(f => f.year))].sort((a, b) => a - b);
    const years = yearList.map(y => {
        const list = fills.filter(f => f.year === y);
        return {
            year: y, count: list.length, gallons: sum(list.map(f => f.gallons)), propane: sum(list.map(f => f.propane)),
            fees: sum(list.map(f => f.fees)), total: sum(list.map(f => f.total)),
        };
    });
    const totalOf = (list, f) => sum(list.map(f).filter(Number.isFinite));
    dataTable($('#t-years'), {
        columns: [
            { id: 'year', label: 'Year', value: r => r.year, num: true, cell: r => `<strong>${r.year}</strong>`, sortLabels: ['Oldest → Newest', 'Newest → Oldest'] },
            { id: 'count', label: 'Fill-ups', value: r => r.count, num: true },
            numCol('gal', 'Gallons', r => r.gallons, gal),
            moneyCol('propane', 'Propane', r => r.propane),
            moneyCol('fees', 'Fees', r => r.fees),
            { ...moneyCol('total', 'Total cost', r => r.total), cell: r => `<strong>${esc(money(r.total))}</strong>` },
            numCol('allin', 'With fees per gallon', r => (r.gallons > 0 ? r.total / r.gallons : NaN), perGal),
        ],
        rows: years,
        sort: { col: 'year', dir: 'desc' },
        footer: (list, filtered) => {
            const g = totalOf(list, r => r.gallons), t = totalOf(list, r => r.total);
            return `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                <td class="amt"><strong>${totalOf(list, r => r.count)}</strong></td>
                <td class="amt"><strong>${esc(gal(g))}</strong></td>
                <td class="amt"><strong>${esc(money(totalOf(list, r => r.propane)))}</strong></td>
                <td class="amt"><strong>${esc(money(totalOf(list, r => r.fees)))}</strong></td>
                <td class="amt"><strong>${esc(money(t))}</strong></td>
                <td class="amt"><strong>${g > 0 ? esc(perGal(t / g)) : ''}</strong></td></tr>`;
        },
    });

    // ── All fill-ups ──
    dataTable($('#t-fills'), {
        columns: [
            dateCol('date', 'Date', r => r.date),
            numCol('gal', 'Gallons', r => r.gallons, gal),
            moneyCol('propane', 'Propane cost', r => r.propane),
            moneyCol('safety', 'Safety fee', r => r.safety),
            moneyCol('transport', 'Transportation fee', r => r.transport),
            { ...moneyCol('total', 'Total cost', r => r.total), cell: r => `<strong>${esc(money(r.total))}</strong>` },
            numCol('price', 'Propane/gal', r => r.price, money),
            numCol('allin', 'With fees/gal', r => r.allIn, money),
            { id: 'days', label: 'Months since last', num: true, value: r => r.days, text: v => (v / 30.44).toFixed(1) },
        ],
        rows: fills,
        sort: { col: 'date', dir: 'desc' },
        onChange: list => { $('#count').textContent = `${list.length} fill-up${list.length === 1 ? '' : 's'} · from ${PROPANE_PATH}`; },
    });
    editableSheet($('#t-fills'), { path: PROPANE_PATH, onSaved: () => renderPropane(el), recalc: recalcPropaneRow, calculated: PROPANE_CALCULATED, dupKey: propaneDupKey });

    // ── Banner: where things stand ──
    const since = daysBetween(last.date, today());
    const gaps = fills.map(f => f.days).filter(d => d > 0);
    const avgGap = gaps.length ? sum(gaps) / gaps.length : NaN;
    $('#status').innerHTML = `<div class="banner ok">🔥 <strong>Last fill-up ${esc(dLong(last.date))}</strong> (${esc(gal(last.gallons))}, ${esc(money(last.total))}), ${esc(months(since))} ago.`
        + (Number.isFinite(avgGap) ? ` You've filled up about every ${esc(months(avgGap))} on average.` : '') + '</div>';

    // ── Add a fill-up ──
    const form = $('#add-form');
    const readForm = () => {
        const f = Object.fromEntries(new FormData(form));
        const propane = numOf(f.propane), safety = numOf(f.safety), transport = numOf(f.transport);
        const total = Math.round(((propane || 0) + (safety || 0) + (transport || 0)) * 100) / 100;
        return { date: dateOf(f.date), gallons: numOf(f.gallons), propane, safety, transport, total };
    };
    const problems = d => {
        const p = [];
        if (!d.date) p.push('Enter the date.');
        else if (fills.some(x => sameDay(x.date, d.date) && sameAmount(x.total, d.total))) p.push(dupText(d.date, d.total, 'a fill-up on'));
        if (!Number.isFinite(d.gallons) || d.gallons <= 0) p.push('Enter the gallons.');
        if (!Number.isFinite(d.propane) || d.propane <= 0) p.push('Enter the propane cost.');
        return p;
    };
    const preview = () => {
        const d = readForm(), p = problems(d), bits = [];
        if (Number.isFinite(d.propane)) bits.push(`total cost ${money(d.total)}`);
        if (d.gallons > 0 && Number.isFinite(d.propane)) bits.push(`${perGal(d.propane / d.gallons)} propane`, `${perGal(d.total / d.gallons)} with fees`);
        const prev = d.date ? [...fills].reverse().find(x => x.date < d.date) : null;
        if (prev) bits.push(`${months(daysBetween(prev.date, d.date))} since ${dLong(prev.date)}`);
        $('#add-preview').innerHTML = esc(bits.join(' · '))
            + (form.dataset.tried && p.length ? `<br><span class="negative">${p.map(esc).join(' ')}</span>` : '');
    };
    $('#add-open').onclick = () => {
        form.reset();
        delete form.dataset.tried;
        form.date.value = isoDate(new Date());
        if (Number.isFinite(last.safety)) form.safety.value = last.safety;
        if (Number.isFinite(last.transport)) form.transport.value = last.transport;
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
            await addPropaneFill(d);
            toast(`Added the ${dLong(d.date)} fill-up (${money(d.total)})`, 'ok');
            rememberedFill = null; // open on the latest fill-up
            await renderPropane(el);
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            $('#add-save').disabled = false;
        }
    };

    setResize(draw);
    show(i);
    requestAnimationFrame(draw); // canvases have their real width once laid out
}
