// Loan/CC: loans and credit cards you set up yourself, each with its own payments table.
import {
    loadAccounts, addAccount, updateAccount, removeAccount, moveAccount, loadPayments, loadActivity, ledger, saveLedger, estimatePayoff,
    ACCOUNT_TYPES, ACTIVITY_TYPES, LOANS_DIR, cleanUrl,
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
/** '1234 5678 9012 4421' → '•••• 4421' */
const maskNumber = n => { const digits = String(n).replace(/\s+/g, ''); return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits; };
/** What a payment that isn't made yet will take: the planned payment, or else the minimum. */
const amountDue = p => (Number.isFinite(p.payment) ? p.payment : p.minPayment);

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        editing = new Set();
        el.innerHTML = '<p class="muted">Loading your loans and cards…</p>';
        const accounts = await loadAccounts();
        const all = await Promise.all(accounts.map(async a => {
            const rawPayments = await loadPayments(a), rawActivity = await loadActivity(a);
            // payments with Before/After worked out from the balance, for the due banner
            return { account: a, rawPayments, rawActivity, payments: ledger(a, rawPayments, rawActivity).payments };
        }));

        el.innerHTML = `
            <div class="row dash-head">
                <h1 class="page">Loan / CC</h1>
                <span class="spacer"></span>
                <button class="primary" id="acct-open">+ Add account</button>
            </div>
            <p class="lead">Your loans and credit cards. Each account has a payments table and an activity table (charges, interest, fees, credits); together with the opening balance they work out the balance.</p>
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
                <div class="add-grid">
                    <label class="field" style="grid-column:1/-1">Payment website<input type="text" inputmode="url" name="url" placeholder="optional: the page where you make payments, e.g. https://…"></label>
                </div>
                <div class="add-grid">
                    <label class="field">Opening balance ($)<input type="number" step="0.01" name="openingBalance" placeholder="0.00"></label>
                    <label class="field">As of<input type="date" name="openingDate"></label>
                    <label class="field">APR (%)<input type="number" step="0.01" min="0" name="apr" placeholder="optional, for the payoff date"></label>
                </div>
                <div class="add-grid">
                    <label class="field">Account number<input type="text" name="accountNumber" autocomplete="off" placeholder="optional: the last 4 digits are enough"></label>
                    <label class="field">Credit limit ($)<input type="number" step="0.01" min="0" name="creditLimit" placeholder="optional: works out available credit"></label>
                    <span></span>
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
            if (acctForm.url.value.trim() && !cleanUrl(acctForm.url.value)) { toast('The payment website should start with https://', 'bad'); return; }
            try {
                await addAccount({ title, description: acctForm.description.value, type: acctForm.type.value, url: acctForm.url.value,
                    openingBalance: numOf(acctForm.openingBalance.value), openingDate: dateOf(acctForm.openingDate.value) || new Date(), apr: numOf(acctForm.apr.value),
                    accountNumber: acctForm.accountNumber.value, creditLimit: numOf(acctForm.creditLimit.value) });
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
        all.forEach(({ account, rawPayments, rawActivity }, k) => {
            const sec = document.createElement('section');
            sec.className = 'loan';
            $('#accounts').appendChild(sec);
            redraws.push(renderAccount(sec, account, rawPayments, rawActivity, { first: k === 0, last: k === all.length - 1, rerender: () => this.render(el) }));
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

/** Draw one account (summary, chart, payments and activity tables, add forms, edit mode). Returns its chart redraw. */
function renderAccount(sec, account, rawPayments, rawActivity, { first, last, rerender }) {
    const $ = s => sec.querySelector(s);
    const L = ledger(account, rawPayments, rawActivity);
    const { payments, activity } = L;
    const made = payments.filter(p => p.made), next = payments.find(p => !p.made) || null;
    const paid = sum(made.map(p => p.payment).filter(Number.isFinite));
    const bySign = s => sum(activity.filter(a => Math.sign(a.signed) === s).map(a => Math.abs(a.signed)));
    const added = bySign(1), credits = bySign(-1);
    const interestFees = sum(activity.filter(a => /^(interest|fee)$/i.test(a.type)).map(a => a.amount).filter(Number.isFinite));
    const P = estimatePayoff(account, L);
    const mon = d => `${MON[d.getMonth()]} ${d.getFullYear()}`;
    const payoffCard = P.status === 'paid' ? card('Payoff', 'Paid off ✓', '<span class="muted">the balance is zero</span>', 'var(--green)')
        : P.status === 'unknown' ? card('Payoff estimate', '–', `<span class="muted">${esc(P.reason)}</span>`)
        : P.status === 'never' ? card('Payoff estimate', 'Not at this rate', `<span class="delta-bad">${esc(money(P.payment))} a month${Number.isFinite(P.monthlyInterest) ? ` doesn't cover the ${esc(money(P.monthlyInterest))} monthly interest` : ' would take over 50 years'}</span>`
            + '<br><span class="muted">pay more, or set a planned payment in Edit</span>', 'var(--red)')
        : card('Payoff estimate', mon(P.date),
            `<span class="muted">${P.months} payment${P.months === 1 ? '' : 's'} of ${esc(money(P.payment))} (${esc(P.basis)})<br>${esc(P.rateText)}`
            + `${P.interest > 0.5 ? ` · about ${esc(money(P.interest))} interest` : ''}</span>`);
    const limit = Number(account.creditLimit);
    const used = limit > 0 ? Math.max(0, L.balanceNow) / limit : NaN;
    const creditCard = !(limit > 0) ? '' : card('Available credit', money(limit - L.balanceNow),
        `<span class="muted">of ${esc(money(limit))} limit · </span><span class="${used >= 0.7 ? 'delta-bad' : used >= 0.3 ? 'badge-warn' : 'delta-good'}">${Math.round(used * 100)}% used</span>`,
        limit - L.balanceNow < 0 ? 'var(--red)' : 'var(--green)');
    const save = async (p, a) => {
        // Accounts set up before opening balances: keep the balance they started from before Before/After are stripped.
        if (!Number.isFinite(account.openingBalance)) {
            await updateAccount(account.id, { openingBalance: L.opening, openingDate: L.openingDate });
            account.openingBalance = L.opening;
            account.openingDate = L.openingDate ? isoDate(L.openingDate) : '';
        }
        await saveLedger(account, p, a);
        rerender();
    };
    const strip = list => list.map(({ before, after, signed, balance, ...rest }) => rest); // drop worked-out fields before saving

    sec.innerHTML = `
        <h2>${typeIcon(account.type)} ${esc(account.title)} <span class="badge badge-neutral">${esc(account.type)}</span>
            ${account.accountNumber ? `<span class="acct-num" title="Account number"><span class="acct-num-text">${esc(maskNumber(account.accountNumber))}</span>${maskNumber(account.accountNumber) !== account.accountNumber.replace(/\s+/g, '') ? ' <button type="button" class="small acct-num-toggle">show</button>' : ''}</span>` : ''}
            <span class="spacer"></span>
            ${account.url ? `<a class="ext-link" href="${esc(account.url)}" target="_blank" rel="noopener" title="${esc(account.url)}">Make a payment ↗</a>` : ''}
            <button type="button" class="small" data-move="-1" title="Move up"${first ? ' disabled' : ''}>▲</button>
            <button type="button" class="small" data-move="1" title="Move down"${last ? ' disabled' : ''}>▼</button>
            <button type="button" class="small" data-edit>✎ Edit</button></h2>
        ${account.description ? `<p class="lead" style="margin:-4px 0 14px">${esc(account.description)}</p>` : ''}
        <div class="view-mode">
            <div class="cards kpis">
                ${card('Balance now', money(L.balanceNow),
                    `<span class="muted">opening ${esc(money(L.opening))}${L.openingDate ? ` (${esc(dLong(L.openingDate))})` : ''}<br>+ ${esc(money(added))} activity${credits ? ` − ${esc(money(credits))} credits` : ''} − ${esc(money(paid))} paid</span>`, 'var(--red)')}
                ${card('Next payment', next && Number.isFinite(amountDue(next)) ? money(amountDue(next)) : '–',
                    next ? `<span class="muted">${next.date ? `${next.date < today() ? 'was due' : 'due'} ${esc(dLong(next.date))}` : 'no date'}`
                        + `${Number.isFinite(next.minPayment) ? ` · minimum ${esc(money(next.minPayment))}` : ''}</span>` : '<span class="muted">every payment is made</span>')}
                ${card('Paid so far', money(paid), `<span class="muted">${made.length} of ${payments.length} payment${payments.length === 1 ? '' : 's'} made</span>`, 'var(--green)')}
                ${creditCard}
                ${payoffCard}
                ${card('Interest &amp; fees', money(interestFees), `<span class="muted">${activity.length} activity entr${activity.length === 1 ? 'y' : 'ies'}</span>`)}
            </div>
            ${L.points.length > 1 ? '<h3 class="chart-title">Balance over time</h3><canvas class="c-bal" style="display:block;width:100%;height:200px;margin-bottom:14px"></canvas>' : ''}
            <div class="loan-tables">
                <div>
                    <h3 class="chart-title">Payments</h3>
                    <div class="t-pay short-table"></div>
                    <div class="row" style="margin-top:10px"><button type="button" class="primary small" data-pay-open>+ Add payment</button></div>
                    <form class="add-bill pay-form" hidden>
                        <h3>Add a payment</h3>
                        <div class="add-grid">
                            <label class="field">Date<input type="date" name="date" required></label>
                            <label class="field">Min payment ($)<input type="number" name="minPayment" step="0.01" placeholder="optional"></label>
                            <label class="field">Payment ($)<input type="number" name="payment" step="0.01"></label>
                        </div>
                        <div class="add-grid">
                            <label class="field">Payment made?<select name="made"><option value="N">N — not yet</option><option value="Y">Y — made</option></select></label>
                            <label class="field" style="grid-column:span 2">Notes<input type="text" name="notes" placeholder="optional"></label>
                        </div>
                        <p class="add-preview pay-preview"></p>
                        <div class="row"><button type="submit" class="primary">Save payment</button><button type="button" data-pay-cancel>Cancel</button></div>
                    </form>
                </div>
                <div>
                    <h3 class="chart-title">Activity <span class="muted" style="font-weight:400">charges, interest, fees, credits</span></h3>
                    <div class="t-act short-table"></div>
                    <div class="row" style="margin-top:10px"><button type="button" class="primary small" data-act-open>+ Add activity</button></div>
                    <form class="add-bill act-form" hidden>
                        <h3>Add activity</h3>
                        <div class="add-grid">
                            <label class="field">Date<input type="date" name="date" required></label>
                            <label class="field">Type<select name="type">${ACTIVITY_TYPES.map(t => `<option>${t.type}</option>`).join('')}</select></label>
                            <label class="field">Amount ($)<input type="number" name="amount" step="0.01" min="0" required></label>
                        </div>
                        <div class="add-grid">
                            <label class="field" style="grid-column:span 2">Description<input type="text" name="description" placeholder="e.g. Hotel stay, monthly interest"></label>
                            <label class="field">Notes<input type="text" name="notes" placeholder="optional"></label>
                        </div>
                        <div class="row"><button type="submit" class="primary">Save activity</button><button type="button" data-act-cancel>Cancel</button></div>
                    </form>
                </div>
            </div>
        </div>
        <div class="edit-mode" hidden></div>`;

    // ── Read-only tables ──
    dataTable($('.t-pay'), {
        columns: [
            dateCol('date', 'Date', p => p.date),
            moneyCol('min', 'Min', p => p.minPayment),
            moneyCol('payment', 'Payment', p => p.payment),
            moneyCol('before', 'Before', p => p.before),
            { ...moneyCol('after', 'After', p => p.after), tdClass: p => `nowrap${p.made ? '' : ' muted'}` },
            { id: 'made', label: 'Made', value: p => (p.made ? 'Y' : 'N'), cell: madeBadge },
            { id: 'notes', label: 'Notes', value: p => p.notes, tdClass: () => 'note-text' },
        ],
        rows: payments,
        sort: { col: 'date', dir: 'desc' },
        empty: 'No payments yet',
    });
    dataTable($('.t-act'), {
        columns: [
            dateCol('date', 'Date', a => a.date),
            { id: 'desc', label: 'Description', value: a => a.description },
            { id: 'type', label: 'Type', value: a => a.type, cell: a => `<span class="cat-badge${a.signed < 0 ? ' income' : ''}">${esc(a.type)}</span>` },
            { id: 'amount', label: 'Amount', num: true, value: a => a.signed, text: v => (v < 0 ? '−' : '+') + money(Math.abs(v)),
                tdClass: a => `nowrap ${a.signed < 0 ? 'income-amt' : 'expense-amt'}` },
            moneyCol('balance', 'Balance', a => a.balance),
            { id: 'notes', label: 'Notes', value: a => a.notes, tdClass: () => 'note-text' },
        ],
        rows: activity,
        sort: { col: 'date', dir: 'desc' },
        empty: 'No activity yet',
    });

    // ── Chart: the balance after each event ──
    const pts = L.points;
    const draw = () => {
        const c = $('.c-bal');
        if (!c || sec.querySelector('.view-mode').hidden) return;
        drawBars(c, {
            labels: pts.map(p => shortDate(p.date)),
            series: [{ name: 'Balance', values: pts.map(p => p.balance), color: account.type === 'Credit card' ? '#9b59b6' : '#4a90d9' }],
            fmt: axisMoney, tipFmt: money,
            tipHead: k => `${dLong(pts[k].date)} · ${pts[k].what}`,
        });
    };

    // ── Add a payment: a month after the last one, same amounts ──
    const pf = $('.pay-form'), prev = payments.filter(p => p.date).at(-1) || null;
    const payPreview = () => {
        const d = dateOf(pf.date.value), pay = numOf(pf.payment.value), min = numOf(pf.minPayment.value);
        if (!d) { $('.pay-preview').textContent = ''; return; }
        const trial = ledger(account, [...rawPayments, { date: d, payment: pay, minPayment: min, made: pf.made.value === 'Y' }], rawActivity);
        const p = trial.payments.find(x => x.date?.getTime() === d.getTime() && (x.payment === pay || (!Number.isFinite(pay) && x.minPayment === min)));
        $('.pay-preview').textContent = p ? `balance before ${money(p.before)} · after ${money(p.after)}${pf.made.value === 'Y' ? '' : ' (once made)'}` : '';
    };
    $('[data-pay-open]').onclick = () => {
        pf.reset();
        pf.date.value = isoDate(prev?.date ? addMonths(prev.date, 1) : new Date());
        if (Number.isFinite(prev?.minPayment)) pf.minPayment.value = prev.minPayment;
        if (Number.isFinite(prev?.payment)) pf.payment.value = prev.payment;
        pf.hidden = false;
        $('[data-pay-open]').hidden = true;
        payPreview();
        pf.minPayment.focus();
    };
    $('[data-pay-cancel]').onclick = () => { pf.hidden = true; $('[data-pay-open]').hidden = false; };
    pf.oninput = payPreview;
    pf.onsubmit = async e => {
        e.preventDefault();
        const date = dateOf(pf.date.value), payment = numOf(pf.payment.value), minPayment = numOf(pf.minPayment.value);
        if (!date || !(Number.isFinite(payment) || Number.isFinite(minPayment))) { toast('Enter the date and the payment or the minimum', 'bad'); return; }
        try {
            await save([...strip(rawPayments), { date, minPayment, payment, made: pf.made.value === 'Y', notes: pf.notes.value }], strip(rawActivity));
            toast(`Added a ${money(Number.isFinite(payment) ? payment : minPayment)} payment to ${account.title}`, 'ok');
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
        }
    };

    // ── Add activity ──
    const af = $('.act-form');
    $('[data-act-open]').onclick = () => {
        af.reset();
        af.date.value = isoDate(new Date());
        af.hidden = false;
        $('[data-act-open]').hidden = true;
        af.amount.focus();
    };
    $('[data-act-cancel]').onclick = () => { af.hidden = true; $('[data-act-open]').hidden = false; };
    af.onsubmit = async e => {
        e.preventDefault();
        const date = dateOf(af.date.value), amount = numOf(af.amount.value);
        if (!date || !Number.isFinite(amount)) { toast('Enter the date and the amount', 'bad'); return; }
        try {
            await save(strip(rawPayments), [...strip(rawActivity), { date, type: af.type.value, amount: Math.abs(amount), description: af.description.value, notes: af.notes.value }]);
            toast(`Added ${af.type.value.toLowerCase()} of ${money(Math.abs(amount))} to ${account.title}`, 'ok');
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
        }
    };

    // ── Account number: masked until "show" ──
    const tog = $('.acct-num-toggle');
    if (tog) tog.onclick = () => {
        const t = $('.acct-num-text'), shown = tog.textContent === 'hide';
        t.textContent = shown ? maskNumber(account.accountNumber) : account.accountNumber;
        tog.textContent = shown ? 'show' : 'hide';
    };

    // ── Reorder ──
    sec.querySelectorAll('[data-move]').forEach(b => {
        b.onclick = async () => { await moveAccount(account.id, +b.dataset.move); rerender(); };
    });

    // ── Edit mode: account details, opening balance, and every payment and activity row ──
    const ed = $('.edit-mode');
    const payRow = (p = {}) => `<tr>
        <td><input type="date" data-k="date" value="${p.date ? isoDate(p.date) : ''}"></td>
        <td><input type="number" step="0.01" data-k="minPayment" value="${Number.isFinite(p.minPayment) ? p.minPayment : ''}"></td>
        <td><input type="number" step="0.01" data-k="payment" value="${Number.isFinite(p.payment) ? p.payment : ''}"></td>
        <td><select data-k="made"><option${p.made ? '' : ' selected'}>N</option><option${p.made ? ' selected' : ''}>Y</option></select></td>
        <td><input type="text" data-k="notes" value="${esc(p.notes || '')}"></td>
        <td><button type="button" class="small danger" data-del title="Remove this row">✕</button></td>
    </tr>`;
    const actRow = (a = {}) => `<tr>
        <td><input type="date" data-k="date" value="${a.date ? isoDate(a.date) : ''}"></td>
        <td><input type="text" data-k="description" value="${esc(a.description || '')}"></td>
        <td><select data-k="type">${ACTIVITY_TYPES.map(t => `<option${t.type === a.type ? ' selected' : ''}>${t.type}</option>`).join('')}</select></td>
        <td><input type="number" step="0.01" min="0" data-k="amount" value="${Number.isFinite(a.amount) ? a.amount : ''}"></td>
        <td><input type="text" data-k="notes" value="${esc(a.notes || '')}"></td>
        <td><button type="button" class="small danger" data-del title="Remove this row">✕</button></td>
    </tr>`;
    $('[data-edit]').onclick = () => {
        editing.add(account.id);
        sec.querySelector('.view-mode').hidden = true;
        $('[data-edit]').hidden = true;
        ed.hidden = false;
        ed.innerHTML = `
            <div class="add-grid">
                <label class="field">Title<input type="text" name="title" value="${esc(account.title)}"></label>
                <label class="field">Type<select name="type">${ACCOUNT_TYPES.map(t => `<option${t === account.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
                <label class="field">Payment website<input type="text" inputmode="url" name="url" value="${esc(account.url || '')}" placeholder="optional: https://…"></label>
            </div>
            <div class="add-grid">
                <label class="field" style="grid-column:1/-1">Description<input type="text" name="description" value="${esc(account.description)}"></label>
            </div>
            <div class="add-grid">
                <label class="field">Opening balance ($)<input type="number" step="0.01" name="openingBalance" value="${Number.isFinite(L.opening) ? L.opening : 0}"></label>
                <label class="field">Opening date<input type="date" name="openingDate" value="${L.openingDate ? isoDate(L.openingDate) : ''}"></label>
                <span class="muted" style="align-self:end;font-size:0.85em;padding-bottom:8px">The balance before the first payment and activity below.</span>
            </div>
            <div class="add-grid">
                <label class="field">APR (%)<input type="number" step="0.01" min="0" name="apr" value="${Number(account.apr) > 0 ? account.apr : ''}" placeholder="optional"></label>
                <label class="field">Planned monthly payment ($)<input type="number" step="0.01" min="0" name="planPayment" value="${Number(account.planPayment) > 0 ? account.planPayment : ''}" placeholder="optional"></label>
                <span class="muted" style="align-self:end;font-size:0.85em;padding-bottom:8px">Used for the payoff estimate. Without a planned payment it uses your next payment.</span>
            </div>
            <div class="add-grid">
                <label class="field">Account number<input type="text" name="accountNumber" autocomplete="off" value="${esc(account.accountNumber || '')}" placeholder="optional: the last 4 digits are enough"></label>
                <label class="field">Credit limit ($)<input type="number" step="0.01" min="0" name="creditLimit" value="${Number(account.creditLimit) > 0 ? account.creditLimit : ''}" placeholder="optional"></label>
                <span class="muted" style="align-self:end;font-size:0.85em;padding-bottom:8px">Available credit = credit limit − balance now.</span>
            </div>
            <h3 class="chart-title">Payments <span class="muted" style="font-weight:400">Before and After are worked out from the balance</span></h3>
            <div class="table-wrap loan-grid"><table class="sheet-table pay-grid">
                <thead><tr><th>Date</th><th>Min payment</th><th>Payment</th><th>Made</th><th>Notes</th><th></th></tr></thead>
                <tbody>${rawPayments.map(payRow).join('')}</tbody>
            </table></div>
            <div class="row" style="margin:8px 0 16px"><button type="button" class="small" data-add-pay-row>+ Add payment row</button></div>
            <h3 class="chart-title">Activity</h3>
            <div class="table-wrap loan-grid"><table class="sheet-table act-grid">
                <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
                <tbody>${rawActivity.map(actRow).join('')}</tbody>
            </table></div>
            <div class="row" style="margin-top:8px">
                <button type="button" class="small" data-add-act-row>+ Add activity row</button>
                <span class="spacer"></span>
                <button type="button" class="small danger" data-remove-account>Remove account</button>
            </div>
            <div class="row" style="margin-top:12px">
                <button type="button" class="primary" data-save>Save changes</button>
                <button type="button" data-cancel>Cancel</button>
                <span class="muted" style="font-size:0.85em">Saves to ${esc(account.file)} and ${esc(account.activityFile)}. Close them in Excel first.</span>
            </div>`;
    };
    ed.addEventListener('click', async e => {
        if (e.target.closest('[data-add-pay-row]')) {
            const lastRow = [...ed.querySelectorAll('.pay-grid tbody tr')].at(-1);
            const v = k => lastRow?.querySelector(`[data-k="${k}"]`)?.value ?? '';
            const d = dateOf(v('date'));
            ed.querySelector('.pay-grid tbody').insertAdjacentHTML('beforeend', payRow({ date: d ? addMonths(d, 1) : new Date(), minPayment: numOf(v('minPayment')), payment: numOf(v('payment')) }));
        } else if (e.target.closest('[data-add-act-row]')) {
            ed.querySelector('.act-grid tbody').insertAdjacentHTML('beforeend', actRow({ date: new Date(), type: 'Charge' }));
        } else if (e.target.closest('[data-del]')) {
            e.target.closest('tr').remove();
        } else if (e.target.closest('[data-cancel]')) {
            editing.delete(account.id);
            rerender();
        } else if (e.target.closest('[data-remove-account]')) {
            if (!confirm(`Remove "${account.title}" from this page? Its files (${account.file}, ${account.activityFile}) stay in your folder.`)) return;
            await removeAccount(account.id);
            editing.delete(account.id);
            toast(`Removed ${account.title}`, 'ok');
            rerender();
        } else if (e.target.closest('[data-save]')) {
            const cells = (tr, k) => tr.querySelector(`[data-k="${k}"]`).value;
            const pays = [...ed.querySelectorAll('.pay-grid tbody tr')].map(tr => ({
                date: dateOf(cells(tr, 'date')), minPayment: numOf(cells(tr, 'minPayment')), payment: numOf(cells(tr, 'payment')),
                made: cells(tr, 'made') === 'Y', notes: cells(tr, 'notes'),
            })).filter(p => p.date || Number.isFinite(p.payment) || Number.isFinite(p.minPayment) || p.notes);
            const acts = [...ed.querySelectorAll('.act-grid tbody tr')].map(tr => ({
                date: dateOf(cells(tr, 'date')), description: cells(tr, 'description'), type: cells(tr, 'type'),
                amount: Math.abs(numOf(cells(tr, 'amount'))), notes: cells(tr, 'notes'),
            })).filter(a => a.date || Number.isFinite(a.amount) || a.description || a.notes);
            const title = ed.querySelector('[name=title]').value.trim();
            if (!title) { toast('The account needs a title', 'bad'); return; }
            const url = ed.querySelector('[name=url]').value;
            if (url.trim() && !cleanUrl(url)) { toast('The payment website should start with https://', 'bad'); return; }
            const openingBalance = numOf(ed.querySelector('[name=openingBalance]').value);
            const openingDate = dateOf(ed.querySelector('[name=openingDate]').value);
            try {
                await updateAccount(account.id, {
                    title, type: ed.querySelector('[name=type]').value, description: ed.querySelector('[name=description]').value, url,
                    openingBalance: Number.isFinite(openingBalance) ? openingBalance : 0, openingDate,
                    apr: numOf(ed.querySelector('[name=apr]').value), planPayment: numOf(ed.querySelector('[name=planPayment]').value),
                    accountNumber: ed.querySelector('[name=accountNumber]').value, creditLimit: numOf(ed.querySelector('[name=creditLimit]').value),
                });
                const updated = { ...account, openingBalance: Number.isFinite(openingBalance) ? openingBalance : 0, openingDate: openingDate ? isoDate(openingDate) : '' };
                await saveLedger(updated, pays, acts);
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
