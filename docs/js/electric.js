// Electric bills: inputs/electric/master_electric.csv (kept by hand, usually tab-separated from Excel).
import * as fs from './fs.js';
import { parseRecords } from './csv.js';

export const ELECTRIC_PATH = 'inputs/electric/master_electric.csv';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** '22/Jul/2026' (also 22-Jul-2026, 2026-07-22) → Date, or null. */
export function parseBillDate(s) {
    s = String(s ?? '').trim();
    let m = s.match(/^(\d{1,2})[/\-\s]([A-Za-z]{3})[A-Za-z]*[/\-\s](\d{2,4})$/);
    if (m) {
        const mo = MONTHS.indexOf(m[2].toLowerCase()), y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        const d = new Date(y, mo, +m[1]);
        return mo >= 0 && d.getDate() === +m[1] ? d : null;
    }
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return new Date(+m[1], m[2] - 1, +m[3]);
    return null;
}

/** ' $(1,003.21)' → -1003.21 (accounting negatives), ' $25.15 ' → 25.15, 'na' → NaN. */
export function parseMoney(s) {
    s = String(s ?? '').trim();
    const neg = /^\(.*\)$/.test(s.replace(/\$/g, '')) || s.startsWith('-');
    const n = Number(s.replace(/[$,()\s-]/g, ''));
    return s === '' || Number.isNaN(n) ? NaN : neg ? -n : n;
}

const num = s => { const n = Number(String(s ?? '').replace(/,/g, '').trim()); return String(s ?? '').trim() === '' ? NaN : n; };

/**
 * Bills, oldest first: {id, start, end, days, due, used, received, amount, perKwh, notes}.
 * `used` is the billed kWh (after the multiplier); `received` is kWh sent to the grid (NaN before solar);
 * `amount` is negative when the bill is a credit. Returns null if the file doesn't exist.
 */
export async function loadElectric() {
    const text = await fs.readText(ELECTRIC_PATH);
    if (text == null) return null;
    const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
    const records = parseRecords(text, firstLine.includes('\t') ? '\t' : ',');
    if (!records.length) return { bills: [], missing: [] };
    const head = records[0].map(h => h.trim().toLowerCase());
    // "kWh's used" appears twice; the second one is after the multiplier, so take the last match.
    const idx = (...names) => { for (const n of names) { const i = head.lastIndexOf(n); if (i >= 0) return i; } return -1; };
    const I = {
        id: idx('id'), start: idx('service date start'), end: idx('service date end'), days: idx('service days'),
        due: idx('bill due date'), used: idx("kwh's used", 'kwh used'), received: idx("kwh's recieved", "kwh's received", 'kwh received'),
        amount: idx('amount due'), notes: idx('notes'),
    };
    const missing = ['start', 'end', 'used', 'amount'].filter(k => I[k] < 0);
    if (missing.length) return { bills: [], missing };
    const cell = (r, k) => (I[k] >= 0 ? r[I[k]] ?? '' : '');

    const bills = records.slice(1).map(r => {
        const used = num(cell(r, 'used')), amount = parseMoney(cell(r, 'amount'));
        const notes = cell(r, 'notes').trim();
        return {
            id: cell(r, 'id').trim(),
            start: parseBillDate(cell(r, 'start')),
            end: parseBillDate(cell(r, 'end')),
            days: num(cell(r, 'days')),
            due: parseBillDate(cell(r, 'due')),
            used,
            received: num(cell(r, 'received')),
            amount,
            perKwh: used > 0 ? amount / used : NaN,
            notes: /^\d{4}$/.test(notes) ? '' : notes, // a bare year is just a marker in the sheet
        };
    }).filter(b => b.end && Number.isFinite(b.amount));
    bills.sort((a, b) => a.end - b.end);
    return { bills, missing: [] };
}

/** The bill covering roughly the same period one year earlier, or null. */
export function sameBillLastYear(bills, bill) {
    const target = bill.end.getTime() - 365 * 864e5;
    let best = null;
    for (const b of bills) {
        const off = Math.abs(b.end.getTime() - target);
        if (off < 20 * 864e5 && (!best || off < Math.abs(best.end.getTime() - target))) best = b;
    }
    return best;
}
