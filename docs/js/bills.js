// Scheduled bills: payments that leave on (roughly) the same day every month or every few months.
// Saved in config.json `scheduled_bills`; a transaction is "scheduled" when its merchant is one of a
// bill's merchants. Nothing is stored per transaction, so changing a bill re-tags all of history.
import * as fs from './fs.js';
import { PATHS, readTable, loadConfig, keyOf, DEFAULT_CONFIG } from './data.js';
import { withParsed } from './finance.js';
import { merchantNameKey } from './merchants.js';
import { yearMonth } from './dates.js';
import { round2, esc } from './util.js';

export const EVERY = { 1: 'Monthly', 2: 'Every 2 months', 3: 'Every 3 months', 6: 'Twice a year', 12: 'Yearly' };
const GRACE_DAYS = 3; // a payment this many days after its due date is still on time

/** Clean list from config.json (bad entries dropped). */
export function parseBills(cfg) {
    return (Array.isArray(cfg?.scheduled_bills) ? cfg.scheduled_bills : [])
        .filter(b => b && typeof b.name === 'string' && b.name.trim())
        .map(b => ({
            ...b,
            name: b.name.trim(),
            merchants: (Array.isArray(b.merchants) ? b.merchants : []).map(m => String(m).trim()).filter(Boolean),
            day: Math.min(31, Math.max(1, Math.round(+b.day) || 1)),
            amount: Number.isFinite(+b.amount) ? Math.abs(+b.amount) : 0,
            varies: !!b.varies,
            every: EVERY[b.every] ? +b.every : 1,
            start: /^\d{4}-\d{2}$/.test(b.start || '') ? b.start : '',
            active: b.active !== false,
        }));
}

export const hasBills = cfg => Array.isArray(cfg?.scheduled_bills);

/** row → the bill it pays, or null. Only money going out counts; with two bills on one merchant, the nearest amount wins. */
export function billMatcher(bills) {
    const byKey = new Map();
    for (const b of bills) for (const m of b.merchants) {
        const k = merchantNameKey(m);
        if (k) byKey.set(k, [...(byKey.get(k) || []), b]);
    }
    return row => {
        const amt = row._amt ?? +String(row.Amount ?? '').replace(/[$,]/g, '');
        if (!(amt < 0)) return null;
        const list = byKey.get(merchantNameKey(row['Cleaned Merchant']));
        if (!list) return null;
        if (list.length === 1) return list[0];
        return [...list].sort((a, b) => Math.abs(a.amount + amt) - Math.abs(b.amount + amt))[0];
    };
}

/** "Scheduled" label for tables: the bill's name, "Unscheduled" for other money out, '' for money in. */
export function scheduleLabel(row, match) {
    const bill = match(row);
    if (bill) return bill.name;
    const amt = row._amt ?? +String(row.Amount ?? '').replace(/[$,]/g, '');
    return amt < 0 ? 'Unscheduled' : '';
}

/** Table column (datatable.js): the bill a transaction pays, or "Unscheduled". */
export const schedColumn = match => ({
    id: 'sched', label: 'Scheduled', value: r => scheduleLabel(r, match),
    cell: r => schedTag(scheduleLabel(r, match)),
});
export const schedTag = v => !v ? '' : v === 'Unscheduled' ? '<span class="sched-tag unsched">Unscheduled</span>' : `<span class="sched-tag">${esc(v)}</span>`;

const ymIndex = ym => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1;
const ymOf = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
export const addMonths = (ym, n) => ymOf(ymIndex(ym) + n);

/** The bill's due date in month `ym` (day clipped to the month's length). */
export function dueDate(bill, ym) {
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
    return new Date(y, m, Math.min(bill.day, new Date(y, m + 1, 0).getDate()));
}

/** Whether the bill is expected in month `ym`. */
export function dueIn(bill, ym) {
    if (!bill.active) return false;
    if (bill.every === 1) return !bill.start || ym >= bill.start;
    if (!bill.start || ym < bill.start) return false;
    return (ymIndex(ym) - ymIndex(bill.start)) % bill.every === 0;
}

