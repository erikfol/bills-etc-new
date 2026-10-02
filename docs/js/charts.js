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

/** Grouped income/expense bars with a dashed net line. */
export function drawCashFlow(canvas, { months, income, expenses }) {
    const s = setup(canvas);
    const n = months.length;
    if (!s || !n) return;
    const { ctx, W, H } = s;
    const pad = { top: 24, right: 20, bottom: 44, left: 72 };
    const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...income, ...expenses) * 1.15 || 1;
    yGrid(ctx, pad, chartW, chartH, maxVal);

    const groupW = chartW / n;
    const barW = Math.min(groupW * 0.32, 42);
    const gap = Math.min(groupW * 0.05, 6);
    const gOff = (groupW - 2 * barW - gap) / 2;
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(chartW / 60)));
    for (let i = 0; i < n; i++) {
        const gx = pad.left + i * groupW + gOff;
        const incH = (income[i] / maxVal) * chartH;
        ctx.fillStyle = '#4a90d9';
        ctx.fillRect(gx, pad.top + chartH - incH, barW, incH);
        const expH = (expenses[i] / maxVal) * chartH;
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(gx + barW + gap, pad.top + chartH - expH, barW, expH);
        if (i % labelEvery === 0) {
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            ctx.fillText(months[i], pad.left + i * groupW + groupW / 2, pad.top + chartH + 18);
        }
    }

    const pt = i => ({
        x: pad.left + i * groupW + groupW / 2,
        y: pad.top + chartH - (Math.max(income[i] - expenses[i], 0) / maxVal) * chartH,
    });
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const p = pt(i); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#27ae60';
    for (let i = 0; i < n; i++) { const p = pt(i); ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI); ctx.fill(); }
}

/** Horizontal bars, pairs = [[category, total], ...] sorted desc. */
export function drawCategoryBars(canvas, pairs) {
    const s = setup(canvas);
    if (!s || !pairs.length) return;
    const { ctx, W, H } = s;
    const n = pairs.length;
    const pad = { top: 14, right: 88, bottom: 14, left: 118 };
    const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
    const rowH = chartH / n;
    const barH = Math.min(rowH * 0.55, 22);
    const maxVal = Math.max(...pairs.map(p => p[1])) * 1.05 || 1;

    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(f => {
        const x = pad.left + f * chartW;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + chartH); ctx.stroke();
    });

    ctx.font = `12px ${FONT}`;
    pairs.forEach(([cat, total], i) => {
        const y = pad.top + i * rowH;
        const barLen = (total / maxVal) * chartW;
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
        ctx.fillRect(pad.left, y + (rowH - barH) / 2, barLen, barH);
        ctx.fillStyle = '#444';
        ctx.textAlign = 'right';
        ctx.fillText(cat, pad.left - 8, y + rowH / 2 + 4);
        ctx.fillStyle = '#555';
        ctx.textAlign = 'left';
        ctx.fillText(total >= 1000 ? '$' + (total / 1000).toFixed(1) + 'k' : '$' + total.toFixed(0), pad.left + barLen + 6, y + rowH / 2 + 4);
    });
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
    maxVal = maxVal * 1.15 || 1;
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
