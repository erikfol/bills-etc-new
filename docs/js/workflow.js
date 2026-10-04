// The workflow steps (load, categorize, close the month), ported from the Python scripts; run from the Setup page. Each takes a `log(text, kind)` callback.
import * as fs from './fs.js';
import { PATHS, MASTER_COLS, CACHE_COLS, readTable, writeTable, readBankCsv, keyOf, loadConfig, parseConfig } from './data.js';
import { aiCategorize } from './ollama.js';
import { categorizeByRules, cleanupMerchant, renamed } from './rules.js';
import { buildHistory, historyLookup, merchantKey } from './history.js';
import { applyMerchantRules, ruleByBankText, knownMerchants, snapMerchant } from './merchants.js';
import { parseDate, yearMonth, longMonthLabel, normalizeDateCell } from './dates.js';
import { computeProjection } from './finance.js';
import { amountOf, money } from './util.js';

/** Remembers how each current-month row was categorized on the last step-3 run (key → source). */
export const lastSources = new Map();

/**
 * Categorize one row: merchant overrides → your history → a merchant rule matching the bank text (if it
 * sets a category) → AI (if enabled) → keyword rules, then your merchant rules from Config (clean name,
 * and category if the rule has one). The AI is given your merchant names (`known`) and a name it returns
 * that is only a respelling of one of them is replaced by yours.
 * A merchant the AI just categorized is remembered so repeats in the same run skip the model.
 */
async function categorize(row, lookup, useAI, signal, known = []) {
    const hit = historyLookup(lookup, row.Description);
    if (hit) return applyMerchantRules(hit, row.Description);
    const bankRule = ruleByBankText(row.Description);
    if (bankRule?.category) return { merchant: bankRule.name, category: renamed(bankRule.category), source: 'merchant' };
    if (useAI) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const raw = await aiCategorize(row.Description, row.Amount, signal, known);
        const ai = applyMerchantRules({ ...raw, merchant: snapMerchant(raw.merchant, known) }, row.Description);
        const key = merchantKey(row.Description);
        if (key && ai.parsed) lookup.set(key, { category: ai.category, merchant: ai.merchant });
        return { ...ai, source: 'ai' };
    }
    return applyMerchantRules({ ...categorizeByRules(row.Description), source: 'rules' }, row.Description);
}

function txTypeMerchant(row, merchant) {
    const t = String(row['Transaction Type'] ?? '').toLowerCase();
    if (!('Transaction Type' in row)) return merchant;
    if (t.includes('atm')) return 'ATM';
    if (t.includes('check')) return 'CHECK';
    if (t.includes('transfer')) return 'TRANSFER';
    return merchant;
}

// ── Step 1: backfill past months into the master ─────────────────────────────

