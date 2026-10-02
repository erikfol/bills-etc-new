// Date helpers mirroring pandas `to_datetime(format='mixed')` for the formats the bank / Excel produce.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

const fullYear = y => { y = +y; return y < 100 ? (y < 69 ? 2000 + y : 1900 + y) : y; };
const monthIndex = s => MONTHS.findIndex(m => m.toLowerCase() === s.slice(0, 3).toLowerCase());

function make(y, mo, d) {
    if (mo < 0 || mo > 11) return null;
    const dt = new Date(y, mo, d);
    return dt.getMonth() === mo && dt.getDate() === d ? dt : null;
}

export function parseDate(value) {
    const s = String(value ?? '').trim().replace(/^"|"$/g, '');
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return make(+m[1], m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return make(fullYear(m[3]), m[1] - 1, +m[2]);
    if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})\.?[-\s,]+(\d{2,4})$/))) return make(fullYear(m[3]), monthIndex(m[2]), +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,})\.?[-\s](\d{1,2}),?[-\s]+(\d{2,4})$/))) return make(fullYear(m[3]), monthIndex(m[1]), +m[2]);
    return null;
}

const pad = n => String(n).padStart(2, '0');

/** DD-Mmm-YY, the format the scripts store (strftime '%d-%b-%y'). */
export const fmtDate = d => `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;

/** 'YYYY-MM' period key. */
export const yearMonth = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** '2025-12' -> 'Dec 2025' */
export function monthLabel(ym) {
    const [y, m] = ym.split('-');
    return `${MONTHS[+m - 1]} ${y}`;
}

export function longMonthLabel(ym) {
    const [y, m] = ym.split('-');
    return `${MONTH_NAMES[+m - 1]} ${y}`;
}

/** Normalize a date cell to DD-Mmm-YY, or '' if it can't be parsed (pandas NaT). */
export function normalizeDateCell(value) {
    const d = parseDate(value);
    return d ? fmtDate(d) : '';
}
