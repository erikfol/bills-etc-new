// Left to spend this month: expected paychecks − scheduled bills − savings transfers − everything else spent.
// Paydays and the per-paycheck savings transfer are learned from history; config.json `spending_plan`
// can pin the paycheck merchant, the paycheck amount and the savings per paycheck.
import * as fs from './fs.js';
import { PATHS, loadConfig } from './data.js';
import { merchantNameKey } from './merchants.js';
import { renamed } from './rules.js';
import { yearMonth } from './dates.js';
import { round2 } from './util.js';

const DAY = 86400000;
const SAME_PAYDAY = 4;  // deposits (and reversals) this many days apart are one paycheck
const MATCH_DAYS = 3;   // an expected payday matches a real one this close
const SAVE_WINDOW = 7;  // savings moved up to this many days after a payday belongs to that paycheck
const TYPICAL_MONTHS = 6; // "typical" spending = median of this many recent complete months
const sumAmt = rows => round2(rows.reduce((a, r) => a + r._amt, 0));
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Clean `spending_plan` from config.json; null fields mean "work it out from history". */
export function parsePlan(cfg) {
    const p = cfg?.spending_plan || {};
    const num = v => (v === null || v === '' || v === undefined || !Number.isFinite(+v) ? null : Math.abs(+v));
    return {
        merchant: typeof p.paycheck_merchant === 'string' && p.paycheck_merchant.trim() ? p.paycheck_merchant.trim() : null,
        paycheck: num(p.paycheck_amount),
        savings: num(p.savings_per_paycheck),
    };
}

export async function savePlan(plan) {
    const cfg = await loadConfig();
    if (!cfg) throw new Error('config.json not found');
    cfg.spending_plan = {
        _note: 'Used by This Month → Left to spend. Blank (null) = worked out from your history.',
        paycheck_merchant: plan.merchant || null,
        paycheck_amount: plan.paycheck ?? null,
        savings_per_paycheck: plan.savings ?? null,
    };
    await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
}