/** Returns totals: { added, history, merchant, ai, rules, files: [names that added rows] }. */
export async function backfill({ useAI, log, signal }) {
    const totals = { added: 0, history: 0, merchant: 0, ai: 0, rules: 0, files: [] };
    const files = await fs.listFiles(PATHS.pastMonths);
    if (!files.length) {
        log(`No CSV files found in ${PATHS.pastMonths}/. Import your bank statements there first.`, 'err');
        return totals;
    }

    const master = (await readTable(PATHS.master)) || { columns: [...MASTER_COLS], rows: [] };
    for (const c of MASTER_COLS) if (!master.columns.includes(c)) master.columns.push(c);
    const existing = new Set(master.rows.map(keyOf));
    if (existing.size) log(`Master file has ${existing.size} existing transactions. Duplicates will be skipped.`, 'dim');
    const lookup = buildHistory(master.rows);
    const known = useAI ? knownMerchants(master.rows) : [];
    log(`History knows ${lookup.size} merchant(s).`, 'dim');

    try {
        for (const file of files) {
            log(`\n--- Processing File: ${file} ---`);
            const bank = await readBankCsv(`${PATHS.pastMonths}/${file}`);
            if (bank.dropped.length) log(`Dropping potentially sensitive columns: ${bank.dropped.join(', ')}`, 'dim');

            const fresh = bank.rows.filter(r => !existing.has(keyOf(r)));
            const skipped = bank.rows.length - fresh.length;
            if (skipped) log(`  Skipping ${skipped} transactions already in master.`, 'dim');
            if (!fresh.length) { log(`  Nothing new in ${file}. Skipping.`, 'dim'); continue; }

            log(`Processing ${fresh.length} new transactions...`);
            const added = [];
            const counts = { history: 0, merchant: 0, ai: 0, rules: 0 };
            try {
                for (const row of fresh) {
                    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
                    const { merchant, category, source, parsed } = await categorize(row, lookup, useAI, signal, known);
                    counts[source]++;
                    if (source === 'ai') {
                        log(`  [AI] ${row.Description} (${row.Amount}) → ${category}${parsed ? '' : '  [unparsed AI reply, used rules]'}`, parsed ? '' : 'err');
                    }
                    added.push({ ...row, 'Cleaned Merchant': txTypeMerchant(row, merchant), 'AI Category': category, Notes: '' });
                }
            } finally {
                log(`  ${counts.history} from history, ${counts.merchant} by your merchant rules, ${counts.ai} by AI, ${counts.rules} by keyword rules.`, 'dim');
                for (const k of ['history', 'merchant', 'ai', 'rules']) totals[k] += counts[k];
                // Save whatever finished, even if cancelled mid-file; dedupe skips it next run.
                if (added.length) {
                    master.rows.push(...added);
                    added.forEach(r => existing.add(keyOf(r)));
                    await writeTable(PATHS.master, master);
                    totals.added += added.length;
                    totals.files.push(file);
                    log(`Added ${added.length} new transactions from ${file} to master history.`, 'ok');
                }
            }
        }
    } finally {
        // Only rewrite the master when rows were added (it may be open in Excel otherwise).
        if (totals.added) {
            for (const r of master.rows) {
                r['Cleaned Merchant'] = cleanupMerchant(r.Description, master.columns.includes('Transaction Type') ? r['Transaction Type'] : null, r['Cleaned Merchant']);
            }
            await writeTable(PATHS.master, master);
            log('Master merchant names cleaned up.', 'dim');
        }
    }
    log(`\nDone. ${totals.added} transaction(s) added. Review them in Finance Table → Master.`, 'ok');
    return totals;
}

// ── Step 3: categorize the current month ─────────────────────────────────────

export async function processCurrentMonth({ useAI, log, signal }) {
    const cfgRaw = await loadConfig();
    if (!cfgRaw) { log('config.json not found. Create it on the Config page first.', 'err'); return null; }
    const config = parseConfig(cfgRaw);
    if (config.income === 0) log('Warning: monthly income is 0 in config.json. Update it before trusting the projection.', 'err');

    const files = await fs.listFiles(PATHS.currentMonth);
    if (!files.length) { log(`No CSV found in ${PATHS.currentMonth}/. Import this month's bank export first.`, 'err'); return null; }
    if (files.length > 1) { log(`Multiple CSVs found in ${PATHS.currentMonth}/ (${files.join(', ')}). Keep only one.`, 'err'); return null; }

    log(`Loading ${files[0]} ...`);
    const bank = await readBankCsv(`${PATHS.currentMonth}/${files[0]}`);

    // Lookup order: processed file (manual edits) → history → AI cache → AI (if enabled) → rules.
    const processedLookup = new Map();
    const processed = await readTable(PATHS.processed);
    if (processed) {
        for (const p of processed.rows) {
            processedLookup.set(keyOf(p), { category: String(p['AI Category'] ?? '').trim(), merchant: String(p['Cleaned Merchant'] ?? '').trim(), notes: p.Notes ?? '' });
        }
        log(`Loaded ${processedLookup.size} row(s) from processed file (manual edits preserved).`, 'dim');
    }
    const cache = (await readTable(PATHS.cache)) || { columns: [...CACHE_COLS], rows: [] };
    const cacheLookup = new Map(cache.rows.map(c => [keyOf(c), { category: c['AI Category'], merchant: c['Cleaned Merchant'] }]));

    const out = [];
    const newCache = [];
    const master = await readTable(PATHS.master);
    const lookup = buildHistory(master?.rows || []);
    const known = useAI ? knownMerchants(master?.rows || []) : [];
    const counts = { edited: 0, history: 0, cache: 0, merchant: 0, ai: 0, rules: 0 };
    lastSources.clear();
    try {
        for (const row of bank.rows) {
            const key = keyOf(row);
            let hit, source;
            if ((hit = processedLookup.get(key))) source = 'edited';
            else if ((hit = historyLookup(lookup, row.Description))) source = hit.source;
            else if ((hit = cacheLookup.get(key))) source = 'cache';
            else {
                hit = await categorize(row, lookup, useAI, signal, known);
                source = hit.source;
                if (source === 'ai') {
                    log(`  [AI] ${row.Description} (${row.Amount}) → ${hit.category}`);
                    const [d, desc, amt] = key.split('\u0001');
                    newCache.push({ Date: d, Description: desc, Amount: amt, 'AI Category': hit.category, 'Cleaned Merchant': hit.merchant });
                }
            }
            if (source !== 'edited') hit = applyMerchantRules(hit, row.Description); // your edits always win
            counts[source]++;
            lastSources.set(key, source);
            out.push({ ...row, 'Cleaned Merchant': hit.merchant, 'AI Category': hit.category, Notes: hit.notes ?? row.Notes ?? '' });
        }
    } finally {
        if (newCache.length) {
            cache.rows.push(...newCache);
            await writeTable(PATHS.cache, cache);
            log(`Cache updated: ${newCache.length} new transaction(s) saved.`, 'dim');
        }
    }

    if (counts.edited) log(`${counts.edited} transaction(s) loaded from processed file.`, 'dim');
    if (counts.history) log(`${counts.history} transaction(s) categorized from your history.`, 'dim');
    if (counts.cache) log(`${counts.cache} transaction(s) served from AI cache.`, 'dim');
    if (!useAI && counts.rules) log(`${counts.rules} new merchant(s) used keyword rules only. Run with AI, or fix them in Finance Table.`, 'err');

    await writeTable(PATHS.processed, { columns: MASTER_COLS, rows: out });
    log(`Processed data saved to ${PATHS.processed}. Fix categories in Finance Table, then re-run.`, 'ok');

    const projection = computeProjection({ config, rows: out, masterRows: master?.rows });
    log(`Day ${projection.daysElapsed} of ${projection.daysInMonth}. Projected ${projection.surplus >= 0 ? 'surplus' : 'deficit'}: ${money(projection.surplus, true)}`, 'ok');
    return projection;
}

