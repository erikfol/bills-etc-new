// Health records: one CSV per section in inputs/health/ of the connected folder (kept out of git like all of inputs/).
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const HEALTH_DIR = 'inputs/health';
export const LOCATIONS_PATH = `${HEALTH_DIR}/locations.json`;
const DEFAULT_LOCATIONS = ['Head', 'Lips', 'Stomach', 'Arm', 'Leg', 'Penis'];

// Column kinds are the shared record table's (shared/js/recordtable.js).
export const SECTIONS = [
    { id: 'general', label: 'General Health', path: `${HEALTH_DIR}/general_health.csv`, columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Location', kind: 'choice' },
        { name: 'Description', kind: 'text' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
    { id: 'dental', label: 'Dental', path: `${HEALTH_DIR}/dental.csv`, columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Description', kind: 'text' },
        { name: 'Location', kind: 'suggest' }, // the dental office (offers the ones used before), not General Health's body locations
        { name: 'Total Cost', kind: 'money' },
        { name: 'Out of Pocket', kind: 'money' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
    { id: 'eye', label: 'Eye', path: `${HEALTH_DIR}/eye.csv`, columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Description', kind: 'text' },
        { name: 'Location', kind: 'suggest' }, // the eye doctor's office, like Dental's
        { name: 'Total Cost', kind: 'money' },
        { name: 'Out of Pocket', kind: 'money' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
    { id: 'hsa', label: 'Health Savings Account (HSA)', path: `${HEALTH_DIR}/hsa.csv`, account: `${HEALTH_DIR}/hsa.json`, balance: accountBalance, columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Type', kind: 'suggest', suggestions: ['Deposit', 'Charge'] }, // or anything typed in
        { name: 'Description', kind: 'text' },
        { name: 'Amount', kind: 'money' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
];

const names = section => section.columns.map(c => c.name);

/**
 * The HSA's total balance: a Deposit adds its Amount and a Charge takes it away (the Type decides, so a charge typed
 * as -50 still counts as 50 out). Entries of any other Type could be either, so they aren't counted.
 * Returns { balance, deposits, charges, other } — other: how many entries with an amount were left out.
 */
function accountBalance(rows) {
    const t = { balance: 0, deposits: 0, charges: 0, other: 0 };
    for (const r of rows) {
        const s = String(r.Amount ?? '').replace(/[$,]/g, '').trim();
        const n = s === '' ? NaN : Math.abs(Number(s));
        if (Number.isNaN(n)) continue;
        const type = (r.Type || '').trim().toLowerCase();
        if (type === 'deposit') t.deposits += n;
        else if (type === 'charge') t.charges += n;
        else t.other++;
    }
    t.balance = t.deposits - t.charges;
    return t;
}

/**
 * Rows of a section's file ([] when it doesn't exist yet); columns the file lacks read as blank.
 * track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing.
 */
export async function loadRecords(section, track = true) {
    const text = track ? await readTracked(section.path) : await fs.readText(section.path);
    if (text === null) return [];
    return parseCSV(text).rows.map(r => Object.fromEntries(names(section).map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(section, rows) {
    await writeTracked(section.path, toCSV(names(section), rows));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/**
 * A section's account box (HSA): { title, hint, linkText, url } — who holds it, a sign-in hint and its website; {} until
 * set. Kept in inputs/ like the records, never in the code (the site is public).
 */
export async function loadAccount(section, track = true) {
    const text = track ? await readTracked(section.account) : await fs.readText(section.account);
    return text === null ? {} : JSON.parse(text);
}

export async function saveAccount(section, account) {
    await writeTracked(section.account, JSON.stringify(account, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved'));
}

export async function loadLocations() {
    const text = await readTracked(LOCATIONS_PATH);
    if (text === null) return [...DEFAULT_LOCATIONS];
    const list = JSON.parse(text).locations;
    return Array.isArray(list) ? list : [...DEFAULT_LOCATIONS];
}

export async function saveLocations(list) {
    await writeTracked(LOCATIONS_PATH, JSON.stringify({ locations: list }, null, 2) + '\n');
}
