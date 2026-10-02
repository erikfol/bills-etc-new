// Report and projection math — ports of scripts 2 and 3.
import { parseDate, yearMonth, monthLabel } from './dates.js';
import { applyOverrides, applyMerchantCatOverrides, cleanupMerchant, normalizeCategory } from './rules.js';
import { amountOf, money, round2 } from './util.js';

/** Attach parsed _date, _ym, _amt to each row (non-destructive). */
export function withParsed(rows) {
    return rows.map(r => {
        const d = parseDate(r.Date);
        const a = amountOf(r.Amount);
        return { ...r, _date: d, _ym: d ? yearMonth(d) : null, _amt: Number.isFinite(a) ? a : 0 };
    });
}

/** Script 2's load-time cleanup: normalize categories, apply overrides, fix merchant names. */
export function normalizeMaster(rows) {
    return withParsed(rows).map(r => {
        const desc = r.Description ?? '';
        if ('AI Category' in r) {
            r['AI Category'] = applyOverrides(desc, normalizeCategory(r['AI Category']));
            const mc = applyMerchantCatOverrides(desc);
            if (mc) { r['Cleaned Merchant'] = mc.merchant; r['AI Category'] = mc.category; }
        }
        if ('Cleaned Merchant' in r) r['Cleaned Merchant'] = cleanupMerchant(desc, r['Transaction Type'], r['Cleaned Merchant']);
        return r;
    });
}

/** Group-sum helper: Map<key, number>. */
function sumBy(rows, keyFn) {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + r._amt); }
    return m;
}

/**
 * Script 2's numbers. Returns
 * { months, monthly: [{ym, income, expenses, net}], categories, trends: {ym: {cat: signedSum}}, totals: {cat: abs} }
 */
export function buildReport(rows) {
    const dated = rows.filter(r => r._ym);
    const expense = dated.filter(r => r['AI Category'] !== 'Income');
    const income = dated.filter(r => r['AI Category'] === 'Income');

    const months = [...new Set(expense.map(r => r._ym))].sort();
    const incBy = sumBy(income, r => r._ym);
    const expBy = sumBy(expense, r => r._ym);
    const monthly = months.map(ym => {
        const inc = incBy.get(ym) || 0, exp = expBy.get(ym) || 0;
        return { ym, income: inc, expenses: exp, net: inc + exp };
    });

    const categories = [...new Set(expense.map(r => r['AI Category']))].sort();
    const trends = Object.fromEntries(months.map(ym => [ym, Object.fromEntries(categories.map(c => [c, 0]))]));
    for (const r of expense) trends[r._ym][r['AI Category']] += r._amt;

    const totals = Object.fromEntries(categories.map(c =>
        [c, round2(Math.abs(months.reduce((a, ym) => a + trends[ym][c], 0)))]));

    return { months, monthly, categories, trends, totals };
}

/** Text summary fed to the AI analysis prompt (last 3 months of categories, like the script). */
export function reportSummaryText(report) {
    let s = '=== FINANCIAL HISTORICAL SUMMARY ===\n\n--- MONTH-OVER-MONTH CASH FLOW ---\n';
    for (const m of report.monthly) {
        s += `Month: ${m.ym} | Income: ${money(m.income)} | Total Expenses: ${money(Math.abs(m.expenses))} | Net: ${money(m.net)}\n`;
    }
    s += '\n--- TOP CATEGORY SPENDING PER MONTH ---\n';
    const recent = report.months.slice(-3);
    s += ['Month', ...report.categories].join(' | ') + '\n';
    for (const ym of recent) {
        s += [ym, ...report.categories.map(c => report.trends[ym][c].toFixed(2))].join(' | ') + '\n';
    }
    return s;
}

/** Script 3's historical averages: completed months only (current month excluded). */
export function historicalAverages(masterRows, variableCats, today) {
    const currentYm = yearMonth(today);
    const exp = withParsed(masterRows).filter(r => r._ym && r._ym !== currentYm && r['AI Category'] !== 'Income');
    const months = [...new Set(exp.map(r => r._ym))];
    const n = months.length;
    const byMonthCat = sumBy(exp, r => r._ym + '|' + r['AI Category']);
    const avgs = {};
    for (const cat of variableCats) {
        const total = months.reduce((a, ym) => a + Math.abs(byMonthCat.get(ym + '|' + cat) || 0), 0);
        avgs[cat] = n ? round2(total / n) : 0;
    }
    return { avgs, months: n };
}

/** Script 3's projection for the current month. */
export function computeProjection({ config, rows, masterRows, today = new Date() }) {
    const { income, fixed, variableCats } = config;
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysElapsed = today.getDate();

    const parsed = withParsed(rows);
    const exp = parsed.filter(r => r['AI Category'] !== 'Income' && r._amt < 0);
    const spent = {}, projected = {};
    for (const cat of variableCats) {
        spent[cat] = round2(Math.abs(exp.filter(r => r['AI Category'] === cat).reduce((a, r) => a + r._amt, 0)));
        projected[cat] = round2(spent[cat] / daysElapsed * daysInMonth);
    }
    const hist = masterRows ? historicalAverages(masterRows, variableCats, today) : { avgs: {}, months: 0 };

    const totalFixed = Object.values(fixed).reduce((a, b) => a + b, 0);
    const totalVariable = Object.values(projected).reduce((a, b) => a + b, 0);
    const totalProjected = totalFixed + totalVariable;
    return {
        income, fixed, variableCats, spent, projected, hist,
        today, daysInMonth, daysElapsed, pctMonth: Math.round(daysElapsed / daysInMonth * 100),
        totalFixed, totalVariable, totalProjected, surplus: income - totalProjected,
        rows: parsed,
    };
}

export function statusBadge(proj, hist) {
    if (!hist) return ['badge-neutral', 'No history'];
    const ratio = proj / hist;
    if (ratio <= 1.10) return ['badge-ok', 'On track'];
    if (ratio <= 1.40) return ['badge-warn', 'Watch'];
    return ['badge-over', 'Over'];
}

export { monthLabel };
