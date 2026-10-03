// Canvas charts, ported from the HTML report that script 2 generates.

export const CHART_COLORS = ['#4a90d9', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63', '#607d8b', '#34495e'];
const FONT = '-apple-system, BlinkMacSystemFont, sans-serif';

function setup(canvas) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    return { ctx, W, H };
}

/** Round up to a clean axis step (1, 2, 2.5, 3, 4, 5, 6, 8 × 10^n). */
function niceStep(x) {
    if (x <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(x));
    return [1, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * p).find(v => v >= x);
}
/** Axis max that splits into 4 clean steps. */
const niceMax = v => niceStep(v / 4) * 4;

const kFmt = v => '$' + (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : v.toFixed(0));

function yGrid(ctx, pad, chartW, chartH, maxVal) {
    ctx.font = `11px ${FONT}`;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + chartH * (1 - i / 4);
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'right';
        ctx.fillText(kFmt(maxVal * i / 4), pad.left - 6, y + 4);
    }
}

/** One line per active category; byMonth = {label: {cat: value}}; colorOf(cat) → color. */
export function drawTrends(canvas, { months, cats, byMonth, active, colorOf }) {
    const s = setup(canvas);
    const n = months.length;
    if (!s || !n || !cats.length) return;
    const { ctx, W, H } = s;
    const pad = { top: 24, right: 24, bottom: 36, left: 72 };
    const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;

    let maxVal = 0;
    cats.forEach(c => { if (active.has(c)) months.forEach(m => { maxVal = Math.max(maxVal, byMonth[m]?.[c] || 0); }); });
    maxVal = niceMax(maxVal * 1.05) || 1;
    yGrid(ctx, pad, chartW, chartH, maxVal);

    const xOf = i => pad.left + (n === 1 ? chartW / 2 : i * chartW / (n - 1));
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(chartW / 60)));
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    months.forEach((m, i) => { if (i % labelEvery === 0) ctx.fillText(m, xOf(i), pad.top + chartH + 18); });

    cats.forEach(cat => {
        if (!active.has(cat)) return;
        const color = colorOf(cat);
        const pts = months.map((m, i) => ({ x: xOf(i), y: pad.top + chartH - ((byMonth[m]?.[cat] || 0) / maxVal) * chartH }));
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
        ctx.fillStyle = color;
        pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.fill(); });
    });
}

/**
 * Income vs spending bars per month, with the selected month highlighted.
 * Sets canvas._hit(x) → month index under that x (or -1) for click handling.
 */
