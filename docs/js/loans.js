// Loans and credit cards you set up yourself. The list of accounts is kept in inputs/loans_cc/accounts.json
// ({id, title, description, type, url, openingBalance, openingDate, file, activityFile}). Each account has two CSVs
// next to it so they open in Excel too:
//   payments  <id>.csv           Date, Min Payment, Payment, Before, After, Payment Made, Notes
//   activity  <id>-activity.csv  Date, Description, Type, Amount, Notes   (charges, interest, fees, credits)
// The balance is a running ledger: opening balance + activity − payments made, in date order. Before / After are
// worked out from it (and written to the payments CSV so Excel shows them too).
// Loans (type 'Loan') also keep their terms (original amount, first payment, term, rate, monthly payment, escrow,
// due day) and their payments CSV has Interest / Escrow / Principal columns: each payment pays the month's interest
// (from your statement if you type it in, else balance × APR ÷ 12) and any escrow first; the rest is principal.
import * as fs from './fs.js';
import { parseCSV, toCSV } from './csv.js';
import { parseBillDate, parseMoney, sheetDate } from './sheet.js';

export const LOANS_DIR = 'inputs/loans_cc';
const INDEX = `${LOANS_DIR}/accounts.json`;
export const PAYMENT_COLS = ['Date', 'Min Payment', 'Payment', 'Before', 'After', 'Payment Made', 'Notes'];
export const ACTIVITY_COLS = ['Date', 'Description', 'Type', 'Amount', 'Notes'];
export const LOAN_PAYMENT_COLS = ['Date', 'Payment', 'Interest', 'Escrow', 'Principal', 'Before', 'After', 'Payment Made', 'Notes'];
export const ACCOUNT_TYPES = ['Loan', 'Credit card', 'Other'];
export const LOAN_KINDS = ['Mortgage', 'Auto', 'Personal', 'Student', 'Timeshare', 'Solar / energy', 'Home equity', 'Other'];
export const isLoan = a => a?.type === 'Loan';
// Loan details kept in accounts.json (numbers > 0, or null).
const LOAN_NUMBERS = ['originalAmount', 'termMonths', 'payment', 'escrow', 'dueDay'];
/** Activity types; `sign` is how each one moves the balance. */
export const ACTIVITY_TYPES = [
    { type: 'Charge', sign: 1 },
    { type: 'Interest', sign: 1 },
    { type: 'Fee', sign: 1 },
    { type: 'Credit/refund', sign: -1 },
];
const signOf = type => ACTIVITY_TYPES.find(t => t.type.toLowerCase() === String(type).trim().toLowerCase())?.sign ?? 1;

const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const moneyCell = n => (Number.isFinite(n) ? round2(n).toFixed(2) : '');
const byDate = (a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity);
const activityFileOf = a => a.activityFile || a.file.replace(/\.csv$/i, '') + '-activity.csv';

/** Accounts in the order you set them up. [] if none yet. */
export async function loadAccounts() {
    const text = await fs.readText(INDEX);
    if (text == null) return [];
    const data = JSON.parse(text);
    return (Array.isArray(data.accounts) ? data.accounts : []).map(a => ({ ...a, activityFile: activityFileOf(a) }));
}

async function saveAccounts(accounts) {
    await fs.writeText(INDEX, JSON.stringify({
        _readme: 'Loans and credit cards for the Loan/CC page. Payments are in the CSV named by "file", charges/interest/fees/credits in "activityFile".',
        accounts,
    }, null, 2) + '\n');
}

/** 'Car Loan (Ally)' → 'car-loan-ally', unique among the existing ids. */
function slug(title, taken) {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'account';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
}

/** 'chase.com/pay' → 'https://chase.com/pay'; '' stays ''. Only http(s) links are kept. */
export function cleanUrl(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return /^https?:\/\//i.test(u) ? u : '';
}

