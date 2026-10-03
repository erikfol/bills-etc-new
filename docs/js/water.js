// Water bills: inputs/water/master_water.csv, one row per quarter (kept by hand, usually tab-separated from Excel).
import * as fs from './fs.js';
import { readSheet, insertRow, addColumn, parseBillDate, parseMoney, num, sheetDate, sheetMoney } from './sheet.js';

export const WATER_PATH = 'inputs/water/master_water.csv';

const round2 = n => Math.round(n * 100) / 100;

/** 'Q1 - 2026' → {q: 1, year: 2026}, or null. */
export function parseQuarter(s) {
    const m = String(s ?? '').match(/Q\s*([1-4])\D+(\d{4})/i);
    return m ? { q: +m[1], year: +m[2] } : null;
}
export const quarterText = (q, year) => `Q${q} - ${year}`;
/** The quarter after {q, year}. */
export const nextQuarter = ({ q, year }) => (q === 4 ? { q: 1, year: year + 1 } : { q: q + 1, year });
/** First and last day of a quarter. */
export const quarterDates = ({ q, year }) => [new Date(year, (q - 1) * 3, 1), new Date(year, q * 3, 0)];

/** The sheet plus its column indexes by meaning. */
async function readWater() {
    const sheet = await readSheet(WATER_PATH);
    if (!sheet) return null;
    const { idx, idxStart } = sheet;
    sheet.I = {
        quarter: idx('quarter'), start: idx('bill period start'), end: idx('bill period end'), due: idx('payment due date'),
        flatRate: idx('water -- 1 flat unit(s)'), flat: idx('water -- 1 flat unit(s) cost'),
        gallons: idx('gallons used'), rate: idx('gallons charged at'), usage: idx('gallons cost'),
        fixed: idxStart('water fixed cost'), meter: idxStart('meter charge'),
        calc: idx('calc amount due'), statement: idx('true amount due'), diff: idx('diff'),
        fee: idxStart('service fee'), total: idx('total due'), paid: idxStart('paid'), paidDate: idx('date paid'),
    };
    return sheet;
}

/**
 * Quarterly bills, oldest first: {quarter, q, year, start, end, days, due, gallons, rate (per 1,000 gal), usage, flat,
 * fixed, meter, fixedAll (flat + fixed + meter), calc, statement, diff, fee, total, paid, isPaid, paidDate,
 * perThousand (total ÷ gallons × 1000)}.
 * Returns null if the file doesn't exist.
 */
export async function loadWater() {
    const sheet = await readWater();
    if (!sheet) return null;
    const { records, I } = sheet;
    if (!records.length) return { bills: [], missing: [] };
    const missing = ['quarter', 'end', 'gallons', 'total'].filter(k => I[k] < 0);
    if (missing.length) return { bills: [], missing };
    const cell = (r, k) => (I[k] >= 0 ? r[I[k]] ?? '' : '');
    const money = (r, k) => parseMoney(cell(r, k));

    const bills = records.slice(1).map(r => {
        const qy = parseQuarter(cell(r, 'quarter'));
        const start = parseBillDate(cell(r, 'start')), end = parseBillDate(cell(r, 'end'));
        const gallons = num(cell(r, 'gallons'));
        const flat = money(r, 'flat'), fixed = money(r, 'fixed'), meter = money(r, 'meter');
        const total = money(r, 'total');
        const paid = cell(r, 'paid').trim();
        return {
            quarter: cell(r, 'quarter').trim(),
            q: qy?.q, year: qy?.year ?? end?.getFullYear(),
            start, end, due: parseBillDate(cell(r, 'due')),
            days: start && end ? Math.round((end - start) / 864e5) + 1 : NaN,
            gallons,
            rate: num(String(cell(r, 'rate')).replace(/[$\s]/g, '').split('/')[0]),
            flatRate: cell(r, 'flatRate').trim(),
            usage: money(r, 'usage'), flat, fixed, meter,
            fixedAll: [flat, fixed, meter].filter(Number.isFinite).reduce((a, b) => a + b, 0),
            calc: money(r, 'calc'), statement: money(r, 'statement'), diff: money(r, 'diff'),
            fee: money(r, 'fee'), total, paid,
            isPaid: /^y/i.test(paid),
            paidDate: parseBillDate(cell(r, 'paidDate')),
            perThousand: gallons > 0 ? total / gallons * 1000 : NaN,
        };
    }).filter(b => b.end && b.year && Number.isFinite(b.total));
    bills.sort((a, b) => a.year - b.year || (a.q || 0) - (b.q || 0) || a.end - b.end);
    return { bills, missing: [] };
}

