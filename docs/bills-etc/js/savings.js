// Savings buckets: inputs/savings/master_savings.csv, a hand-kept sheet (tab-separated, notes over several lines).
// Layout, top to bottom:
//   header (Before | | Last deposited/updated | How much deposit each paycheck | Notes)
//   "Available In Account" row (the real account balance), then one row per bucket, then a "Total" per-paycheck row
//   "*** NEED TO SETUP ***" buckets, other buckets (not in the paycheck total), one-time money (stimulus, tax returns…)
//   summary rows: Available In Account, Total deductions, Total oh sh!t money, Before changes…, Diff
//   a transfer log: Transfer | Amount | Date | Confirmed | Description
// Records are read with the CSV reader and written back field by field, so untouched parts stay byte-for-byte.
import * as fs from './fs.js';
import { parseRecords } from './csv.js';
import { parseBillDate, parseMoney } from './sheet.js';

export const SAVINGS_PATH = 'inputs/savings/master_savings.csv';
const SETTINGS_PATH = 'inputs/savings/savings_settings.json';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map(m => m.slice(0, 3));

const round2 = n => Math.round(n * 100) / 100;
const trim = v => String(v ?? '').trim();
/** ' $11,100 ', ' $1,234.56 ', and ' $-   ' for zero, like the sheet. */
export const sheetDollars = v => {
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) < 0.005) return ' $-   ';
    const t = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(round2(v)) ? 0 : 2, maximumFractionDigits: 2 });
    return v < 0 ? ` $(${t})` : ` $${t} `;
};
/** 'September 14, 2026' (bucket dates) */
export const longDate = d => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
/** '7-Jan-26' (transfer dates) */
export const shortDate = d => `${d.getDate()}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
/** Money like ' $1,000 ', '~$186', 'n/a' → {value, approx}; blank / n/a → NaN. */
function money(v) {
    const s = trim(v);
    const approx = s.startsWith('~');
    return { value: parseMoney(s.replace(/^~/, '')), approx };
}

/** One field as the sheet writes it: quoted when it holds a line break, a tab or starts with a quote. */
const cellOut = v => (v.includes('\n') || v.includes('\t') || v.startsWith('"') ? `"${v.replace(/"/g, '""')}"` : v);

