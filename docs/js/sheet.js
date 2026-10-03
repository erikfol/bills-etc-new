// Hand-kept utility sheets (inputs/<utility>/master_<utility>.csv): usually tab-separated from Excel,
// with dates like 22/Jul/2026 and Excel accounting amounts like ' $25.15 ' / ' $(1,003.21)'.
import * as fs from './fs.js';
import { parseRecords } from './csv.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/** ' $(1,003.21)' → -1003.21 (accounting negatives), ' $25.15 ' → 25.15, ' $ -   ' → 0, 'na' → NaN. */
export function parseMoney(s) {
    s = String(s ?? '').trim();
    const neg = /^\(.*\)$/.test(s.replace(/\$/g, '').trim()) || s.startsWith('-');
    const n = Number(s.replace(/[$,()\s-]/g, ''));
    return s === '' || Number.isNaN(n) ? NaN : neg ? -n : n;
}

/** '  6,950 ' → 6950; blank → NaN. */
export const num = s => { const t = String(s ?? '').replace(/,/g, '').trim(); return t === '' ? NaN : Number(t); };

/** 22/Jul/2026 (pad: 01/Jan/2026 vs 1/Jan/2026, to match the sheet). */
export const sheetDate = (d, pad = true) => `${pad ? String(d.getDate()).padStart(2, '0') : d.getDate()}/${MON[d.getMonth()]}/${d.getFullYear()}`;

/** Excel accounting format: ' $25.15 ', ' $(1,003.21)', and ' $ -   ' for zero when `dashZero`. */
export function sheetMoney(v, dashZero = false) {
    if (dashZero && Math.abs(v) < 0.005) return ' $ -   ';
    const t = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v < 0 ? ` $(${t})` : ` $${t} `;
}

/**
 * The raw sheet: {text, delim, eol, records, head (lower-case headers)}; null if the file doesn't exist.
 * idx(...names) finds a column by exact header (last match wins); idxStart(prefix) by header prefix.
 */
export async function readSheet(path) {
    const text = await fs.readText(path);
    if (text == null) return null;
    const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
    const delim = firstLine.includes('\t') ? '\t' : ',';
    const records = parseRecords(text, delim);
    const head = (records[0] || []).map(h => h.trim().toLowerCase());
    const idx = (...names) => { for (const n of names) { const i = head.lastIndexOf(n); if (i >= 0) return i; } return -1; };
    const idxStart = prefix => head.findIndex(h => h.startsWith(prefix));
    return { path, text, delim, eol: text.includes('\r\n') ? '\r\n' : '\n', records, head, idx, idxStart };
}

/**
 * Write one new row (cells in header order) into the sheet, keeping its order: at the top when it's kept
 * newest first (judged by the dates in column `endCol`), otherwise at the bottom.
 */
export async function insertRow(sheet, cells, endCol) {
    const { path, text, delim, eol, records } = sheet;
    const line = cells.map(c => (delim === ',' && /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(delim);
    const rows = records.slice(1);
    const endOf = r => parseBillDate(r[endCol])?.getTime() ?? 0;
    const newestFirst = rows.length < 2 || endOf(rows[0]) >= endOf(rows.at(-1));
    const lines = text.split(/\r?\n/);
    const trailing = lines.at(-1) === '' ? lines.pop() : null;
    if (newestFirst) lines.splice(1, 0, line);
    else lines.push(line);
    if (trailing !== null) lines.push('');
    await fs.writeText(path, lines.join(eol));
}

/**
 * Add a column named `name` at the end of the sheet (in memory: text, records) and return its index.
 * Every existing row gets an empty cell for it, so the file stays rectangular.
 */
export function addColumn(sheet, name) {
    const { delim, eol } = sheet;
    const lines = sheet.text.split(/\r?\n/);
    const width = lines[0].split(delim).length + 1;
    sheet.text = lines.map((line, n) => {
        if (n === 0) return line + delim + name;
        if (line === '') return line;
        const cells = line.split(delim);
        while (cells.length < width) cells.push('');
        return cells.join(delim);
    }).join(eol);
    sheet.records = sheet.records.map(r => { const c = [...r]; while (c.length < width) c.push(''); return c; });
    sheet.records[0][width - 1] = name;
    return width - 1;
}
