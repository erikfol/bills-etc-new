// Property taxes (Enfield, NH): inputs/taxes_property_enfield/master_taxes_property.csv, one row per half-year bill.
// NH bills twice a year: the 1st half is an estimate at roughly half the rate; the 2nd half uses the year's full rate
// and makes up the rest, so the year's tax is the two halves added together.
import { readSheet, insertRow, parseBillDate, parseMoney, num, sheetMoney } from './sheet.js';

export const TAX_PATH = 'inputs/taxes_property_enfield/master_taxes_property.csv';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
/** 'Nov 19 2025', the sheet's date format. */
export const taxDate = d => `${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
/** Whole-dollar money as the sheet writes assessments: ' $380,300 '. */
const dollars = v => ` $${Math.round(v).toLocaleString('en-US')} `;

/** Column indexes by meaning, from a sheet read with readSheet. */
const taxColumns = ({ idx, idxStart }) => ({
    year: idx('year'), half: idx('half'), billed: idx('billing date'), due: idx('payment due'), amount: idx('amount due'),
    county: idx('county rate'), school: idx('school rate'), town: idx('town rate'), state: idxStart('state education'),
    rate: idx('total tax rate'), land: idx('taxable land'), buildings: idx('buildings'), assessed: idx('total'),
    annual: idx('annual tax bill'), monthly: idxStart('monthly payment'), increase: idxStart('increase'),
    notes: idx('notes', 'noes'),
});

/**
 * Bills, oldest first: {year, half (1|2), billed, due, amount, rates: {county, school, town, state}, rate (total per
 * $1,000), land, buildings, assessed, annual (on the 2nd half), monthly (mortgage payment with escrow), increase, notes}.
 * Returns null if the file doesn't exist.
 */
export async function loadTaxes() {
    const sheet = await readSheet(TAX_PATH);
    if (!sheet) return null;
    const { records } = sheet, I = taxColumns(sheet);
    if (!records.length) return { bills: [], missing: [] };
    const missing = ['year', 'half', 'amount'].filter(k => I[k] < 0);
    if (missing.length) return { bills: [], missing };
    const cell = (r, k) => (I[k] >= 0 ? r[I[k]] ?? '' : '');
    const m = (r, k) => parseMoney(cell(r, k));
    const bills = records.slice(1).map(r => ({
        year: num(cell(r, 'year')),
        half: parseInt(cell(r, 'half'), 10),
        billed: parseBillDate(cell(r, 'billed')), due: parseBillDate(cell(r, 'due')),
        amount: m(r, 'amount'),
        rates: { county: m(r, 'county'), school: m(r, 'school'), town: m(r, 'town'), state: m(r, 'state') },
        rate: m(r, 'rate'),
        land: m(r, 'land'), buildings: m(r, 'buildings'), assessed: m(r, 'assessed'),
        annual: m(r, 'annual'), monthly: m(r, 'monthly'), increase: m(r, 'increase'),
        notes: cell(r, 'notes').trim(),
    })).filter(b => Number.isFinite(b.year) && (b.half === 1 || b.half === 2) && Number.isFinite(b.amount));
    bills.sort((a, b) => a.year - b.year || a.half - b.half);
    return { bills, missing: [] };
}

/** Columns worked out from others, which the table editor fills in again when it saves a row. */
export const TAX_CALCULATED = 'Total Tax Rate and Total (assessed value)';
/** Work out a row's total rate and assessed total again, in place — only when the cells they come from changed. */
export function recalcTaxRow(cells, sheet, changed) {
    const I = taxColumns(sheet);
    const touched = (...keys) => keys.some(k => changed.has(I[k]));
    const m = k => parseMoney(cells[I[k]]);
    const parts = ['county', 'school', 'town', 'state'].map(m);
    if (touched('county', 'school', 'town', 'state') && I.rate >= 0 && parts.every(Number.isFinite)) cells[I.rate] = sheetMoney(round2(parts.reduce((a, b) => a + b, 0)));
    if (touched('land', 'buildings') && I.assessed >= 0 && Number.isFinite(m('land')) && Number.isFinite(m('buildings'))) cells[I.assessed] = dollars(m('land') + m('buildings'));
}

/**
 * Add one half-year bill, in the same format and order as the rows already there.
 * b: {year, half, billed, due, amount, county, school, town, state, land, buildings, monthly?, increase?, notes?}.
 * The 2nd half also gets the year's Annual Tax Bill (this half + the 1st half already in the file).
 */
export async function addTaxBill(b, firstHalfAmount = NaN) {
    const sheet = await readSheet(TAX_PATH);
    if (!sheet || !sheet.records.length) throw new Error(`${TAX_PATH} not found`);
    const I = taxColumns(sheet);
    const cells = sheet.records[0].map(() => '');
    const set = (k, v) => { if (I[k] >= 0) cells[I[k]] = String(v); };
    set('year', b.year);
    set('half', `${b.half} of 2`);
    set('billed', b.billed ? taxDate(b.billed) : '');
    set('due', b.due ? taxDate(b.due) : '');
    set('amount', sheetMoney(b.amount));
    for (const k of ['county', 'school', 'town', 'state']) set(k, sheetMoney(b[k]));
    set('rate', sheetMoney(round2(b.county + b.school + b.town + b.state)));
    set('land', dollars(b.land));
    set('buildings', dollars(b.buildings));
    set('assessed', dollars(b.land + b.buildings));
    set('annual', b.half === 2 && Number.isFinite(firstHalfAmount) ? sheetMoney(round2(b.amount + firstHalfAmount)) : 'n/a');
    set('monthly', Number.isFinite(b.monthly) ? sheetMoney(b.monthly) : '');
    set('increase', Number.isFinite(b.increase) ? sheetMoney(b.increase, true) : '');
    set('notes', String(b.notes || '').replace(/[\t\r\n]+/g, ' ').trim());
    await insertRow(sheet, cells, I.billed);
}