/** The month a payment belongs to: the one whose due date is nearest (a bill due the 1st paid on the 30th counts for the next month). */
export function paymentMonth(bill, date) {
    const here = yearMonth(date);
    let best = here, gap = Infinity;
    for (const o of [-1, 0, 1]) {
        const ym = addMonths(here, o);
        const g = Math.abs(date - dueDate(bill, ym));
        if (g < gap) { gap = g; best = ym; }
    }
    return best;
}

/** Master history plus the current month (rows in both counted once), parsed. */
export async function allTransactions() {
    const master = (await readTable(PATHS.master))?.rows || [];
    const processed = (await readTable(PATHS.processed))?.rows || [];
    const seen = new Set(master.map(keyOf));
    return withParsed([...master, ...processed.filter(r => !seen.has(keyOf(r)))]).filter(r => r._date);
}

/** Month of a bill's first payment ever (from paymentsByMonth), or ''. Months before it aren't "missed". */
export const firstPaid = months => [...(months?.keys() || [])].sort()[0] || '';

/** Map bill name → Map(ym → [payments]) over `rows`. */
export function paymentsByMonth(bills, rows) {
    const match = billMatcher(bills);
    const out = new Map(bills.map(b => [b.name, new Map()]));
    for (const r of rows) {
        const b = match(r);
        if (!b) continue;
        const ym = paymentMonth(b, r._date);
        const m = out.get(b.name);
        m.set(ym, [...(m.get(ym) || []), r]);
    }
    return out;
}

const DAY = 86400000;

/**
 * One bill in one month: { bill, due (bool), dueOn, payments, paid, expected, status, lateDays, changed }.
 * status: paid | late-paid | due | late | missed | unknown (due date passed but bank data doesn't reach it yet) | none.
 * `dataThrough` = newest transaction date loaded; `today` = now; `since` = first month paid (when the bill has no start month).
 */
export function billMonth(bill, ym, payments, { dataThrough, today = new Date(), since = '' }) {
    const due = dueIn(bill, ym) && (bill.start || !since || ym >= since);
    const dueOn = dueDate(bill, ym);
    const list = payments || [];
    const paid = round2(list.reduce((a, r) => a - r._amt, 0));
    const expected = bill.amount;
    let status = 'none', lateDays = 0;
    if (list.length) {
        const first = list.map(r => r._date).sort((a, b) => a - b)[0];
        lateDays = Math.round((first - dueOn) / DAY);
        status = lateDays > GRACE_DAYS ? 'late-paid' : 'paid';
    } else if (due) {
        const graceEnd = new Date(dueOn.getTime() + GRACE_DAYS * DAY);
        if (ym < yearMonth(today) && dataThrough && graceEnd <= dataThrough) status = 'missed';
        else if (graceEnd > today) status = 'due';
        else if (dataThrough && graceEnd <= dataThrough) status = 'late';
        else status = 'unknown';
    }
    const changed = !!list.length && !bill.varies && expected > 0 && Math.abs(paid - expected) > Math.max(1, expected * 0.02);
    return { bill, ym, due, dueOn, payments: list, paid, expected, status, lateDays, changed };
}

export const STATUS = {
    paid: ['badge-ok', 'Paid'],
    'late-paid': ['badge-warn', 'Paid late'],
    due: ['badge-neutral', 'Due'],
    late: ['badge-over', 'Late'],
    missed: ['badge-over', 'Missed'],
    unknown: ['badge-neutral', 'Not loaded yet'],
    none: ['badge-neutral', 'Not due'],
};

/**
 * Merchants that look like scheduled bills: in the last 12 months, at most two charges a month,
 * and either landing within ~3 days of the same day each month or for a steady amount.
 * Returns [{ merchant, names, category, day, amount, varies, months, lastSeen, reason }].
 */