// ── Step 4: close the month ──────────────────────────────────────────────────

/** Work out what closing would do, without changing anything. */
export async function planClose() {
    const processed = await readTable(PATHS.processed);
    if (!processed) return { error: `${PATHS.processed} not found. Add this month’s bank export on Setup first.` };
    if (!processed.rows.length) return { error: 'processed_current_month.csv is empty. Nothing to close.' };

    const yms = processed.rows.map(r => parseDate(r.Date)).filter(Boolean).map(yearMonth);
    if (!yms.length) return { error: 'Could not parse any dates in the processed file.' };
    const freq = new Map();
    yms.forEach(y => freq.set(y, (freq.get(y) || 0) + 1));
    const ym = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const slug = ym.replace('-', '_');

    const master = await readTable(PATHS.master);
    const existing = new Set((master?.rows || []).map(keyOf));
    const newRows = processed.rows.filter(r => !existing.has(keyOf(r)));

    const byCat = new Map();
    for (const r of newRows) {
        const c = r['AI Category'] || '(none)';
        const e = byCat.get(c) || { count: 0, total: 0 };
        e.count++; e.total += amountOf(r.Amount) || 0;
        byCat.set(c, e);
    }
    const net = newRows.reduce((a, r) => a + (amountOf(r.Amount) || 0), 0);

    return {
        ym, label: longMonthLabel(ym), slug, newRows, skipped: processed.rows.length - newRows.length,
        summary: [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0])), net,
        bankFiles: await fs.listFiles(PATHS.currentMonth),
        archiveCsv: `${PATHS.pastMonths}/${slug}_closed.csv`,
        archiveProcessed: `output_master_data/processed_${slug}.csv`,
    };
}

export async function closeMonth(plan, log) {
    if (plan.newRows.length) {
        const master = (await readTable(PATHS.master)) || { columns: [...MASTER_COLS], rows: [] };
        for (const c of MASTER_COLS) if (!master.columns.includes(c)) master.columns.push(c);
        master.rows.push(...plan.newRows.map(r => ({ ...r, Date: normalizeDateCell(r.Date) })));
        await writeTable(PATHS.master, master);
        log(`${plan.newRows.length} transaction(s) appended to ${PATHS.master}`, 'ok');
    }
    for (const f of plan.bankFiles) {
        await fs.moveFile(`${PATHS.currentMonth}/${f}`, plan.archiveCsv);
        log(`Archived bank CSV → ${plan.archiveCsv}`, 'ok');
    }
    await fs.moveFile(PATHS.processed, plan.archiveProcessed);
    log(`Archived processed file → ${plan.archiveProcessed}`, 'ok');
    lastSources.clear();
    log(`\n${plan.label} closed. Import next month's bank CSV when ready.`, 'ok');
}
