import { PATHS, readTable, writeTable, loadConfig } from '../data.js';
import { parseBills, hasBills, billMatcher, schedColumn } from '../bills.js';
import { normalizeMaster, buildReport, reportSummaryText, monthlyBreakdown, baseline } from '../finance.js';
import { drawMonthBars, drawTrends, CHART_COLORS } from '../charts.js';
import { generate, insightsPrompt, aiEnabled } from '../ollama.js';
import { monthLabel, longMonthLabel, yearMonth, MONTH_NAMES } from '../dates.js';
import { esc, money, mdToHtml, toast } from '../util.js';
import { bindCellEditing, merchantInput, categorySelect, notesInput, merchantText, categoryText, notesText } from '../celledit.js';
import { requireFolder } from '../app.js';
import { dataTable, dateColumn, moneyColumn, closeFilterMenu } from '../datatable.js';
import { renamed, getCategories } from '../rules.js';

let onResize = null;
let remembered = null; // selected month, kept while you move between pages
let dirty = new Set(); // master row indexes with unsaved edits
let editing = false; // transactions table is read-only until Edit is pressed

const shortLabel = ym => `${MONTH_NAMES[+ym.slice(5) - 1].slice(0, 3)} ’${ym.slice(2, 4)}`;

/** "≈ usual" / "▲ $120 more than usual" for a KPI or category, coloured good/bad. */
function compare(cur, avg, { higherIsGood, count, tolerance = 0.05, min = 25 }) {
    if (!count) return '<span class="muted">no earlier months to compare</span>';
    const diff = cur - avg;
    if (Math.abs(diff) <= Math.max(Math.abs(avg) * tolerance, min)) return `<span class="muted">≈ your usual ${esc(money(avg))}</span>`;
    const good = (diff > 0) === higherIsGood;
    return `<span class="${good ? 'delta-good' : 'delta-bad'}">${diff > 0 ? '▲' : '▼'} ${esc(money(Math.abs(diff)))} ${diff > 0 ? 'more' : 'less'}</span> <span class="muted">than usual (${esc(money(avg))})</span>`;
}

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading your history…</p>';
        const master = await readTable(PATHS.master);
        if (!master?.rows.length) {
            el.innerHTML = `<div class="banner">No history yet. Add bank files on the <a href="#home">Setup</a> page.</div>`;
            return;
        }
        if (!master.columns.includes('AI Category')) {
            el.innerHTML = `<div class="banner bad">The master file has no <code>AI Category</code> column. Columns: ${esc(master.columns.join(', '))}</div>`;
            return;
        }

        // Categories typed into the data but missing from the list get counted as Miscellaneous; say so.
        const listed = new Set(getCategories());
        const unlisted = [...new Set(master.rows.map(r => renamed(String(r['AI Category'] ?? '').trim())).filter(c => c && !listed.has(c)))].sort();
        for (const c of ['Cleaned Merchant', 'AI Category', 'Notes']) if (!master.columns.includes(c)) master.columns.push(c);
        const rows = normalizeMaster(master.rows);
        const cfg = await loadConfig().catch(() => null);
        const match = hasBills(cfg) ? billMatcher(parseBills(cfg)) : null;
        if (match) for (const r of rows) r._bill = match(r)?.name || '';
        rows.forEach((r, i) => { r._i = i; }); // index back into master.rows for saving edits
        dirty = new Set();
        editing = false;
        const months = monthlyBreakdown(rows);
        const yms = months.map(m => m.ym);
        const thisYm = yearMonth(new Date());
        // Open on the latest complete month; "this month so far" lives on the This Month page.
        const defaultYm = [...yms].reverse().find(ym => ym < thisYm) || yms.at(-1);
        let ym = yms.includes(remembered) ? remembered : defaultYm;
        let catFilter = null;
        let schedFilter = null; // 'sched' | 'unsched'
        const card = renamed('Credit Card'), savings = renamed('Savings');

        el.innerHTML = `
            <div class="row dash-head">
                <h1 class="page">Checking Activity</h1>
                <span class="spacer"></span>
                <div class="month-nav">
                    <button id="prev" title="Previous month" aria-label="Previous month">◀</button>
                    <select id="month">${yms.map(m => `<option value="${m}">${longMonthLabel(m)}</option>`).join('')}</select>
                    <button id="next" title="Next month" aria-label="Next month">▶</button>
                </div>
            </div>
            <p class="lead" id="lead"></p>
            ${unlisted.length ? `<div class="banner">${unlisted.map(c => `<strong>${esc(c)}</strong>`).join(', ')} ${unlisted.length === 1 ? 'is' : 'are'} used in your history but not in your category list, so ${unlisted.length === 1 ? 'it is' : 'they are'} counted as ${esc(renamed('Miscellaneous'))} here. Add ${unlisted.length === 1 ? 'it' : 'them'} on the <a href="#config">Config</a> page (Categories → Add to list) to see ${unlisted.length === 1 ? 'it' : 'them'} separately.</div>` : ''}

            <div class="cards kpis" id="kpis"></div>

            <section>
                <h2>Where the money went <span class="sub" id="where-sub"></span></h2>
                <div id="where"></div>
                <div id="moved" class="moved"></div>
                <div id="sched" class="moved"${match ? '' : ' hidden'}></div>
            </section>

            <section>
                <h2>Month by month <span class="sub">click a month to open it</span></h2>
                <div class="chart-legend">
                    <span><span class="legend-dot" style="background:#4a90d9"></span>Income</span>
                    <span><span class="legend-dot" style="background:#e74c3c"></span>Spending</span>
                </div>
                <canvas id="c-months" style="display:block;width:100%;height:220px;cursor:pointer"></canvas>
            </section>

            <section>
                <h2 id="tx-title">Transactions</h2>
                <div class="row" style="margin-bottom:10px">
                    <input type="search" id="tx-q" placeholder="Search merchant / description / notes" style="min-width:240px">
                    <span id="tx-chip"></span>
                    <span class="spacer"></span><span class="muted" id="tx-count" style="font-size:0.85em"></span>
                </div>
                <div class="row table-tools" id="tx-tools">
                    <button class="small" id="tx-edit">✎ Edit</button>
                    <span class="muted" id="tx-hint">Press Edit to change a transaction's merchant, category or notes.</span>
                </div>
                <div class="save-bar" id="tx-save-bar" hidden>
                    <span id="tx-dirty"></span>
                    <span class="spacer"></span>
                    <button id="tx-discard">Cancel</button>
                    <button class="primary" id="tx-save">Save changes</button>
                </div>
                <p class="note" id="tx-note" style="margin:0 0 8px" hidden>Edit the merchant, category or notes right in the table, then click Save changes. The description is the bank's original text and can't be changed (it's how duplicates are recognised).</p>
                <div id="t-tx"></div>
            </section>

            <details class="dash-more" id="more-history">
                <summary>Full history table</summary>
                <h3>Each month</h3>
                <div id="t-history"></div>
                <h3>Spending by category</h3>
                <div id="t-cats"></div>
            </details>

            <details class="dash-more" id="more-trends">
                <summary>Category trends</summary>
                <p class="note" style="margin:0 0 10px">Your five biggest categories are shown; click others to add them.</p>
                <div class="chart-legend" id="trend-legend"></div>
                <canvas id="c-trend" style="display:block;width:100%;height:300px"></canvas>
            </details>

            <section${aiEnabled() ? '' : ' hidden'}>
                <h2>AI Strategic Analysis</h2>
                <div class="row"><button class="primary" id="ai-run">Generate analysis with local AI</button><span class="muted" id="ai-status" style="font-size:0.85em"></span></div>
                <div class="ai-box" id="ai-out" style="margin-top:14px"></div>
            </section>`;

        const $ = s => el.querySelector(s);

        // ── Transactions table (filtered to the selected month and clicked category) ──
        const tx = dataTable($('#t-tx'), {
            columns: [
                dateColumn('date', 'Date', r => r.Date),
                { id: 'desc', label: 'Description', value: r => r.Description ?? '', tdClass: () => 'desc-cell' },
                { id: 'merchant', label: 'Merchant', value: r => r['Cleaned Merchant'] ?? '', tdClass: () => (editing ? 'edit-cell' : ''), cell: r => (editing ? merchantInput(r._i, r['Cleaned Merchant']) : merchantText(r['Cleaned Merchant'])) },
                moneyColumn('amt', 'Amount', r => r._amt, { signed: true }),
                { id: 'cat', label: 'Category', value: r => r['AI Category'] ?? '', tdClass: () => (editing ? 'edit-cell' : ''), cell: r => (editing ? categorySelect(r._i, r['AI Category']) : categoryText(r['AI Category'])) },
                ...(match ? [schedColumn(match)] : []),
                { id: 'notes', label: 'Notes', value: r => (r.Notes ?? '').trim(), tdClass: () => (editing ? 'edit-cell' : ''), cell: r => (editing ? notesInput(r._i, r.Notes) : notesText(r.Notes)) },
            ],
            rows,
            sort: { col: 'date', dir: 'asc' },
            rowLimit: 500,
            rowClass: r => (dirty.has(r._i) ? 'dirty' : ''),
            onChange: list => { $('#tx-count').textContent = `${list.length} transaction${list.length === 1 ? '' : 's'}`; },
        });
        const applyTx = () => {
            const q = $('#tx-q').value.trim().toLowerCase();
            tx.setFilter(r => r._ym === ym && (!catFilter || r['AI Category'] === catFilter)
                && (!schedFilter || (schedFilter === 'sched' ? !!r._bill : !r._bill && r._amt < 0))
                && (!q || `${r['Cleaned Merchant']} ${r.Description} ${r.Notes}`.toLowerCase().includes(q)));
            $('#tx-title').innerHTML = `Transactions <span class="sub">${esc(longMonthLabel(ym))}</span>`;
            $('#tx-chip').innerHTML = (catFilter
                ? `<button class="chip active" id="clear-chip" title="Show all categories">${esc(catFilter)} ✕</button>` : '')
                + (schedFilter ? ` <button class="chip active" id="clear-sched" title="Show all transactions">${schedFilter === 'sched' ? 'Scheduled' : 'Unscheduled'} ✕</button>` : '');
            $('#clear-chip')?.addEventListener('click', () => setCat(null));
            $('#clear-sched')?.addEventListener('click', () => setSched(null));
            el.querySelectorAll('#sched [data-sched]').forEach(b => b.classList.toggle('active', b.dataset.sched === schedFilter));
            el.querySelectorAll('#where [data-cat], #moved [data-cat]').forEach(b => b.classList.toggle('active', b.dataset.cat === catFilter));
        };
        $('#tx-q').oninput = applyTx;

        // ── Editing ──
        const updateSaveBar = () => {
            $('#tx-tools').hidden = editing;
            $('#tx-save-bar').hidden = $('#tx-note').hidden = !editing;
            $('#tx-dirty').textContent = dirty.size ? `${dirty.size} unsaved change${dirty.size === 1 ? '' : 's'}` : 'Editing';
            $('#tx-save').disabled = !dirty.size;
        };
        $('#tx-edit').onclick = () => { editing = true; updateSaveBar(); tx.redraw(); };
        bindCellEditing($('#t-tx'), (i, col) => rows[i][col] ?? '', (i, col, value, input) => {
            rows[i][col] = value;
            master.rows[i][col] = value;
            dirty.add(i);
            input.closest('tr').classList.add('dirty');
            updateSaveBar();
        });
        $('#tx-save').onclick = async () => {
            try {
                await writeTable(PATHS.master, master);
                toast(`Saved ${dirty.size} change${dirty.size === 1 ? '' : 's'}`, 'ok');
                dirty.clear();
                editing = false;
                this.render(el); // recompute the totals with the new categories
            } catch (e) {
                toast(`Save failed: ${e.message}. Is the file open in Excel?`, 'bad');
            }
        };
        $('#tx-discard').onclick = () => {
            if (!dirty.size) { editing = false; updateSaveBar(); tx.redraw(); return; }
            if (!confirm('Discard your unsaved changes?')) return;
            dirty.clear();
            editing = false;
            this.render(el);
        };
        const setCat = c => { catFilter = c === catFilter ? null : c; applyTx(); };
        const setSched = v => { schedFilter = v === schedFilter ? null : v; applyTx(); };

        // ── Month chart ──
        const chartWindow = () => {
            const i = yms.indexOf(ym);
            // Normally the latest 12 months; if the selected month is older, the 12 months ending at it.
            const end = i >= yms.length - 12 ? yms.length : i + 1;
            return months.slice(Math.max(0, end - 12), end);
        };
        const drawMonths = () => {
            const win = chartWindow();
            drawMonthBars($('#c-months'), {
                labels: win.map(m => shortLabel(m.ym)),
                income: win.map(m => m.income),
                spending: win.map(m => m.spending),
                selected: win.findIndex(m => m.ym === ym),
            });
        };
        $('#c-months').onclick = e => {
            const i = $('#c-months')._hit?.(e.offsetX) ?? -1;
            if (i >= 0) show(chartWindow()[i].ym);
        };

        // ── Show one month ──
        const show = next => {
            ym = remembered = next;
            catFilter = null;
            schedFilter = null;
            const i = yms.indexOf(ym), m = months[i], base = baseline(months, i);
            $('#month').value = ym;
            $('#prev').disabled = i === 0;
            $('#next').disabled = i === yms.length - 1;
            $('#lead').textContent = ym === thisYm
                ? 'This month so far. For a projection of where it will end up, see This Month.'
                : base.count ? `Compared with your average for the ${base.count} month${base.count === 1 ? '' : 's'} before.` : 'Your first month of history.';

            const kpi = (label, value, cmp, color = '') => `
                <div class="card"><div class="label">${label}</div>
                <div class="value"${color ? ` style="color:${color}"` : ''}>${esc(value)}</div>
                <div class="sub cmp">${cmp}</div></div>`;
            $('#kpis').innerHTML = [
                kpi('Income', money(m.income), compare(m.income, base.income, { higherIsGood: true, count: base.count }), '#2980b9'),
                kpi('Spending', money(m.spending), compare(m.spending, base.spending, { higherIsGood: false, count: base.count }), 'var(--red)'),
                kpi('Saved', money(m.saved), compare(m.saved, base.saved, { higherIsGood: true, count: base.count })),
                kpi('Left over', money(m.leftover, true), compare(m.leftover, base.leftover, { higherIsGood: true, count: base.count }),
                    m.leftover >= 0 ? 'var(--green)' : 'var(--red)'),
            ].join('');

            const cats = Object.entries(m.byCat).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
            const max = cats[0]?.[1] || 1;
            $('#where-sub').textContent = `${money(m.spending)} spent · click a category to see its transactions`;
            $('#where').innerHTML = cats.length ? cats.map(([c, v]) => {
                const avg = base.byCat[c] || 0;
                const delta = !base.count ? '' : !avg ? '<span class="muted">new</span>'
                    : compare(v, avg, { higherIsGood: false, count: base.count, tolerance: 0.15, min: 20 }).replace(/ <span class="muted">than usual.*$/, '');
                return `<button class="where-row" data-cat="${esc(c)}">
                    <span class="where-name">${esc(c)} <span class="muted">${m.counts[c]}</span></span>
                    <span class="where-bar"><span style="width:${Math.max(1, v / max * 100).toFixed(1)}%"></span></span>
                    <span class="where-amt">${esc(money(v))}</span>
                    <span class="where-delta">${delta}</span>
                </button>`;
            }).join('') : '<p class="muted">No spending this month.</p>';
            $('#moved').innerHTML = `
                <span class="muted">Moved, not spent:</span>
                <button class="chip" data-cat="${esc(card)}">Card payments ${esc(money(m.card))}</button>
                <button class="chip" data-cat="${esc(savings)}">Savings ${esc(money(m.saved))}</button>
                ${m.otherIn > 0.005 ? `<span class="muted">· Other money in (refunds, transfers in): <strong>${esc(money(m.otherIn))}</strong></span>` : ''}
                <span class="muted" style="font-size:0.85em;flex-basis:100%">Card purchases aren't itemized in the bank export, so they show here as one payment.</span>`;
            el.querySelectorAll('#where [data-cat], #moved [data-cat]').forEach(b => { b.onclick = () => setCat(b.dataset.cat); });
            if (match) {
                const inMonth = rows.filter(r => r._ym === ym && r._amt < 0);
                const sched = inMonth.filter(r => r._bill);
                const schedTotal = -sched.reduce((a, r) => a + r._amt, 0);
                const isSpending = r => r['AI Category'] !== 'Income' && r['AI Category'] !== card && r['AI Category'] !== savings;
                const unsched = m.spending + sched.filter(isSpending).reduce((a, r) => a + r._amt, 0);
                $('#sched').innerHTML = `
                    <span class="muted">Bills:</span>
                    <button class="chip" data-sched="sched">Scheduled ${esc(money(schedTotal))} <span class="muted">(${new Set(sched.map(r => r._bill)).size} bills)</span></button>
                    <button class="chip" data-sched="unsched">Unscheduled spending ${esc(money(unsched))}</button>
                    <span class="muted" style="font-size:0.85em;flex-basis:100%">Scheduled includes card payments and savings transfers that are set up as bills. <a href="#bills">Manage bills →</a></span>`;
                el.querySelectorAll('#sched [data-sched]').forEach(b => { b.onclick = () => setSched(b.dataset.sched); });
            }

            drawMonths();
            applyTx();
        };

        $('#month').onchange = e => show(e.target.value);
        $('#prev').onclick = () => show(yms[yms.indexOf(ym) - 1]);
        $('#next').onclick = () => show(yms[yms.indexOf(ym) + 1]);

        // ── Full history (folded away) ──
        const sumOf = (list, f) => list.reduce((a, r) => a + f(r), 0);
        const monthCol = { id: 'month', label: 'Month', value: r => r.ym, text: monthLabel, sortLabels: ['Oldest → Newest', 'Newest → Oldest'] };
        const totalCell = (list, f, cls = '') => `<td class="amt ${cls}"><strong>${esc(money(sumOf(list, f)))}</strong></td>`;
        dataTable($('#t-history'), {
            columns: [
                monthCol,
                moneyColumn('inc', 'Income', r => r.income),
                moneyColumn('in', 'Other money in', r => r.otherIn),
                moneyColumn('spend', 'Spending', r => r.spending),
                moneyColumn('card', 'Card payments', r => r.card),
                moneyColumn('saved', 'Saved', r => r.saved),
                { ...moneyColumn('left', 'Left over', r => r.leftover), tdClass: r => (r.leftover >= 0 ? 'positive' : 'negative') },
            ],
            rows: months,
            sort: { col: 'month', dir: 'desc' },
            footer: (list, filtered) => `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>
                ${totalCell(list, r => r.income)}${totalCell(list, r => r.otherIn)}${totalCell(list, r => r.spending)}${totalCell(list, r => r.card)}${totalCell(list, r => r.saved)}
                ${totalCell(list, r => r.leftover, sumOf(list, r => r.leftover) >= 0 ? 'positive' : 'negative')}</tr>`,
        });

        const spendCats = Object.entries(months.reduce((t, m) => { for (const [c, v] of Object.entries(m.byCat)) t[c] = (t[c] || 0) + v; return t; }, {}))
            .sort((a, b) => b[1] - a[1]).map(([c]) => c);
        dataTable($('#t-cats'), {
            columns: [
                { ...monthCol, cell: r => `<strong>${esc(monthLabel(r.ym))}</strong>` },
                ...spendCats.map(c => ({
                    ...moneyColumn('c:' + c, c, r => r.byCat[c] || 0),
                    cell: r => r.byCat[c] ? esc(money(r.byCat[c])) : '<span class="zero">-</span>',
                })),
            ],
            rows: months,
            sort: { col: 'month', dir: 'desc' },
            footer: (list, filtered) => `<tr class="total-row"><td><strong>Total${filtered ? ' (filtered)' : ''}</strong></td>${spendCats.map(c => totalCell(list, r => r.byCat[c] || 0)).join('')}</tr>`,
        });

        // ── Category trends (folded away; top five shown) ──
        const colorOf = c => CHART_COLORS[spendCats.indexOf(c) % CHART_COLORS.length];
        const active = new Set(spendCats.slice(0, 5));
        const byMonth = Object.fromEntries(months.map(m => [shortLabel(m.ym), m.byCat]));
        const drawTrend = () => {
            if (!$('#more-trends').open) return;
            drawTrends($('#c-trend'), { months: months.map(m => shortLabel(m.ym)), cats: spendCats, byMonth, active, colorOf });
        };
        for (const c of spendCats) {
            const btn = document.createElement('button');
            btn.className = 'cat-toggle' + (active.has(c) ? ' active' : '');
            btn.style.setProperty('--cat-color', colorOf(c));
            btn.innerHTML = `<span class="legend-dot"></span>${esc(c)}`;
            btn.onclick = () => { active.has(c) ? active.delete(c) : active.add(c); btn.classList.toggle('active', active.has(c)); drawTrend(); };
            $('#trend-legend').appendChild(btn);
        }
        $('#more-trends').addEventListener('toggle', () => requestAnimationFrame(drawTrend));

        onResize = () => { drawMonths(); drawTrend(); };
        window.addEventListener('resize', onResize);
        show(ym);
        requestAnimationFrame(drawMonths); // canvas has its real width once laid out

        // ── AI analysis (only when AI is turned on in Setup) ──
        $('#ai-run').onclick = async () => {
            const btn = $('#ai-run'), status = $('#ai-status');
            btn.disabled = true;
            status.textContent = 'Local AI is reviewing your history… this can take a minute.';
            try {
                const text = await generate(insightsPrompt(reportSummaryText(buildReport(rows))));
                $('#ai-out').innerHTML = mdToHtml(text);
                status.textContent = '';
            } catch (e) {
                status.textContent = `Couldn't reach Ollama: ${e.message}. Check the Setup page.`;
            } finally {
                btn.disabled = false;
            }
        };
    },

    canLeave(unloading) {
        if (!dirty.size) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved changes to transactions. Leave without saving?')) return false;
        dirty.clear();
        return true;
    },

    destroy() {
        if (onResize) window.removeEventListener('resize', onResize);
        onResize = null;
        closeFilterMenu();
    },
};