export function suggestBills(rows, bills, ignored = []) {
    const taken = new Set(bills.flatMap(b => b.merchants.map(merchantNameKey)));
    const skip = new Set(ignored.map(merchantNameKey));
    const out = rows.filter(r => r._amt < 0 && r['AI Category'] !== 'Income' && String(r['Cleaned Merchant'] ?? '').trim());
    if (!out.length) return [];
    const end = out.reduce((a, r) => (r._date > a ? r._date : a), out[0]._date);
    const from = new Date(end.getFullYear(), end.getMonth() - 11, 1); // the last 12 calendar months
    const groups = new Map();
    for (const r of out) {
        if (r._date < from || r._date > end) continue;
        const k = merchantNameKey(r['Cleaned Merchant']);
        if (!k || taken.has(k) || skip.has(k)) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
    const result = [];
    for (const list of groups.values()) {
        const byYm = new Map();
        for (const r of list) byYm.set(r._ym, [...(byYm.get(r._ym) || []), r]);
        if (byYm.size < 4 || [...byYm.values()].some(v => v.length > 2)) continue;
        const lastSeen = list.reduce((a, r) => (r._date > a ? r._date : a), list[0]._date);
        if ((end - lastSeen) / DAY > 62) continue; // stopped
        // One payment per month: the earliest.
        const firsts = [...byYm.values()].map(v => [...v].sort((a, b) => a._date - b._date)[0]);
        const days = firsts.map(r => r._date.getDate());
        const amts = [...byYm.values()].map(v => -v.reduce((a, r) => a + r._amt, 0));
        const day = Math.round(median(days));
        const near = days.filter(d => Math.min(Math.abs(d - day), 30 - Math.abs(d - day)) <= 3).length / days.length;
        const amount = round2(median(amts));
        const steady = amts.filter(a => Math.abs(a - amount) <= Math.max(1, amount * 0.02)).length / amts.length;
        const sameDay = near >= 0.75;
        if (!sameDay && !(steady >= 0.75 && byYm.size >= 6)) continue;
        const count = (arr, f) => { const m = new Map(); for (const x of arr) { const v = f(x); m.set(v, (m.get(v) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
        result.push({
            merchant: count(list, r => String(r['Cleaned Merchant']).trim())[0][0],
            names: [...new Set(list.map(r => String(r['Cleaned Merchant']).trim()))],
            category: count(list, r => r['AI Category'] || '')[0][0],
            day, amount, varies: steady < 0.75, months: byYm.size, lastSeen,
            reason: sameDay ? 'same day each month' : 'same amount each month (day varies)',
        });
    }
    return result.sort((a, b) => a.day - b.day);
}

/** Monthly equivalent of the active bills, for config.json `fixed_expenses` (the Python scripts read it). */
const fixedFrom = bills => Object.fromEntries(bills.filter(b => b.active).map(b => [b.name, round2(b.amount / b.every)]));

/** Save the bills (and keep `fixed_expenses` in step). The first save keeps a copy of the old fixed expenses. */
export async function saveBills(bills, extra = {}) {
    const cfg = (await loadConfig()) || structuredClone(DEFAULT_CONFIG);
    if (!hasBills(cfg) && cfg.fixed_expenses && !cfg._fixed_expenses_before_bills) {
        cfg._fixed_expenses_before_bills = cfg.fixed_expenses;
    }
    cfg.scheduled_bills = bills.map(b => {
        const o = { name: b.name, merchants: b.merchants, day: b.day, amount: round2(b.amount), varies: !!b.varies, every: b.every };
        if (b.start) o.start = b.start;
        if (!b.active) o.active = false;
        if (b.notes) o.notes = b.notes;
        return o;
    });
    const notes = Object.fromEntries(Object.entries(cfg.fixed_expenses || {}).filter(([k]) => k.startsWith('_') && k !== '_note'));
    cfg.fixed_expenses = {
        _note: 'Kept in step with the Bills page (monthly equivalent of each active bill). Edit your bills there.',
        ...notes, ...fixedFrom(parseBills(cfg)),
    };
    Object.assign(cfg, extra);
    await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
    return cfg;
}
