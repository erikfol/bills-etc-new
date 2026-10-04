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

/** Bank text as letters only: "STRAIGHTTALK*P 800-299 FL" → "straighttalkpfl". Rules' `bank_text` match inside this. */
export const compactText = s => String(s ?? '').toLowerCase().replace(/[^a-z]+/g, '');

// Words that don't identify a merchant when grouping suggestions.
const NOISE = new Set(['the', 'sq', 'tst', 'pos', 'debit', 'purchase', 'online', 'payment', 'pmt', 'pp', 'paypal', 'www', 'inc', 'llc', 'co']);

let rules = []; // [{ name, match: [keys], bank: [compact bank text], category: string|null }]
export const getMerchantRules = () => rules;
export function setMerchantRules(cfg) {
    rules = (Array.isArray(cfg?.merchant_rules) ? cfg.merchant_rules : [])
        .filter(r => r && typeof r.name === 'string' && r.name.trim() && Array.isArray(r.match))
        .map(r => ({
            name: r.name.trim(), match: r.match.filter(k => typeof k === 'string' && k),
            bank: (Array.isArray(r.bank_text) ? r.bank_text : []).map(compactText).filter(b => b.length >= 4),
            category: typeof r.category === 'string' && r.category ? r.category : null,
        }));
}

/** The rule whose bank text appears in `description` (longest match wins), or null. */
export function ruleByBankText(description) {
    const d = compactText(description);
    let best = null, len = 0;
    for (const r of rules) for (const b of r.bank) if (b.length > len && d.includes(b)) { best = r; len = b.length; }
    return best;
}

/**
 * Apply merchant rules to a categorization result {merchant, category}. A rule matches when the
 * merchant's (or the whole description's) cleaned-up name is exactly one of its spellings — never a
 * prefix, so a rule for "Amazon" can't catch "AMAZON CORP SYF PAYMNT" — or, failing that, when the
 * bank text contains one of the rule's `bank_text` pieces (longest wins). Returns a new object.
 */
export function applyMerchantRules(hit, description) {
    const mKey = merchantNameKey(hit.merchant), dKey = merchantNameKey(description);
    const r = rules.find(x => x.match.includes(mKey) || x.match.includes(dKey)) || ruleByBankText(description);
    return r ? { ...hit, merchant: r.name, category: r.category ? renamed(r.category) : hit.category } : hit;
}

const DATA_FILES = [PATHS.master, PATHS.processed, PATHS.cache];

/** Every merchant spelling with its transaction count, categories and bank texts (compacted) (master + current month). */
export async function merchantSummary() {
    const map = new Map();
    for (const path of [PATHS.master, PATHS.processed]) {
        for (const r of (await readTable(path))?.rows || []) {
            const name = String(r['Cleaned Merchant'] ?? '').trim();
            if (!name) continue;
            let e = map.get(name);
            if (!e) map.set(name, e = { name, count: 0, cats: {}, descs: [] });
            e.count++;
            e.descs.push(compactText(r.Description));
            const c = String(r['AI Category'] ?? '').trim() || '(none)';
            e.cats[c] = (e.cats[c] || 0) + 1;
        }
    }
    return [...map.values()].map(e => ({ ...e, key: merchantNameKey(e.name) }));
}

/** Longest start the bank texts share ("straighttalksmiami", "straighttalkp" → "straighttalk"); '' if under 4 letters. */
export function sharedBankText(descs) {
    const list = [...new Set(descs.filter(Boolean))];
    if (!list.length) return '';
    let p = list[0];
    for (const d of list) { let i = 0; while (i < p.length && i < d.length && p[i] === d[i]) i++; p = p.slice(0, i); }
    return p.length >= 4 ? p : '';
}

/** "Straight Talk" ~ "StraightTalk" ~ "Straighthatalk*": same letters, or (both 8+ letters) within 2 typos. */
export function sameMerchant(a, b) {
    const x = merchantNameKey(a).replace(/ /g, ''), y = merchantNameKey(b).replace(/ /g, '');
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length < 8 || y.length < 8 || Math.abs(x.length - y.length) > 2) return false;
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
        const cur = [i];
        for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[y.length] <= 2;
}