/** Add an account and create its empty payments and activity files. Returns the new account. */
export async function addAccount({ title, description, type, url, openingBalance, openingDate, apr, accountNumber, creditLimit, loan = null }) {
    const accounts = await loadAccounts();
    const id = slug(title, new Set(accounts.map(a => a.id)));
    const account = {
        id, title: title.trim(), description: (description || '').trim(), type: type || 'Other', url: cleanUrl(url),
        openingBalance: Number.isFinite(openingBalance) ? round2(openingBalance) : 0,
        openingDate: openingDate ? sheetDate(openingDate, false) : '',
        apr: Number.isFinite(apr) && apr > 0 ? apr : null,
        accountNumber: String(accountNumber || '').trim(),
        creditLimit: Number.isFinite(creditLimit) && creditLimit > 0 ? round2(creditLimit) : null,
        file: `${LOANS_DIR}/${id}.csv`, activityFile: `${LOANS_DIR}/${id}-activity.csv`,
    };
    if (loan) Object.assign(account, cleanLoan(loan));
    if ((await fs.readText(account.file)) == null) await fs.writeText(account.file, toCSV(isLoan(account) ? LOAN_PAYMENT_COLS : PAYMENT_COLS, []));
    if ((await fs.readText(account.activityFile)) == null) await fs.writeText(account.activityFile, toCSV(ACTIVITY_COLS, []));
    accounts.push(account);
    await saveAccounts(accounts);
    return account;
}

/** Loan details from a form: {lender, kind, originalAmount, firstPayment (Date), termMonths, payment, escrow, dueDay}. */
function cleanLoan(l) {
    const out = { lender: String(l.lender || '').trim(), loanKind: LOAN_KINDS.includes(l.kind) ? l.kind : 'Other' };
    for (const k of LOAN_NUMBERS) out[k] = Number.isFinite(l[k]) && l[k] > 0 ? (k === 'termMonths' || k === 'dueDay' ? Math.round(l[k]) : round2(l[k])) : null;
    if (out.dueDay) out.dueDay = Math.min(31, out.dueDay);
    out.firstPayment = l.firstPayment ? sheetDate(l.firstPayment, false) : '';
    return out;
}

/** Change an account's title / description / type / url / opening balance (its files stay the same). */
export async function updateAccount(id, changes) {
    const accounts = await loadAccounts();
    const a = accounts.find(x => x.id === id);
    if (!a) throw new Error('That account is no longer in accounts.json');
    for (const k of ['title', 'description', 'type']) if (changes[k] != null) a[k] = String(changes[k]).trim();
    if (changes.url != null) a.url = cleanUrl(changes.url);
    if ('openingBalance' in changes) a.openingBalance = Number.isFinite(changes.openingBalance) ? round2(changes.openingBalance) : 0;
    if ('openingDate' in changes) a.openingDate = changes.openingDate ? sheetDate(changes.openingDate, false) : '';
    for (const k of ['apr', 'planPayment', 'creditLimit']) if (k in changes) a[k] = Number.isFinite(changes[k]) && changes[k] > 0 ? changes[k] : null;
    if (changes.accountNumber != null) a.accountNumber = String(changes.accountNumber).trim();
    if (changes.loan) Object.assign(a, cleanLoan(changes.loan));
    await saveAccounts(accounts);
}

/** Take an account off the page. Its CSVs are left in the folder, so nothing is lost. */
export async function removeAccount(id) {
    await saveAccounts((await loadAccounts()).filter(a => a.id !== id));
}

/** Move an account up (-1) or down (+1) the page. */
export async function moveAccount(id, dir) {
    const accounts = await loadAccounts();
    const k = accounts.findIndex(a => a.id === id), j = k + dir;
    if (k < 0 || j < 0 || j >= accounts.length) return;
    [accounts[k], accounts[j]] = [accounts[j], accounts[k]];
    await saveAccounts(accounts);
}

async function readRows(path) {
    const text = await fs.readText(path);
    if (text == null) return [];
    const { rows } = parseCSV(text);
    const get = (r, name) => r[Object.keys(r).find(k => k.trim().toLowerCase() === name.toLowerCase())] ?? '';
    return rows.map(r => name => get(r, name));
}

/** Payments, oldest first: {date, minPayment, payment, before, after, made, notes} (before/after as stored). */
export async function loadPayments(account) {
    return (await readRows(account.file)).map(get => ({
        date: parseBillDate(get('Date')),
        minPayment: parseMoney(get('Min Payment')),
        payment: parseMoney(get('Payment')),
        before: parseMoney(get('Before')),
        after: parseMoney(get('After')),
        made: /^y/i.test(String(get('Payment Made')).trim()),
        notes: String(get('Notes')).trim(),
        // Loans: interest / escrow you typed in from the statement (blank = worked out).
        interest: parseMoney(get('Interest')),
        escrow: parseMoney(get('Escrow')),
    })).sort(byDate);
}

