// Loans and credit cards you set up yourself. The list of accounts (title, description, type) is kept in
// inputs/loans_cc/accounts.json; each account's payments are a CSV next to it (Date, Min Payment, Payment, Before,
// After, Payment Made, Notes) so they open in Excel too. Files written before Min Payment existed get it on next save.
import * as fs from './fs.js';
import { parseCSV, toCSV } from './csv.js';
import { parseBillDate, parseMoney, sheetDate } from './sheet.js';

export const LOANS_DIR = 'inputs/loans_cc';
const INDEX = `${LOANS_DIR}/accounts.json`;
export const PAYMENT_COLS = ['Date', 'Min Payment', 'Payment', 'Before', 'After', 'Payment Made', 'Notes'];
export const ACCOUNT_TYPES = ['Loan', 'Credit card', 'Other'];

const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const moneyCell = n => (Number.isFinite(n) ? round2(n).toFixed(2) : '');

/** Accounts in the order you set them up: [{id, title, description, type, file}]. [] if none yet. */
export async function loadAccounts() {
    const text = await fs.readText(INDEX);
    if (text == null) return [];
    const data = JSON.parse(text);
    return Array.isArray(data.accounts) ? data.accounts : [];
}

async function saveAccounts(accounts) {
    await fs.writeText(INDEX, JSON.stringify({
        _readme: 'Loans and credit cards for the Loan/CC page. Each account\'s payments are in the CSV named by "file".',
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

/** Add an account and create its empty payments file. Returns the new account. */
export async function addAccount({ title, description, type }) {
    const accounts = await loadAccounts();
    const id = slug(title, new Set(accounts.map(a => a.id)));
    const account = { id, title: title.trim(), description: (description || '').trim(), type: type || 'Other', file: `${LOANS_DIR}/${id}.csv` };
    if ((await fs.readText(account.file)) == null) await fs.writeText(account.file, toCSV(PAYMENT_COLS, []));
    accounts.push(account);
    await saveAccounts(accounts);
    return account;
}

/** Change an account's title / description / type (its file stays the same). */
export async function updateAccount(id, changes) {
    const accounts = await loadAccounts();
    const a = accounts.find(x => x.id === id);
    if (!a) throw new Error('That account is no longer in accounts.json');
    for (const k of ['title', 'description', 'type']) if (changes[k] != null) a[k] = String(changes[k]).trim();
    await saveAccounts(accounts);
}

/** Take an account off the page. Its payments CSV is left in the folder, so nothing is lost. */
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

/**
 * Payments of one account, oldest first: {date, minPayment, payment, before, after, made (bool), notes}.
 * A missing file reads as no payments.
 */
export async function loadPayments(account) {
    const text = await fs.readText(account.file);
    if (text == null) return [];
    const { rows } = parseCSV(text);
    const get = (r, name) => r[Object.keys(r).find(k => k.trim().toLowerCase() === name.toLowerCase())] ?? '';
    return rows.map(r => ({
        date: parseBillDate(get(r, 'Date')),
        minPayment: parseMoney(get(r, 'Min Payment')),
        payment: parseMoney(get(r, 'Payment')),
        before: parseMoney(get(r, 'Before')),
        after: parseMoney(get(r, 'After')),
        made: /^y/i.test(String(get(r, 'Payment Made')).trim()),
        notes: String(get(r, 'Notes')).trim(),
    })).sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
}

/** Write an account's whole payments table (rows as {date, minPayment, payment, before, after, made, notes}), oldest first. */
export async function savePayments(account, payments) {
    const rows = [...payments].sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity)).map(p => ({
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
