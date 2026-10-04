// Merchant rules — the one place merchant names and forced categories come from (config.json
// `merchant_rules`), shared with the Python scripts. A rule: { name?, match: [spellings], bank_text: [pieces],
// category? }. Keep merchantNameKey(), compactText() and applyMerchantRules() identical to bills_config.py.
// Also: find spellings of the same merchant and merge them.
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
export const MIN_BANK_TEXT = 3;

// Words that don't identify a merchant when grouping suggestions.
const NOISE = new Set(['the', 'sq', 'tst', 'pos', 'debit', 'purchase', 'online', 'payment', 'pmt', 'pp', 'paypal', 'www', 'inc', 'llc', 'co']);

/** Clean list from config.json; `i` = position in config's list (used to edit a rule). */
export function parseRules(cfg) {
    return (Array.isArray(cfg?.merchant_rules) ? cfg.merchant_rules : []).map((r, i) => {
        if (!r || typeof r !== 'object') return null;
        const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null;
        const match = (Array.isArray(r.match) ? r.match : []).filter(k => typeof k === 'string' && k);
        const bank = (Array.isArray(r.bank_text) ? r.bank_text : []).map(compactText).filter(b => b.length >= MIN_BANK_TEXT);
        const category = typeof r.category === 'string' && r.category ? r.category : null;
        if (!(name || category) || !(match.length || bank.length)) return null;
        return { i, name, match, bank, category, notes: typeof r.notes === 'string' ? r.notes : '' };
    }).filter(Boolean);
}

let rules = [];
export const getMerchantRules = () => rules;
export function setMerchantRules(cfg) { rules = parseRules(cfg); }

/** Longest bank-text match among rules passing `want`, or null. */
function byBankText(d, want) {
    let best = null, len = 0;
    for (const r of rules) if (want(r)) for (const b of r.bank) if (b.length > len && d.includes(b)) { best = r; len = b.length; }
    return best;
}

/**
 * Apply merchant rules to {merchant, category}. Name and category are settled separately:
 * a rule listing this exact spelling (of the merchant or the whole description) wins; otherwise the
 * rule with the longest `bank_text` found in the description. Spellings must match exactly — a rule
 * for "Amazon" can't catch "AMAZON CORP SYF PAYMNT". Returns a new object.
 */
export function applyMerchantRules(hit, description) {
    const mKey = merchantNameKey(hit.merchant), dKey = merchantNameKey(description), d = compactText(description);
    const exact = rules.find(r => r.match.includes(mKey) || r.match.includes(dKey));
    const nameRule = exact?.name ? exact : byBankText(d, r => r.name);
    const catRule = exact?.category ? exact : byBankText(d, r => r.category);
    return {
        ...hit,
        merchant: nameRule ? nameRule.name : hit.merchant,
        category: catRule ? renamed(catRule.category) : hit.category,
    };
}

/** {merchant, category} when the bank text alone settles both (no need to ask the AI), else null. */
export function rulesOnly(description) {
    const r = applyMerchantRules({ merchant: '', category: '' }, description);
    return r.merchant && r.category ? r : null;
}

/** Rules that would apply to this transaction (for showing why it got its name/category). */
export function rulesFor(description) {
    const d = compactText(description), dKey = merchantNameKey(description);
    return rules.filter(r => r.match.includes(dKey) || r.bank.some(b => d.includes(b)));
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

/**
 * Bank text to suggest for a merchant: the longest start (4+ letters) that at least 90% of its
 * transactions share, so one mislabeled transaction doesn't spoil it ("hannaford…" ×41, "ckenorth…" ×1
 * → "hannaford"). '' when there isn't one.
 */
export function sharedBankText(descs, share = 0.9) {
    const list = descs.filter(Boolean);
    if (!list.length) return '';
    const counts = new Map();
    for (const d of list) counts.set(d, (counts.get(d) || 0) + 1);
    const common = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    for (let len = common.length; len >= 4; len--) {
        const p = common.slice(0, len);
        if (list.filter(d => d.startsWith(p)).length >= list.length * share) return p;
    }
    return '';
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
    const names = [...rules.map(r => r.name).filter(Boolean), ...[...counts].sort((a, b) => b[1] - a[1]).map(([n]) => n)];
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
    const bank = [...new Set(bankText.map(compactText).filter(b => b.length >= MIN_BANK_TEXT))];
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
        cfg.merchant_rules = list.filter(r => r.match?.length || r.bank_text?.length);
        await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
        setMerchantRules(cfg);
    }
    return changed;
}