/** Activity, oldest first: {date, description, type, amount, notes}. */
export async function loadActivity(account) {
    return (await readRows(account.activityFile)).map(get => ({
        date: parseBillDate(get('Date')),
        description: String(get('Description')).trim(),
        type: String(get('Type')).trim() || 'Charge',
        amount: parseMoney(get('Amount')),
        notes: String(get('Notes')).trim(),
    })).sort(byDate);
}

/**
 * The running balance. Opening balance (or, for accounts set up before it existed, the first payment's stored Before),
 * then every activity entry and every payment that's been made, in date order (activity first on the same day).
 * Returns { opening, openingDate, payments (with before/after worked out; after is projected for ones not made yet),
 * activity (with balance), points [{date, balance, what}], balanceNow }.
 */
export function ledger(account, payments, activity) {
    if (isLoan(account)) return loanLedger(account, payments, activity);
    let opening = Number.isFinite(account.openingBalance) ? account.openingBalance : NaN;
    let openingDate = parseBillDate(account.openingDate);
    if (!Number.isFinite(opening)) {
        const first = payments.find(p => Number.isFinite(p.before));
        opening = first ? first.before : 0;
        openingDate = openingDate || first?.date || null;
    }
    const events = [
        ...activity.map(a => ({ kind: 'activity', date: a.date, item: a })),
        ...payments.map(p => ({ kind: 'payment', date: p.date, item: p })),
    ].sort((x, y) => byDate(x, y) || (x.kind === y.kind ? 0 : x.kind === 'activity' ? -1 : 1));
    let bal = opening;
    // Payments not made yet are projected one after another, as if each earlier one had been made, with a month's
    // interest before each, the same way the payoff planner works (see interestModel): at the APR, or without one the
    // interest and fees recorded in the last three months. `planned` is their running effect.
    const rate = Number(account.apr) > 0 ? account.apr / 100 / 12 : 0;
    const since = plusMonths(new Date(), -3);
    const flat = rate ? 0 : activity.filter(a => a.date && a.date >= since && /^(interest|fee)$/i.test(a.type) && Number.isFinite(a.amount))
        .reduce((t, a) => t + a.amount, 0) / 3;
    let planned = 0;
    // The opening point sits at the opening date, or at the first entry if something is dated before it.
    const firstDate = events.find(e => e.date)?.date;
    const openAt = openingDate && firstDate ? (firstDate < openingDate ? firstDate : openingDate) : openingDate || firstDate;
    const points = openAt ? [{ date: openAt, balance: round2(bal), what: 'Opening balance' }] : [];
    const outPayments = [], outActivity = [];
    for (const e of events) {
        if (e.kind === 'activity') {
            const a = e.item, amt = Number.isFinite(a.amount) ? a.amount * signOf(a.type) : 0;
            bal = round2(bal + amt);
            outActivity.push({ ...a, signed: amt, balance: bal });
            if (a.date) points.push({ date: a.date, balance: bal, what: `${a.type}: ${a.description || ''}`.trim() });
        } else {
            const p = e.item, pay = Number.isFinite(p.payment) ? p.payment : 0;
            if (!p.made) {
                const start = Math.max(0, bal + planned), interest = start > 0.005 ? round2(rate ? start * rate : flat) : 0;
                const amount = Number.isFinite(p.payment) ? pay : Number.isFinite(p.minPayment) ? p.minPayment : 0;
                const before = round2(start + interest), after = round2(before - amount);
                planned = round2(planned + interest - amount);
                outPayments.push({ ...p, before, after, projected: true, interest });
                continue;
            }
            const before = bal, after = round2(bal - pay);
            outPayments.push({ ...p, before, after });
            if (p.made) {
                bal = round2(bal - pay);
                if (p.date) points.push({ date: p.date, balance: bal, what: 'Payment' });
            }
        }
    }
    return { opening, openingDate, payments: outPayments.sort(byDate), activity: outActivity.sort(byDate), points, balanceNow: bal };
}

