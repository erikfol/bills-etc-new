// Merchant clean-up: find spellings of the same merchant, merge them, and remember the result as a
// merchant rule (config.json `merchant_rules`) so new transactions arrive with the clean name/category.
// Keep merchantNameKey() and applyMerchantRules() identical to bills_config.py.
import * as fs from './fs.js';
import { PATHS, DEFAULT_CONFIG, readTable, writeTable, loadConfig } from './data.js';
import { renamed } from './rules.js';

/** "AMAZON.COM*2K4 #1234" → "amazon": lower-case letters only, without www./.com/.net/.org. */
export function merchantNameKey(name) {
    return String(name ?? '').toLowerCase()
        .replace(/www\./g, ' ').replace(/\.(com|net|org)\b/g, ' ')
        .replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Words that don't identify a merchant when grouping suggestions.
const NOISE = new Set(['the', 'sq', 'tst', 'pos', 'debit', 'purchase', 'online', 'payment', 'pmt', 'pp', 'paypal', 'www', 'inc', 'llc', 'co']);

let rules = []; // [{ name, match: [keys], category: string|null }]
export const getMerchantRules = () => rules;
export function setMerchantRules(cfg) {
    rules = (Array.isArray(cfg?.merchant_rules) ? cfg.merchant_rules : [])
        .filter(r => r && typeof r.name === 'string' && r.name.trim() && Array.isArray(r.match))
        .map(r => ({ name: r.name.trim(), match: r.match.filter(k => typeof k === 'string' && k), category: typeof r.category === 'string' && r.category ? r.category : null }));
}

/**
 * Apply merchant rules to a categorization result {merchant, category}. A rule matches only when the
 * merchant's (or the whole description's) cleaned-up name is exactly one of its spellings — never a
 * prefix, so a rule for "Amazon" can't catch "AMAZON CORP SYF PAYMNT". Returns a new object.
 */
export function applyMerchantRules(hit, description) {
    const mKey = merchantNameKey(hit.merchant), dKey = merchantNameKey(description);
    for (const r of rules) {
        if (r.match.includes(mKey) || r.match.includes(dKey)) {
            return { ...hit, merchant: r.name, category: r.category ? renamed(r.category) : hit.category };
        }
    }
    return hit;
}

const DATA_FILES = [PATHS.master, PATHS.processed, PATHS.cache];

/** Every merchant spelling with its transaction count and categories (master + current month). */
export async function merchantSummary() {
    const map = new Map();
    for (const path of [PATHS.master, PATHS.processed]) {
        for (const r of (await readTable(path))?.rows || []) {
            const name = String(r['Cleaned Merchant'] ?? '').trim();
            if (!name) continue;
            let e = map.get(name);
            if (!e) map.set(name, e = { name, count: 0, cats: {} });
            e.count++;
            const c = String(r['AI Category'] ?? '').trim() || '(none)';
            e.cats[c] = (e.cats[c] || 0) + 1;
        }
    }
    return [...map.values()].map(e => ({ ...e, key: merchantNameKey(e.name) }));
}

/**
 * Groups of 2+ spellings sharing their first meaningful word. `likely` = the biggest set of spellings
 * that are identical once cleaned up (Amazon / Amazon.com / AMAZON); the rest are only offered.
 */
export function suggestGroups(summary) {
    const groups = new Map();
    for (const m of summary) {
        const word = m.key.split(' ').find(w => w.length >= 3 && !NOISE.has(w));
        if (!word) continue;
        if (!groups.has(word)) groups.set(word, []);
        groups.get(word).push(m);
    }
    return [...groups.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([word, list]) => {
            const byKey = new Map();
            for (const m of list) byKey.set(m.key, [...(byKey.get(m.key) || []), m]);
            const best = [...byKey.values()].filter(c => c.length > 1)
                .sort((a, b) => b.reduce((s, m) => s + m.count, 0) - a.reduce((s, m) => s + m.count, 0))[0] || [];
            const likely = best.map(m => m.name);
            list.sort((a, b) => (likely.includes(b.name) - likely.includes(a.name)) || b.count - a.count);
            return { word, spellings: list, likely, total: list.reduce((a, m) => a + m.count, 0) };
        })
        .sort((a, b) => b.total - a.total);
}

/**
 * Rename every row whose merchant is one of `spellings` to `name` (and set `category` if given)
 * in the master, current month and cache. With `remember`, save/extend a merchant rule.
 * Returns the number of transactions changed (master + current month).
 */
export async function mergeMerchants({ spellings, name, category = null, remember = true }) {
    name = String(name ?? '').trim();
    if (!name) throw new Error('Enter the merchant name to use.');
    const set = new Set(spellings);
    let changed = 0;
    for (const path of DATA_FILES) {
        const table = await readTable(path);
        if (!table) continue;
        let n = 0;
        for (const r of table.rows) {
            if (!set.has(String(r['Cleaned Merchant'] ?? '').trim())) continue;
            const before = `${r['Cleaned Merchant']}\u0001${r['AI Category']}`;
            r['Cleaned Merchant'] = name;
            if (category) r['AI Category'] = category;
            if (`${r['Cleaned Merchant']}\u0001${r['AI Category']}` !== before) n++;
        }
        if (n) { await writeTable(path, table); if (path !== PATHS.cache) changed += n; }
    }
    // Scheduled bills follow the merge (they match on merchant names).
    const billCfg = await loadConfig();
    if (Array.isArray(billCfg?.scheduled_bills)) {
        let touched = false;
        for (const b of billCfg.scheduled_bills) {
            if (!Array.isArray(b?.merchants) || !b.merchants.some(m => set.has(m))) continue;
            b.merchants = [...new Set(b.merchants.map(m => (set.has(m) ? name : m)))];
            touched = true;
        }
        if (touched) await fs.writeText(PATHS.config, JSON.stringify(billCfg, null, 2) + '\n');
    }
    if (remember) {
        const cfg = (await loadConfig()) || structuredClone(DEFAULT_CONFIG);
        const list = Array.isArray(cfg.merchant_rules) ? cfg.merchant_rules : [];
        const keys = [...new Set([...spellings, name].map(merchantNameKey).filter(Boolean))];
        // A spelling can only belong to one rule: take these keys away from other rules.
        for (const r of list) if (r.name !== name) r.match = (r.match || []).filter(k => !keys.includes(k));
        const existing = list.find(r => r.name === name);
        if (existing) {
            existing.match = [...new Set([...(existing.match || []), ...keys])];
            if (category) existing.category = category;
        } else {
            list.push({ name, match: keys, category });
        }
        cfg.merchant_rules = list.filter(r => r.match?.length);
        await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
        setMerchantRules(cfg);
    }
    return changed;
}

export async function removeMerchantRule(name) {
    const cfg = await loadConfig();
    if (!cfg) return;
    cfg.merchant_rules = (cfg.merchant_rules || []).filter(r => r.name !== name);
    await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
    setMerchantRules(cfg);
}

/** Change a rule's category (null = leave each transaction's category alone). */
export async function setRuleCategory(name, category) {
    const cfg = await loadConfig();
    const r = cfg?.merchant_rules?.find(x => x.name === name);
    if (!r) return;
    r.category = category || null;
    await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
    setMerchantRules(cfg);
}