async function saveRules(cfg) {
    await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
    setMerchantRules(cfg);
}

/** Clean a rule from the editor: { name, match, bank_text, category, notes } with empty parts left out. */
function cleanRule(r) {
    const out = {};
    const name = String(r.name ?? '').trim();
    if (name) out.name = name;
    const match = [...new Set((r.match || []).map(merchantNameKey).filter(Boolean))];
    if (name && !match.includes(merchantNameKey(name))) match.unshift(merchantNameKey(name));
    if (match.length) out.match = match;
    const bank = [...new Set((r.bank_text || []).map(compactText).filter(b => b.length >= MIN_BANK_TEXT))];
    if (bank.length) out.bank_text = bank;
    out.category = r.category || null;
    if (r.notes) out.notes = String(r.notes).trim();
    if (!out.name && !out.category) throw new Error('A rule needs a merchant name, a category, or both.');
    if (!out.match && !out.bank_text) throw new Error(`Give the rule some bank text (${MIN_BANK_TEXT}+ letters) to match.`);
    return out;
}

/** Add a rule, or replace the rule at position `i` in config.json's list. Returns the cleaned rule. */
export async function saveRule(rule, i = null) {
    const cfg = (await loadConfig()) || structuredClone(DEFAULT_CONFIG);
    const list = Array.isArray(cfg.merchant_rules) ? cfg.merchant_rules : [];
    const r = cleanRule(rule);
    if (r.name && list.some((x, k) => k !== i && x?.name === r.name)) throw new Error(`There is already a rule for “${r.name}”. Edit that one instead.`);
    if (i == null) list.push(r); else list[i] = r;
    cfg.merchant_rules = list;
    await saveRules(cfg);
    return r;
}

export async function removeRule(i) {
    const cfg = await loadConfig();
    if (!cfg?.merchant_rules?.[i]) return;
    cfg.merchant_rules.splice(i, 1);
    await saveRules(cfg);
}

/** Whether a cleaned rule ({name, match, bank_text, category}) applies to a transaction. */
export function ruleMatches(rule, row) {
    const keys = (rule.match || []).map(merchantNameKey);
    if (rule.name) keys.push(merchantNameKey(rule.name));
    const bank = (rule.bank_text || []).map(compactText).filter(b => b.length >= MIN_BANK_TEXT);
    const d = compactText(row.Description);
    return keys.includes(merchantNameKey(row['Cleaned Merchant'])) || keys.includes(merchantNameKey(row.Description)) || bank.some(b => d.includes(b));
}

/** Give every existing transaction the rule matches its name and/or category. Returns the number changed. */
export async function applyRuleToExisting(rule) {
    let changed = 0;
    for (const path of DATA_FILES) {
        const table = await readTable(path);
        if (!table) continue;
        let n = 0;
        for (const r of table.rows) {
            if (!ruleMatches(rule, r)) continue;
            const before = `${r['Cleaned Merchant']}\u0001${r['AI Category']}`;
            if (rule.name) r['Cleaned Merchant'] = rule.name;
            if (rule.category) r['AI Category'] = renamed(rule.category);
            if (`${r['Cleaned Merchant']}\u0001${r['AI Category']}` !== before) n++;
        }
        if (n) { await writeTable(path, table); if (path !== PATHS.cache) changed += n; }
    }
    return changed;
}