/** Income merchants by how many deposits they made in the last 6 months, most first. */
export function incomeMerchants(rows) {
    const end = rows.reduce((a, r) => (r._date > a ? r._date : a), new Date(0));
    const from = addDays(end, -183);
    const n = new Map();
    for (const r of rows) {
        if (r['AI Category'] !== 'Income' || r._amt <= 0 || r._date < from) continue;
        const m = String(r['Cleaned Merchant'] ?? '').trim();
        if (m) n.set(m, (n.get(m) || 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

/** Paychecks from `merchant`: deposits a few days apart (split deposits, reversals) are one paycheck. [{date, amount, rows}] oldest first. */
export function paydays(rows, merchant) {
    const key = merchantNameKey(merchant);
    const pay = rows.filter(r => r['AI Category'] === 'Income' && merchantNameKey(r['Cleaned Merchant']) === key)
        .sort((a, b) => a._date - b._date);
    const out = [];
    for (const r of pay) {
        const last = out[out.length - 1];
        if (last && (r._date - last.date) / DAY <= SAME_PAYDAY) last.rows.push(r);
        else out.push({ date: r._date, rows: [r] });
    }
    return out.map(p => ({ ...p, amount: sumAmt(p.rows) })).filter(p => p.amount > 0);
}

const isSavings = r => r['AI Category'] === renamed('Savings') && r._amt < 0;

/** Savings moved after payday `p` (within the window, before the next payday), up to `cap` in all. */
function savedAfter(rows, p, next, cap = Infinity) {
    let total = 0;
    return rows.filter(r => isSavings(r) && r._date > p.date && r._date <= addDays(p.date, SAVE_WINDOW) && (!next || r._date < next.date))
        .sort((a, b) => a._date - b._date)
        .filter(r => (total - r._amt <= cap + 0.5 ? (total -= r._amt, true) : false));
}

/**
 * Everything the Left to spend section shows for month `ym`.
 * `rows`: master + current month, parsed (allTransactions). `bills`: billMonth results for `ym` with `counted`.
 * `match`: row → bill. `dataThrough`: newest transaction loaded. `ended`: the month is over (no predictions).
 */
export function leftToSpend({ cfg, rows, ym, bills, match, dataThrough, today = new Date(), ended = false }) {
    const plan = parsePlan(cfg);
    const merchants = incomeMerchants(rows);
    const merchant = plan.merchant || merchants[0] || null;
    const all = merchant ? paydays(rows, merchant) : [];
    const latest = all[all.length - 1] || null;

    // Pay rhythm: median gap of the last few paychecks (14 for every other week).
    const gaps = all.slice(-7).map((p, i, a) => (i ? Math.round((p.date - a[i - 1].date) / DAY) : null)).filter(Boolean).sort((a, b) => a - b);
    const every = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    const paycheck = plan.paycheck ?? latest?.amount ?? 0;

    // Savings per paycheck: what moved after the latest paycheck whose window has fully loaded.
    const savingsFrom = [...all].reverse().find(p => dataThrough && addDays(p.date, SAVE_WINDOW) <= dataThrough) || null;
    const detectedSavings = savingsFrom ? -sumAmt(savedAfter(rows, savingsFrom, all[all.indexOf(savingsFrom) + 1])) : 0;
    const perCheck = plan.savings ?? detectedSavings;

    // This month's paychecks: the real ones, then expected ones every `every` days after the latest.
    const first = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const checks = all.filter(p => yearMonth(p.date) === ym).map(p => ({ ...p, received: true }));
    if (latest && !ended) {
        for (let d = addDays(latest.date, every); d <= last; d = addDays(d, every)) {
            if (d >= first && !checks.some(c => Math.abs(c.date - d) / DAY <= MATCH_DAYS)) {
                checks.push({ date: d, amount: paycheck, rows: [], received: false });
            }
        }
    }
    checks.sort((a, b) => a.date - b.date);

    // Savings: each of this month's paychecks owes its transfer (even if it lands early next month);
    // a transfer for last month's last paycheck isn't counted again here.
    const prev = all.filter(p => p.date < first).pop();
    const prevSaved = new Set(prev ? savedAfter(rows, prev, all.find(p => p.date > prev.date), perCheck) : []);
    const monthRows = rows.filter(r => r._ym === ym);
    for (const [i, c] of checks.entries()) {
        const next = checks[i + 1] || all.find(p => p.date > c.date);
        const moved = c.received ? savedAfter(rows, c, next, perCheck) : [];
        c.saved = -sumAmt(moved);
        c.savedRows = moved;
        c.toMove = ended ? 0 : Math.max(0, round2(perCheck - c.saved));
        c.moveOn = addDays(c.date, ((8 - c.date.getDay()) % 7) || 7); // the Monday after
    }
    const tied = new Set(checks.flatMap(c => c.savedRows));
    const otherSaved = monthRows.filter(r => isSavings(r) && !prevSaved.has(r) && !tied.has(r));

    // Paycheck rows, bill payments and savings are counted above; everything else is spending or other money in.
    const payKey = merchant && merchantNameKey(merchant);
    const isPay = r => r['AI Category'] === 'Income' && merchantNameKey(r['Cleaned Merchant']) === payKey;
    const rest = monthRows.filter(r => !isSavings(r) && !match?.(r) && !isPay(r));
    const spentRows = rest.filter(r => r._amt < 0), inRows = rest.filter(r => r._amt > 0);

    // Typical month: median "everything else" spending over the last 6 complete months.
    const spentIn = {};
    for (const r of rows) {
        if (!r._ym || r._ym >= ym || !(r._amt < 0) || isSavings(r) || match?.(r) || isPay(r)) continue;
        spentIn[r._ym] = (spentIn[r._ym] || 0) - r._amt;
    }
    const recent = Object.keys(spentIn).sort().slice(-TYPICAL_MONTHS).map(k => spentIn[k]).sort((a, b) => a - b);
    const typicalMonth = recent.length ? round2(recent.length % 2 ? recent[(recent.length - 1) / 2] : (recent[recent.length / 2 - 1] + recent[recent.length / 2]) / 2) : 0;

    const income = round2(checks.reduce((a, c) => a + c.amount, 0));
    const received = round2(checks.filter(c => c.received).reduce((a, c) => a + c.amount, 0));
    const billsPaid = round2((bills || []).reduce((a, x) => a + (x.payments.length ? x.paid : 0), 0));
    const billsTotal = round2((bills || []).reduce((a, x) => a + x.counted, 0));
    const savedSoFar = round2(checks.reduce((a, c) => a + c.saved, 0) - sumAmt(otherSaved));
    const toMove = round2(checks.reduce((a, c) => a + c.toMove, 0));
    const spent = -sumAmt(spentRows), otherIn = sumAmt(inRows);
    const left = round2(income + otherIn - billsTotal - savedSoFar - toMove - spent);

    // From today (or the day after the data ends, if that's later) to the end of the month.
    const from = dataThrough && dataThrough > today ? addDays(dataThrough, 1) : today;
    const daysLeft = ended ? 0 : Math.max(0, Math.round((last - new Date(from.getFullYear(), from.getMonth(), from.getDate())) / DAY) + 1);

    return {
        merchant, merchants, every, paycheck, savingsCategory: renamed('Savings'), paycheckDetected: latest, perCheck, detectedSavings, savingsFrom, plan,
        checks, income, received, still: round2(income - received),
        billsPaid, billsTotal, billsDue: round2(billsTotal - billsPaid),
        savedSoFar, toMove, otherSaved, spent, spentRows, otherIn, inRows,
        left, daysLeft, perDay: daysLeft ? round2(left / daysLeft) : null,
        typicalMonth, typicalMonths: recent.length,
        typicalRest: round2(typicalMonth / last.getDate() * daysLeft),
        typicalEnd: round2(left - typicalMonth / last.getDate() * daysLeft),
    };
}
