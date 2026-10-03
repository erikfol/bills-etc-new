// Loan/CC: loans and credit cards you set up yourself, each with its own payments table.
import {
    loadAccounts, addAccount, updateAccount, removeAccount, moveAccount, loadPayments, savePayments,
    ACCOUNT_TYPES, LOANS_DIR,
} from '../loans.js';
import { drawBars } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, closeFilterMenu } from '../datatable.js';
import {
    MON, dLong, addMonths, today, axisMoney, isoDate, dateOf, numOf, card, dateCol, moneyCol, setResize, clearResize,
} from './utilcommon.js';

let editing = new Set(); // account ids being edited with unsaved changes possible
const shortDate = d => `${MON[d.getMonth()]} ${d.getDate()} ’${String(d.getFullYear()).slice(2)}`;
const madeBadge = p => (p.made ? '<span class="badge badge-ok">Y</span>' : '<span class="badge badge-over">N</span>');
const typeIcon = t => (t === 'Credit card' ? '💳' : t === 'Loan' ? '🏦' : '📄');
const DAY = 864e5;
/** What a payment that isn't made yet will take: the planned payment, or else the minimum. */
const amountDue = p => (Number.isFinite(p.payment) ? p.payment : p.minPayment);

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        editing = new Set();
        el.innerHTML = '<p class="muted">Loading your loans and cards…</p>';
        const accounts = await loadAccounts();
        const all = await Promise.all(accounts.map(async a => ({ account: a, payments: await loadPayments(a) })));

        el.innerHTML = `
            <div class="row dash-head">
                <h1 class="page">Loan / CC</h1>
                <span class="spacer"></span>
                <button class="primary" id="acct-open">+ Add account</button>
            </div>
            <p class="lead">Your loans and credit cards. Add an account, then record each payment: the minimum due, what you paid, the balance before and after, and whether it's been made.</p>
            <form id="acct-form" class="add-bill" hidden style="margin-bottom:18px">
                <h3>Add a loan or credit card</h3>
                <div class="add-grid">
                    <label class="field">Title<input type="text" name="title" required placeholder="e.g. Car loan, Chase Freedom"></label>
                    <label class="field">Type<select name="type">${ACCOUNT_TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
                    <span></span>
                </div>
                <div class="add-grid">
                    <label class="field" style="grid-column:1/-1">Description<input type="text" name="description" placeholder="optional: lender, rate, account ending, payoff goal…"></label>
                </div>
                <div class="row">
                    <button type="submit" class="primary">Add account</button>
                    <button type="button" id="acct-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Saved in ${esc(LOANS_DIR)}/ in your bills-etc folder.</span>
                </div>
            </form>
            <div id="due"></div>
            <div id="accounts"></div>`;
        const $ = s => el.querySelector(s);

        // ── Add an account ──
        const acctForm = $('#acct-form');
        $('#acct-open').onclick = () => { acctForm.hidden = false; $('#acct-open').hidden = true; acctForm.title.focus(); };
        $('#acct-cancel').onclick = () => { acctForm.reset(); acctForm.hidden = true; $('#acct-open').hidden = false; };
        acctForm.onsubmit = async e => {
            e.preventDefault();
            const title = acctForm.title.value.trim();
            if (!title) return;
            try {
                await addAccount({ title, description: acctForm.description.value, type: acctForm.type.value });
                toast(`Added ${title}`, 'ok');
                this.render(el);
            } catch (err) {
                toast(`Couldn't add it: ${err.message}`, 'bad');
            }
        };

        // ── Payments not made yet: past due and coming up in the next two weeks ──
        const t0 = today();
        const open = all.flatMap(({ account, payments }) => payments.filter(p => !p.made && p.date).map(p => ({ account, p })));
        const late = open.filter(x => x.p.date < t0), soon = open.filter(x => x.p.date >= t0 && x.p.date - t0 <= 14 * DAY);
        const item = x => `<span class="nowrap">${esc(x.account.title)}: ${esc(money(amountDue(x.p)))}${Number.isFinite(x.p.payment) ? '' : ' minimum'} ${x.p.date < t0 ? 'was due' : 'due'} ${esc(dLong(x.p.date))}</span>`;
        $('#due').innerHTML = (late.length ? `<div class="banner bad"><strong>Not made yet:</strong> ${late.map(item).join(' · ')}</div>` : '')
            + (soon.length ? `<div class="banner"><strong>Coming up:</strong> ${soon.map(item).join(' · ')}</div>` : '')
            + (!late.length && !soon.length && all.some(x => x.payments.length) ? '<div class="banner ok">✓ <strong>No payments due.</strong> Nothing is past due or due in the next two weeks.</div>' : '');

        if (!all.length) {
            $('#accounts').innerHTML = '<section><p>No accounts yet. Press <strong>+ Add account</strong> to set up your first loan or credit card.</p></section>';
            return;
        }

        // ── One section per account ──
        const redraws = [];
        all.forEach(({ account, payments }, k) => {
            const sec = document.createElement('section');
            sec.className = 'loan';
            $('#accounts').appendChild(sec);
            redraws.push(renderAccount(sec, account, payments, { first: k === 0, last: k === all.length - 1, rerender: () => this.render(el) }));
        });
        const redraw = () => redraws.forEach(f => f());
        setResize(redraw);
        requestAnimationFrame(redraw);
    },

    canLeave(unloading) {
        if (!editing.size) return true;
        if (unloading) return false;
        if (!confirm('You have unsaved edits on a loan or card. Leave without saving?')) return false;
        editing = new Set();
        return true;
    },

    destroy() {
        clearResize();
        closeFilterMenu();
    },
};

