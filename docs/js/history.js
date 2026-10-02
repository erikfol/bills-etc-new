// History-first categorization: reuse the category you've already given a merchant.
// Keep merchantKey() identical to merchant_key() in history_lookup.py.
import { applyOverrides, applyMerchantCatOverrides } from './rules.js';

/** "TST* JOES PIZZA 1234 HANOVER NH" → "TST JOES PIZZA": letters only, first 3 words. */
export function merchantKey(description) {
    return String(description ?? '').toUpperCase()
        .replace(/\d+/g, ' ').replace(/[^A-Z ]/g, ' ')
        .split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
}

const mostCommon = counts => [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

/**
 * Build a lookup from categorized rows (the master). A merchant is only used when one
 * category holds a strict majority of its rows, so ambiguous merchants still go to the AI.
 */
export function buildHistory(rows) {
    const byKey = new Map();
    for (const r of rows) {
        const key = merchantKey(r.Description);
        const cat = String(r['AI Category'] ?? '').trim();
        if (!key || !cat) continue;
        let e = byKey.get(key);
        if (!e) byKey.set(key, e = { total: 0, cats: new Map(), merchants: new Map() });
        e.total++;
        e.cats.set(cat, (e.cats.get(cat) || 0) + 1);
        const m = `${cat}\u0001${String(r['Cleaned Merchant'] ?? '').trim()}`;
        e.merchants.set(m, (e.merchants.get(m) || 0) + 1);
    }
    const lookup = new Map();
    for (const [key, e] of byKey) {
        const [cat, n] = mostCommon(e.cats);
        if (n * 2 <= e.total) continue;
        const merchants = new Map([...e.merchants].filter(([m]) => m.startsWith(cat + '\u0001')));
        lookup.set(key, { category: cat, merchant: mostCommon(merchants)[0].split('\u0001')[1] });
    }
    return lookup;
}

/**
 * {merchant, category, source} from the merchant+category overrides ('rules') or history ('history');
 * null if the merchant is new or ambiguous. Category overrides still apply on top of history.
 */
export function historyLookup(lookup, description) {
    const mc = applyMerchantCatOverrides(description);
    if (mc) return { ...mc, source: 'rules' };
    const hit = lookup.get(merchantKey(description));
    if (!hit) return null;
    return {
        merchant: hit.merchant || String(description ?? ''),
        category: applyOverrides(description, hit.category),
        source: 'history',
    };
}
