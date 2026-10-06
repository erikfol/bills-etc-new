// Propane for the oven: fill-ups in inputs/propane_oven/master_propane_oven.csv (kept by hand in Excel, comma-separated,
// US dates like 12/07/2022, plain amounts like 21.94). Total cost = propane cost + safety fee + transportation fee.
import { readSheet, insertRow, parseBillDate, parseMoney, num } from './sheet.js';

export const PROPANE_PATH = 'inputs/propane_oven/master_propane_oven.csv';

const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const DAY = 864e5;
export const daysBetween = (a, b) => Math.round((b - a) / DAY);
/** 12/07/2022, the way the sheet writes dates. */
const usDate = d => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

/** Column indexes by meaning, from a sheet read with readSheet. */
const propaneColumns = ({ idx, idxStart }) => ({
    date: idx('date'), gallons: idx('quantity', 'gallons'), propane: idxStart('propane cost'),
    safety: idxStart('safety fee'), transport: idxStart('transportation fee'), total: idxStart('total cost'),
});

async function readPropane() {
    const sheet = await readSheet(PROPANE_PATH);
    if (sheet) sheet.I = propaneColumns(sheet);
    return sheet;
}

/** The parts that add up to Total Cost (blank counts as 0); NaN when there's no propane cost. */
const totalOf = (propane, safety, transport) =>
    Number.isFinite(propane) ? round2(propane + (Number.isFinite(safety) ? safety : 0) + (Number.isFinite(transport) ? transport : 0)) : NaN;

/** The date and amount that make a fill-up a duplicate: date and total cost. */
export const propaneDupKey = (cells, sheet) => {
    const I = propaneColumns(sheet);
    return { date: parseBillDate(cells[I.date]), amount: parseMoney(cells[I.total]), what: 'a fill-up on' };
};

/** Columns worked out from others, which the table editor fills in again when it saves a row. */
export const PROPANE_CALCULATED = 'Total Cost';
/** Work out a fill-up row's Total Cost again, in place, when one of its parts changed. */
export function recalcPropaneRow(cells, sheet, changed) {
    const I = propaneColumns(sheet);
    if (I.total < 0 || ![I.propane, I.safety, I.transport].some(k => changed.has(k))) return;
    const total = totalOf(parseMoney(cells[I.propane]), parseMoney(cells[I.safety]), parseMoney(cells[I.transport]));
    if (Number.isFinite(total)) cells[I.total] = total.toFixed(2);
}

/**
 * Fill-ups, oldest first: {date, gallons, propane, safety, transport, fees (safety + transport), total, price (propane
 * cost per gallon), allIn (total per gallon), days (since the previous fill-up), perMonth (gallons a month since then),
 * year}. Total is the sheet's Total Cost, or the parts added up when it's blank. Returns null if the file doesn't exist.
 */
export async function loadPropane() {
    const sheet = await readPropane();
    if (!sheet) return null;
    const { records, I } = sheet;
    if (!records.length) return { fills: [], missing: [] };
    const missing = ['date', 'gallons', 'propane'].filter(k => I[k] < 0);
    if (missing.length) return { fills: [], missing };
    const cell = (r, k) => (I[k] >= 0 ? r[I[k]] ?? '' : '');

    const fills = records.slice(1).map(r => {
        const date = parseBillDate(cell(r, 'date')), gallons = num(cell(r, 'gallons'));
        const propane = parseMoney(cell(r, 'propane')), safety = parseMoney(cell(r, 'safety')), transport = parseMoney(cell(r, 'transport'));
        const typed = parseMoney(cell(r, 'total'));
        const total = Number.isFinite(typed) ? typed : totalOf(propane, safety, transport);
        const fees = (Number.isFinite(safety) ? safety : 0) + (Number.isFinite(transport) ? transport : 0);
        return {
            date, gallons, propane, safety, transport, fees, total,
            price: gallons > 0 ? propane / gallons : NaN, allIn: gallons > 0 ? total / gallons : NaN,
            year: date?.getFullYear(),
        };
    }).filter(f => f.date && Number.isFinite(f.total));
    fills.sort((a, b) => a.date - b.date);
    fills.forEach((f, k) => {
        const prev = fills[k - 1];
        f.days = prev ? daysBetween(prev.date, f.date) : NaN;
        f.perMonth = f.days > 0 ? f.gallons / f.days * 30.44 : NaN;
    });
    return { fills, missing: [] };
}

/** Add one fill-up ({date, gallons, propane, safety, transport}) in the sheet's format and order; Total Cost is added up. */
export async function addPropaneFill(f) {
    const sheet = await readPropane();
    if (!sheet || !sheet.records.length) throw new Error(`${PROPANE_PATH} not found`);
    const { records, I } = sheet;
    const cells = records[0].map(() => '');
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = v; };
    set('date', usDate(f.date));
    set('gallons', f.gallons.toFixed(1));
    set('propane', f.propane.toFixed(2));
    set('safety', Number.isFinite(f.safety) ? f.safety.toFixed(2) : '');
    set('transport', Number.isFinite(f.transport) ? f.transport.toFixed(2) : '');
    set('total', totalOf(f.propane, f.safety, f.transport).toFixed(2));
    await insertRow(sheet, cells, I.date);
}