/** Write an account's whole payments table, oldest first. Before / After come from ledger(). */
export async function savePayments(account, payments) {
    if (isLoan(account)) {
        const rows = [...payments].sort(byDate).map(p => ({
            Date: p.date ? sheetDate(p.date, false) : '',
            Payment: moneyCell(p.payment),
            Interest: p.interestTyped ? moneyCell(p.interest) : '',
            Escrow: p.escrowTyped ? moneyCell(p.escrow) : '',
            Principal: moneyCell(p.principal),
            Before: moneyCell(p.before),
            After: moneyCell(p.after),
            'Payment Made': p.made ? 'Y' : 'N',
            Notes: String(p.notes || '').replace(/[\r\n]+/g, ' ').trim(),
        }));
        await fs.writeText(account.file, toCSV(LOAN_PAYMENT_COLS, rows));
        return;
    }
    const rows = [...payments].sort(byDate).map(p => ({
        Date: p.date ? sheetDate(p.date, false) : '',
        'Min Payment': moneyCell(p.minPayment),
        Payment: moneyCell(p.payment),
        Before: moneyCell(p.before),
        After: moneyCell(p.after),
        'Payment Made': p.made ? 'Y' : 'N',
        Notes: String(p.notes || '').replace(/[\r\n]+/g, ' ').trim(),
    }));
    await fs.writeText(account.file, toCSV(PAYMENT_COLS, rows));
}

/** Write an account's whole activity table, oldest first. */
export async function saveActivity(account, activity) {
    const rows = [...activity].sort(byDate).map(a => ({
        Date: a.date ? sheetDate(a.date, false) : '',
        Description: String(a.description || '').replace(/[\r\n]+/g, ' ').trim(),
        Type: a.type || 'Charge',
        Amount: moneyCell(a.amount),
        Notes: String(a.notes || '').replace(/[\r\n]+/g, ' ').trim(),
    }));
    await fs.writeText(account.activityFile, toCSV(ACTIVITY_COLS, rows));
}

/**
 * Save both tables after a change, with Before / After worked out again from the ledger so the payments CSV agrees
 * with the page. `account` must already carry the opening balance to use.
 */
export async function saveLedger(account, payments, activity) {
    const L = ledger(account, payments, activity);
    // Accounts set up before opening balances existed: keep the balance they started from, so it doesn't drift.
    if (!Number.isFinite(account.openingBalance)) {
        await updateAccount(account.id, { openingBalance: L.opening, openingDate: L.openingDate });
        account.openingBalance = L.opening;
        account.openingDate = L.openingDate ? sheetDate(L.openingDate, false) : '';
    }
    await saveActivity(account, activity);
    await savePayments(account, L.payments);
}

/** Same day n months later, kept within the month. */
const plusMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n,
    Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()));

/** How interest is charged: an APR (monthly rate on the balance) or, without one, a flat $ per month from recent activity. */
export function interestModel(account, L, now = new Date()) {
    const apr = Number(account.apr);
    if (apr > 0) return { rate: apr / 100 / 12, flat: 0, text: `${apr}% APR` };
    const since = plusMonths(now, -3);
    const recent = L.activity.filter(a => a.date && a.date >= since && /^(interest|fee)$/i.test(a.type) && Number.isFinite(a.amount));
    const flat = recent.reduce((t, a) => t + a.amount, 0) / 3;
    return { rate: 0, flat, text: flat ? `about $${flat.toFixed(2)}/mo interest & fees (from the last 3 months)` : 'no interest recorded' };
}

/**
 * Pay `payment` a month until `balance` is gone. Returns {status: 'ok' | 'never', months, interest (total),
 * balances: balance after each payment (index 0 = after the first)}.
 */
export function simulate(balance, payment, { rate = 0, flat = 0 } = {}, maxMonths = 600) {
    const balances = [];
    let bal = balance, interest = 0;
    while (bal > 0.005) {
        const i = rate ? bal * rate : flat;
        if (payment <= i + 0.005 || balances.length >= maxMonths) return { status: 'never', months: Infinity, interest: Infinity, balances, monthlyInterest: i };
        interest += i;
        bal = Math.max(0, bal + i - payment);
        if (bal < 1) bal = 0; // a few cents of rounding go with the last payment
        balances.push(Math.round(bal * 100) / 100);
    }
    return { status: 'ok', months: balances.length, interest, balances };
}

/** The monthly payment that clears `balance` in `months` payments. */
export function paymentFor(balance, months, { rate = 0, flat = 0 } = {}) {
    if (!(months > 0)) return NaN;
    if (!rate) return balance / months + flat;
    return (rate * balance) / (1 - (1 + rate) ** -months);
}

/** The minimum payment on the account: the next unmade payment's, else the latest one recorded. */
export function minimumOf(L) {
    const next = L.payments.find(p => !p.made && Number.isFinite(p.minPayment));
    return next ? next.minPayment : [...L.payments].reverse().find(p => Number.isFinite(p.minPayment))?.minPayment ?? NaN;
}