export function drawMonthBars(canvas, { labels, income, spending, selected }) {
    const s = setup(canvas);
    const n = labels.length;
    canvas._hit = () => -1;
    if (!s || !n) return;
    const { ctx, W, H } = s;
    const pad = { top: 16, right: 12, bottom: 30, left: 56 };
    const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
    const maxVal = niceMax(Math.max(...income, ...spending, 1) * 1.05);
    yGrid(ctx, pad, chartW, chartH, maxVal);

    const groupW = chartW / n;
    const labelEvery = Math.ceil(52 / groupW);
    const barW = Math.min(groupW * 0.32, 26);
    const gOff = (groupW - 2 * barW - 3) / 2;
    for (let i = 0; i < n; i++) {
        const gx = pad.left + i * groupW;
        if (i === selected) {
            ctx.fillStyle = '#eef3ff';
            ctx.fillRect(gx + 2, pad.top, groupW - 4, chartH);
        }
        const dim = i === selected ? 1 : 0.55;
        ctx.globalAlpha = dim;
        const ih = (Math.max(income[i], 0) / maxVal) * chartH, sh = (Math.max(spending[i], 0) / maxVal) * chartH;
        ctx.fillStyle = '#4a90d9';
        ctx.fillRect(gx + gOff, pad.top + chartH - ih, barW, ih);
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(gx + gOff + barW + 3, pad.top + chartH - sh, barW, sh);
        ctx.globalAlpha = 1;
        // Skip labels when they'd overlap, but always label the selected month.
        if (i === selected || i % labelEvery === 0) {
            ctx.fillStyle = i === selected ? '#1a1a2e' : '#888';
            ctx.font = `${i === selected ? '600 ' : ''}11px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], gx + groupW / 2, pad.top + chartH + 18);
        }
    }
    canvas._hit = x => {
        const i = Math.floor((x - pad.left) / groupW);
        return i >= 0 && i < n ? i : -1;
    };
}

/**
 * Bars per period for one or more series; values may be negative (drawn below a zero line).
 * series: [{ values, color, negColor?, valueLabels? }]; fmt(value) → axis label. Sets canvas._hit like drawMonthBars.
 * valueFmt(value) → text printed at the end of each bar of a series with valueLabels: true
 * (sideways when the bars are too narrow for it to fit across).
 */
export function drawBars(canvas, { labels, series, selected = -1, fmt = kFmt, valueFmt = null }) {
    const s = setup(canvas);
    const n = labels.length;
    canvas._hit = () => -1;
    if (!s || !n) return;
    const { ctx, W, H } = s;
    const pad = { top: 16, right: 12, bottom: 30, left: 64 };
    const chartW = W - pad.left - pad.right;
    const all = series.flatMap(x => x.values.filter(Number.isFinite));

    const groupW = chartW / labels.length;
    const labelEvery = Math.ceil(52 / groupW);
    const gap = series.length > 1 ? 2 : 0;
    const barW = Math.min((groupW * 0.7 - gap * (series.length - 1)) / series.length, 26);
    const gOff = (groupW - series.length * barW - gap * (series.length - 1)) / 2;

    // Room for value labels above the tallest bar and below the deepest one.
    const VFONT = `10px ${FONT}`;
    const labelled = valueFmt ? series.filter(x => x.valueLabels).flatMap(x => x.values.filter(v => Number.isFinite(v) && v)) : [];
    ctx.font = VFONT;
    const textW = Math.max(0, ...labelled.map(v => ctx.measureText(valueFmt(v)).width));
    const sideways = textW > barW + 4;
    const room = labelled.length ? (sideways ? textW : 10) + 6 : 0;
    if (labelled.some(v => v > 0)) pad.top += room;
    const below = labelled.some(v => v < 0) ? room : 0;
    const chartH = H - pad.top - pad.bottom - below;
    const hi = Math.max(0, ...all), lo = Math.min(0, ...all);
    // Same clean step above and below zero so the grid lines land on round numbers.
    const step = niceStep((hi - lo) * 1.05 / 4 || 1);
    const top = Math.ceil(hi * 1.05 / step) * step || step, bottom = Math.floor(lo * 1.05 / step) * step;
    const yOf = v => pad.top + chartH * (top - v) / (top - bottom);

    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'right';
    for (let v = bottom; v <= top + step / 2; v += step) {
        const y = yOf(v);
        ctx.strokeStyle = Math.abs(v) < step / 2 ? '#bbb' : '#f0f0f0';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = '#aaa';
        ctx.fillText(fmt(Math.abs(v) < step / 2 ? 0 : v), pad.left - 6, y + 4);
    }

    for (let i = 0; i < n; i++) {
        const gx = pad.left + i * groupW;
        if (i === selected) {
            ctx.fillStyle = '#eef3ff';
            ctx.fillRect(gx + 1, pad.top, groupW - 2, chartH + below);
        }
        ctx.globalAlpha = selected < 0 || i === selected ? 1 : 0.55;
        series.forEach((ser, k) => {
            const v = ser.values[i];
            if (!Number.isFinite(v) || !v) return;
            ctx.fillStyle = v < 0 && ser.negColor ? ser.negColor : ser.color;
            const y0 = yOf(0), y1 = yOf(v), x = gx + gOff + k * (barW + gap);
            ctx.fillRect(x, Math.min(y0, y1), barW, Math.abs(y1 - y0));
            if (!valueFmt || !ser.valueLabels) return;
            ctx.save();
            ctx.font = VFONT;
            ctx.fillStyle = '#555';
            const up = v > 0;
            if (sideways) {
                ctx.translate(x + barW / 2 + 3.5, y1 + (up ? -4 : 4));
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = up ? 'left' : 'right';
                ctx.fillText(valueFmt(v), 0, 0);
            } else {
                ctx.textAlign = 'center';
                ctx.fillText(valueFmt(v), x + barW / 2, up ? y1 - 4 : y1 + 12);
            }
            ctx.restore();
        });
        ctx.globalAlpha = 1;
        if (i === selected || (i % labelEvery === 0 && !(selected >= 0 && Math.abs(i - selected) < labelEvery))) {
            ctx.fillStyle = i === selected ? '#1a1a2e' : '#888';
            ctx.font = `${i === selected ? '600 ' : ''}11px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], gx + groupW / 2, pad.top + chartH + below + 18);
        }
    }
    canvas._hit = x => {
        const i = Math.floor((x - pad.left) / groupW);
        return i >= 0 && i < n ? i : -1;
    };
}
