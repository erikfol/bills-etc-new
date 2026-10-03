// Home heating oil: deliveries in inputs/heat_home/master_heat_home.csv and Heatable price checks in
// inputs/heat_home/heatable_cost_trend.csv (both kept by hand, usually tab-separated from Excel).
import * as fs from './fs.js';
import { readSheet, insertRow, parseBillDate, parseMoney, num, sheetDate, sheetMoney } from './sheet.js';

export const HEAT_PATH = 'inputs/heat_home/master_heat_home.csv';
export const PRICE_PATH = 'inputs/heat_home/heatable_cost_trend.csv';

const round2 = n => Math.round(n * 100) / 100;
const DAY = 864e5;
export const daysBetween = (a, b) => Math.round((b - a) / DAY);

/** The deliveries sheet plus its column indexes by meaning. */
async function readDeliveries() {
    const sheet = await readSheet(HEAT_PATH);
    if (!sheet) return null;
    const { idx, idxStart } = sheet;
    sheet.I = {
        date: idx('date delivered'), last: idx('last delivery'), days: idxStart('days since'),
        provider: idx('provider'), price: idx('price/gal'), gallons: idx('gallons'),
        calc: idx('calc price'), actual: idx('actual price'), extra: idx('extra fees'),
        perDay: idx('gal/day used'), notes: idx('notes'), paidBack: idxStart('paid cc back'),
    };
    return sheet;
}

/**
 * Deliveries, oldest first: {date, last, days, provider, price (per gal), gallons, calc, actual, extra, perDay
 * (gallons ÷ days since the previous delivery — a fill-up replaces what was burned), notes, paidBack, isPaidBack, year}.
 * Returns null if the file doesn't exist.
 */
export async function loadDeliveries() {
    const sheet = await readDeliveries();
    if (!sheet) return null;
    const { records, I } = sheet;
    if (!records.length) return { deliveries: [], missing: [] };
    const missing = ['date', 'gallons', 'actual'].filter(k => I[k] < 0);
    if (missing.length) return { deliveries: [], missing };
    const cell = (r, k) => (I[k] >= 0 ? r[I[k]] ?? '' : '');

    const deliveries = records.slice(1).map(r => {
        const date = parseBillDate(cell(r, 'date')), gallons = num(cell(r, 'gallons'));
        const paidBack = cell(r, 'paidBack').trim();
        return {
            date, last: parseBillDate(cell(r, 'last')),
            provider: cell(r, 'provider').trim(),
            price: parseMoney(cell(r, 'price')), gallons,
            calc: parseMoney(cell(r, 'calc')), actual: parseMoney(cell(r, 'actual')), extra: parseMoney(cell(r, 'extra')),
            notes: cell(r, 'notes').trim(),
            paidBack, isPaidBack: /^y/i.test(paidBack),
            year: date?.getFullYear(),
        };
    }).filter(d => d.date && Number.isFinite(d.actual));
    deliveries.sort((a, b) => a.date - b.date);
    deliveries.forEach((d, k) => {
        const prev = deliveries[k - 1]?.date || d.last;
        d.days = prev ? daysBetween(prev, d.date) : NaN;
        d.perDay = d.days > 0 ? d.gallons / d.days : NaN;
    });
    return { deliveries, missing: [] };
}

/** Price checks, oldest first: {date, price}. Returns [] if the file doesn't exist. */
export async function loadPriceChecks() {
    const sheet = await readSheet(PRICE_PATH);
    if (!sheet || !sheet.records.length) return [];
    const di = sheet.idxStart('date'), pi = sheet.idxStart('cost');
    if (di < 0 || pi < 0) return [];
    return sheet.records.slice(1)
        .map(r => ({ date: parseBillDate(r[di]), price: parseMoney(r[pi]) }))
        .filter(c => c.date && Number.isFinite(c.price))
        .sort((a, b) => a.date - b.date);
}

/** Add one price check ({date, price}) to the price sheet, keeping its order. */
export async function addPriceCheck({ date, price }) {
    const sheet = await readSheet(PRICE_PATH);
    if (!sheet || !sheet.records.length) throw new Error(`${PRICE_PATH} not found`);
    const di = sheet.idxStart('date'), pi = sheet.idxStart('cost');
    const cells = sheet.records[0].map(() => '');
    cells[di] = sheetDate(date, false);
    cells[pi] = price.toFixed(2);
    await insertRow(sheet, cells, di);
}

/**
 * Add one delivery to the sheet, in the same format and order as the rows already there.
 * d: {date, provider, price, gallons, actual, notes?, paidBack ('Yes' / 'Not Yet' / 'Need To Check')}.
 * Last delivery, days since, calc price, extra fees and gal/day are worked out from the latest delivery before it.
 */
export async function addDelivery(d, previous) {
    const sheet = await readDeliveries();
    if (!sheet || !sheet.records.length) throw new Error(`${HEAT_PATH} not found`);
    const { records, I } = sheet;
    const cells = records[0].map(() => '');
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = String(v); };
    const calc = round2(d.price * d.gallons);
    const days = previous ? daysBetween(previous, d.date) : NaN;

    set('date', sheetDate(d.date, false));
    set('last', previous ? sheetDate(previous, false) : 'n/a');
    set('days', Number.isFinite(days) ? days : 'n/a');
    set('provider', d.provider);
    set('price', sheetMoney(d.price));
    set('gallons', d.gallons);
    set('calc', sheetMoney(calc));
    set('actual', sheetMoney(d.actual));
    set('extra', `$${round2(d.actual - calc).toFixed(2)}`);
    set('perDay', days > 0 ? (d.gallons / days).toFixed(2) : 'na');
    set('notes', String(d.notes || '').replace(/[\t\r\n]+/g, ' ').trim());
    set('paidBack', d.paidBack);
    await insertRow(sheet, cells, I.date);
}

/** Set the "Paid CC Back?" column of the delivery on `date` (a Date), leaving everything else as it was. */
export async function setPaidBack(date, value) {
    const sheet = await readDeliveries();
    if (!sheet || sheet.I.paidBack < 0) throw new Error(`${HEAT_PATH} has no Paid CC Back? column`);
    const { text, delim, eol, I } = sheet;
    const lines = text.split(/\r?\n/);
    const k = lines.findIndex((line, n) => n > 0 && parseBillDate(line.split(delim)[I.date])?.getTime() === date.getTime());
    if (k < 0) throw new Error(`No delivery on that date in ${HEAT_PATH}`);
    const cells = lines[k].split(delim);
    while (cells.length <= I.paidBack) cells.push('');
    cells[I.paidBack] = value;
    lines[k] = cells.join(delim);
    await fs.writeText(HEAT_PATH, lines.join(eol));
}