/** Draw one account (summary, chart, table, add-payment form, edit mode). Returns its chart redraw function. */
function renderAccount(sec, account, payments, { first, last, rerender }) {
    const $ = s => sec.querySelector(s);
    const dated = payments.filter(p => p.date);
    // Balance now = after the latest payment that's been made (planned payments don't count yet).
    const latest = [...dated].reverse().find(p => p.made && Number.isFinite(p.after)) || null;
    const made = payments.filter(p => p.made), next = payments.find(p => !p.made) || null;
    const paid = sum(made.map(p => p.payment).filter(Number.isFinite));

    sec.innerHTML = `
        <h2>${typeIcon(account.type)} ${esc(account.title)} <span class="badge badge-neutral">${esc(account.type)}</span>
            <span class="spacer"></span>
            <button type="button" class="small" data-move="-1" title="Move up"${first ? ' disabled' : ''}>▲</button>
            <button type="button" class="small" data-move="1" title="Move down"${last ? ' disabled' : ''}>▼</button>
            <button type="button" class="small" data-edit>✎ Edit</button></h2>
        ${account.description ? `<p class="lead" style="margin:-4px 0 14px">${esc(account.description)}</p>` : ''}
        <div class="view-mode">
            <div class="cards kpis">
                ${card('Balance now', latest ? money(latest.after) : Number.isFinite(dated[0]?.before) ? money(dated[0].before) : '–',
                    latest ? `<span class="muted">after the ${esc(dLong(latest.date))} payment</span>` : '<span class="muted">no payments made yet</span>', 'var(--red)')}
                ${card('Paid so far', money(paid), `<span class="muted">${made.length} of ${payments.length} payment${payments.length === 1 ? '' : 's'} made</span>`, 'var(--green)')}
                ${card('Next payment', next && Number.isFinite(amountDue(next)) ? money(amountDue(next)) : '–',
                    next ? `<span class="muted">${next.date ? `${next.date < today() ? 'was due' : 'due'} ${esc(dLong(next.date))}` : 'no date'}`
                        + `${Number.isFinite(next.minPayment) ? ` · minimum ${esc(money(next.minPayment))}` : ''}</span>` : '<span class="muted">every payment is made</span>')}
                ${card('Paid down', latest && Number.isFinite(dated[0]?.before) ? money(dated[0].before - latest.after) : '–',
                    latest && Number.isFinite(dated[0]?.before) ? `<span class="muted">from ${esc(money(dated[0].before))} on ${esc(dLong(dated[0].date))}</span>` : (latest ? '<span class="muted">needs a Before on the first payment</span>' : '<span class="muted">no payments made yet</span>'))}
            </div>
            ${dated.some(p => Number.isFinite(p.after)) ? `<h3 class="chart-title">Balance after each payment</h3><canvas class="c-bal" style="display:block;width:100%;height:200px;margin-bottom:14px"></canvas>` : ''}
            <div class="t-pay short-table"></div>
            <div class="row" style="margin-top:12px"><button type="button" class="primary small" data-add-open>+ Add payment</button></div>
            <form class="add-bill pay-form" hidden>
                <h3>Add a payment</h3>
                <div class="add-grid">
                    <label class="field">Date<input type="date" name="date" required></label>
                    <label class="field">Min payment ($)<input type="number" name="minPayment" step="0.01" placeholder="optional"></label>
                    <label class="field">Payment ($)<input type="number" name="payment" step="0.01"></label>
                </div>
                <div class="add-grid">
                    <label class="field">Balance before ($)<input type="number" name="before" step="0.01"></label>
                    <label class="field">Balance after ($)<input type="number" name="after" step="0.01" placeholder="before − payment"></label>
                    <label class="field">Payment made?<select name="made"><option value="N">N — not yet</option><option value="Y">Y — made</option></select></label>
                </div>
                <div class="add-grid">
                    <label class="field" style="grid-column:1/-1">Notes<input type="text" name="notes" placeholder="optional"></label>
                </div>
                <div class="row">
                    <button type="submit" class="primary">Save payment</button>
                    <button type="button" data-add-cancel>Cancel</button>
                </div>
            </form>
        </div>
        <div class="edit-mode" hidden></div>`;

    // ── Read-only table ──
    dataTable($('.t-pay'), {
        columns: [
            dateCol('date', 'Date', p => p.date),
            moneyCol('min', 'Min payment', p => p.minPayment),
            moneyCol('payment', 'Payment', p => p.payment),
            moneyCol('before', 'Before', p => p.before),
            moneyCol('after', 'After', p => p.after),
            { id: 'made', label: 'Payment made', value: p => (p.made ? 'Y' : 'N'), cell: madeBadge },
            { id: 'notes', label: 'Notes', value: p => p.notes, tdClass: () => 'note-text bill-note' },
        ],
        rows: payments,
        sort: { col: 'date', dir: 'desc' },
        empty: 'No payments yet: press + Add payment',
    });

    // ── Chart ──
    const chartRows = dated.filter(p => Number.isFinite(p.after));
    const draw = () => {
        const c = $('.c-bal');
        if (!c || sec.querySelector('.view-mode').hidden) return;
        drawBars(c, {
            labels: chartRows.map(p => shortDate(p.date)),
            series: [
                { name: 'Balance after', values: chartRows.map(p => p.after), color: account.type === 'Credit card' ? '#9b59b6' : '#4a90d9' },
                { name: 'Min payment', values: chartRows.map(p => p.minPayment), tipOnly: true },
                { name: 'Payment', values: chartRows.map(p => p.payment), tipOnly: true },
                { name: 'Balance before', values: chartRows.map(p => p.before), tipOnly: true },
            ],
            fmt: axisMoney, tipFmt: money,
            tipHead: k => `${dLong(chartRows[k].date)} · ${chartRows[k].made ? 'made' : 'not made yet'}`,
        });
    };

    // ── Add a payment (defaults follow on from the latest one: a month later, same amount, balance carried over) ──
    const form = $('.pay-form');
    const prev = dated.at(-1) || null;
    $('[data-add-open]').onclick = () => {
        form.reset();
        form.date.value = isoDate(prev?.date ? addMonths(prev.date, 1) : new Date());
        if (Number.isFinite(prev?.minPayment)) form.minPayment.value = prev.minPayment;
        if (Number.isFinite(prev?.payment)) form.payment.value = prev.payment;
        if (Number.isFinite(prev?.after)) form.before.value = prev.after;
        form.hidden = false;
        $('[data-add-open]').hidden = true;
        form.minPayment.focus();
    };
    $('[data-add-cancel]').onclick = () => { form.hidden = true; $('[data-add-open]').hidden = false; };
    form.oninput = () => {
        const b = numOf(form.before.value), p = numOf(form.payment.value);
        form.after.placeholder = Number.isFinite(b) && Number.isFinite(p) ? `${(b - p).toFixed(2)} (before − payment)` : 'before − payment';
    };
    form.onsubmit = async e => {
        e.preventDefault();
        const date = dateOf(form.date.value), payment = numOf(form.payment.value), before = numOf(form.before.value);
        const minPayment = numOf(form.minPayment.value);
        const after = form.after.value.trim() === '' ? (Number.isFinite(before) && Number.isFinite(payment) ? before - payment : NaN) : numOf(form.after.value);
        if (!date || !(Number.isFinite(payment) || Number.isFinite(minPayment))) { toast('Enter the date and the payment or the minimum', 'bad'); return; }
        try {
            await savePayments(account, [...payments, { date, minPayment, payment, before, after, made: form.made.value === 'Y', notes: form.notes.value }]);
            toast(`Added a ${money(Number.isFinite(payment) ? payment : minPayment)} payment to ${account.title}`, 'ok');
            rerender();
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
        }
    };

    // ── Reorder ──
    sec.querySelectorAll('[data-move]').forEach(b => {
        b.onclick = async () => { await moveAccount(account.id, +b.dataset.move); rerender(); };
    });

    // ── Edit mode: title, type, description and every payment row; Save writes it all ──
    const ed = $('.edit-mode');
    const rowHtml = (p = {}) => `<tr>
        <td><input type="date" data-k="date" value="${p.date ? isoDate(p.date) : ''}"></td>
        <td><input type="number" step="0.01" data-k="minPayment" value="${Number.isFinite(p.minPayment) ? p.minPayment : ''}"></td>
        <td><input type="number" step="0.01" data-k="payment" value="${Number.isFinite(p.payment) ? p.payment : ''}"></td>
        <td><input type="number" step="0.01" data-k="before" value="${Number.isFinite(p.before) ? p.before : ''}"></td>
        <td><input type="number" step="0.01" data-k="after" value="${Number.isFinite(p.after) ? p.after : ''}" placeholder="before − payment"></td>
        <td><select data-k="made"><option${p.made ? '' : ' selected'}>N</option><option${p.made ? ' selected' : ''}>Y</option></select></td>
        <td><input type="text" data-k="notes" value="${esc(p.notes || '')}"></td>
        <td><button type="button" class="small danger" data-del title="Remove this row">✕</button></td>
    </tr>`;
    const openEdit = () => {
        editing.add(account.id);
        sec.querySelector('.view-mode').hidden = true;
        $('[data-edit]').hidden = true;
        ed.hidden = false;
        ed.innerHTML = `
            <div class="add-grid">
                <label class="field">Title<input type="text" name="title" value="${esc(account.title)}"></label>
                <label class="field">Type<select name="type">${ACCOUNT_TYPES.map(t => `<option${t === account.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
                <span></span>
            </div>
            <div class="add-grid">
                <label class="field" style="grid-column:1/-1">Description<input type="text" name="description" value="${esc(account.description)}"></label>
            </div>
            <div class="table-wrap loan-grid"><table class="sheet-table">
                <thead><tr><th>Date</th><th>Min payment</th><th>Payment</th><th>Before</th><th>After</th><th>Payment made</th><th>Notes</th><th></th></tr></thead>
                <tbody>${payments.map(rowHtml).join('')}</tbody>
            </table></div>
            <div class="row" style="margin-top:10px">
                <button type="button" class="small" data-add-row>+ Add row</button>
                <span class="spacer"></span>
                <button type="button" class="small danger" data-remove-account>Remove account</button>
            </div>
            <div class="row" style="margin-top:12px">
                <button type="button" class="primary" data-save>Save changes</button>
                <button type="button" data-cancel>Cancel</button>
                <span class="muted" style="font-size:0.85em">Saves to ${esc(account.file)}. Close the file in Excel first.</span>
            </div>`;
    };
    $('[data-edit]').onclick = openEdit;
    ed.addEventListener('click', async e => {
        if (e.target.closest('[data-add-row]')) {
            const rows = [...ed.querySelectorAll('tbody tr')], lastRow = rows.at(-1);
            const v = k => lastRow?.querySelector(`[data-k="${k}"]`)?.value ?? '';
            const d = dateOf(v('date')), after = numOf(v('after'));
            ed.querySelector('tbody').insertAdjacentHTML('beforeend', rowHtml({ date: d ? addMonths(d, 1) : new Date(), minPayment: numOf(v('minPayment')), payment: numOf(v('payment')), before: after }));
        } else if (e.target.closest('[data-del]')) {
            e.target.closest('tr').remove();
        } else if (e.target.closest('[data-cancel]')) {
            editing.delete(account.id);
            rerender();
        } else if (e.target.closest('[data-remove-account]')) {
            if (!confirm(`Remove "${account.title}" from this page? Its payments file (${account.file}) stays in your folder.`)) return;
            await removeAccount(account.id);
            editing.delete(account.id);
            toast(`Removed ${account.title}`, 'ok');
            rerender();
        } else if (e.target.closest('[data-save]')) {
            const rows = [...ed.querySelectorAll('tbody tr')].map(tr => {
                const v = k => tr.querySelector(`[data-k="${k}"]`).value;
                const payment = numOf(v('payment')), before = numOf(v('before'));
                const after = v('after').trim() === '' && Number.isFinite(before) && Number.isFinite(payment) ? before - payment : numOf(v('after'));
                return { date: dateOf(v('date')), minPayment: numOf(v('minPayment')), payment, before, after, made: v('made') === 'Y', notes: v('notes') };
            }).filter(p => p.date || Number.isFinite(p.payment) || Number.isFinite(p.minPayment) || p.notes);
            const title = ed.querySelector('[name=title]').value.trim();
            if (!title) { toast('The account needs a title', 'bad'); return; }
            try {
                await savePayments(account, rows);
                await updateAccount(account.id, { title, type: ed.querySelector('[name=type]').value, description: ed.querySelector('[name=description]').value });
                editing.delete(account.id);
                toast(`Saved ${title}`, 'ok');
                rerender();
            } catch (err) {
                toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
            }
        }
    });

    return draw;
}
