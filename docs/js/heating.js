// Home heating oil: deliveries in inputs/heat_home/master_heat_home.csv and Heatable price checks in
// inputs/heat_home/heatable_cost_trend.csv (both kept by hand, usually tab-separated from Excel).
import * as fs from './fs.js';
import { readSheet, insertRow, addColumn, parseBillDate, parseMoney, num, sheetDate, sheetMoney } from './sheet.js';

export const HEAT_PATH = 'inputs/heat_home/master_heat_home.csv';
export const PRICE_PATH = 'inputs/heat_home/heatable_cost_trend.csv';

const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100; // 4.93 × 148.5 = 732.105 → 732.11
const DAY = 864e5;
export const daysBetween = (a, b) => Math.round((b - a) / DAY);

/** Heating season (Jul 1 – Jun 30) a date falls in, named by the year it starts: Feb 6, 2026 → 2025. */
export const seasonOf = d => (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
/** 2025 → '2025–26' */
export const seasonLabel = y => `${y}–${String(y + 1).slice(2)}`;

/** The deliveries sheet plus its column indexes by meaning. */
/** Column indexes by meaning, from a sheet read with readSheet. */
const deliveryColumns = ({ idx, idxStart }) => ({
        date: idx('date delivered'), last: idx('last delivery'), days: idxStart('days since'),
        provider: idx('provider'), price: idx('price/gal'), gallons: idx('gallons'),
        calc: idx('calc price'), actual: idx('actual price'), extra: idx('extra fees'),
        perDay: idx('gal/day used'), notes: idx('notes'), paidBack: idxStart('paid cc back'),
        paidBackDate: idx('date paid back'),
});

async function readDeliveries() {
    const sheet = await readSheet(HEAT_PATH);
    if (sheet) sheet.I = deliveryColumns(sheet);
    return sheet;
}

/** Columns worked out from others, which the table editor fills in again when it saves a row. */
export const DELIVERY_CALCULATED = 'Days since last delivery, Calc Price, Extra Fees and Gal/Day Used';
/**
 * Work out a delivery row's calculated cells (days, calc price, extra fees, gal/day) again, in place — only those
 * whose inputs are among the `changed` column indexes.
 */
export function recalcDeliveryRow(cells, sheet, changed) {
    const I = deliveryColumns(sheet);
    const touched = (...keys) => keys.some(k => changed.has(I[k]));
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = v; };
    const date = parseBillDate(cells[I.date]), last = parseBillDate(cells[I.last]);
    const price = parseMoney(cells[I.price]), gallons = num(cells[I.gallons]), actual = parseMoney(cells[I.actual]);
    const days = date && last ? daysBetween(last, date) : NaN;
    if (touched('date', 'last') && Number.isFinite(days)) set('days', String(days));
    if (touched('price', 'gallons') && Number.isFinite(price) && Number.isFinite(gallons)) set('calc', sheetMoney(round2(price * gallons)));
    const calc = parseMoney(cells[I.calc]);
    if (touched('price', 'gallons', 'actual') && Number.isFinite(actual) && Number.isFinite(calc)) set('extra', `$${round2(actual - calc).toFixed(2)}`);
    if (touched('date', 'last', 'gallons') && days > 0 && Number.isFinite(gallons)) set('perDay', (gallons / days).toFixed(2));
}

/**
 * Deliveries, oldest first: {date, last, days, provider, price (per gal), gallons, calc, actual, extra, perDay
 * (gallons ÷ days since the previous delivery — a fill-up replaces what was burned), notes, paidBack, isPaidBack,
 * paidBackDate, year, season (see seasonOf)}.
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
            paidBackDate: parseBillDate(cell(r, 'paidBackDate')),
            year: date?.getFullYear(), season: date ? seasonOf(date) : null,
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
 * d: {date, provider, price, gallons, actual, notes?, paidBack ('Yes' / 'Not Yet' / 'Need To Check'), paidBackDate? (Date)}.
 * Last delivery, days since, calc price, extra fees and gal/day are worked out from the latest delivery before it.
 */
export async function addDelivery(d, previous) {
    const sheet = await readDeliveries();
    if (!sheet || !sheet.records.length) throw new Error(`${HEAT_PATH} not found`);
    const paidOn = /^y/i.test(d.paidBack) && d.paidBackDate;
    if (paidOn && sheet.I.paidBackDate < 0) sheet.I.paidBackDate = addColumn(sheet, 'Date Paid Back');
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
    set('paidBackDate', paidOn ? sheetDate(d.paidBackDate, false) : '');
    await insertRow(sheet, cells, I.date);
}

/**
 * Set the "Paid CC Back?" column of the delivery on `date` (a Date) to `value`, and its Date Paid Back to `paidOn`
 * (cleared unless the value is Yes). Adds the Date Paid Back column the first time it's needed; nothing else changes.
 */
export async function setPaidBack(date, value, paidOn = null) {
    const sheet = await readDeliveries();
    if (!sheet || sheet.I.paidBack < 0) throw new Error(`${HEAT_PATH} has no Paid CC Back? column`);
    const yes = /^y/i.test(value);
    if (yes && paidOn && sheet.I.paidBackDate < 0) sheet.I.paidBackDate = addColumn(sheet, 'Date Paid Back');
    const { text, delim, eol, I } = sheet;
    const lines = text.split(/\r?\n/);
    const k = lines.findIndex((line, n) => n > 0 && parseBillDate(line.split(delim)[I.date])?.getTime() === date.getTime());
    if (k < 0) throw new Error(`No delivery on that date in ${HEAT_PATH}`);
    const cells = lines[k].split(delim);
    while (cells.length <= Math.max(I.paidBack, I.paidBackDate)) cells.push('');
    cells[I.paidBack] = value;
    if (I.paidBackDate >= 0) cells[I.paidBackDate] = yes && paidOn ? sheetDate(paidOn, false) : '';
    lines[k] = cells.join(delim);
    await fs.writeText(HEAT_PATH, lines.join(eol));
}
