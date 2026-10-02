import { PATHS, readTable } from '../data.js';
import { normalizeMaster, buildReport, reportSummaryText } from '../finance.js';
import { drawCashFlow, drawCategoryBars, drawTrends, CHART_COLORS } from '../charts.js';
import { generate, insightsPrompt } from '../ollama.js';
import { monthLabel } from '../dates.js';
import { esc, money, mdToHtml } from '../util.js';
import { requireFolder } from '../app.js';

let onResize = null;

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading master history…</p>';
        const master = await readTable(PATHS.master);
        if (!master?.rows.length) {
            el.innerHTML = `<div class="banner">No master history yet. Run step 1 on the <a href="#workflow">Workflow</a> page.</div>`;
            return;
        }
        if (!master.columns.includes('AI Category')) {
            el.innerHTML = `<div class="banner bad">The master file has no <code>AI Category</code> column. Columns: ${esc(master.columns.join(', '))}</div>`;
            return;
        }

        const rows = normalizeMaster(master.rows);
        const rep = buildReport(rows);
        const labels = rep.months.map(monthLabel);
        const sortedTotals = Object.fromEntries(Object.entries(rep.totals).sort((a, b) => b[1] - a[1]));
        const colorOf = cat => CHART_COLORS[Object.keys(sortedTotals).indexOf(cat) % CHART_COLORS.length];
        const byMonthAbs = Object.fromEntries(rep.months.map((ym, i) =>
            [labels[i], Object.fromEntries(rep.categories.map(c => [c, Math.abs(rep.trends[ym][c])]))]));
        const active = new Set(Object.keys(sortedTotals));

        const totIncome = rep.monthly.reduce((a, m) => a + m.income, 0);
        const totExp = rep.monthly.reduce((a, m) => a + Math.abs(m.expenses), 0);
        const avgNet = rep.monthly.length ? rep.monthly.reduce((a, m) => a + m.net, 0) / rep.monthly.length : 0;
        const allTxMonths = [...new Set(rows.filter(r => r._ym).map(r => r._ym))].sort();

        el.innerHTML = `
            <h1 class="page">Financial Dashboard</h1>
            <p class="lead">${rows.length.toLocaleString()} transactions · ${labels[0] ?? ''} – ${labels.at(-1) ?? ''}</p>

            <div class="cards">
                <div class="card"><div class="label">Total Income</div><div class="value" style="color:#2980b9">${money(totIncome)}</div><div class="sub">${rep.months.length} months</div></div>
                <div class="card"><div class="label">Total Expenses</div><div class="value" style="color:var(--red)">${money(totExp)}</div><div class="sub">everything except Income</div></div>
                <div class="card"><div class="label">Average Monthly Net</div><div class="value" style="color:${avgNet >= 0 ? 'var(--green)' : 'var(--red)'}">${money(avgNet, true)}</div><div class="sub">income − expenses</div></div>
            </div>

            <section>
                <h2>Month-over-Month Cash Flow</h2>
                <div class="chart-wrap">
                    <div class="chart-legend">
                        <span><span class="legend-dot" style="background:#4a90d9"></span>Income</span>
                        <span><span class="legend-dot" style="background:#e74c3c"></span>Expenses</span>
                        <span><span class="legend-line"></span>Net</span>
                    </div>
                    <canvas id="c-cash" style="height:260px"></canvas>
                </div>
                <div class="table-wrap"><table>
                    <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead>
                    <tbody>${rep.monthly.map((m, i) => `<tr>
                        <td>${labels[i]}</td><td class="amt">${money(m.income)}</td><td class="amt">${money(Math.abs(m.expenses))}</td>
                        <td class="amt ${m.net >= 0 ? 'positive' : 'negative'}">${money(m.net)}</td></tr>`).join('')}</tbody>
                </table></div>
            </section>

            <section>
                <h2>Category Spending Breakdown</h2>
                <div class="row" style="margin-bottom:10px">
                    <label class="check">Month:
                        <select id="cat-month"><option value="all">All months</option>${labels.map(l => `<option>${l}</option>`).join('')}</select>
                    </label>
                </div>
                <div class="chart-wrap"><canvas id="c-cat" style="height:${Math.max(200, rep.categories.length * 36 + 50)}px"></canvas></div>
                <div class="table-wrap"><table>
                    <thead><tr><th>Month</th>${rep.categories.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead>
                    <tbody>${rep.months.map((ym, i) => `<tr><td><strong>${labels[i]}</strong></td>${rep.categories.map(c => {
                        const v = rep.trends[ym][c];
                        return v ? `<td class="amt">${money(Math.abs(v))}</td>` : '<td class="zero num">-</td>';
                    }).join('')}</tr>`).join('')}</tbody>
                </table></div>
            </section>

            <section>
                <h2>Category Trends</h2>
                <div class="chart-legend" id="trend-legend"></div>
                <div class="chart-wrap"><canvas id="c-trend" style="height:300px"></canvas></div>
            </section>

            <section>
                <h2>Transaction Detail</h2>
                <div class="row" style="margin-bottom:12px">
                    <label class="check">Month: <select id="tx-month">${allTxMonths.map(ym => `<option value="${ym}">${monthLabel(ym)}</option>`).join('')}</select></label>
                    <label class="check">Category: <select id="tx-cat"></select></label>
                    <input type="search" id="tx-q" placeholder="Search merchant / description" style="min-width:220px">
                    <span class="spacer"></span><span class="muted" id="tx-count" style="font-size:0.85em"></span>
                </div>
                <div class="table-wrap"><table id="tx-table">
                    <thead><tr>
                        <th class="sortable" data-sort="date">Date ↕</th>
                        <th class="sortable" data-sort="merchant">Merchant ↕</th>
                        <th class="sortable num" data-sort="amount">Amount ↕</th>
                        <th class="sortable" data-sort="cat">Category ↕</th>
                        <th>Notes</th>
                    </tr></thead>
                    <tbody></tbody>
                </table></div>
            </section>

            <section>
                <h2>AI Strategic Analysis</h2>
                <div class="row"><button class="primary" id="ai-run">Generate analysis with local AI</button><span class="muted" id="ai-status" style="font-size:0.85em"></span></div>
                <div class="ai-box" id="ai-out" style="margin-top:14px"></div>
            </section>`;

        // Charts
        const drawAll = () => {
            drawCashFlow(el.querySelector('#c-cash'), {
                months: labels,
                income: rep.monthly.map(m => m.income),
                expenses: rep.monthly.map(m => Math.abs(m.expenses)),
            });
            const sel = el.querySelector('#cat-month').value;
            const pairs = sel === 'all'
                ? Object.entries(sortedTotals)
                : Object.entries(byMonthAbs[sel] || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
            drawCategoryBars(el.querySelector('#c-cat'), pairs);
            drawTrends(el.querySelector('#c-trend'), { months: labels, cats: Object.keys(sortedTotals), byMonth: byMonthAbs, active, colorOf });
        };
        el.querySelector('#cat-month').onchange = drawAll;

        const legend = el.querySelector('#trend-legend');
        for (const cat of Object.keys(sortedTotals)) {
            const btn = document.createElement('button');
            btn.className = 'cat-toggle active';
            btn.style.setProperty('--cat-color', colorOf(cat));
            btn.innerHTML = `<span class="legend-dot"></span>${esc(cat)}`;
            btn.onclick = () => {
                active.has(cat) ? active.delete(cat) : active.add(cat);
                btn.classList.toggle('active', active.has(cat));
                drawAll();
            };
            legend.appendChild(btn);
        }
        onResize = drawAll;
        window.addEventListener('resize', onResize);
        requestAnimationFrame(drawAll);

        // Transaction table
        const txMonth = el.querySelector('#tx-month'), txCat = el.querySelector('#tx-cat'), txQ = el.querySelector('#tx-q');
        txMonth.value = allTxMonths.at(-1);
        let sort = { key: 'date', asc: true };
        const sorters = {
            date: r => r._date?.getTime() ?? 0,
            merchant: r => String(r['Cleaned Merchant'] || r.Description || '').toLowerCase(),
            amount: r => r._amt,
            cat: r => r['AI Category'] || '',
        };
        const fillCats = () => {
            const cats = [...new Set(rows.filter(r => r._ym === txMonth.value).map(r => r['AI Category']))].sort();
            txCat.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
        };
        const drawTable = () => {
            const q = txQ.value.trim().toLowerCase();
            const list = rows.filter(r => r._ym === txMonth.value
                && (!txCat.value || r['AI Category'] === txCat.value)
                && (!q || `${r['Cleaned Merchant']} ${r.Description} ${r.Notes}`.toLowerCase().includes(q)));
            const f = sorters[sort.key];
            list.sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1); });
            el.querySelector('#tx-table tbody').innerHTML = list.map(r => `<tr>
                <td style="white-space:nowrap">${esc(r.Date)}</td>
                <td title="${esc(r.Description)}">${esc(r['Cleaned Merchant'] || r.Description)}</td>
                <td class="${r._amt > 0 ? 'income-amt' : 'expense-amt'}">${money(r._amt, r._amt > 0)}</td>
                <td><span class="cat-badge">${esc(r['AI Category'])}</span></td>
                <td>${r.Notes?.trim() ? `<span class="note-text">${esc(r.Notes)}</span>` : ''}</td></tr>`).join('');
            const spent = list.filter(r => r['AI Category'] !== 'Income').reduce((a, r) => a + r._amt, 0);
            el.querySelector('#tx-count').textContent = `${list.length} transaction${list.length === 1 ? '' : 's'} · net ${money(spent)} excl. income`;
        };
        txMonth.onchange = () => { fillCats(); drawTable(); };
        txCat.onchange = drawTable;
        txQ.oninput = drawTable;
        el.querySelectorAll('#tx-table th[data-sort]').forEach(th => th.onclick = () => {
            sort = { key: th.dataset.sort, asc: sort.key === th.dataset.sort ? !sort.asc : true };
            el.querySelectorAll('#tx-table th[data-sort]').forEach(h => { h.textContent = h.textContent.replace(/ [↕↑↓]$/, ' ↕'); });
            th.textContent = th.textContent.replace(/ [↕↑↓]$/, sort.asc ? ' ↑' : ' ↓');
            drawTable();
        });
        fillCats();
        drawTable();

        // AI analysis
        el.querySelector('#ai-run').onclick = async () => {
            const btn = el.querySelector('#ai-run'), status = el.querySelector('#ai-status');
            btn.disabled = true;
            status.textContent = 'Local AI is reviewing your history… this can take a minute.';
            try {
                const text = await generate(insightsPrompt(reportSummaryText(rep)));
                el.querySelector('#ai-out').innerHTML = mdToHtml(text);
                status.textContent = '';
            } catch (e) {
                status.textContent = `Couldn't reach Ollama: ${e.message}. Check the Setup page.`;
            } finally {
                btn.disabled = false;
            }
        };
    },

    destroy() {
        if (onResize) window.removeEventListener('resize', onResize);
        onResize = null;
    },
};
