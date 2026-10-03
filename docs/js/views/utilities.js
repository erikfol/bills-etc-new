// Utilities: one sub-page per utility (#utilities/electric, …).
import { loadElectric, sameBillLastYear, addElectricBill, serviceDays, ELECTRIC_PATH } from '../electric.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, closeFilterMenu } from '../datatable.js';

const SUBPAGES = [
    { id: 'electric', label: 'Electric', render: renderElectric },
];

let onResize = null;
let rememberedBill = null; // selected bill id, kept while you move between pages

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dShort = d => `${MON[d.getMonth()]} ${d.getDate()}`;
const dLong = d => `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
const period = b => b.start ? `${dShort(b.start)}${b.start.getFullYear() !== b.end.getFullYear() ? ', ' + b.start.getFullYear() : ''} – ${dLong(b.end)}` : dLong(b.end);
/** Same day next month, kept within the month (Jan 31 → Feb 28). */
const addMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate()));
const barLabel = b => `${MON[b.end.getMonth()]} ’${String(b.end.getFullYear()).slice(2)}`;
const kwh = n => Number.isFinite(n) ? `${Math.round(n).toLocaleString('en-US')} kWh` : '–';
/** Bill amounts: credits read as "$1,003.21 credit" rather than a minus sign. */
const billText = v => v < 0 ? `${money(-v)} credit` : money(v);
const billClass = v => v < 0 ? 'income-amt' : '';
const axisMoney = v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const axisKwh = v => Math.round(v).toLocaleString('en-US');

/** "▲ 120 kWh more than last year (Aug ’25: 466 kWh)", coloured good/bad. */
function vsLastYear(cur, prev, prevBill, { higherIsGood, fmt, fmtDiff = fmt }) {
    if (!prevBill || !Number.isFinite(prev)) return '<span class="muted">no bill a year earlier to compare</span>';
    const diff = cur - prev;
    const when = `<span class="muted">than ${esc(barLabel(prevBill))} (${esc(fmt(prev))})</span>`;
    if (Math.abs(diff) < 0.005) return `<span class="muted">same as ${esc(barLabel(prevBill))}</span>`;
    const good = (diff > 0) === higherIsGood;
    return `<span class="${good ? 'delta-good' : 'delta-bad'}">${diff > 0 ? '▲' : '▼'} ${esc(fmtDiff(Math.abs(diff)))} ${diff > 0 ? 'more' : 'less'}</span> ${when}`;
}

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        const want = location.hash.split('/')[1];
        const page = SUBPAGES.find(p => p.id === want) || SUBPAGES[0];
        el.innerHTML = `
            <h1 class="page">Utilities</h1>
            <nav class="subnav">${SUBPAGES.map(p => `<a href="#utilities/${p.id}"${p === page ? ' class="active"' : ''}>${esc(p.label)}</a>`).join('')}</nav>
            <div id="sub"></div>`;
        await page.render(el.querySelector('#sub'));
    },

    destroy() {
        if (onResize) window.removeEventListener('resize', onResize);
        onResize = null;
        closeFilterMenu();
    },
};

async function renderElectric(el) {
    el.innerHTML = '<p class="muted">Loading electric bills…</p>';
    const data = await loadElectric();
    if (!data) {
        el.innerHTML = `<div class="banner">No electric bills found. This page reads <code>${esc(ELECTRIC_PATH)}</code> in your bills-etc folder.</div>`;
        return;
    }
    if (data.missing.length) {
        el.innerHTML = `<div class="banner bad"><code>${esc(ELECTRIC_PATH)}</code> is missing columns this page needs (${esc(data.missing.join(', '))}). It expects Service Date Start, Service Date End, kWh's used and Amount due.</div>`;
        return;
    }
    const { bills } = data;
    if (!bills.length) {
        el.innerHTML = `<div class="banner"><code>${esc(ELECTRIC_PATH)}</code> has no bills yet.</div>`;
        return;
    }

    const solarFrom = bills.find(b => Number.isFinite(b.received));
    let i = bills.findIndex(b => b.id && b.id === rememberedBill);
    if (i < 0) i = bills.length - 1; // open on the latest bill

    el.innerHTML = `
        <div id="catchup"></div>
        <div class="row dash-head">
            <h2 class="page-sub">Electric</h2>
            <span class="spacer"></span>
            <div class="month-nav">
                <button id="prev" title="Previous bill" aria-label="Previous bill">◀</button>
                <select id="bill">${bills.map((b, k) => `<option value="${k}">${esc(period(b))}</option>`).join('')}</select>
                <button id="next" title="Next bill" aria-label="Next bill">▶</button>
            </div>
        </div>
        <p class="lead" id="lead"></p>
        <div class="cards kpis" id="kpis"></div>

        <section>
            <h2>Bill amount <span class="sub">click a bar to open that bill · below zero is a credit</span></h2>
            <canvas id="c-amount" style="display:block;width:100%;height:240px;cursor:pointer"></canvas>
        </section>

        <section>
            <h2>Energy <span class="sub">kWh per bill</span></h2>
            <div class="chart-legend">
                <span><span class="legend-dot" style="background:#e67e22"></span>Used from the grid</span>
                ${solarFrom ? '<span><span class="legend-dot" style="background:#27ae60"></span>Sent to the grid (solar)</span>' : ''}
            </div>
            <canvas id="c-energy" style="display:block;width:100%;height:240px;cursor:pointer"></canvas>
        </section>

        ${solarFrom ? '<section><h2>Before and since solar</h2><div id="solar"></div></section>' : ''}

        <section>
            <h2>Year by year <span class="sub">by the year each billing period ended</span></h2>
            <div id="t-years"></div>
        </section>

        <section>
            <h2>All bills <span class="sub" id="bill-count"></span></h2>
            <div id="t-bills"></div>
            <div class="row" style="margin-top:14px"><button class="primary" id="add-open">+ Add a bill</button></div>
            <form id="add-form" class="add-bill" hidden>
                <h3>Add a bill</h3>
                <div class="add-grid">
                    <label class="field">Service start<input type="date" name="start" required></label>
                    <label class="field">Service end<input type="date" name="end" required></label>
                    <label class="field">Due date<input type="date" name="due"></label>
                </div>
                <div class="add-grid">
                    <label class="field">Meter reading, previous<input type="number" name="prevRead" min="0" step="1" required></label>
                    <label class="field">Meter reading, current<input type="number" name="curRead" min="0" step="1" required></label>
                    <label class="field">Multiplier<input type="number" name="multiplier" min="0" step="any" required></label>
                </div>
                <div class="add-grid">
                    <label class="field">Sent to grid (Rec) reading, previous<input type="number" name="prevRec" min="0" step="1"></label>
                    <label class="field">Sent to grid (Rec) reading, current<input type="number" name="curRec" min="0" step="1"></label>
                    <span></span>
                </div>
                <div class="add-grid">
                    <label class="field">Amount<input type="number" name="amount" min="0" step="0.01" required placeholder="0.00"></label>
                    <label class="field">This bill is<select name="kind"><option value="due">Amount due (you pay)</option><option value="credit">A credit</option></select></label>
                    <label class="field">Notes<input type="text" name="notes" placeholder="optional"></label>
                </div>
                <p class="add-preview" id="add-preview"></p>
                <div class="row">
                    <button type="submit" class="primary" id="add-save">Save bill</button>
                    <button type="button" id="add-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Adds a row to ${esc(ELECTRIC_PATH)}. Close the file in Excel first.</span>
                </div>
            </form>
        </section>`;

    const $ = s => el.querySelector(s);

    // ── Charts ──
    const draw = () => {
        drawBars($('#c-amount'), {
            labels: bills.map(barLabel),
            series: [{ values: bills.map(b => b.amount), color: '#e74c3c', negColor: '#27ae60' }],
            selected: i, fmt: axisMoney,
        });
        drawBars($('#c-energy'), {
            labels: bills.map(barLabel),
            series: [
                { values: bills.map(b => b.used), color: '#e67e22' },
                ...(solarFrom ? [{ values: bills.map(b => b.received), color: '#27ae60' }] : []),
            ],
            selected: i, fmt: axisKwh,
        });
    };
    for (const id of ['#c-amount', '#c-energy']) {
        $(id).onclick = e => { const k = $(id)._hit?.(e.offsetX) ?? -1; if (k >= 0) show(k); };
    }

    // ── One bill ──
    const show = k => {
        i = k;
        const b = bills[i], prev = sameBillLastYear(bills, b);
        rememberedBill = b.id;
        $('#bill').value = String(i);
        $('#prev').disabled = i === 0;
        $('#next').disabled = i === bills.length - 1;
        $('#lead').innerHTML = `${esc(period(b))}${Number.isFinite(b.days) ? ` · ${b.days} days` : ''}${b.due ? ` · due ${esc(dLong(b.due))}` : ''}`
            + (b.notes ? `<br><span class="note-text">${esc(b.notes)}</span>` : '');

        const card = (label, value, cmp, color = '') => `
            <div class="card"><div class="label">${label}</div>
            <div class="value"${color ? ` style="color:${color}"` : ''}>${esc(value)}</div>
            <div class="sub cmp">${cmp}</div></div>`;
        const perDay = Number.isFinite(b.days) && b.days > 0 ? b.used / b.days : NaN;
        $('#kpis').innerHTML = [
            card(b.amount < 0 ? 'Credit' : 'Amount due', money(Math.abs(b.amount)),
                vsLastYear(b.amount, prev?.amount, prev, { higherIsGood: false, fmt: billText, fmtDiff: money }),
                b.amount < 0 ? 'var(--green)' : 'var(--red)'),
            card('Used from the grid', kwh(b.used),
                (Number.isFinite(perDay) ? `<span class="muted">${perDay.toFixed(1)} kWh a day</span><br>` : '')
                + vsLastYear(b.used, prev?.used, prev, { higherIsGood: false, fmt: kwh })),
            Number.isFinite(b.received)
                ? card('Sent to the grid', kwh(b.received),
                    `<span class="muted">${b.received >= b.used ? `${kwh(b.received - b.used)} more than you used` : `${kwh(b.used - b.received)} less than you used`}</span>`, 'var(--green)')
                : card('Sent to the grid', '–', solarFrom ? '<span class="muted">before solar</span>' : '<span class="muted">no solar readings</span>'),
            card('Per kWh used', Number.isFinite(b.perKwh) ? (b.perKwh < 0 ? `${money(-b.perKwh)} credit` : money(b.perKwh)) : '–',
                '<span class="muted">bill amount ÷ kWh used</span>'),
        ].join('');
        draw();
    };

    $('#bill').onchange = e => show(+e.target.value);
    $('#prev').onclick = () => show(i - 1);
    $('#next').onclick = () => show(i + 1);

    // ── Before and since solar: the 12 bills before the first solar reading vs every bill since ──
    if (solarFrom) {
        const s = bills.indexOf(solarFrom);
        const before = bills.slice(Math.max(0, s - 12), s), since = bills.slice(s);
        const avg = (list, f) => list.length ? sum(list.map(f)) / list.length : NaN;
        const cellOf = (v, fmt) => `<td class="amt ${fmt === billText ? billClass(v) : ''}">${Number.isFinite(v) ? esc(fmt(v)) : '–'}</td>`;
        const row = (label, f, fmt) => `<tr><td>${label}</td>${cellOf(avg(before, f), fmt)}${cellOf(avg(since, f), fmt)}</tr>`;
        $('#solar').innerHTML = `
            <div class="table-wrap"><table>
                <thead><tr><th>Average per bill</th><th class="num">${before.length} bills before solar</th><th class="num">${since.length} bill${since.length === 1 ? '' : 's'} since (from ${esc(barLabel(solarFrom))})</th></tr></thead>
                <tbody>
                    ${row('Bill', x => x.amount, billText)}
                    ${row('Used from the grid', x => x.used, kwh)}
                    <tr><td>Sent to the grid</td><td class="amt">–</td><td class="amt">${esc(kwh(avg(since, x => x.received || 0)))}</td></tr>
                </tbody>
                <tfoot><tr class="total-row"><td><strong>Total</strong></td><td class="amt"><strong>${esc(billText(sum(before.map(x => x.amount))))}</strong></td><td class="amt"><strong>${esc(billText(sum(since.map(x => x.amount))))}</strong></td></tr></tfoot>
            </table></div>`;
    }

    // ── Year by year ──
    const years = [...new Set(bills.map(b => b.end.getFullYear()))].map(y => {
        const list = bills.filter(b => b.end.getFullYear() === y);
        const rec = list.filter(b => Number.isFinite(b.received));
        return {
            year: y, count: list.length,
            used: sum(list.map(b => b.used)),
            received: rec.length ? sum(rec.map(b => b.received)) : NaN,
            net: sum(list.map(b => b.amount)),
            avg: sum(list.map(b => b.amount)) / list.length,
        };
    });
    const moneyCol = (id, label, get) => ({ id, label, num: true, value: get, text: billText, tdClass: r => `nowrap ${billClass(get(r))}` });
    const kwhCol = (id, label, get) => ({ id, label, num: true, value: get, text: kwh, tdClass: () => 'nowrap' });
    const totalOf = (list, f) => sum(list.map(f).filter(Number.isFinite));
    dataTable($('#t-years'), {
        columns: [
            { id: 'year', label: 'Year', value: r => r.year, num: true, cell: r => `<strong>${r.year}</strong>` },
            { id: 'count', label: 'Bills', value: r => r.count, num: true },
            kwhCol('used', 'Used from the grid', r => r.used),
            kwhCol('rec', 'Sent to the grid', r => r.received),
            moneyCol('net', 'Total', r => r.net),
            moneyCol('avg', 'Average bill', r => r.avg),
        ],
        rows: years,
        sort: { col: 'year', dir: 'desc' },
        footer: (list, filtered) => `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
            <td class="amt"><strong>${totalOf(list, r => r.count)}</strong></td>
            <td class="amt"><strong>${esc(kwh(totalOf(list, r => r.used)))}</strong></td>
            <td class="amt"><strong>${list.some(r => Number.isFinite(r.received)) ? esc(kwh(totalOf(list, r => r.received))) : '–'}</strong></td>
            <td class="amt ${billClass(totalOf(list, r => r.net))}"><strong>${esc(billText(totalOf(list, r => r.net)))}</strong></td><td></td></tr>`,
    });

    // ── All bills ──
    const dateCol = (id, label, get) => ({ id, label, value: r => get(r)?.getTime() ?? '', sortKey: v => (v === '' ? -Infinity : v),
        text: v => dLong(new Date(v)), tdClass: () => 'nowrap', sortLabels: ['Oldest → Newest', 'Newest → Oldest'] });
    dataTable($('#t-bills'), {
        columns: [
            dateCol('start', 'Service start', r => r.start),
            dateCol('end', 'Service end', r => r.end),
            { id: 'days', label: 'Days', value: r => r.days, num: true },
            dateCol('due', 'Due', r => r.due),
            kwhCol('used', 'Used', r => r.used),
            kwhCol('rec', 'Sent to grid', r => r.received),
            moneyCol('amt', 'Amount', r => r.amount),
            { id: 'per', label: 'Per kWh', value: r => r.perKwh, num: true, text: v => (v < 0 ? `${money(-v)} credit` : money(v)), tdClass: r => `nowrap ${billClass(r.perKwh)}` },
            { id: 'notes', label: 'Notes', value: r => r.notes, tdClass: () => 'note-text bill-note' },
        ],
        rows: bills,
        sort: { col: 'end', dir: 'desc' },
        onChange: list => { $('#bill-count').textContent = `${list.length} bill${list.length === 1 ? '' : 's'} · from ${ELECTRIC_PATH}`; },
    });

    // ── Add a bill: prefilled from the latest bill (readings carry over, the new period starts the next day) ──
    const form = $('#add-form'), last = bills.at(-1);
    const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dateOf = v => { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
    const numOf = v => (String(v).trim() === '' ? NaN : Number(v));
    const readForm = () => {
        const f = Object.fromEntries(new FormData(form));
        const amount = numOf(f.amount);
        return {
            start: dateOf(f.start), end: dateOf(f.end), due: dateOf(f.due),
            prevRead: numOf(f.prevRead), curRead: numOf(f.curRead), multiplier: numOf(f.multiplier),
            prevRec: numOf(f.prevRec), curRec: numOf(f.curRec),
            amount: f.kind === 'credit' ? -amount : amount, notes: f.notes,
        };
    };
    /** Problems with the entry, or [] when it can be saved. */
    const problems = b => {
        const p = [];
        if (!b.start || !b.end) p.push('Enter the service start and end dates.');
        else if (b.end <= b.start) p.push('The service end must be after the start.');
        else if (bills.some(x => x.end.getTime() === b.end.getTime())) p.push(`There is already a bill ending ${dLong(b.end)}.`);
        if (!Number.isFinite(b.prevRead) || !Number.isFinite(b.curRead)) p.push('Enter both meter readings.');
        else if (b.curRead < b.prevRead) p.push('The current meter reading is lower than the previous one.');
        if (!(b.multiplier > 0)) p.push('The multiplier must be more than 0.');
        if (Number.isFinite(b.curRec) !== Number.isFinite(b.prevRec)) p.push('Enter both sent-to-grid readings, or neither.');
        else if (b.curRec < b.prevRec) p.push('The current sent-to-grid reading is lower than the previous one.');
        if (!Number.isFinite(b.amount)) p.push('Enter the amount.');
        return p;
    };
    const preview = () => {
        const b = readForm(), p = problems(b);
        const used = (b.curRead - b.prevRead) * b.multiplier, sent = b.curRec - b.prevRec;
        const bits = [];
        if (b.start && b.end && b.end > b.start) bits.push(`${serviceDays(b.start, b.end)} days`);
        if (Number.isFinite(used) && used >= 0) bits.push(`${kwh(used)} used`);
        if (Number.isFinite(sent) && sent >= 0) bits.push(`${kwh(sent)} sent to the grid`);
        if (Number.isFinite(b.amount)) bits.push(billText(b.amount) + (used > 0 ? ` (${b.amount < 0 ? `${money(-b.amount / used)} credit` : money(b.amount / used)} per kWh)` : ''));
        $('#add-preview').innerHTML = (bits.length ? esc(bits.join(' · ')) : '')
            + (form.dataset.tried && p.length ? `<br><span class="negative">${p.map(esc).join(' ')}</span>` : '');
    };
    $('#add-open').onclick = () => {
        form.reset();
        delete form.dataset.tried;
        form.start.value = isoDate(new Date(last.end.getFullYear(), last.end.getMonth(), last.end.getDate() + 1));
        if (Number.isFinite(last.curRead)) form.prevRead.value = last.curRead;
        form.multiplier.value = Number.isFinite(last.multiplier) ? last.multiplier : 1;
        if (Number.isFinite(last.curRec)) form.prevRec.value = last.curRec;
        form.hidden = false;
        $('#add-open').hidden = true;
        preview();
        form.scrollIntoView({ block: 'center' });
        form.end.focus({ preventScroll: true });
    };
    $('#add-cancel').onclick = () => { form.hidden = true; $('#add-open').hidden = false; };

    // ── Caught up? A statement comes monthly, so the next one is due a month after the last due date ──
    const lastDue = last.due || last.end;
    const nextDue = addMonth(lastDue);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    $('#catchup').innerHTML = today >= nextDue
        ? `<div class="banner row">
            <span>📬 <strong>There's a new electric statement to add.</strong> Your last bill was due ${esc(dLong(lastDue))}, so the next one was due around ${esc(dLong(nextDue))}.</span>
            <span class="spacer"></span><button class="primary small" id="catchup-add">Add it now</button></div>`
        : `<div class="banner ok">✓ <strong>All electric statements are caught up.</strong> The next one is due around ${esc(dLong(nextDue))}.</div>`;
    $('#catchup-add')?.addEventListener('click', () => $('#add-open').click());
    form.oninput = preview;
    form.onsubmit = async e => {
        e.preventDefault();
        form.dataset.tried = '1';
        const b = readForm();
        if (problems(b).length) { preview(); return; }
        $('#add-save').disabled = true;
        try {
            await addElectricBill(b);
            toast(`Added the bill ending ${dLong(b.end)}`, 'ok');
            rememberedBill = null; // open on the latest bill
            await renderElectric(el);
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            $('#add-save').disabled = false;
        }
    };

    if (onResize) window.removeEventListener('resize', onResize);
    onResize = draw;
    window.addEventListener('resize', onResize);
    show(i);
    requestAnimationFrame(draw); // canvases have their real width once laid out
}
