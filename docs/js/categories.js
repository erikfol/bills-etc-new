// User-defined categories, stored in config.json as `categories` (the list) and
// `category_renames` (old → new). Renaming rewrites every data file that uses the old name.
import * as fs from './fs.js';
import { PATHS, DEFAULT_CONFIG, readTable, writeTable, loadConfig } from './data.js';
import { DEFAULT_CATEGORIES, setCategorySettings, renamed } from './rules.js';

/** Categories the math depends on: Income can't be renamed or removed; Miscellaneous can't be removed. */
export const LOCKED = 'Income';
const DATA_FILES = [PATHS.master, PATHS.processed, PATHS.cache];

const follow = (renames, c) => { for (let i = 0; i < 20 && Object.hasOwn(renames, c); i++) c = renames[c]; return c; };

/** Read {categories, renames} from a config object (defaults when absent). */
export function categorySettings(cfg) {
    const list = (cfg?.categories || []).filter(c => typeof c === 'string' && c.trim() && !c.startsWith('_')).map(c => c.trim());
    const renames = Object.fromEntries(Object.entries(cfg?.category_renames || {})
        .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim()));
    const categories = list.length ? list : [...DEFAULT_CATEGORIES];
    for (const must of [LOCKED, follow(renames, 'Miscellaneous')]) if (!categories.includes(must)) categories.push(must);
    return { categories, renames };
}

/** Load the folder's category settings into the rules. Called before each page renders. */
export async function syncCategories() {
    let cfg = null;
    try { cfg = await loadConfig(); } catch { /* invalid JSON: keep defaults; Config page reports it */ }
    setCategorySettings(categorySettings(cfg));
}

/** {category: number of transactions} across the master and the current month. */
export async function categoryUsage() {
    const counts = {};
    for (const path of [PATHS.master, PATHS.processed]) {
        for (const r of (await readTable(path))?.rows || []) {
            const c = String(r['AI Category'] ?? '').trim();
            if (c) counts[c] = (counts[c] || 0) + 1;
        }
    }
    return counts;
}

async function readConfigForEdit() {
    return (await loadConfig()) || structuredClone(DEFAULT_CONFIG);
}

async function saveConfig(cfg, { categories, renames }) {
    cfg.categories = categories;
    cfg.category_renames = renames;
    await fs.writeText(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
    setCategorySettings({ categories, renames });
}

export function validateName(name, categories, except = null) {
    name = String(name ?? '').trim();
    if (!name) return 'Enter a name.';
    if (name.startsWith('_')) return "Names can't start with _.";
    if (name.includes(',') || name.includes('"')) return 'Names can’t contain commas or quotes.';
    const clash = categories.find(c => c.toLowerCase() === name.toLowerCase() && c !== except);
    if (clash) return `“${clash}” already exists.`;
    return null;
}

export async function addCategory(name) {
    name = name.trim();
    const cfg = await readConfigForEdit();
    const st = categorySettings(cfg);
    const err = validateName(name, st.categories);
    if (err) throw new Error(err);
    st.categories.push(name);
    delete st.renames[name]; // re-adding a name that was renamed away makes it a real category again
    await saveConfig(cfg, st);
}

/**
 * Rename `from` to `to` everywhere. If `to` already exists, the two are merged.
 * Returns the number of transactions changed.
 */
export async function renameCategory(from, to) {
    to = to.trim();
    if (from === LOCKED) throw new Error(`${LOCKED} can't be renamed; cash-flow totals depend on it.`);
    if (!to || to === from) throw new Error('Enter a different name.');
    if (to.startsWith('_') || to.includes(',') || to.includes('"')) throw new Error(validateName(to, []));
    const cfg = await readConfigForEdit();
    const st = categorySettings(cfg);
    const existing = st.categories.find(c => c.toLowerCase() === to.toLowerCase() && c !== from);
    if (existing) to = existing; // merge into the existing spelling

    // 1. Rewrite data files.
    let changed = 0;
    for (const path of DATA_FILES) {
        const table = await readTable(path);
        if (!table) continue;
        let n = 0;
        for (const r of table.rows) if (String(r['AI Category'] ?? '').trim() === from) { r['AI Category'] = to; n++; }
        if (n) { await writeTable(path, table); if (path !== PATHS.cache) changed += n; }
    }

    // 2. Update the list, variable categories and renames.
    st.categories = existing ? st.categories.filter(c => c !== from) : st.categories.map(c => (c === from ? to : c));
    if (!st.categories.includes(to)) st.categories.push(to); // `from` may have been used but not listed
    for (const k of Object.keys(st.renames)) if (st.renames[k] === from) st.renames[k] = to;
    st.renames[from] = to;
    delete st.renames[to]; // renaming back to an old name
    if (Array.isArray(cfg.variable_categories)) {
        const seen = new Set();
        cfg.variable_categories = cfg.variable_categories.map(c => (c === from ? to : c)).filter(c => !seen.has(c) && seen.add(c));
    }
    await saveConfig(cfg, st);
    return changed;
}

export async function removeCategory(name) {
    if (name === LOCKED || name === renamed('Miscellaneous')) throw new Error(`${name} can't be removed.`);
    if ((await categoryUsage())[name]) throw new Error(`${name} is still used. Rename it into another category to merge them instead.`);
    const cfg = await readConfigForEdit();
    const st = categorySettings(cfg);
    st.categories = st.categories.filter(c => c !== name);
    if (Array.isArray(cfg.variable_categories)) cfg.variable_categories = cfg.variable_categories.filter(c => c !== name);
    await saveConfig(cfg, st);
}
