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

/** The raw sheet: delimiter, line ending, header and records, plus column indexes by meaning. */
async function readSheet() {
    const text = await fs.readText(ELECTRIC_PATH);
    if (text == null) return null;
    const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
    const delim = firstLine.includes('\t') ? '\t' : ',';
    const records = parseRecords(text, delim);
    const head = (records[0] || []).map(h => h.trim().toLowerCase());
    // "kWh's used" appears twice: meter difference first, then after the multiplier (the billed amount).
    const idx = (...names) => { for (const n of names) { const i = head.lastIndexOf(n); if (i >= 0) return i; } return -1; };
    const I = {
        id: idx('id'), start: idx('service date start'), end: idx('service date end'), days: idx('service days'),
        due: idx('bill due date'), curRead: idx('current kwh'), prevRead: idx('previous kwh'),
        rawUsed: head.indexOf("kwh's used"), multiplier: idx('multiplier'), used: idx("kwh's used", 'kwh used'),
        curRec: idx('current kwh (rec)'), prevRec: idx('previous kwh (rec)'),
        received: idx("kwh's recieved", "kwh's received", 'kwh received'),
        amount: idx('amount due'), perKwh: idx('price/unit'), notes: idx('notes'),
    };
    return { text, delim, eol: text.includes('\r\n') ? '\r\n' : '\n', records, I };
}

/**
 * Bills, oldest first: {id, start, end, days, due, used, received, amount, perKwh, notes, curRead, curRec, multiplier}.
 * `used` is the billed kWh (after the multiplier); `received` is kWh sent to the grid (NaN before solar);
 * `amount` is negative when the bill is a credit. Returns null if the file doesn't exist.
 */
export async function loadElectric() {
    const sheet = await readSheet();
    if (!sheet) return null;
    const { records, I } = sheet;
    if (!records.length) return { bills: [], missing: [] };
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
            curRead: num(cell(r, 'curRead')),
            curRec: num(cell(r, 'curRec')),
            multiplier: num(cell(r, 'multiplier')),
        };
    }).filter(b => b.end && Number.isFinite(b.amount));
    bills.sort((a, b) => a.end - b.end);
    return { bills, missing: [] };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 22/Jul/2026, the sheet's date format. */
const sheetDate = d => `${String(d.getDate()).padStart(2, '0')}/${MON[d.getMonth()]}/${d.getFullYear()}`;
/** Excel accounting format the sheet uses: ' $25.15 ' and ' $(1,003.21)'. */
const sheetMoney = v => {
    const t = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v < 0 ? ` $(${t})` : ` $${t} `;
};
/** Days in a service period, counting both ends (22 Jul – 19 Aug = 29), as the sheet does. */
export const serviceDays = (start, end) => Math.round((end - start) / 864e5) + 1;

/**
 * Add one bill to the sheet, in the same format and order as the rows already there.
 * bill: {start, end, due?, curRead, prevRead, multiplier, curRec?, prevRec?, amount, notes?} (dates as Date, numbers as numbers).
 */
export async function addElectricBill(bill) {
    const sheet = await readSheet();
    if (!sheet || !sheet.records.length) throw new Error(`${ELECTRIC_PATH} not found`);
    const { text, delim, eol, records, I } = sheet;
    const cells = records[0].map(() => '');
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = String(v); };
    const rows = records.slice(1);
    const ids = rows.map(r => parseInt(r[I.id], 10)).filter(Number.isFinite);
    const rawUsed = bill.curRead - bill.prevRead, used = rawUsed * bill.multiplier;
    const hasRec = Number.isFinite(bill.curRec) && Number.isFinite(bill.prevRec);

    set('id', ids.length ? Math.max(...ids) + 1 : 1);
    set('start', sheetDate(bill.start));
    set('end', sheetDate(bill.end));
    set('days', serviceDays(bill.start, bill.end));
    set('due', bill.due ? sheetDate(bill.due) : '');
    set('curRead', bill.curRead);
    set('prevRead', bill.prevRead);
    set('rawUsed', rawUsed);
    set('multiplier', bill.multiplier);
    set('used', used);
    set('curRec', hasRec ? bill.curRec : 'na');
    set('prevRec', hasRec ? bill.prevRec : 'na');
    set('received', hasRec ? bill.curRec - bill.prevRec : 'na');
    set('amount', sheetMoney(bill.amount));
    set('perKwh', used > 0 ? sheetMoney(bill.amount / used) : '');
    // Blank notes get the year, like the rest of the sheet.
    set('notes', String(bill.notes || '').replace(/[\t\r\n]+/g, ' ').trim() || bill.end.getFullYear());
    const line = cells.map(c => (delim === ',' && /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(delim);

    // The sheet is kept newest first; put the bill at the top unless it's kept oldest first.
    const endOf = r => parseBillDate(r[I.end])?.getTime() ?? 0;
    const newestFirst = rows.length < 2 || endOf(rows[0]) >= endOf(rows.at(-1));
    const lines = text.split(/\r?\n/);
    const trailing = lines.at(-1) === '' ? lines.pop() : null;
    if (newestFirst) lines.splice(1, 0, line);
    else lines.push(line);
    if (trailing !== null) lines.push('');
    await fs.writeText(ELECTRIC_PATH, lines.join(eol));
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
