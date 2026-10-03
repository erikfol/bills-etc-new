// Loan/CC: loans and credit cards you set up yourself, each with its own payments table.
import {
    loadAccounts, addAccount, updateAccount, removeAccount, moveAccount, loadPayments, loadActivity, ledger, saveLedger, estimatePayoff,
    interestModel, simulate, paymentFor, minimumOf, nextPaymentDate, plusMonths,
    ACCOUNT_TYPES, ACTIVITY_TYPES, LOANS_DIR, cleanUrl,
} from '../loans.js';
import { drawBars, drawLines } from '../charts.js';
import { esc, money, sum, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { dataTable, closeFilterMenu } from '../datatable.js';
import {
    MON, dLong, addMonths, today, axisMoney, isoDate, dateOf, numOf, card, dateCol, moneyCol, setResize, clearResize,
    sameDay, sameAmount, dupText,
} from './utilcommon.js';

let editing = new Set();
/** Loan/CC sub-tabs. An account shows on the tab its Type belongs to. */
const TABS = [
    { id: 'cards', label: 'Credit Cards', type: 'Credit card', one: 'credit card', has: a => a.type === 'Credit card',
        lead: 'Your credit cards. Each card has a payments table and an activity table (charges, interest, fees, credits); together with the opening balance they work out the balance.',
        titleHint: 'e.g. Chase Freedom', empty: 'No credit cards yet. Press <strong>+ Add credit card</strong> to set up your first one.' },
    { id: 'loans', label: 'Loans', type: 'Loan', one: 'loan', has: a => a.type !== 'Credit card',
        lead: 'Your loans: car, student, personal, mortgage. Set the opening balance to what you owe (or the original amount), the APR, and add payments as you make them; interest goes in the activity table.',
        titleHint: 'e.g. Car loan (Ally)', empty: 'No loans yet. Press <strong>+ Add loan</strong> to set one up: the amount you owe as the opening balance, the APR, and your monthly payment in the payoff planner.' },
]; // account ids being edited with unsaved changes possible
const shortDate = d => `${MON[d.getMonth()]} ${d.getDate()} ’${String(d.getFullYear()).slice(2)}`;
/** 'yyyy-m-d|12.34' for an entry with a date and amount, else null. */
const dupKeyOf = (r, amountOf) => (r.date && Number.isFinite(amountOf(r)) ? `${r.date.getFullYear()}-${r.date.getMonth()}-${r.date.getDate()}|${amountOf(r).toFixed(2)}` : null);
/** How many entries share each date + amount. */
const dupCounts = (list, amountOf) => {
    const m = new Map();
    for (const r of list) { const k = dupKeyOf(r, amountOf); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return m;
};

/** Made, Planned (date still to come) or Overdue (date has passed, not made). */
const statusOf = p => (p.made ? 'Made' : p.date && p.date > today() ? 'Planned' : 'Overdue');
const statusBadge = p => {
    const st = statusOf(p);
    return `<span class="badge ${st === 'Made' ? 'badge-ok' : st === 'Planned' ? 'badge-plan' : 'badge-over'}">${st}</span>`;
};
const MON_LONG = d => `${MON[d.getMonth()]} ${d.getFullYear()}`;
/** 38 → '3 years 2 months' */
const duration = m => { const y = Math.floor(m / 12), r = m % 12; return [y ? `${y} year${y === 1 ? '' : 's'}` : '', r ? `${r} month${r === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 months'; };
let plannerOpen = new Set(); // accounts whose planner is unfolded
const expanded = new Set(); // accounts opened (all start collapsed); kept while you move around the app
const plannerPay = new Map(); // account id → payment being tried in the planner
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
        const tab = TABS.find(t => t.id === location.hash.split('/')[1]) || TABS[0];
        const accounts = (await loadAccounts()).filter(tab.has);
        const all = await Promise.all(accounts.map(async a => {
            const rawPayments = await loadPayments(a), rawActivity = await loadActivity(a);
            // payments with Before/After worked out from the balance, for the due banner
            return { account: a, rawPayments, rawActivity, payments: ledger(a, rawPayments, rawActivity).payments };
        }));

        el.innerHTML = `
            <div class="row dash-head">
                <h1 class="page">Loan / CC</h1>
                <span class="spacer"></span>
                <button class="primary" id="acct-open">+ Add ${tab.one}</button>
            </div>
            <nav class="subnav">${TABS.map(t => `<a href="#loans/${t.id}"${t === tab ? ' class="active"' : ''}>${t.label}</a>`).join('')}</nav>
            <p class="lead">${tab.lead}</p>
            <form id="acct-form" class="add-bill" hidden style="margin-bottom:18px">
                <h3>Add a ${tab.one}</h3>
                <div class="add-grid">
                    <label class="field">Title<input type="text" name="title" required placeholder="${tab.titleHint}"></label>
                    <label class="field">Type<select name="type">${ACCOUNT_TYPES.map(t => `<option${t === tab.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
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
                    ${tab.id === 'cards' ? '<label class="field">Credit limit ($)<input type="number" step="0.01" min="0" name="creditLimit" placeholder="optional: works out available credit"></label>' : '<span></span>'}
                    <span></span>
                </div>
                <div class="row">
                    <button type="submit" class="primary">Add account</button>
                    <button type="button" id="acct-cancel">Cancel</button>
                    <span class="muted" style="font-size:0.85em">Saved in ${esc(LOANS_DIR)}/ in your bills-etc folder.</span>
                </div>
            </form>
            <div id="due"></div>
            <section id="totals" hidden></section>
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
                    accountNumber: acctForm.accountNumber.value, creditLimit: acctForm.creditLimit ? numOf(acctForm.creditLimit.value) : NaN });
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
            $('#accounts').innerHTML = `<section><p>${tab.empty}</p></section>`;
            return;
        }

        // ── One section per account ──
        renderTotals($('#totals'), all, tab);

        const redraws = [];
        all.forEach(({ account, rawPayments, rawActivity }, k) => {
            const sec = document.createElement('section');
            sec.className = 'loan';
            sec.dataset.account = account.id;
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

/**
 * Totals across every account: balance, available credit, monthly payments, when all of it is paid off, paid so far,
 * a row per account (click to open it), and which one to pay extra on first.
 */
function renderTotals(el, all, tab) {
    const rows = all.map(({ account, rawPayments, rawActivity }) => {
        const L = ledger(account, rawPayments, rawActivity);
        const P = estimatePayoff(account, L);
        const limit = Number(account.creditLimit) > 0 ? Number(account.creditLimit) : NaN;
        const paid = sum(L.payments.filter(p => p.made && Number.isFinite(p.payment)).map(p => p.payment));
        return { account, L, P, balance: L.balanceNow, limit, paid, apr: Number(account.apr) > 0 ? Number(account.apr) : NaN };
    });
    if (!rows.length) { el.hidden = true; return; }
    const owing = rows.filter(r => r.balance > 0.005);
    const balance = sum(rows.map(r => Math.max(0, r.balance)));
    const limited = rows.filter(r => Number.isFinite(r.limit));
    const limit = sum(limited.map(r => r.limit)), available = sum(limited.map(r => r.limit - r.balance));
    const used = limit > 0 ? sum(limited.map(r => Math.max(0, r.balance))) / limit : NaN;
    const monthly = sum(owing.map(r => r.P.payment).filter(Number.isFinite));
    const ok = owing.filter(r => r.P.status === 'ok');
    const unsure = owing.filter(r => r.P.status !== 'ok');
    const lastPayoff = ok.length ? ok.reduce((a, r) => (r.P.date > a.P.date ? r : a)) : null;
    const interestLeft = sum(ok.map(r => r.P.interest).filter(Number.isFinite));
    const paid = sum(rows.map(r => r.paid));
    const t0 = today();
    const dueSoon = sum(rows.flatMap(r => r.L.payments.filter(p => !p.made && p.date && p.date >= t0 && p.date - t0 <= 30 * DAY).map(amountDue)).filter(Number.isFinite));

    const usedClass = used >= 0.7 ? 'delta-bad' : used >= 0.3 ? 'badge-warn' : 'delta-good';
    const byApr = owing.filter(r => Number.isFinite(r.apr)).sort((a, b) => b.apr - a.apr);
    const tips = [];
    if (byApr.length >= 2) tips.push(`<strong>Pay-off order:</strong> after the minimums, put any extra toward <strong>${esc(byApr[0].account.title)}</strong> (${byApr[0].apr}% APR) first, then ${byApr.slice(1).map(r => `${esc(r.account.title)} (${r.apr}%)`).join(', then ')}. Paying the highest rate first saves the most interest.`);
    const noApr = owing.filter(r => !Number.isFinite(r.apr));
    if (noApr.length) tips.push(`<span class="muted">No APR set for ${noApr.map(r => esc(r.account.title)).join(', ')}: add it in Edit for better estimates${byApr.length ? ' and to place it in the pay-off order' : ''}.</span>`);
    if (unsure.length) tips.push(`<span class="muted">${unsure.map(r => esc(r.account.title)).join(', ')} ${unsure.length === 1 ? "doesn't" : "don't"} have a payoff date yet (no payment planned, or the payment doesn't cover the interest), so the debt-free date leaves ${unsure.length === 1 ? 'it' : 'them'} out.</span>`);

    el.hidden = false;
    el.innerHTML = `
        <h2>All ${tab.label.toLowerCase()} <span class="sub">${rows.length} ${tab.one}${rows.length === 1 ? '' : 's'} · click a row to open it</span></h2>
        <div class="cards kpis totals-cards">
            ${card('Total balance', money(balance), `<span class="muted">across ${owing.length} account${owing.length === 1 ? '' : 's'} with a balance</span>`, 'var(--red)')}
            ${limit > 0 ? card('Available credit', money(available), `<span class="muted">of ${esc(money(limit))} total limit · </span><span class="${usedClass}">${Math.round(used * 100)}% used</span>`, available < 0 ? 'var(--red)' : 'var(--green)') : ''}
            ${card('Monthly payments', money(monthly), `<span class="muted">${esc(money(dueSoon))} due in the next 30 days</span>`)}
            ${card('Debt-free by', lastPayoff ? MON_LONG(lastPayoff.P.date) : owing.length ? '–' : 'Now ✓',
                lastPayoff ? `<span class="muted">last one: ${esc(lastPayoff.account.title)}${interestLeft > 0.5 ? `<br>about ${esc(money(interestLeft))} interest still to pay` : ''}</span>` : `<span class="muted">${owing.length ? 'add payments to estimate' : 'nothing owed'}</span>`,
                lastPayoff || !owing.length ? 'var(--green)' : '')}
            ${card('Paid so far', money(paid), '<span class="muted">payments marked made, all accounts</span>', 'var(--green)')}
        </div>
        <div class="table-wrap"><table class="totals-table">
            <thead><tr><th>Account</th><th class="num">Balance</th><th class="num">APR</th><th class="num">Monthly payment</th><th>Payoff</th><th class="num">Interest left</th><th class="num">${tab.id === 'loans' ? 'Paid off' : 'Available'}</th></tr></thead>
            <tbody>${rows.map(r => `<tr class="totals-row" data-open="${esc(r.account.id)}">
                <td>${typeIcon(r.account.type)} <strong>${esc(r.account.title)}</strong></td>
                <td class="amt">${esc(money(r.balance))}</td>
                <td class="amt">${Number.isFinite(r.apr) ? `${r.apr}%` : '<span class="muted">–</span>'}</td>
                <td class="amt">${Number.isFinite(r.P.payment) ? esc(money(r.P.payment)) : '<span class="muted">–</span>'}</td>
                <td class="nowrap">${r.P.status === 'ok' ? esc(MON_LONG(r.P.date)) : r.P.status === 'paid' ? '<span class="delta-good">paid off</span>' : r.P.status === 'never' ? '<span class="delta-bad">not at this rate</span>' : '<span class="muted">–</span>'}</td>
                <td class="amt">${r.P.status === 'ok' && r.P.interest > 0.5 ? esc(money(r.P.interest)) : '<span class="muted">–</span>'}</td>
                <td class="amt">${tab.id === 'loans'
                    ? (r.L.opening > 0 ? `${Math.max(0, Math.round((r.L.opening - r.balance) / r.L.opening * 100))}%` : '<span class="muted">–</span>')
                    : Number.isFinite(r.limit) ? esc(money(r.limit - r.balance)) : '<span class="muted">–</span>'}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr class="total-row"><td><strong>Total</strong></td><td class="amt"><strong>${esc(money(balance))}</strong></td><td></td>
                <td class="amt"><strong>${esc(money(monthly))}</strong></td><td></td>
                <td class="amt"><strong>${interestLeft > 0.5 ? esc(money(interestLeft)) : ''}</strong></td>
                <td class="amt"><strong>${tab.id === 'loans'
                    ? (() => { const o = sum(rows.map(r => r.L.opening).filter(v => v > 0)); return o > 0 ? `${Math.max(0, Math.round((o - balance) / o * 100))}%` : ''; })()
                    : limit > 0 ? esc(money(available)) : ''}</strong></td></tr></tfoot>
        </table></div>
        ${tips.length ? `<ul class="insight-list" style="margin-top:12px">${tips.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}`;
    el.querySelectorAll('[data-open]').forEach(tr => {
        tr.onclick = () => {
            const sec = document.querySelector(`section.loan[data-account="${CSS.escape(tr.dataset.open)}"]`);
            if (!sec) return;
            if (sec.querySelector('.loan-body').hidden) sec.querySelector('.loan-head').click();
            sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
    });
}

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
    const isLoan = account.type !== 'Credit card';
    const paidOff = Number.isFinite(L.opening) && L.opening > 0 ? (L.opening - L.balanceNow) / L.opening : NaN;
    const loanCard = !isLoan || !Number.isFinite(paidOff) ? '' : card('Paid off', `${Math.max(0, Math.round(paidOff * 100))}%`,
        `<div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, Math.max(0, paidOff * 100)).toFixed(1)}%"></div></div>`
        + `<span class="muted">${esc(money(Math.max(0, L.opening - L.balanceNow)))} of ${esc(money(L.opening))}</span>`, 'var(--green)');
    const creditCard = isLoan ? loanCard : !(limit > 0) ? '' : card('Available credit', money(limit - L.balanceNow),
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
        <h2 class="loan-head" title="Click to ${expanded.has(account.id) ? 'collapse' : 'expand'}">
            <span class="loan-chevron" aria-hidden="true">${expanded.has(account.id) ? '▾' : '▸'}</span>
            ${typeIcon(account.type)} ${esc(account.title)} <span class="badge badge-neutral">${esc(account.type)}</span>
            ${account.accountNumber ? `<span class="acct-num" title="Account number"><span class="acct-num-text">${esc(maskNumber(account.accountNumber))}</span>${maskNumber(account.accountNumber) !== account.accountNumber.replace(/\s+/g, '') ? ' <button type="button" class="small acct-num-toggle">show</button>' : ''}</span>` : ''}
            <span class="spacer"></span>
            ${account.url ? `<a class="ext-link" href="${esc(account.url)}" target="_blank" rel="noopener" title="${esc(account.url)}">Make a payment ↗</a>` : ''}
            <button type="button" class="small" data-move="-1" title="Move up"${first ? ' disabled' : ''}>▲</button>
            <button type="button" class="small" data-move="1" title="Move down"${last ? ' disabled' : ''}>▼</button>
            <button type="button" class="small" data-edit>✎ Edit</button></h2>
        <div class="loan-summary">
            <span>Balance <strong>${esc(money(L.balanceNow))}</strong></span>
            ${next && Number.isFinite(amountDue(next)) ? `<span>Next <strong>${esc(money(amountDue(next)))}</strong>${next.date ? ` ${next.date < today() ? 'was due' : 'due'} ${esc(dLong(next.date))}` : ''}</span>` : ''}
            ${P.status === 'ok' ? `<span>Payoff <strong>${esc(MON_LONG(P.date))}</strong></span>` : P.status === 'paid' ? '<span class="delta-good">Paid off ✓</span>' : ''}
            ${Number(account.creditLimit) > 0 ? `<span>Available <strong>${esc(money(account.creditLimit - L.balanceNow))}</strong></span>` : ''}
        </div>
        <div class="loan-body"${expanded.has(account.id) ? '' : ' hidden'}>
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
                ${card('Interest &amp; fees', money(interestFees),
                    `<span class="muted">${Number(account.apr) > 0 ? `<strong>${esc(String(account.apr))}% APR</strong>` : 'APR not set: add it in Edit'}<br>`
                    + `${activity.length} activity entr${activity.length === 1 ? 'y' : 'ies'}</span>`)}
            </div>
            ${L.points.length > 1 ? '<h3 class="chart-title">Balance over time</h3><canvas class="c-bal" style="display:block;width:100%;height:200px;margin-bottom:14px"></canvas>' : ''}
            <div class="insights"></div>
            <details class="planner"${plannerOpen.has(account.id) ? ' open' : ''}>
                <summary>📉 Payoff planner and burn-down</summary>
                <div class="planner-body"></div>
            </details>
            <div class="loan-tables">
                <div>
                    <h3 class="chart-title">Payments</h3>
                    <div class="t-pay short-table"></div>
                    ${payments.some(p => p.projected) ? `<p class="note" style="margin-top:6px">Planned payments show the balance as if each one before it is made, with a month's interest each: ${esc(P.model?.text || interestModel(account, L).text)}.</p>` : ''}
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
        <div class="edit-mode" hidden></div>
        </div>`;
    sec.classList.toggle('collapsed', !expanded.has(account.id));

    // ── Collapse / expand: click the header (not its buttons or links) ──
    const setOpen = open => {
        open ? expanded.add(account.id) : expanded.delete(account.id);
        $('.loan-body').hidden = !open;
        sec.classList.toggle('collapsed', !open);
        $('.loan-chevron').textContent = open ? '▾' : '▸';
        $('.loan-head').title = `Click to ${open ? 'collapse' : 'expand'}`;
        if (open) requestAnimationFrame(() => redrawAll());
    };
    $('.loan-head').addEventListener('click', e => {
        if (e.target.closest('button, a')) return;
        setOpen($('.loan-body').hidden);
    });

    // ── Read-only tables ──
    dataTable($('.t-pay'), {
        columns: [
            dateCol('date', 'Date', p => p.date),
            moneyCol('min', 'Min', p => p.minPayment),
            moneyCol('payment', 'Payment', p => p.payment),
            moneyCol('before', 'Before', p => p.before),
            { ...moneyCol('after', 'After', p => p.after), tdClass: p => `nowrap${p.made ? '' : ' muted'}` },
            { id: 'made', label: 'Status', value: statusOf, cell: statusBadge },
            { id: 'notes', label: 'Notes', value: p => p.notes, tdClass: () => 'note-text' },
        ],
        rows: payments,
        sort: { col: 'date', dir: 'desc' },
        rowClass: p => (statusOf(p) === 'Planned' ? 'planned-row' : ''),
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
        const amt = Number.isFinite(payment) ? payment : minPayment;
        if (rawPayments.some(p => sameDay(p.date, date) && sameAmount(Number.isFinite(p.payment) ? p.payment : p.minPayment, amt))) { toast(dupText(date, amt, 'a payment on'), 'bad'); return; }
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
        if (rawActivity.some(a => sameDay(a.date, date) && sameAmount(a.amount, Math.abs(amount)))) { toast(dupText(date, Math.abs(amount), 'activity on'), 'bad'); return; }
        try {
            await save(strip(rawPayments), [...strip(rawActivity), { date, type: af.type.value, amount: Math.abs(amount), description: af.description.value, notes: af.notes.value }]);
            toast(`Added ${af.type.value.toLowerCase()} of ${money(Math.abs(amount))} to ${account.title}`, 'ok');
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
        }
    };

    // ── Insights and the payoff planner ──
    const drawPlanner = renderPlanner(sec, account, L, P, rerender, { rawPayments, rawActivity, save, strip });

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
        setOpen(true);
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
            // A date and amount that now appears more often than it did before editing: a duplicate entry.
            // (Duplicates already in the file don't block saving other changes; the insights point them out.)
            const firstDup = (list, before, amountOf, what) => {
                const was = dupCounts(before, amountOf), now = dupCounts(list, amountOf);
                for (const [k, n] of now) if (n > 1 && n > (was.get(k) || 0)) { const x = list.find(r => dupKeyOf(r, amountOf) === k); return dupText(x.date, amountOf(x), what); }
                return null;
            };
            const payAmt = p => (Number.isFinite(p.payment) ? p.payment : p.minPayment);
            const dup = firstDup(pays, rawPayments, payAmt, 'a payment on') || firstDup(acts, rawActivity, a => a.amount, 'activity on');
            if (dup) { toast(dup, 'bad'); return; }
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

    function redrawAll() { draw(); drawPlanner(); }
    return redrawAll;
}

/**
 * Insights (a few plain sentences) and the planner: try a monthly payment or a payoff month, see the burn-down
 * (actual balance so far, your plan, minimum only), compare scenarios, and save a payment as the planned one.
 * Returns the burn-down redraw.
 */
function renderPlanner(sec, account, L, P, rerender, { rawPayments, rawActivity, save, strip }) {
    const $ = s => sec.querySelector(s);
    const model = interestModel(account, L);
    const balance = L.balanceNow, minimum = minimumOf(L), start = nextPaymentDate(L);
    const limit = Number(account.creditLimit);
    const overdue = L.payments.filter(p => statusOf(p) === 'Overdue');
    const sim = pay => simulate(balance, pay, model);
    const payoffMonth = s => MON_LONG(plusMonths(start, s.months - 1));

    // ── Insights ──
    const tips = [];
    if (!(balance > 0.005)) tips.push('🎉 <strong>Paid off.</strong> The balance is zero.');
    else {
        if (P.status === 'ok') {
            tips.push(`At <strong>${esc(money(P.payment))}</strong> a month (${esc(P.basis)}) you'll be debt-free by <strong>${esc(MON_LONG(P.date))}</strong>, after ${P.months} payment${P.months === 1 ? '' : 's'}${P.interest > 0.5 ? ` and about <strong>${esc(money(P.interest))}</strong> in interest` : ''}.`);
            const more = sim(P.payment + 50);
            if (more.status === 'ok' && more.months < P.months) {
                const saved = P.interest - more.interest;
                tips.push(`Paying $50 more (${esc(money(P.payment + 50))}) finishes ${duration(P.months - more.months)} sooner${saved > 0.5 ? ` and saves about ${esc(money(saved))} in interest` : ''}.`);
            }
        } else if (P.status === 'never') {
            tips.push(`<span class="delta-bad">At ${esc(money(P.payment))} a month the balance never goes down</span>: the interest is about ${esc(money(P.monthlyInterest))} a month. Try a bigger payment in the planner below.`);
        }
        if (Number.isFinite(minimum) && !(P.status === 'ok' && minimum >= P.payment)) {
            const m = sim(minimum);
            tips.push(m.status === 'ok'
                ? `Paying only the ${esc(money(minimum))} minimum would take ${duration(m.months)}${m.interest > 0.5 ? ` and cost about ${esc(money(m.interest))} in interest` : ''}.`
                : `Paying only the ${esc(money(minimum))} minimum wouldn't pay it off at this interest.`);
        }
        const firstInterest = model.rate ? balance * model.rate : model.flat;
        if (firstInterest > 0.005 && P.payment > 0) tips.push(`About ${esc(money(firstInterest))} of your next payment goes to interest (${Math.round(firstInterest / P.payment * 100)}%).`);
        if (limit > 0) {
            const used = balance / limit;
            tips.push(`You're using ${Math.round(used * 100)}% of your ${esc(money(limit))} limit${used > 0.3 ? `; getting it under 30% (below ${esc(money(limit * 0.3))}) is better for your credit score` : ', under the 30% that helps your credit score'}.`);
        }
        if (!(Number(account.apr) > 0)) tips.push(`<span class="muted">Add the APR in Edit to make these estimates more accurate (now: ${esc(model.text)}).</span>`);
    }
    const dupsIn = (list, amountOf, what) => [...dupCounts(list, amountOf)].filter(([, n]) => n > 1).map(([k, n]) => {
        const x = list.find(r => dupKeyOf(r, amountOf) === k);
        return `${what} ${esc(money(amountOf(x)))} on ${esc(dLong(x.date))}${x.description ? ` (${esc(x.description)})` : ''} appears ${n} times`;
    });
    const dupNotes = [...dupsIn(L.payments, p => (Number.isFinite(p.payment) ? p.payment : p.minPayment), 'A payment of'), ...dupsIn(L.activity, a => a.amount, 'Activity of')];
    if (dupNotes.length) tips.push(`<span class="delta-bad">Possible duplicate entr${dupNotes.length === 1 ? 'y' : 'ies'}:</span> ${dupNotes.join('; ')}. If one is a mistake, remove it in Edit.`);
    if (overdue.length) tips.push(`<span class="delta-bad">${overdue.length} payment${overdue.length === 1 ? ' is' : 's are'} past ${overdue.length === 1 ? 'its' : 'their'} date and not marked made</span> (${overdue.map(p => esc(dLong(p.date))).join(', ')}).`);
    $('.insights').innerHTML = tips.length ? `<h3 class="chart-title">Insights</h3><ul class="insight-list">${tips.map(t => `<li>${t}</li>`).join('')}</ul>` : '';

    const details = $('.planner'), body = $('.planner-body');
    details.ontoggle = () => { details.open ? plannerOpen.add(account.id) : plannerOpen.delete(account.id); if (details.open) requestAnimationFrame(drawBurn); };
    if (!(balance > 0.005)) { body.innerHTML = '<p class="muted">Nothing to plan: the balance is zero.</p>'; return () => {}; }

    const basePay = P.payment > 0 ? P.payment : Number.isFinite(minimum) ? minimum : Math.max(25, Math.ceil(balance / 24));
    const floor = Math.ceil((model.rate ? balance * model.rate : model.flat) + 1);
    const maxPay = Math.max(Math.ceil(balance * 1.02 + floor), Math.ceil(basePay * 3));
    body.innerHTML = `
        <div class="row planner-controls">
            <label class="field">Monthly payment ($)<input type="number" name="pay" min="${floor}" step="1"></label>
            <input type="range" name="payRange" min="${Math.max(1, floor)}" max="${maxPay}" step="1" aria-label="Monthly payment">
            <label class="field">…or paid off by<input type="month" name="target"></label>
            <span class="spacer"></span>
            <button type="button" class="small primary" data-use-plan title="Sets this as the planned monthly payment and fills in the planned payments until payoff">Use as my planned payment</button>
        </div>
        <p class="planner-result"></p>
        <div class="chart-legend">
            <span><span class="legend-dot" style="background:#1a1a2e"></span>Actual balance</span>
            <span><span class="legend-dot" style="background:#4a90d9"></span>Your plan</span>
            ${Number.isFinite(minimum) ? '<span><span class="legend-line" style="border-top-color:#b0b8c8"></span>Minimum only</span>' : ''}
        </div>
        <canvas class="c-burn" style="display:block;width:100%;height:260px"></canvas>
        <h3 class="chart-title" style="margin-top:14px">Scenarios <span class="muted" style="font-weight:400">click one to try it</span></h3>
        <div class="table-wrap"><table class="scen-table"><thead><tr>
            <th>Monthly payment</th><th>Paid off</th><th class="num">Payments</th><th class="num">Total interest</th><th class="num">Saved vs minimum</th>
        </tr></thead><tbody></tbody></table></div>
        <p class="note">Estimates assume no new charges, ${esc(model.text)}, and payments starting ${esc(dLong(start))}.</p>`;
    const payIn = body.querySelector('[name=pay]'), range = body.querySelector('[name=payRange]'), target = body.querySelector('[name=target]');

    // Actual balance at the end of each month so far (from the ledger), then "Now".
    const monthKey = d => d.getFullYear() * 12 + d.getMonth();
    const nowKey = monthKey(today());
    const firstKey = L.points.length ? Math.min(...L.points.map(p => monthKey(p.date))) : nowKey;
    const history = [];
    for (let k = firstKey; k < nowKey; k++) {
        const end = new Date(Math.floor(k / 12), (k % 12) + 1, 0);
        const before = L.points.filter(p => p.date <= end);
        if (before.length) history.push({ label: `${MON[k % 12]} ’${String(Math.floor(k / 12)).slice(2)}`, value: before.at(-1).balance });
    }
    let current = basePay;
    const drawBurn = () => {
        const c = body.querySelector('.c-burn');
        if (!details.open || !c) return;
        const plan = sim(current), minS = Number.isFinite(minimum) ? sim(minimum) : null;
        const planLen = plan.status === 'ok' ? plan.months : 120;
        const minLen = minS ? (minS.status === 'ok' ? minS.months : 120) : 0;
        const len = Math.max(planLen, Math.min(minLen, Math.max(planLen * 2, 60), 240));
        const months = Array.from({ length: len }, (_, k) => plusMonths(start, k));
        const labels = [...history.map(h => h.label), 'Now', ...months.map(d => `${MON[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`)];
        const H = history.length;
        const proj = s => [...Array(H).fill(NaN), balance, ...months.map((_, k) => (k < s.balances.length ? s.balances[k] : s.status === 'ok' ? NaN : NaN))];
        drawLines(c, {
            labels,
            series: [
                { name: 'Actual balance', values: [...history.map(h => h.value), balance, ...months.map(() => NaN)], color: '#1a1a2e', width: 2.5 },
                ...(minS ? [{ name: `Minimum only (${money(minimum)})`, values: proj(minS), color: '#b0b8c8', dash: [6, 4] }] : []),
                { name: `Your plan (${money(current)})`, values: proj(plan), color: '#4a90d9', width: 2.5 },
            ],
            fmt: v => '$' + Math.round(v).toLocaleString('en-US'), tipFmt: money, markIndex: H,
            tipHead: i => (i === H ? `Now · ${dLong(today())}` : i > H ? `Payment ${i - H} · ${dLong(months[i - H - 1])}` : labels[i]),
        });
    };
    const update = (pay, from) => {
        current = Math.max(1, Math.round(pay * 100) / 100);
        plannerPay.set(account.id, current);
        if (from !== 'pay') payIn.value = current.toFixed(2);
        if (from !== 'range') range.value = Math.round(current);
        const s = sim(current);
        if (from !== 'target') target.value = s.status === 'ok' ? (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)(plusMonths(start, s.months - 1)) : '';
        const base = sim(basePay);
        body.querySelector('.planner-result').innerHTML = s.status === 'ok'
            ? `<strong>${esc(money(current))}</strong> a month → debt-free by <strong>${esc(payoffMonth(s))}</strong> · ${s.months} payment${s.months === 1 ? '' : 's'}`
                + `${s.interest > 0.5 ? ` · about ${esc(money(s.interest))} interest` : ''}`
                + (base.status === 'ok' && Math.abs(current - basePay) >= 0.01
                    ? ` <span class="${s.months < base.months ? 'delta-good' : 'delta-bad'}">(${s.months === base.months ? 'same finish' : `${duration(Math.abs(base.months - s.months))} ${s.months < base.months ? 'sooner' : 'later'}`}${Math.abs(base.interest - s.interest) > 0.5 ? `, ${esc(money(Math.abs(base.interest - s.interest)))} ${s.interest < base.interest ? 'less' : 'more'} interest` : ''} than ${esc(money(basePay))})</span>` : '')
            : `<span class="delta-bad">${esc(money(current))} a month doesn't cover the interest (about ${esc(money(s.monthlyInterest))}), so the balance never goes down.</span>`;
        drawBurn();
    };
    payIn.oninput = () => { const v = numOf(payIn.value); if (v > 0) update(v, 'pay'); };
    range.oninput = () => update(+range.value, 'range');
    target.oninput = () => {
        const m = target.value.match(/^(\d{4})-(\d{2})$/);
        if (!m) return;
        const months = (+m[1] * 12 + (+m[2] - 1)) - (start.getFullYear() * 12 + start.getMonth()) + 1;
        if (months < 1) { toast('Pick a month after the next payment', 'bad'); return; }
        update(Math.ceil(paymentFor(balance, months, model) * 100) / 100, 'target');
    };
    // "Use as my planned payment": the planned monthly payment, and planned rows in Payments month by month until
    // payoff. Future planned rows are updated, missing months added, the last one is just what's left, and planned rows
    // after payoff are removed. Made and overdue payments are never touched.
    const buildPlan = pay => {
        const s = sim(pay);
        if (s.status !== 'ok') return null;
        const t0 = today();
        const future = rawPayments.filter(p => !p.made && p.date && p.date > t0).sort((a, b) => a.date - b.date);
        const others = rawPayments.filter(p => !future.includes(p));
        let first = future[0]?.date || nextPaymentDate(L);
        while (first <= t0) first = plusMonths(first, 1);
        const lastFuture = future.at(-1)?.date || null;
        const rows = [];
        let bal = balance;
        for (let k = 0; k < s.months; k++) {
            const date = k < future.length ? future[k].date : lastFuture ? plusMonths(lastFuture, k - future.length + 1) : plusMonths(first, k);
            const r2 = n => Math.round(n * 100) / 100; // same rounding as the Payments table
            const owed = r2(bal + (model.rate ? r2(bal * model.rate) : model.flat));
            const amount = k === s.months - 1 ? Math.round(owed * 100) / 100 : pay;
            rows.push({ date, minPayment: future[k]?.minPayment ?? minimum, payment: Math.min(pay, amount), made: false, notes: future[k]?.notes || '' });
            bal = owed - Math.min(pay, amount);
        }
        return {
            rows: [...strip(others), ...rows], months: s.months, first: rows[0].date, last: rows.at(-1),
            updated: Math.min(s.months, future.length), added: Math.max(0, s.months - future.length), removed: Math.max(0, future.length - s.months),
        };
    };
    body.querySelector('[data-use-plan]').onclick = async () => {
        const plan = buildPlan(current);
        if (!plan) { toast(`${money(current)} a month doesn't cover the interest, so there's no payoff to plan`, 'bad'); return; }
        const changes = [plan.updated && `update ${plan.updated} planned payment${plan.updated === 1 ? '' : 's'}`,
            plan.added && `add ${plan.added}`, plan.removed && `remove ${plan.removed} planned after the payoff`].filter(Boolean).join(', ');
        if (!confirm(`Plan ${money(current)} a month for ${account.title}?\n\n`
            + `${plan.months} payment${plan.months === 1 ? '' : 's'} from ${dLong(plan.first)} to ${dLong(plan.last.date)} (the last one ${money(plan.last.payment)}).\n`
            + `This will ${changes} in the Payments table. Made and overdue payments aren't changed.`)) return;
        try {
            await updateAccount(account.id, { planPayment: current });
            account.planPayment = current;
            plannerPay.delete(account.id);
            toast(`${account.title}: ${plan.months} planned payments of ${money(current)} added`, 'ok');
            await save(plan.rows, strip(rawActivity));
        } catch (err) {
            toast(`Save failed: ${err.message}. Is the file open in Excel?`, 'bad');
        }
    };

    // ── Scenarios ──
    const pays = [...new Set([minimum, basePay, basePay + 25, basePay + 50, basePay + 100, basePay * 2]
        .filter(v => Number.isFinite(v) && v > 0).map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);
    const minSim = Number.isFinite(minimum) ? sim(minimum) : null;
    body.querySelector('.scen-table tbody').innerHTML = pays.map(v => {
        const s = sim(v);
        const tag = v === minimum ? ' <span class="badge badge-neutral">minimum</span>' : v === basePay ? ' <span class="badge badge-plan">current</span>' : '';
        const saved = minSim?.status === 'ok' && s.status === 'ok' ? minSim.interest - s.interest : NaN;
        return `<tr data-pay="${v}" class="scen-row">
            <td class="nowrap"><strong>${esc(money(v))}</strong>${tag}</td>
            <td class="nowrap">${s.status === 'ok' ? esc(payoffMonth(s)) : '<span class="delta-bad">never</span>'}</td>
            <td class="amt">${s.status === 'ok' ? `${s.months} <span class="muted">(${duration(s.months)})</span>` : '–'}</td>
            <td class="amt">${s.status === 'ok' ? esc(money(s.interest)) : '–'}</td>
            <td class="amt">${saved > 0.5 ? `<span class="delta-good">${esc(money(saved))}</span>` : minSim && minSim.status !== 'ok' && s.status === 'ok' ? '<span class="delta-good">pays it off</span>' : '–'}</td>
        </tr>`;
    }).join('');
    body.querySelectorAll('.scen-row').forEach(tr => { tr.onclick = () => update(+tr.dataset.pay); });

    update(plannerPay.get(account.id) || basePay);
    return drawBurn;
}
