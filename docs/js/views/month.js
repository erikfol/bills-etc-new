import { PATHS, readTable, loadConfig, parseConfig, keyOf } from '../data.js';
import { computeProjection, statusBadge } from '../finance.js';
import { lastSources } from '../workflow.js';
import { MONTH_NAMES } from '../dates.js';
import { esc, money } from '../util.js';
import { requireFolder } from '../app.js';

async function loadProjection() {
    const cfg = await loadConfig();
    if (!cfg) return { error: 'config.json not found — create it on the <a href="#config">Config</a> page.' };
    const processed = await readTable(PATHS.processed);
    if (!processed) return { error: 'No processed current month yet — run step 3 on the <a href="#workflow">Workflow</a> page.' };
    const master = await readTable(PATHS.master);
    return computeProjection({ config: parseConfig(cfg), rows: processed.rows, masterRows: master?.rows });
}

const SOURCE_TAGS = {
    edited: '<span class="source-tag source-edited">edited</span>',
    history: '<span class="source-tag source-history">history</span>',
    cache: '<span class="source-tag source-cache">cache</span>',
    ai: '<span class="source-tag source-ai">AI</span>',
    rules: '<span class="source-tag source-rules">rules</span>',
};

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading…</p>';
        // Re-read from disk so edits made in the editor (or Excel) show up.
        const p = await loadProjection();
        if (p.error) { el.innerHTML = `<div class="banner">${p.error}</div>`; return; }

        const label = `${MONTH_NAMES[p.today.getMonth()]} ${p.today.getFullYear()}`;
        const sdColor = p.surplus >= 0 ? 'var(--green)' : 'var(--red)';
        const hasSources = lastSources.size > 0;
        const rows = [...p.rows].sort((a, b) => (a._date?.getTime() ?? 0) - (b._date?.getTime() ?? 0));

        el.innerHTML = `
            <div class="row" style="margin-bottom:6px">
                <h1 class="page">Current Month Projection: ${esc(label)}</h1>
                <span class="spacer"></span>
                <button id="reload">Refresh</button>
            </div>
            <p class="lead">Day ${p.daysElapsed} of ${p.daysInMonth} · ${p.pctMonth}% through the month</p>

            <div class="cards">
                <div class="card"><div class="label">Expected Income</div><div class="value" style="color:#2980b9">${money(p.income)}</div><div class="sub">per month, from config</div></div>
                <div class="card"><div class="label">Total Projected Spend</div><div class="value" style="color:var(--red)">${money(p.totalProjected)}</div><div class="sub">fixed + variable projection</div></div>
                <div class="card"><div class="label">${p.surplus >= 0 ? 'Projected Surplus' : 'Projected Deficit'}</div><div class="value" style="color:${sdColor}">${money(p.surplus, true)}</div><div class="sub">end-of-month estimate</div></div>
            </div>

            <section>
                <h2>Month Progress</h2>
                <div class="progress-label"><span>Day ${p.daysElapsed} of ${p.daysInMonth}</span><span>${p.pctMonth}% elapsed</span></div>
                <div class="progress-bar"><div class="progress-fill" style="width:${p.pctMonth}%"></div></div>
                <p class="note">Variable spending is projected by scaling your current pace to the full month: (spent ÷ ${p.daysElapsed} days) × ${p.daysInMonth} days.</p>
            </section>

                <section>
                    <h2>Fixed Expenses <span class="sub">(from config)</span></h2>
                    <table>
                        <thead><tr><th>Item</th><th class="num">Monthly</th></tr></thead>
                        <tbody>
                            ${Object.entries(p.fixed).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td class="amt">${money(v)}</td></tr>`).join('')}
                            <tr class="total-row"><td><strong>Total Fixed</strong></td><td class="amt"><strong>${money(p.totalFixed)}</strong></td></tr>
                        </tbody>
                    </table>
                </section>
                <section>
                    <h2>Variable Spending</h2>
                    <div class="table-wrap"><table>
                        <thead><tr><th>Category</th><th class="num">Spent</th><th class="num">Projected</th><th class="num">Avg (${p.hist.months} mo)</th><th class="num">vs Avg</th><th>Status</th></tr></thead>
                        <tbody>
                            ${p.variableCats.map(cat => {
                                const spent = p.spent[cat], proj = p.projected[cat], hist = p.hist.avgs[cat] || 0;
                                const [cls, txt] = statusBadge(proj, hist);
                                const delta = proj - hist;
                                return `<tr>
                                    <td>${esc(cat)}</td>
                                    <td class="amt">${money(spent)}</td>
                                    <td class="amt"><strong>${money(proj)}</strong></td>
                                    <td class="amt muted">${hist > 0 ? money(hist) : '—'}</td>
                                    <td class="amt">${hist > 0 ? `<span style="color:${delta > 0 ? 'var(--red)' : 'var(--green)'}">${money(delta, true)}</span>` : '<span class="muted">—</span>'}</td>
                                    <td><span class="badge ${cls}">${txt}</span></td>
                                </tr>`;
                            }).join('')}
                            <tr class="total-row"><td><strong>Total</strong></td><td></td><td class="amt"><strong>${money(p.totalVariable)}</strong></td><td></td><td></td><td></td></tr>
                        </tbody>
                    </table></div>
                    <p class="note">Historical average covers ${p.hist.months} completed month(s); the current month is excluded.</p>
                </section>

            <section>
                <h2>Transactions <span class="sub">(${rows.length} rows)</span><span class="spacer"></span><a href="#edit" style="font-size:0.85em;text-transform:none;letter-spacing:0">Edit categories →</a></h2>
                <div class="table-wrap"><table>
                    <thead><tr><th>Date</th><th>Description</th><th>Merchant</th><th class="num">Amount</th><th>Category</th>${hasSources ? '<th>Source</th>' : ''}</tr></thead>
                    <tbody>${rows.map(r => {
                        const cat = r['AI Category'] || '';
                        const extra = cat === 'Credit Card' ? ' credit-card' : cat === 'Income' ? ' income' : '';
                        return `<tr>
                            <td style="white-space:nowrap">${esc(r.Date)}</td>
                            <td class="desc-cell">${esc(r.Description)}</td>
                            <td>${esc(r['Cleaned Merchant'])}</td>
                            <td class="${r._amt > 0 ? 'income-amt' : 'expense-amt'}">${money(r._amt, r._amt > 0)}</td>
                            <td><span class="cat-badge${extra}">${esc(cat)}</span></td>
                            ${hasSources ? `<td>${SOURCE_TAGS[lastSources.get(keyOf(r))] || ''}</td>` : ''}
                        </tr>`;
                    }).join('')}</tbody>
                </table></div>
                ${hasSources ? `<p class="note">Source: ${SOURCE_TAGS.edited} your manual edit · ${SOURCE_TAGS.history} same category as this merchant in your history · ${SOURCE_TAGS.cache} AI-categorized on an earlier run · ${SOURCE_TAGS.ai} AI-categorized this run · ${SOURCE_TAGS.rules} override/keyword rules only</p>` : ''}
            </section>`;

        el.querySelector('#reload').onclick = () => this.render(el);
    },
};
