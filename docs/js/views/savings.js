// Savings: the buckets in inputs/savings/master_savings.csv: what's in the account, what's set aside for each
// bucket, the "oh sh!t money" left over, what each paycheck adds, and the log of money moved out of savings.
import {
    loadSavings, changeSavings, saveSeparate, bucketCells, transferCells, sheetDollars, longDate, SAVINGS_PATH,
} from '../savings.js';
import { PATHS, readTable } from '../data.js';
import { normalizeMaster, monthlyBreakdown } from '../finance.js';
import { yearMonth } from '../dates.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, closeFilterMenu } from '../datatable.js';
import { dLong, today, isoDate, dateOf, numOf, card, dateCol, moneyCol, setResize, clearResize, axisMoney, sameDay, sameAmount, dupText } from './utilcommon.js';

const DAY = 864e5;
const GROUPS = [
    { id: 'active', title: 'Buckets', sub: 'filled from each paycheck' },
    { id: 'setup', title: 'Need to set up', sub: 'no money or deposit yet' },
    { id: 'other', title: 'Not in the paycheck total', sub: 'deposits listed but not counted in the per-paycheck total' },
    { id: 'past', title: 'One-time money', sub: 'stimulus, escrow, tax returns and other money that came and went' },
];
let editing = null; // 'buckets' | 'transfers' | 'balances' while a form has possible unsaved changes
const daysAgo = d => Math.round((today() - d) / DAY);
const amountText = v => (Number.isFinite(v) ? money(v) : '–');