/**
 * Merchant names the AI should reuse: your rule names plus your most used merchants.
 * `rows` = categorized transactions (the master).
 */
export function knownMerchants(rows, limit = 80) {
    const counts = new Map();
    for (const r of rows) {
        const n = String(r['Cleaned Merchant'] ?? '').trim();
        if (n && !['ATM', 'CHECK', 'TRANSFER'].includes(n)) counts.set(n, (counts.get(n) || 0) + 1);
    }
    const names = [...rules.map(r => r.name), ...[...counts].sort((a, b) => b[1] - a[1]).map(([n]) => n)];
    const out = [];
    for (const n of names) if (!out.some(o => sameMerchant(o, n))) out.push(n);
    return out.slice(0, limit);
}

/** The known spelling of `name` if it's the same merchant (see sameMerchant), else `name`. */
export const snapMerchant = (name, known) => known.find(k => sameMerchant(k, name)) || name;

/**
 * Groups of 2+ spellings sharing their first meaningful word. `likely` = the biggest set of spellings
 * that are identical once cleaned up (Amazon / Amazon.com / AMAZON); the rest are only offered.
 */
export function suggestGroups(summary) {
    const groups = new Map();
    for (const m of summary) {
        // Group on the first letters of the name with noise words and spaces removed, so
        // "Straight Talk", "StraightTalk" and "Straighthatalk" land together.
        const letters = m.key.split(' ').filter(w => !NOISE.has(w)).join('');
        if (letters.length < 4) continue;
        const word = letters.slice(0, 6);
        if (!groups.has(word)) groups.set(word, []);
        groups.get(word).push(m);
    }
    return [...groups.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([word, list]) => {
            const byKey = new Map();
            for (const m of list) { const k = m.key.replace(/ /g, ''); byKey.set(k, [...(byKey.get(k) || []), m]); }
            const best = [...byKey.values()].filter(c => c.length > 1)
                .sort((a, b) => b.reduce((s, m) => s + m.count, 0) - a.reduce((s, m) => s + m.count, 0))[0] || [];
            const likely = best.map(m => m.name);
            list.sort((a, b) => (likely.includes(b.name) - likely.includes(a.name)) || b.count - a.count);
            return { word, spellings: list, likely, total: list.reduce((a, m) => a + m.count, 0) };
        })
        .sort((a, b) => b.total - a.total);
}

/**
 * Rename every row whose merchant is one of `spellings`, or whose bank text contains one of `bankText`,
 * to `name` (and set `category` if given) in the master, current month and cache. With `remember`,
 * save/extend a merchant rule. Returns the number of transactions changed (master + current month).
 */
export async function mergeMerchants({ spellings, name, category = null, remember = true, bankText = [] }) {
    name = String(name ?? '').trim();
    if (!name) throw new Error('Enter the merchant name to use.');
    const set = new Set(spellings);
    const bank = [...new Set(bankText.map(compactText).filter(b => b.length >= 4))];
    const hits = r => set.has(String(r['Cleaned Merchant'] ?? '').trim()) || bank.some(b => compactText(r.Description).includes(b));
    let changed = 0;
    for (const path of DATA_FILES) {
        const table = await readTable(path);
        if (!table) continue;
        let n = 0;
        for (const r of table.rows) {
            if (!hits(r)) continue;
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
            if (bank.length) existing.bank_text = [...new Set([...(existing.bank_text || []), ...bank])];
            if (category) existing.category = category;
        } else {
            list.push({ name, match: keys, ...(bank.length ? { bank_text: bank } : {}), category });
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

/** Replace a rule's bank text pieces (letters only, 4+ each). */
export async function setRuleBankText(name, pieces) {
    const cfg = await loadConfig();
    const r = cfg?.merchant_rules?.find(x => x.name === name);
    if (!r) return;
    const bank = [...new Set(pieces.map(compactText).filter(b => b.length >= 4))];
    if (bank.length) r.bank_text = bank; else delete r.bank_text;
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