async function readRaw() {
    const text = await fs.readText(SAVINGS_PATH);
    if (text == null) return null;
    return { text, records: parseRecords(text, '\t'), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/**
 * Everything on the sheet: {available, buckets, transfers, totals, separate}. Buckets:
 * {rec, name, balance, updated, perCheck, notes, group: 'active' | 'setup' | 'other' | 'past'}.
 * Transfers: {rec, kind, to, amount, approx, date, confirmed, description}.
 */
export async function loadSavings() {
    const raw = await readRaw();
    if (!raw) return null;
    return parseSavings(raw.records, await loadSettings());
}

/** Read the sheet's records (see loadSavings). */
function parseSavings(R, settings) {
    const tIdx = R.findIndex(r => /^transfer$/i.test(trim(r[0])));
    const end = tIdx >= 0 ? tIdx : R.length;
    const out = { available: null, buckets: [], transfers: [], totals: {}, rows: {} };
    let group = 'active', seenTotal = false;
    for (let i = 1; i < end; i++) {
        const r = R[i], name = trim(r[0]);
        const blank = r.every(c => trim(c) === '');
        if (blank) { if (group === 'setup') group = 'after-setup'; continue; }
        if (!name && /^total$/i.test(trim(r[2]))) { out.totals.perCheck = money(r[3]).value; out.rows.perCheckTotal = i; seenTotal = true; group = 'after-total'; continue; }
        if (/^available in account$/i.test(name)) {
            if (!out.available) { out.available = { rec: i, value: money(r[1]).value, updated: parseBillDate(r[2]), notes: trim(r[4]) }; }
            else out.rows.availableSummary = i;
            continue;
        }
        if (/^total deductions/i.test(name)) { out.totals.deductions = money(r[1]).value; out.rows.deductions = i; continue; }
        if (/^total oh/i.test(name)) { out.totals.cushion = money(r[1]).value; out.rows.cushion = i; continue; }
        if (/^before changes/i.test(name)) { out.totals.before = money(r[1]).value; out.rows.before = i; continue; }
        if (/^diff$/i.test(name)) { out.totals.diff = money(r[1]).value; out.rows.diff = i; continue; }
        if (/need to setup/i.test(name) && r.slice(1).every(c => trim(c) === '')) { group = 'setup'; continue; }
        const perCheck = money(r[3]).value;
        const g = !seenTotal ? 'active' : group === 'setup' ? 'setup' : perCheck > 0 ? 'other' : 'past';
        out.buckets.push({ rec: i, name, balance: money(r[1]).value, updated: parseBillDate(r[2]), perCheck, notes: trim(r[4]), group: g });
    }
    if (tIdx >= 0) {
        for (let i = tIdx + 1; i < R.length; i++) {
            const r = R[i];
            if (r.every(c => trim(c) === '')) continue;
            const m = money(r[1]), kind = trim(r[0]);
            out.transfers.push({
                rec: i, kind, to: (kind.match(/\bto\s+(.+)$/i)?.[1] || '').trim(), from: (kind.match(/^from\s+(.+?)\s+to\b/i)?.[1] || '').trim(),
                amount: m.value, approx: m.approx, date: parseBillDate(r[2]), confirmed: /^y/i.test(trim(r[3])), confirmedText: trim(r[3]),
                description: trim(r[4]),
            });
        }
    }
    out.transferHeader = tIdx;
    // Buckets kept outside "Available In Account". Saved settings win; otherwise work it out from the sheet's own
    // Total deductions: a bucket whose balance is exactly what's missing from it is held separately.
    if (settings?.separate) out.separate = new Set(settings.separate);
    else {
        out.separate = new Set();
        const held = out.buckets.filter(b => b.group !== 'past' && Number.isFinite(b.balance));
        const gap = round2(held.reduce((t, b) => t + b.balance, 0) - (out.totals.deductions ?? NaN));
        if (gap > 0.5) {
            const match = held.find(b => Math.abs(b.balance - gap) < 0.5);
            if (match) out.separate.add(match.name);
        }
    }
    out.settingsSaved = !!settings;
    return out;
}

async function loadSettings() {
    const t = await fs.readText(SETTINGS_PATH);
    if (t == null) return null;
    try { return JSON.parse(t); } catch { return null; }
}
export async function saveSeparate(names) {
    await fs.writeText(SETTINGS_PATH, JSON.stringify({
        _readme: 'Savings page settings. "separate": buckets whose money is NOT in "Available In Account" (kept elsewhere).',
        separate: [...names],
    }, null, 2) + '\n');
}

/**
 * Change the sheet and write it back. `fn(records, info)` edits the records in place (info: {buckets, separate,
 * rows}); afterwards the summary rows are worked out again: Total per paycheck (active buckets), Total deductions
 * (buckets counted in the account), the summary Available, oh sh!t money (available − deductions) and Diff.
 */
export async function changeSavings(fn) {
    const raw = await readRaw();
    if (!raw) throw new Error(`${SAVINGS_PATH} not found`);
    const settings = await loadSettings();
    const info = parseSavings(raw.records, settings);
    fn(raw.records, info);
    // Which buckets are held outside the account is decided before the edit (and saved, the first time), so the
    // totals below don't shift with it.
    if (!settings) await saveSeparate(info.separate);
    const after = parseSavings(raw.records, { separate: [...info.separate] }); // totals from the edited records
    const R = raw.records, set = (i, col, v) => { if (i != null && R[i]) { while (R[i].length <= col) R[i].push(''); R[i][col] = v; } };
    const counted = after.buckets.filter(b => b.group !== 'past' && !after.separate.has(b.name) && Number.isFinite(b.balance));
    const deductions = round2(counted.reduce((t, b) => t + b.balance, 0));
    const perCheck = round2(after.buckets.filter(b => b.group === 'active' && Number.isFinite(b.perCheck)).reduce((t, b) => t + b.perCheck, 0));
    const avail = after.available?.value;
    set(after.rows.perCheckTotal, 3, sheetDollars(perCheck));
    set(after.rows.deductions, 1, sheetDollars(deductions));
    if (Number.isFinite(avail)) {
        set(after.rows.availableSummary, 1, sheetDollars(avail));
        set(after.rows.cushion, 1, sheetDollars(round2(avail - deductions)));
        if (Number.isFinite(after.totals.before)) set(after.rows.diff, 1, sheetDollars(round2(avail - deductions - after.totals.before)));
    }
    await fs.writeText(SAVINGS_PATH, R.map(r => r.map(cellOut).join('\t')).join(raw.eol));
}

/** Cells for a bucket row. */
export const bucketCells = b => [b.name, sheetDollars(b.balance), b.updated ? longDate(b.updated) : '', Number.isFinite(b.perCheck) ? sheetDollars(b.perCheck) : ' n/a ', b.notes || ''];
/** Cells for a transfer row. */
export const transferCells = t => [t.kind, (t.approx ? '~' : '') + sheetDollars(t.amount).replace(/^ /, t.approx ? '' : ' '), t.date ? shortDate(t.date) : '', t.confirmed ? 'Yes' : 'No', t.description || ''];
