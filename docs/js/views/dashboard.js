import { PATHS, readTable } from '../data.js';
import { normalizeMaster, buildReport, reportSummaryText } from '../finance.js';
import { drawCashFlow, drawCategoryBars, drawTrends, CHART_COLORS } from '../charts.js';
import { generate, insightsPrompt, aiEnabled } from '../ollama.js';
import { monthLabel } from '../dates.js';
import { esc, money, mdToHtml } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, dateColumn, moneyColumn, categoryColumn, closeFilterMenu } from '../datatable.js';

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
                <div id="t-cash"></div>
            </section>

            <section>
                <h2>Category Spending Breakdown</h2>
                <div class="row" style="margin-bottom:10px">
                    <label class="check">Month:
                        <select id="cat-month"><option value="all">All months</option>${labels.map(l => `<option>${l}</option>`).join('')}</select>
                    </label>
                </div>
                <div class="chart-wrap"><canvas id="c-cat" style="height:${Math.max(200, rep.categories.length * 36 + 50)}px"></canvas></div>
                <div id="t-cat"></div>
            </section>

            <section>
                <h2>Category Trends</h2>
                <div class="chart-legend" id="trend-legend"></div>
                <div class="chart-wrap"><canvas id="c-trend" style="height:300px"></canvas></div>
            </section>

            <section>
                <h2>Transaction Detail</h2>
                <div class="row" style="margin-bottom:12px">
                    <label class="check">Month: <select id="tx-month"><option value="">All months</option>${allTxMonths.map(ym => `<option value="${ym}">${monthLabel(ym)}</option>`).join('')}</select></label>
                    <input type="search" id="tx-q" placeholder="Search merchant / description / notes" style="min-width:240px">
                    <span class="spacer"></span><span class="muted" id="tx-count" style="font-size:0.85em"></span>
                </div>
                <div id="t-tx"></div>
            </section>

            <section${aiEnabled() ? '' : ' hidden'}>
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

        // Tables
        const sumOf = (list, f) => list.reduce((a, r) => a + f(r), 0);
        const monthCol = { id: 'month', label: 'Month', value: r => r.ym, text: monthLabel, sortLabels: ['Oldest → Newest', 'Newest → Oldest'] };

        dataTable(el.querySelector('#t-cash'), {
            columns: [
                monthCol,
                moneyColumn('inc', 'Income', r => r.income),
                moneyColumn('exp', 'Expenses', r => Math.abs(r.expenses)),
                { ...moneyColumn('net', 'Net', r => r.net), tdClass: r => (r.net >= 0 ? 'positive' : 'negative') },
            ],
            rows: rep.monthly,
            sort: { col: 'month', dir: 'asc' },
            footer: (list, filtered) => {
                const net = sumOf(list, r => r.net);
                return `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                    <td class="amt"><strong>${money(sumOf(list, r => r.income))}</strong></td>
                    <td class="amt"><strong>${money(sumOf(list, r => Math.abs(r.expenses)))}</strong></td>
                    <td class="amt ${net >= 0 ? 'positive' : 'negative'}"><strong>${money(net)}</strong></td></tr>`;
            },
        });

        dataTable(el.querySelector('#t-cat'), {
            columns: [
                { ...monthCol, cell: r => `<strong>${esc(monthLabel(r.ym))}</strong>` },
                ...rep.categories.map(c => ({
                    ...moneyColumn('c:' + c, c, r => Math.abs(rep.trends[r.ym][c])),
                    cell: r => { const v = Math.abs(rep.trends[r.ym][c]); return v ? esc(money(v)) : '<span class="zero">-</span>'; },
                })),
            ],
            rows: rep.months.map(ym => ({ ym })),
            sort: { col: 'month', dir: 'asc' },
            footer: (list, filtered) => `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>${rep.categories.map(c =>
                `<td class="amt"><strong>${money(Math.abs(sumOf(list, r => rep.trends[r.ym][c])))}</strong></td>`).join('')}</tr>`,
        });

        const txMonth = el.querySelector('#tx-month'), txQ = el.querySelector('#tx-q');
        txMonth.value = allTxMonths.at(-1) ?? '';
        const tx = dataTable(el.querySelector('#t-tx'), {
            columns: [
                dateColumn('date', 'Date', r => r.Date),
                { id: 'merchant', label: 'Merchant', value: r => r['Cleaned Merchant'] || r.Description || '',
                    cell: r => `<span title="${esc(r.Description)}">${esc(r['Cleaned Merchant'] || r.Description)}</span>` },
                moneyColumn('amt', 'Amount', r => r._amt, { signed: true }),
                categoryColumn('cat', 'Category', r => r['AI Category']),
                { id: 'notes', label: 'Notes', value: r => (r.Notes ?? '').trim(), cell: r => r.Notes?.trim() ? `<span class="note-text">${esc(r.Notes)}</span>` : '' },
            ],
            rows,
            sort: { col: 'date', dir: 'asc' },
            rowLimit: 500,
            onChange: list => {
                const net = list.filter(r => r['AI Category'] !== 'Income').reduce((a, r) => a + r._amt, 0);
                el.querySelector('#tx-count').textContent = `${list.length} transaction${list.length === 1 ? '' : 's'} · net ${money(net)} excl. income`;
            },
        });
        const applyTxFilter = () => {
            const q = txQ.value.trim().toLowerCase();
            tx.setFilter(r => (!txMonth.value || r._ym === txMonth.value)
                && (!q || `${r['Cleaned Merchant']} ${r.Description} ${r.Notes}`.toLowerCase().includes(q)));
        };
        txMonth.onchange = applyTxFilter;
        txQ.oninput = applyTxFilter;
        applyTxFilter();

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
        closeFilterMenu();
    },
};
