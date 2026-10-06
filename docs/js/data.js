// Paths and file formats shared with the Python scripts.
import * as fs from './fs.js';
import { parseCSV, toCSV } from './csv.js';
import { normalizeDateCell, parseDate } from './dates.js';
import { amountOf } from './util.js';

export const PATHS = {
    pastMonths: 'inputs/past_months',
    currentMonth: 'inputs/current_month',
    master: 'output_master_data/all_time_finances.csv',
    processed: 'output_master_data/processed_current_month.csv',
    cache: 'output_master_data/categorized_cache.csv',
    config: 'config.json',
};

export const MASTER_COLS = ['Transaction Type', 'Date', 'Description', 'Amount',
    'Reference No.', 'Credits', 'Debits', 'Cleaned Merchant', 'AI Category', 'Notes'];
export const CACHE_COLS = ['Date', 'Description', 'Amount', 'AI Category', 'Cleaned Merchant'];

const SENSITIVE = ['account', 'routing', 'balance', 'card number', 'ssn', 'address'];

export async function readTable(path) {
    const text = await fs.readText(path);
    return text == null ? null : parseCSV(text);
}

export async function writeTable(path, table) {
    await fs.writeText(path, toCSV(table.columns, table.rows));
}

/** Read a raw bank export: drop sensitive columns and normalize dates to DD-Mmm-YY. */
export async function readBankCsv(path) {
    const table = await readTable(path);
    const dropped = table.columns.filter(c => SENSITIVE.some(s => c.toLowerCase().includes(s)));
    const columns = table.columns.filter(c => !dropped.includes(c));
    const rows = table.rows.map(r => {
        const o = Object.fromEntries(columns.map(c => [c, r[c]]));
        if ('Date' in o) o.Date = normalizeDateCell(o.Date);
        return o;
    });
    return { columns, rows, dropped };
}

/** Dedup key: date → DD-Mmm-YY, amount → 2dp, description trimmed of whitespace/quotes. */
export function rowKey(date, desc, amount) {
    const d = parseDate(date);
    const dateStr = d ? normalizeDateCell(date) : String(date ?? '').trim();
    const a = amountOf(amount);
    const amtStr = Number.isFinite(a) ? a.toFixed(2) : String(amount ?? '').trim();
    const descStr = String(desc ?? '').trim().replace(/^"+|"+$/g, '');
    return `${dateStr}\u0001${descStr}\u0001${amtStr}`;
}

export const keyOf = r => rowKey(r.Date, r.Description, r.Amount);

export async function loadConfig() {
    const text = await fs.readText(PATHS.config);
    if (text == null) return null;
    return JSON.parse(text);
}

/** Same rules as script 3's load_config: keys starting with _ are ignored. */
export function parseConfig(cfg) {
    const isNum = v => typeof v === 'number' && Number.isFinite(v);
    const income = Object.entries(cfg)
        .filter(([k, v]) => k.startsWith('monthly_income') && isNum(v))
        .reduce((a, [, v]) => a + v, 0);
    const fixed = Object.fromEntries(Object.entries(cfg.fixed_expenses || {})
        .filter(([k, v]) => !k.startsWith('_') && isNum(v)));
    const variableCats = (cfg.variable_categories || []).filter(c => typeof c === 'string' && !c.startsWith('_'));
    return { income, fixed, variableCats };
}

export const DEFAULT_CONFIG = {
    _readme: 'BillsEtc config — copy this file to config.json and fill in your expected monthly values. Keys starting with _ are ignored by the scripts.',
    _income_note: 'Your typical monthly take-home pay (after taxes). Do not count bonuses or tax refunds here.',
    monthly_income_tt: 0,
    fixed_expenses: {
        _note: 'Bills that hit every month for the same (or nearly the same) amount.',
    },
    variable_categories: [
        '_note: These categories are day-scaled from your partial month data to project the full month.',
        'Groceries', 'Dining Out', 'Entertainment', 'Shopping', 'Transport', 'Gas', 'Miscellaneous', 'Utilities',
    ],
    _projection_note: 'Projection formula (GUI): projected_variable = spent_so_far + days_left * (w * spent_so_far / days_elapsed + (1 - w) * historical_avg / days_in_month), w = days_elapsed / days_in_month (no history: pace alone). Fixed expenses are added on top regardless of partial data.',
};