/** What a bill should come to: flat unit + usage (gallons × rate per 1,000) + fixed + meter charges. */
export function calcWater({ gallons, rate, flat, fixed, meter }) {
    const usage = round2(gallons * rate / 1000);
    return { usage, calc: round2(flat + usage + fixed + meter) };
}

/** Add a "Date Paid" column at the end of the sheet (in memory) if it doesn't have one yet. */
function addPaidDateColumn(sheet) {
    if (sheet.I.paidDate < 0) sheet.I.paidDate = addColumn(sheet, 'Date Paid');
}

/**
 * Mark one quarter ({q, year}) paid on `date` (a Date), or not paid (date cleared), in the Paid? and Date Paid
 * columns; every other cell and line stays as it was. Adds the Date Paid column the first time it's needed.
 */
export async function setWaterPaid({ q, year }, paid, date = null) {
    const sheet = await readWater();
    if (!sheet || sheet.I.paid < 0) throw new Error(`${WATER_PATH} has no Paid? column`);
    if (paid && date) addPaidDateColumn(sheet);
    const { text, delim, eol, I } = sheet;
    const lines = text.split(/\r?\n/);
    const k = lines.findIndex((line, n) => {
        const qy = n > 0 && parseQuarter(line.split(delim)[I.quarter]);
        return qy && qy.q === q && qy.year === year;
    });
    if (k < 0) throw new Error(`Q${q} ${year} not found in ${WATER_PATH}`);
    const cells = lines[k].split(delim);
    while (cells.length <= Math.max(I.paid, I.paidDate)) cells.push('');
    cells[I.paid] = paid ? 'Yes' : 'No';
    if (I.paidDate >= 0) cells[I.paidDate] = paid && date ? sheetDate(date, false) : '';
    lines[k] = cells.join(delim);
    await fs.writeText(WATER_PATH, lines.join(eol));
}

/**
 * Add one quarter to the sheet, in the same format and order as the rows already there.
 * bill: {q, year, start, end, due?, gallons, rate, flat, fixed, meter, statement, fee, paid (bool), paidDate? (Date)}.
 */
export async function addWaterBill(bill) {
    const sheet = await readWater();
    if (!sheet || !sheet.records.length) throw new Error(`${WATER_PATH} not found`);
    if (bill.paid && bill.paidDate) addPaidDateColumn(sheet);
    const { records, I } = sheet;
    const cells = records[0].map(() => '');
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = String(v); };
    const latest = records[1] || [];
    const { usage, calc } = calcWater(bill);

    set('quarter', quarterText(bill.q, bill.year));
    set('start', sheetDate(bill.start, false));
    set('end', sheetDate(bill.end, false));
    set('due', bill.due ? sheetDate(bill.due, false) : '');
    // The flat-unit rate is text like "$ 22.75/unit"; keep the sheet's wording.
    set('flatRate', I.flatRate >= 0 && latest[I.flatRate]?.trim() ? latest[I.flatRate] : `$ ${bill.flat.toFixed(2)}/unit`);
    set('flat', sheetMoney(bill.flat));
    set('gallons', ` ${Math.round(bill.gallons).toLocaleString('en-US')} `);
    set('rate', `$${bill.rate.toFixed(3)}/1000`);
    set('usage', sheetMoney(usage));
    set('fixed', sheetMoney(bill.fixed));
    set('meter', sheetMoney(bill.meter));
    set('calc', sheetMoney(calc));
    set('statement', sheetMoney(bill.statement));
    set('diff', sheetMoney(round2(calc - bill.statement), true));
    set('fee', sheetMoney(bill.fee));
    set('total', sheetMoney(round2(bill.statement + bill.fee)));
    set('paid', bill.paid ? 'Yes' : 'No');
    set('paidDate', bill.paid && bill.paidDate ? sheetDate(bill.paidDate, false) : '');
    await insertRow(sheet, cells, I.end);
}