/** Month of the next payment: the next unmade one, else a month after the last, else next month. */
export function nextPaymentDate(L, now = new Date(), account = null) {
    const next = L.payments.find(p => !p.made && p.date);
    if (next) return next.date;
    const lastDate = L.payments.filter(p => p.date).at(-1)?.date;
    if (isLoan(account) && (Number(account.dueDay) > 0 || parseBillDate(account.firstPayment))) return nextDueDate(account, lastDate || now);
    return lastDate ? plusMonths(lastDate, 1) : plusMonths(now, 1);
}

/** The first due date after `after`: on the loan's due day, else the day of its first payment. */
export function nextDueDate(account, after) {
    const day = Number(account.dueDay) || parseBillDate(account.firstPayment)?.getDate() || after.getDate();
    for (let k = 0; k < 3; k++) {
        const y = after.getFullYear(), m = after.getMonth() + k;
        const d = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
        if (d > after) return d;
    }
    return plusMonths(after, 1);
}
export { plusMonths };

/**
 * When the balance would reach zero. Monthly payment: the account's planned monthly payment if set, else the next
 * payment not made yet (its amount, or its minimum), else the average of the last three made. Interest: see interestModel.
 * Returns {status: 'paid' | 'ok' | 'never' | 'unknown', date, months, payment, interest (total, estimated), basis, rateText}.
 */