/** Average monthly spending over the last six complete months, from your transaction history (NaN if none). */
async function averageSpending() {
    try {
        const master = await readTable(PATHS.master);
        if (!master?.rows.length) return NaN;
        const months = monthlyBreakdown(normalizeMaster(master.rows)).filter(m => m.ym < yearMonth(new Date())).slice(-6);
        return months.length ? sum(months.map(m => m.spending)) / months.length : NaN;
    } catch { return NaN; }
}

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        editing = null;
        el.innerHTML = '<p class="muted">Loading your savings…</p>';
        const data = await loadSavings();
        if (!data) {
            el.innerHTML = `<h1 class="page">Savings</h1><div class="banner">No savings sheet found. This page reads <code>${esc(SAVINGS_PATH)}</code> in your bills-etc folder.</div>`;
            return;
        }
        const spending = await averageSpending();
        const { available, buckets, transfers, totals, separate } = data;
        const live = buckets.filter(b => b.group !== 'past');
        const counted = live.filter(b => !separate.has(b.name) && Number.isFinite(b.balance));
        const heldApart = live.filter(b => separate.has(b.name) && Number.isFinite(b.balance));
        const setAside = sum(counted.map(b => b.balance));
        const cushion = Number.isFinite(available?.value) ? available.value - setAside : NaN;
        const perCheck = sum(buckets.filter(b => b.group === 'active' && Number.isFinite(b.perCheck)).map(b => b.perCheck));
        const t0 = today(), yearAgo = new Date(t0.getFullYear() - 1, t0.getMonth(), t0.getDate());
        const recent = transfers.filter(t => t.date && t.date >= yearAgo);
        const movedYear = sum(recent.map(t => t.amount).filter(Number.isFinite));

        el.innerHTML = `
            <div class="row dash-head">
                <h1 class="page">Savings</h1>
                <span class="spacer"></span>
                <button class="primary" id="upd-open">Update balances</button>
            </div>
            <p class="lead">Your savings account split into buckets: money set aside for each bill or goal, and the "oh sh!t money" left over for emergencies. From <code>${esc(SAVINGS_PATH)}</code>.</p>
            <div id="status"></div>
            <form id="upd-form" class="add-bill" hidden style="margin-bottom:18px"></form>
            <div class="cards kpis sav-cards" id="cards"></div>
            <section>
                <h2>Insights</h2>
                <ul class="insight-list" id="insights"></ul>
            </section>
            <section>
                <h2>Where the money is <span class="sub">click a bucket to see its notes</span>
                    <span class="spacer"></span><button type="button" class="small" id="b-edit">✎ Edit buckets</button></h2>
                <div id="buckets"></div>
                <div id="b-editor" hidden></div>
            </section>
            <section>
                <h2>Each paycheck <span class="sub">${esc(money(perCheck))} set aside per paycheck · about ${esc(money(perCheck * 2))} a month · ${esc(money(perCheck * 24))} a year</span></h2>
                <div id="per-check"></div>
            </section>
            <section>
                <h2>Money moved out of savings <span class="sub">from the transfer log</span>
                    <span class="spacer"></span><button type="button" class="small" id="t-edit">✎ Edit</button></h2>
                <div class="cards kpis" id="t-cards"></div>
                <canvas id="c-transfers" style="display:block;width:100%;height:200px;margin-bottom:12px"></canvas>
                <div id="t-table" class="short-table"></div>
                <div id="t-editor" hidden></div>
                <div class="row" style="margin-top:12px"><button type="button" class="primary small" id="t-add-open">+ Add a transfer</button></div>
                <form id="t-form" class="add-bill" hidden>
                    <h3>Add a transfer out of savings</h3>
                    <div class="add-grid">
                        <label class="field">Date<input type="date" name="date" required></label>
                        <label class="field">Amount ($)<input type="number" name="amount" step="0.01" min="0" required></label>
                        <label class="field">To<input type="text" name="to" list="t-dests" placeholder="e.g. Checking" required></label>
                    </div>
                    <div class="add-grid">
                        <label class="check" style="align-self:end;padding-bottom:8px"><input type="checkbox" name="confirmed" checked> Confirmed</label>
                        <label class="field" style="grid-column:span 2">Description<input type="text" name="description" placeholder="what it was for"></label>
                    </div>
                    <datalist id="t-dests">${[...new Set(transfers.map(t => t.to).filter(Boolean))].map(d => `<option value="${esc(d)}">`).join('')}</datalist>
                    <p class="muted" style="font-size:0.85em">Also take it out of "Available in account" with Update balances.</p>
                    <div class="row"><button type="submit" class="primary">Save transfer</button><button type="button" id="t-add-cancel">Cancel</button></div>
                </form>
            </section>`;
        const $ = s => el.querySelector(s);
        const save = async (fn, msg) => {
            try {
                await changeSavings(fn);
                editing = null;
                toast(msg, 'ok');
                const y = scrollY;
                await this.render(el);
                scrollTo(0, y);
            } catch (err) {
                toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            }
        };

        // ── Status ──
        const age = available?.updated ? daysAgo(available.updated) : null;
        $('#status').innerHTML = age == null ? ''
            : `<div class="banner${age > 45 ? '' : ' ok'}">${age > 45 ? '⏰' : '✓'} <strong>Balances last updated ${esc(dLong(available.updated))}</strong> (${age} day${age === 1 ? '' : 's'} ago).${age > 45 ? ' Time to check the account and press Update balances.' : ''}</div>`;

        // ── Cards ──
        const changed = Number.isFinite(totals.before) && Number.isFinite(cushion) ? cushion - totals.before : NaN;
        $('#cards').innerHTML = [
            card('Available in account', amountText(available?.value), `<span class="muted">${available?.updated ? `as of ${esc(dLong(available.updated))}` : 'not dated'}</span>`, 'var(--blue-text)'),
            card('Set aside in buckets', money(setAside), `<span class="muted">${counted.filter(b => b.balance > 0).length} buckets with money</span>`),
            card('Oh sh!t money', amountText(cushion),
                `<span class="muted">available − set aside</span>${Number.isFinite(changed) ? `<br><span class="${changed >= 0 ? 'delta-good' : 'delta-bad'}">${changed >= 0 ? '▲' : '▼'} ${esc(money(Math.abs(changed)))}</span> <span class="muted">vs ${esc(money(totals.before))} before</span>` : ''}`,
                cushion >= 0 ? 'var(--green)' : 'var(--red)'),
            card('Saved each paycheck', money(perCheck), `<span class="muted">about ${esc(money(perCheck * 24))} a year</span>`),
            heldApart.length ? card('Held separately', money(sum(heldApart.map(b => b.balance))), `<span class="muted">${heldApart.map(b => esc(b.name)).join(', ')}: not in the account total</span>`) : '',
        ].join('');

        // ── Insights ──
        const tips = [];
        if (Number.isFinite(cushion) && Number.isFinite(spending) && spending > 0) {
            const months = cushion / spending;
            tips.push(`Your oh sh!t money of <strong>${esc(money(cushion))}</strong> covers about <strong>${months.toFixed(1)} month${months >= 0.95 && months < 1.05 ? '' : 's'}</strong> of your average spending (${esc(money(spending))} a month over the last 6 months).${months < 3 ? ' Three to six months is the usual goal.' : ''}`);
        }
        if (heldApart.length) tips.push(`<span class="muted">${heldApart.map(b => `${esc(b.name)} (${esc(money(b.balance))})`).join(', ')} isn't counted against "Available in account", the way your sheet's Total deductions works. Change this in Edit buckets if that's not right.</span>`);
        const stale = live.filter(b => b.updated && daysAgo(b.updated) > 120 && (b.balance > 0 || b.perCheck > 0));
        if (stale.length) tips.push(`Not updated in over 4 months: ${stale.map(b => `${esc(b.name)} (${esc(dLong(b.updated))})`).join(', ')}.`);
        const setup = buckets.filter(b => b.group === 'setup');
        if (setup.length) tips.push(`Still to set up: ${setup.map(b => esc(b.name)).join(', ')}. Add a balance and a per-paycheck amount in Edit buckets.`);
        const empty = buckets.filter(b => b.group === 'active' && b.perCheck > 0 && !(b.balance > 0));
        if (empty.length) tips.push(`<span class="muted">Getting deposits but showing no balance: ${empty.map(b => esc(b.name)).join(', ')}.</span>`);
        if (recent.length) tips.push(`You moved <strong>${esc(money(movedYear))}</strong> out of savings in the last 12 months (${recent.length} transfer${recent.length === 1 ? '' : 's'}), versus about ${esc(money(perCheck * 24))} a year going in.`);
        else if (transfers.length) tips.push(`No money moved out of savings in the last 12 months. The last transfer was ${esc(dLong(transfers.filter(t => t.date).sort((a, b) => b.date - a.date)[0].date))}.`);
        $('#insights').innerHTML = tips.map(t => `<li>${t}</li>`).join('') || '<li class="muted">Nothing to point out.</li>';

        // ── Buckets as bars, grouped ──
        const maxBal = Math.max(1, ...live.map(b => (Number.isFinite(b.balance) ? b.balance : 0)));
        const bucketRow = b => `
            <details class="bucket${separate.has(b.name) ? ' separate' : ''}">
                <summary class="bucket-row">
                    <span class="b-name">${esc(b.name)}${separate.has(b.name) ? ' <span class="badge badge-neutral">held separately</span>' : ''}</span>
                    <span class="where-bar"><span style="width:${Number.isFinite(b.balance) && b.balance > 0 ? Math.max(1, b.balance / maxBal * 100).toFixed(1) : 0}%"></span></span>
                    <span class="b-amt">${Number.isFinite(b.balance) ? esc(money(b.balance)) : '<span class="muted">n/a</span>'}</span>
                    <span class="b-check">${Number.isFinite(b.perCheck) && b.perCheck > 0 ? `+${esc(money(b.perCheck))}/check` : '<span class="muted">–</span>'}</span>
                    <span class="b-date muted">${b.updated ? esc(dLong(b.updated)) : ''}</span>
                </summary>
                <div class="b-notes">${b.notes ? esc(b.notes).replace(/\r?\n/g, '<br>') : '<span class="muted">No notes.</span>'}</div>
            </details>`;
        $('#buckets').innerHTML = GROUPS.map(g => {
            const list = buckets.filter(b => b.group === g.id);
            if (!list.length) return '';
            const inner = `<div class="bucket-list">${list.map(bucketRow).join('')}</div>`;
            return g.id === 'past'
                ? `<details class="bucket-group"><summary><strong>${g.title}</strong> <span class="muted">(${list.length}) ${g.sub}</span></summary>${inner}</details>`
                : `<h3 class="chart-title" style="margin-top:12px">${g.title} <span class="muted" style="font-weight:400">${g.sub}</span></h3>${inner}`;
        }).join('');

        // ── Each paycheck ──
        const checks = buckets.filter(b => b.group === 'active' && b.perCheck > 0).sort((a, b) => b.perCheck - a.perCheck);
        const maxCheck = Math.max(1, ...checks.map(b => b.perCheck));
        $('#per-check').innerHTML = `<div class="bucket-list">${checks.map(b => `
            <div class="bucket-row static">
                <span class="b-name">${esc(b.name)}</span>
                <span class="where-bar"><span style="width:${(b.perCheck / maxCheck * 100).toFixed(1)}%;background:#27ae60"></span></span>
                <span class="b-amt">${esc(money(b.perCheck))}</span>
                <span class="b-check muted">${Math.round(b.perCheck / perCheck * 100)}%</span>
                <span class="b-date muted">${esc(money(b.perCheck * 24))}/yr</span>
            </div>`).join('')}</div>`;

        // ── Transfers ──
        const years = [...new Set(transfers.filter(t => t.date).map(t => t.date.getFullYear()))].sort();
        $('#t-cards').innerHTML = [
            card('Last 12 months', money(movedYear), `<span class="muted">${recent.length} transfer${recent.length === 1 ? '' : 's'}</span>`, 'var(--red)'),
            card('All logged', money(sum(transfers.map(t => t.amount).filter(Number.isFinite))), `<span class="muted">${transfers.length} transfers since ${years[0] ?? '–'}</span>`),
            card('Most often to', (() => { const c = {}; transfers.forEach(t => { if (t.to) c[t.to] = (c[t.to] || 0) + 1; }); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? top[0] : '–'; })(), '<span class="muted">by number of transfers</span>'),
        ].join('');
        const drawT = () => {
            drawBars($('#c-transfers'), {
                labels: years.map(String),
                series: [{ name: 'Moved out of savings', values: years.map(y => sum(transfers.filter(t => t.date?.getFullYear() === y).map(t => t.amount).filter(Number.isFinite))), color: '#e67e22', valueLabels: true }],
                fmt: axisMoney, valueFmt: v => money(v), tipFmt: money,
            });
        };
        dataTable($('#t-table'), {
            columns: [
                dateCol('date', 'Date', t => t.date),
                { id: 'to', label: 'From → To', value: t => t.kind },
                { ...moneyCol('amount', 'Amount', t => t.amount), cell: t => `${t.approx ? '~' : ''}${esc(money(t.amount))}` },
                { id: 'conf', label: 'Confirmed', value: t => t.confirmedText, cell: t => (t.confirmed ? '<span class="badge badge-ok">Yes</span>' : `<span class="badge badge-over">${esc(t.confirmedText || 'No')}</span>`) },
                { id: 'desc', label: 'Description', value: t => t.description, tdClass: () => 'note-text bill-note' },
            ],
            rows: transfers,
            sort: { col: 'date', dir: 'desc' },
            empty: 'No transfers logged',
        });

        // Add a transfer (newest first, right under the log's header row)
        const tf = $('#t-form');
        $('#t-add-open').onclick = () => { tf.reset(); tf.date.value = isoDate(new Date()); tf.hidden = false; $('#t-add-open').hidden = true; tf.amount.focus(); };
        $('#t-add-cancel').onclick = () => { tf.hidden = true; $('#t-add-open').hidden = false; };
        tf.onsubmit = async e => {
            e.preventDefault();
            const date = dateOf(tf.date.value), amount = numOf(tf.amount.value), to = tf.to.value.trim();
            if (!date || !Number.isFinite(amount) || !to) { toast('Enter the date, amount and where it went', 'bad'); return; }
            if (transfers.some(t => sameDay(t.date, date) && sameAmount(t.amount, amount))) { toast(dupText(date, amount, 'a transfer on'), 'bad'); return; }
            const row = transferCells({ kind: `From Save to ${to}`, amount, date, confirmed: tf.confirmed.checked, description: tf.description.value.trim() });
            await save(R => { R.splice(data.transferHeader + 1, 0, row); }, `Logged ${money(amount)} to ${to}`);
        };

        // ── Update balances: the account total and every bucket's balance; changed ones get today's date ──
        const uf = $('#upd-form');
        const updList = live;
        $('#upd-open').onclick = () => {
            editing = 'balances';
            uf.hidden = false;
            $('#upd-open').hidden = true;
            uf.innerHTML = `
                <h3>Update balances <span class="muted" style="font-weight:400">changed ones get today's date</span></h3>
                <div class="add-grid">
                    <label class="field"><strong>Available in account ($)</strong><input type="number" step="0.01" name="available" value="${Number.isFinite(available?.value) ? available.value : ''}"></label>
                    <span></span><span></span>
                </div>
                <div class="upd-grid">${updList.map(b => `<label class="field">${esc(b.name)}<input type="number" step="0.01" data-rec="${b.rec}" value="${Number.isFinite(b.balance) ? b.balance : ''}" placeholder="n/a"></label>`).join('')}</div>
                <p class="add-preview" id="upd-preview"></p>
                <div class="row"><button type="submit" class="primary">Save balances</button><button type="button" id="upd-cancel">Cancel</button></div>`;
            const preview = () => {
                const avail = numOf(uf.available.value);
                const vals = new Map([...uf.querySelectorAll('[data-rec]')].map(i => [+i.dataset.rec, numOf(i.value)]));
                const aside = sum(counted.map(b => (vals.has(b.rec) ? vals.get(b.rec) : b.balance)).filter(Number.isFinite));
                uf.querySelector('#upd-preview').innerHTML = Number.isFinite(avail) ? `Set aside ${esc(money(aside))} · oh sh!t money <strong>${esc(money(avail - aside))}</strong>` : '';
            };
            uf.oninput = preview;
            preview();
            uf.querySelector('#upd-cancel').onclick = () => { editing = null; uf.hidden = true; $('#upd-open').hidden = false; };
            uf.available.focus();
        };
        uf.onsubmit = async e => {
            e.preventDefault();
            const avail = numOf(uf.available.value), now = new Date();
            const edits = [...uf.querySelectorAll('[data-rec]')].map(i => ({ rec: +i.dataset.rec, value: numOf(i.value) }))
                .filter(x => { const b = buckets.find(y => y.rec === x.rec); return !(Number.isNaN(x.value) && Number.isNaN(b.balance)) && !sameAmount(x.value, b.balance); });
            const availChanged = Number.isFinite(avail) && !sameAmount(avail, available?.value);
            if (!edits.length && !availChanged) { toast('Nothing changed', ''); return; }
            await save(R => {
                if (availChanged) { R[available.rec][1] = sheetDollars(avail); R[available.rec][2] = longDate(now); }
                for (const x of edits) { R[x.rec][1] = Number.isFinite(x.value) ? sheetDollars(x.value) : ' n/a '; R[x.rec][2] = longDate(now); }
            }, `Updated ${edits.length + (availChanged ? 1 : 0)} balance${edits.length + (availChanged ? 1 : 0) === 1 ? '' : 's'}`);
        };

        // ── Edit buckets: name, balance, per paycheck, date, notes, held separately; add or remove buckets ──
        const be = $('#b-editor');
        const bucketEditRow = b => `<tr data-rec="${b.rec ?? ''}">
            <td><input type="text" data-k="name" value="${esc(b.name || '')}"></td>
            <td><input type="number" step="0.01" data-k="balance" value="${Number.isFinite(b.balance) ? b.balance : ''}" placeholder="n/a"></td>
            <td><input type="number" step="0.01" data-k="perCheck" value="${Number.isFinite(b.perCheck) ? b.perCheck : ''}" placeholder="n/a"></td>
            <td><input type="date" data-k="updated" value="${b.updated ? isoDate(b.updated) : ''}"></td>
            <td><textarea data-k="notes" rows="2">${esc(b.notes || '')}</textarea></td>
            <td style="text-align:center"><input type="checkbox" data-k="separate"${separate.has(b.name) ? ' checked' : ''} title="Held separately: not part of Available in account"></td>
            <td><button type="button" class="small danger" data-del title="Remove this bucket">✕</button></td>
        </tr>`;
        $('#b-edit').onclick = () => {
            editing = 'buckets';
            $('#buckets').hidden = true;
            $('#b-edit').hidden = true;
            be.hidden = false;
            be.innerHTML = `
                <div class="table-wrap loan-grid"><table class="sheet-table b-grid">
                    <thead><tr><th>Bucket</th><th>Balance</th><th>Per paycheck</th><th>Last updated</th><th>Notes</th><th>Held<br>separately</th><th></th></tr></thead>
                    <tbody>${live.map(bucketEditRow).join('')}</tbody>
                </table></div>
                <div class="row" style="margin-top:8px"><button type="button" class="small" data-add-bucket>+ Add a bucket</button>
                    <span class="muted" style="font-size:0.85em">New buckets go with the others filled from each paycheck. One-time money isn't listed here.</span></div>
                <div class="row" style="margin-top:12px">
                    <button type="button" class="primary" data-save>Save changes</button><button type="button" data-cancel>Cancel</button>
                    <span class="muted" style="font-size:0.85em">Saves to ${esc(SAVINGS_PATH)} and works out the totals again. Close it in Excel first.</span>
                </div>`;
        };
        be.addEventListener('click', async e => {
            if (e.target.closest('[data-add-bucket]')) {
                be.querySelector('tbody').insertAdjacentHTML('beforeend', bucketEditRow({ name: '', updated: new Date() }));
                be.querySelector('tbody tr:last-child [data-k=name]').focus();
            } else if (e.target.closest('[data-del]')) {
                const tr = e.target.closest('tr');
                if (tr.dataset.rec && !confirm(`Remove the "${tr.querySelector('[data-k=name]').value}" bucket from the sheet?`)) return;
                tr.remove();
            } else if (e.target.closest('[data-cancel]')) {
                editing = null; this.render(el);
            } else if (e.target.closest('[data-save]')) {
                const rows = [...be.querySelectorAll('tbody tr')].map(tr => {
                    const v = k => tr.querySelector(`[data-k=${k}]`);
                    return { rec: tr.dataset.rec === '' ? null : +tr.dataset.rec, name: v('name').value.trim(), balance: numOf(v('balance').value),
                        perCheck: numOf(v('perCheck').value), updated: dateOf(v('updated').value), notes: v('notes').value, separate: v('separate').checked };
                });
                if (rows.some(r => !r.name)) { toast('Every bucket needs a name', 'bad'); return; }
                const names = rows.map(r => r.name.toLowerCase());
                if (names.some((n, i) => names.indexOf(n) !== i)) { toast('Two buckets have the same name', 'bad'); return; }
                const kept = new Set(rows.filter(r => r.rec != null).map(r => r.rec));
                const removed = live.filter(b => !kept.has(b.rec)).map(b => b.rec);
                await saveSeparate(rows.filter(r => r.separate).map(r => r.name));
                await save((R, info) => {
                    for (const r of rows.filter(x => x.rec != null)) {
                        const old = R[r.rec];
                        const cells = bucketCells(r);
                        // keep the sheet's own text for untouched cells (n/a, blank dates, exact spacing)
                        const b = buckets.find(x => x.rec === r.rec);
                        if (r.name === b.name) cells[0] = old[0];
                        if (sameAmount(r.balance, b.balance) || (Number.isNaN(r.balance) && Number.isNaN(b.balance))) cells[1] = old[1] ?? '';
                        if (sameAmount(r.perCheck, b.perCheck) || (Number.isNaN(r.perCheck) && Number.isNaN(b.perCheck))) cells[3] = old[3] ?? '';
                        if ((r.updated && b.updated && sameDay(r.updated, b.updated)) || (!r.updated && !b.updated)) cells[2] = old[2] ?? '';
                        if (r.notes.trim() === b.notes) cells[4] = old[4] ?? '';
                        R[r.rec] = [...cells, ...old.slice(5)];
                    }
                    // new buckets go just above the per-paycheck Total row
                    const at = info.rows.perCheckTotal ?? info.transferHeader;
                    const fresh = rows.filter(x => x.rec == null).map(bucketCells);
                    // removals first from the bottom, so the insert index above them stays right
                    for (const rec of [...removed].sort((a, b) => b - a)) R.splice(rec, 1);
                    const shift = removed.filter(rec => rec < at).length;
                    R.splice(at - shift, 0, ...fresh);
                }, 'Saved your buckets');
            }
        });

        // ── Edit transfers ──
        const te = $('#t-editor');
        const tRow = t => `<tr data-rec="${t.rec}">
            <td><input type="date" data-k="date" value="${t.date ? isoDate(t.date) : ''}"></td>
            <td><input type="text" data-k="kind" value="${esc(t.kind)}"></td>
            <td><input type="text" data-k="amount" value="${(t.approx ? '~' : '') + (Number.isFinite(t.amount) ? t.amount : '')}"></td>
            <td><select data-k="confirmed"><option${t.confirmed ? ' selected' : ''}>Yes</option><option${t.confirmed ? '' : ' selected'}>No</option></select></td>
            <td><textarea data-k="description" rows="2">${esc(t.description)}</textarea></td>
            <td><button type="button" class="small danger" data-del title="Remove this transfer">✕</button></td>
        </tr>`;
        $('#t-edit').onclick = () => {
            editing = 'transfers';
            $('#t-table').hidden = true; $('#t-edit').hidden = true;
            te.hidden = false;
            te.innerHTML = `
                <div class="table-wrap loan-grid"><table class="sheet-table">
                    <thead><tr><th>Date</th><th>From → To</th><th>Amount</th><th>Confirmed</th><th>Description</th><th></th></tr></thead>
                    <tbody>${transfers.map(tRow).join('')}</tbody>
                </table></div>
                <div class="row" style="margin-top:12px"><button type="button" class="primary" data-save>Save changes</button><button type="button" data-cancel>Cancel</button>
                    <span class="muted" style="font-size:0.85em">Start an amount with ~ if it's approximate.</span></div>`;
        };
        te.addEventListener('click', async e => {
            if (e.target.closest('[data-del]')) e.target.closest('tr').remove();
            else if (e.target.closest('[data-cancel]')) { editing = null; this.render(el); }
            else if (e.target.closest('[data-save]')) {
                const rows = [...te.querySelectorAll('tbody tr')].map(tr => {
                    const v = k => tr.querySelector(`[data-k=${k}]`).value;
                    const a = v('amount').trim();
                    return { rec: +tr.dataset.rec, date: dateOf(v('date')), kind: v('kind').trim(), approx: a.startsWith('~'), amount: numOf(a.replace(/[~$,\s]/g, '')), confirmed: v('confirmed') === 'Yes', description: v('description').trim() };
                });
                // A date + amount that now appears more often than before editing is a duplicate entry.
                const key = r => (r.date && Number.isFinite(r.amount) ? `${isoDate(r.date)}|${r.amount.toFixed(2)}` : null);
                const count = list => list.reduce((m, r) => { const k = key(r); if (k) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
                const was = count(transfers), now = count(rows);
                const dupKey = [...now].find(([k, n]) => n > 1 && n > (was.get(k) || 0))?.[0];
                if (dupKey) { const r = rows.find(x => key(x) === dupKey); toast(dupText(r.date, r.amount, 'a transfer on'), 'bad'); return; }
                const kept = new Set(rows.map(r => r.rec));
                await save(R => {
                    for (const r of rows) {
                        const t = transfers.find(x => x.rec === r.rec), old = R[r.rec], cells = transferCells(r);
                        if (r.kind === t.kind) cells[0] = old[0];
                        if (sameAmount(r.amount, t.amount) && r.approx === t.approx) cells[1] = old[1];
                        if (sameDay(r.date, t.date)) cells[2] = old[2];
                        if (r.confirmed === t.confirmed) cells[3] = old[3];
                        if (r.description === t.description) cells[4] = old[4];
                        R[r.rec] = [...cells, ...old.slice(5)];
                    }
                    for (const rec of transfers.map(t => t.rec).filter(rec => !kept.has(rec)).sort((a, b) => b - a)) R.splice(rec, 1);
                }, 'Saved the transfer log');
            }
        });

        setResize(drawT);
        requestAnimationFrame(drawT);
    },

    canLeave(unloading) {
        if (!editing) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved savings edits. Leave without saving?')) return false;
        editing = null;
        return true;
    },

    destroy() {
        clearResize();
        closeFilterMenu();
    },
};
