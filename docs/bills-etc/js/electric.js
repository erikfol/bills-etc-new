// Electric bills: inputs/electric/master_electric.csv (kept by hand, usually tab-separated from Excel).
import { readSheet, insertRow, parseBillDate, parseMoney, num, sheetDate, sheetMoney } from './sheet.js';

export const ELECTRIC_PATH = 'inputs/electric/master_electric.csv';

/** The sheet plus its column indexes by meaning. */
/** Column indexes by meaning, from a sheet read with readSheet. */
// "kWh's used" appears twice: meter difference first, then after the multiplier (the billed amount).
const electricColumns = ({ idx, head }) => ({
        id: idx('id'), start: idx('service date start'), end: idx('service date end'), days: idx('service days'),
        due: idx('bill due date'), curRead: idx('current kwh'), prevRead: idx('previous kwh'),
        rawUsed: head.indexOf("kwh's used"), multiplier: idx('multiplier'), used: idx("kwh's used", 'kwh used'),
        curRec: idx('current kwh (rec)'), prevRec: idx('previous kwh (rec)'),
        received: idx("kwh's recieved", "kwh's received", 'kwh received'),
        amount: idx('amount due'), perKwh: idx('price/unit'), notes: idx('notes'),
});

async function readElectric() {
    const sheet = await readSheet(ELECTRIC_PATH);
    if (sheet) sheet.I = electricColumns(sheet);
    return sheet;
}

/** The date and amount that make a bill a duplicate: service end and amount due. */
export const electricDupKey = (cells, sheet) => { const I = electricColumns(sheet); return { date: parseBillDate(cells[I.end]), amount: parseMoney(cells[I.amount]), what: 'a bill ending' }; };

/** Columns worked out from others, which the table editor fills in again when it saves a row. */
export const ELECTRIC_CALCULATED = "Service Days, both kWh's used, kWh's recieved and price/unit";
/**
 * Work out a bill row's calculated cells (days, kWh used, kWh received, price/unit) again, in place — only those
 * whose inputs are among the `changed` column indexes.
 */
export function recalcElectricRow(cells, sheet, changed) {
    const I = electricColumns(sheet);
    const touched = (...keys) => keys.some(k => changed.has(I[k]));
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = v; };
    const start = parseBillDate(cells[I.start]), end = parseBillDate(cells[I.end]);
    if (touched('start', 'end') && start && end) set('days', String(serviceDays(start, end)));
    const cur = num(cells[I.curRead]), prev = num(cells[I.prevRead]), mult = I.multiplier >= 0 ? num(cells[I.multiplier]) : 1;
    let used = num(cells[I.used]);
    if (touched('curRead', 'prevRead', 'multiplier') && Number.isFinite(cur) && Number.isFinite(prev)) {
        set('rawUsed', String(cur - prev));
        if (Number.isFinite(mult)) { used = (cur - prev) * mult; set('used', String(used)); }
    }
    const curRec = num(cells[I.curRec]), prevRec = num(cells[I.prevRec]);
    if (touched('curRec', 'prevRec') && Number.isFinite(curRec) && Number.isFinite(prevRec)) set('received', String(curRec - prevRec));
    const amount = parseMoney(cells[I.amount]);
    if (touched('amount', 'curRead', 'prevRead', 'multiplier', 'used') && Number.isFinite(amount) && used > 0) set('perKwh', sheetMoney(amount / used));
}

/**
 * Bills, oldest first: {id, start, end, days, due, used, received, amount, charge, perKwh, notes, curRead, curRec, multiplier}.
 * `used` is the billed kWh (after the multiplier); `received` is kWh sent to the grid (NaN before solar).
 * `amount` is the statement's amount (negative = credit balance); `charge` is what this period alone added
 * (see chargeOf), and `perKwh` is charge ÷ used. Returns null if the file doesn't exist.
 */
export async function loadElectric() {
    const sheet = await readElectric();
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
            notes: /^\d{4}$/.test(notes) ? '' : notes, // a bare year is just a marker in the sheet
            curRead: num(cell(r, 'curRead')),
            curRec: num(cell(r, 'curRec')),
            multiplier: num(cell(r, 'multiplier')),
        };
    }).filter(b => b.end && Number.isFinite(b.amount));
    bills.sort((a, b) => a.end - b.end);
    bills.forEach((b, k) => {
        b.charge = chargeOf(b.amount, bills[k - 1]?.amount);
        b.perKwh = b.used > 0 ? b.charge / b.used : NaN;
    });
    return { bills, missing: [] };
}

/** Days in a service period, counting both ends (22 Jul – 19 Aug = 29), as the sheet does. */
export const serviceDays = (start, end) => Math.round((end - start) / 864e5) + 1;

/**
 * Add one bill to the sheet, in the same format and order as the rows already there.
 * bill: {start, end, due?, curRead, prevRead, multiplier, curRec?, prevRec?, amount, notes?} (dates as Date, numbers as numbers).
 */
export async function addElectricBill(bill) {
    const sheet = await readElectric();
    if (!sheet || !sheet.records.length) throw new Error(`${ELECTRIC_PATH} not found`);
    const { records, I } = sheet;
    const cells = records[0].map(() => '');
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = String(v); };
    const ids = records.slice(1).map(r => parseInt(r[I.id], 10)).filter(Number.isFinite);
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
    await insertRow(sheet, cells, I.end);
}

/**
 * What one period added, from its statement amount and the previous statement's. Credits carry forward
 * (since solar the statement shows the running credit balance); an amount due was paid, so the next starts at 0.
 */
export const chargeOf = (amount, prevAmount) => amount - (prevAmount < 0 ? prevAmount : 0);

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