export function estimatePayoff(account, L, now = new Date()) {
    const balance = L.balanceNow;
    if (!(balance > 0.005)) return { status: 'paid' };
    const unmade = L.payments.filter(p => !p.made);
    const made = L.payments.filter(p => p.made && Number.isFinite(p.payment) && p.payment > 0);
    const nextUnmade = unmade.find(p => Number.isFinite(p.payment) || Number.isFinite(p.minPayment)) || null;
    let payment = Number(account.planPayment), basis;
    const loanPay = isLoan(account) ? loanTerms(account).payment : NaN; // principal & interest, without escrow
    if (payment > 0) basis = 'your planned monthly payment';
    else if (loanPay > 0) { payment = loanPay; basis = 'your monthly payment'; }
    else if (nextUnmade) { payment = Number.isFinite(nextUnmade.payment) ? nextUnmade.payment : nextUnmade.minPayment; basis = Number.isFinite(nextUnmade.payment) ? 'your next payment' : 'the minimum payment'; }
    else if (made.length) { const last = made.slice(-3); payment = last.reduce((a, p) => a + (isLoan(account) ? p.payment - (p.escrow || 0) : p.payment), 0) / last.length; basis = `your last ${last.length === 1 ? 'payment' : `${last.length} payments' average`}`; }
    if (!(payment > 0)) return { status: 'unknown', reason: 'Add a payment (or a planned monthly payment in Edit) to estimate a payoff date.' };
    const model = interestModel(account, L, now);
    const sim = simulate(balance, payment, model);
    if (sim.status === 'never') return { status: 'never', payment, basis, monthlyInterest: sim.monthlyInterest, model };
    return {
        status: 'ok', months: sim.months, payment, basis, interest: sim.interest, model,
        date: plusMonths(nextPaymentDate(L, now, account), sim.months - 1), rateText: model.text,
    };
}

// ── Loans ────────────────────────────────────────────────────────────────────

/** A loan's terms with defaults: { rate (monthly), apr, payment (principal & interest), escrow, original, first, term, dueDay }. */
export function loanTerms(account) {
    const apr = Number(account.apr) > 0 ? Number(account.apr) : 0;
    const original = Number(account.originalAmount) > 0 ? Number(account.originalAmount) : NaN;
    const term = Number(account.termMonths) > 0 ? Number(account.termMonths) : NaN;
    const rate = apr / 100 / 12;
    let payment = Number(account.payment) > 0 ? Number(account.payment) : Number(account.planPayment) > 0 ? Number(account.planPayment) : NaN;
    let computedPayment = false;
    if (!Number.isFinite(payment) && Number.isFinite(original) && Number.isFinite(term)) { payment = round2(paymentFor(original, term, { rate })); computedPayment = true; }
    return {
        apr, rate, payment, original, term,
        escrow: Number(account.escrow) > 0 ? Number(account.escrow) : 0,
        first: parseBillDate(account.firstPayment),
        dueDay: Number(account.dueDay) > 0 ? Number(account.dueDay) : null,
        computedPayment,
    };
}

/**
 * Loan version of ledger(). Each payment (in date order, fees/credits from the activity table in between) pays the
 * month's interest — what you typed from the statement, else balance × APR ÷ 12 — and the escrow, and the rest is
 * principal. Payments not made yet are projected the same way. Starting point: the opening balance (what you owed on
 * its date), or else the original amount a month before the first payment.
 */
function loanLedger(account, payments, activity) {
    const T = loanTerms(account);
    let opening = Number.isFinite(account.openingBalance) && account.openingBalance > 0 ? account.openingBalance : NaN;
    let openingDate = parseBillDate(account.openingDate);
    if (!Number.isFinite(opening) && Number.isFinite(T.original)) {
        opening = T.original;
        openingDate = T.first ? plusMonths(T.first, -1) : openingDate;
    }
    if (!Number.isFinite(opening)) opening = 0;
    const events = [
        ...activity.map(a => ({ kind: 'activity', date: a.date, item: a })),
        ...payments.map(p => ({ kind: 'payment', date: p.date, item: p })),
    ].sort((x, y) => byDate(x, y) || (x.kind === y.kind ? 0 : x.kind === 'activity' ? -1 : 1));
    let bal = opening, planned = 0;
    const firstDate = events.find(e => e.date)?.date;
    const openAt = openingDate && firstDate ? (firstDate < openingDate ? firstDate : openingDate) : openingDate || firstDate;
    const points = openAt ? [{ date: openAt, balance: round2(bal), what: 'Opening balance' }] : [];
    const outPayments = [], outActivity = [];
    for (const e of events) {
        if (e.kind === 'activity') {
            const a = e.item, amt = Number.isFinite(a.amount) ? a.amount * signOf(a.type) : 0;
            bal = round2(bal + amt);
            outActivity.push({ ...a, signed: amt, balance: bal });
            if (a.date) points.push({ date: a.date, balance: bal, what: `${a.type}: ${a.description || ''}`.trim() });
            continue;
        }
        const p = e.item;
        const start = Math.max(0, p.made ? bal : bal + planned);
        const interestTyped = Number.isFinite(p.interest), escrowTyped = Number.isFinite(p.escrow);
        const interest = interestTyped ? p.interest : start > 0.005 ? round2(start * T.rate) : 0;
        const pay = Number.isFinite(p.payment) ? p.payment : 0;
        const escrow = escrowTyped ? p.escrow : Math.min(T.escrow, pay);
        const principal = round2(pay - escrow - interest);
        const before = round2(start), after = round2(start - principal);
        const row = { ...p, interest, escrow, principal, before, after, interestTyped, escrowTyped };
        if (p.made) {
            bal = after;
            if (p.date) points.push({ date: p.date, balance: bal, what: 'Payment' });
        } else {
            planned = round2(planned - principal);
            row.projected = true;
        }
        outPayments.push(row);
    }
    return { opening, openingDate, payments: outPayments.sort(byDate), activity: outActivity.sort(byDate), points, balanceNow: bal, terms: T };
}

/**
 * Month-by-month schedule from `balance`, paying `payment` (principal & interest) a month starting on `from`:
 * [{ n, date, payment, interest, principal, balance }] until paid off (max 600).
 */
export function amortize(balance, payment, rate, from) {
    const rows = [];
    let bal = balance;
    for (let n = 1; bal > 0.005 && n <= 600; n++) {
        const interest = round2(bal * rate);
        if (payment <= interest) break;
        // The last payment is whatever is left (a few cents of rounding are folded into it).
        const pay = bal - (payment - interest) < 1 ? round2(bal + interest) : payment;
        const principal = round2(pay - interest);
        bal = round2(bal - principal);
        rows.push({ n, date: plusMonths(from, n - 1), payment: pay, interest, principal, balance: Math.max(0, bal) });
    }
    return rows;
}

/**
 * Where the original schedule says the balance should be after the payments due by `date` (original amount, first
 * payment, term, rate). null without the original terms. { balance, paymentsDue, endDate }.
 */
export function scheduledBalance(account, date = new Date()) {
    const T = loanTerms(account);
    if (!Number.isFinite(T.original) || !T.first || !Number.isFinite(T.payment)) return null;
    const rows = amortize(T.original, T.payment, T.rate, T.first);
    const due = rows.filter(r => r.date <= date);
    return { balance: due.length ? due.at(-1).balance : T.original, paymentsDue: due.length, endDate: rows.at(-1)?.date || null, rows };
}
