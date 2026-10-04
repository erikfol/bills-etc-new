import * as fs from '../fs.js';
import { ollamaSettings, pingOllama, aiEnabled, setAiEnabled } from '../ollama.js';
import { PATHS, readTable, readBankCsv, keyOf } from '../data.js';
import { parseCSV } from '../csv.js';
import { parseDate, yearMonth, monthLabel } from '../dates.js';
import { backfill, processCurrentMonth, planClose, closeMonth } from '../workflow.js';
import { esc, money, toast } from '../util.js';
import { refreshStatus } from '../app.js';
import { dataTable, closeFilterMenu } from '../datatable.js';

let busy = false;
let running = null; // AbortController of the active load

const monthsOf = rows => [...new Set(rows.map(r => parseDate(r.Date)).filter(Boolean).map(yearMonth))].sort();
const rangeLabel = yms => !yms.length ? '—' : yms.length === 1 ? monthLabel(yms[0]) : `${monthLabel(yms[0])} – ${monthLabel(yms.at(-1))}`;

/** What's in the folder, and which bank files still have rows that aren't in the master. */
async function folderStatus() {
    const master = await readTable(PATHS.master);
    const keys = new Set((master?.rows || []).map(keyOf));
    const past = [];
    for (const name of await fs.listFiles(PATHS.pastMonths)) {
        const bank = await readBankCsv(`${PATHS.pastMonths}/${name}`);
        past.push({ name, months: monthsOf(bank.rows), pending: bank.rows.filter(r => !keys.has(keyOf(r))).length });
    }
    const current = [];
    for (const name of await fs.listFiles(PATHS.currentMonth)) {
        const bank = await readBankCsv(`${PATHS.currentMonth}/${name}`);
        current.push({ name, months: monthsOf(bank.rows) });
    }
    return {
        master: master ? { rows: master.rows.length, months: monthsOf(master.rows) } : null,
        past, current,
        processed: await fs.exists(PATHS.processed),
        config: await fs.exists(PATHS.config),
    };
}

function statusHtml(st) {
    const pending = st.past.filter(f => f.pending);
    const thisYm = yearMonth(new Date());
    const cur = st.current[0];
    return `
        <div class="cards" style="margin:14px 0">
            <div class="card"><div class="label">History</div>
                <div class="value" style="font-size:1.2em">${st.master ? esc(rangeLabel(st.master.months)) : 'Empty'}</div>
                <div class="sub">${st.master ? `${st.master.rows.toLocaleString()} transactions` : 'Add bank files to start'}</div></div>
            <div class="card"><div class="label">Waiting to load</div>
                <div class="value" style="font-size:1.2em;color:${pending.length ? 'var(--orange)' : 'var(--green)'}">${pending.length ? `${pending.reduce((a, f) => a + f.pending, 0)} rows` : 'Nothing'}</div>
                <div class="sub">${pending.length ? `in ${pending.length} file(s); click Refresh` : 'all bank files are loaded'}</div></div>
            <div class="card"><div class="label">Current month</div>
                <div class="value" style="font-size:1.2em">${cur ? esc(rangeLabel(cur.months)) : 'None'}</div>
                <div class="sub">${cur ? esc(cur.name) : 'add this month’s export to see a projection'}</div></div>
        </div>
        ${cur && cur.months.length && cur.months.at(-1) < thisYm ? `<div class="banner">The current-month file is for ${esc(rangeLabel(cur.months))}, which has ended. When you've finished fixing its categories, ${st.processed ? 'close it with <strong>Close month</strong> below' : 'click Refresh, then close it with <strong>Close month</strong>'}.</div>` : ''}
        ${st.current.length > 1 ? `<div class="banner bad">There are ${st.current.length} files in <code>${PATHS.currentMonth}/</code>; keep only one.</div>` : ''}
        ${st.processed ? `<div class="row" style="margin:0 0 12px"><button id="close-month"${cur && cur.months.length && cur.months.at(-1) < thisYm ? ' class="primary"' : ''}>Close month…</button>
            <span class="muted" style="font-size:0.85em">Adds the finished month to your history, archives its files and clears <code>${PATHS.currentMonth}/</code>.</span></div>
            <div id="close-plan"></div>` : ''}
        ${st.config ? '' : `<div class="banner">No <code>config.json</code> yet, so This Month can't project. Create it on the <a href="#config">Config</a> page.</div>`}
        <details${pending.length ? ' open' : ''}>
            <summary style="cursor:pointer;color:#555;font-size:0.9em">Bank files in <code>${PATHS.pastMonths}/</code> (${st.past.length})</summary>
            <div id="t-files" style="margin-top:8px"></div>
        </details>`;
}

/** Route picked CSVs: a file whose newest date is in this calendar month is the current month; the rest are past months. */
async function importFiles(files, log) {
    const thisYm = yearMonth(new Date());
    const result = { past: [], current: null, skipped: [] };
    for (const f of files) {
        const text = await f.text();
        const { columns, rows } = parseCSV(text);
        const missing = ['Date', 'Description', 'Amount'].filter(c => !columns.includes(c));
        if (missing.length) { log(`Skipped ${f.name}: missing column(s) ${missing.join(', ')}. Is it a bank export CSV?`, 'err'); result.skipped.push(f.name); continue; }
        const yms = monthsOf(rows);
        if (!yms.length) { log(`Skipped ${f.name}: no readable dates.`, 'err'); result.skipped.push(f.name); continue; }

        if (yms.at(-1) === thisYm) {
            const existing = await fs.listFiles(PATHS.currentMonth);
            const others = existing.filter(n => n !== f.name);
            if (others.length && !confirm(`${f.name} is for this month. Replace ${others.join(', ')} in inputs/current_month/ with it?`)) continue;
            for (const n of others) await fs.removeFile(`${PATHS.currentMonth}/${n}`);
            await fs.writeText(`${PATHS.currentMonth}/${f.name}`, text);
            log(`${f.name} → current month (${rangeLabel(yms)})`, 'ok');
            result.current = f.name;
        } else {
            const dest = `${PATHS.pastMonths}/${f.name}`;
            const old = await fs.readText(dest);
            if (old !== null && old !== text && !confirm(`A different ${f.name} is already in inputs/past_months/. Replace it?`)) continue;
            await fs.writeText(dest, text);
            log(`${f.name} → past months (${rangeLabel(yms)})`, 'ok');
            result.past.push(f.name);
        }
    }
    return result;
}

const home = {
    async render(el) {
        const origin = location.origin;
        const supported = fs.isSupported();
        const ai = aiEnabled();
        el.innerHTML = `
            <h1 class="page">Setup</h1>
            <p class="lead">Bills Etc runs entirely in your browser. Your bank files stay on your computer.</p>
            ${supported ? '' : `<div class="banner bad">This browser can't open local folders. Use <strong>Chrome</strong> or <strong>Edge</strong> on desktop.</div>`}

            <section>
                <h2>Your data folder</h2>
                <p>Choose your <code>bills-etc-new</code> folder, the one that contains <code>inputs/</code> and <code>config.json</code>.
                The app reads and writes the same files as the Python scripts, so you can switch between them.</p>
                <div class="row" style="margin:14px 0">
                    <button id="pick" ${supported ? '' : 'disabled'}>Choose folder…</button>
                    <button class="primary" id="reconnect" hidden></button>
                    <span id="folder-name" class="muted"></span>
                </div>
                <div id="folder-tools" hidden>
                    <div class="row">
                        <button class="primary" id="add-files">Add bank files…</button>
                        <button id="refresh">Refresh</button>
                        ${ai ? '<label class="check"><input type="checkbox" id="use-ai" checked> Use AI for new merchants</label>' : ''}
                        <button class="small danger" id="cancel" hidden>Cancel</button>
                        <span class="muted" style="font-size:0.85em">Add exports from CitizensBank.com, or click Refresh after copying files into the folder yourself.</span>
                    </div>
                    <div id="result" style="margin-top:12px"></div>
                    <div id="folder-status"><p class="muted">Checking files…</p></div>
                    <details id="log-wrap" style="margin-top:10px" hidden>
                        <summary style="cursor:pointer;color:#555;font-size:0.9em">Details</summary>
                        <div class="log" id="log" style="margin-top:8px"></div>
                    </details>
                </div>
                <input type="file" id="file-in" accept=".csv" multiple hidden>
            </section>

            <section>
                <details${ai ? ' open' : ''}>
                    <summary style="cursor:pointer"><strong>Local AI (Ollama)</strong> <span class="muted" style="font-size:0.85em">— optional, ${ai ? 'on' : 'off'}</span></summary>
                    <p style="margin-top:12px">Without AI, transactions are categorized from your own history first, then by keyword rules. Turn this on only if you have Ollama set up.</p>
                    <label class="check" style="margin:10px 0"><input type="checkbox" id="ai-on"${ai ? ' checked' : ''}> Turn on AI features</label>
                    <div id="ai-settings"${ai ? '' : ' hidden'}>
                        <div class="row" style="align-items:flex-end;margin-bottom:12px">
                            <label class="field">Ollama URL<input type="url" id="o-base" value="${esc(ollamaSettings.base)}" style="width:240px"></label>
                            <label class="field">Model<input type="text" id="o-model" value="${esc(ollamaSettings.model)}" list="o-models" style="width:180px"><datalist id="o-models"></datalist></label>
                            <button id="o-save">Save &amp; test</button>
                        </div>
                        <div id="o-status"></div>
                        <p class="note" style="font-style:normal">For this page to reach Ollama, run this once in a terminal, then quit Ollama from the system tray and start it again:</p>
                        <pre class="cmd">setx OLLAMA_ORIGINS "${esc(origin)}"</pre>
                    </div>
                </details>
            </section>`;

        const logEl = el.querySelector('#log');
        const log = (text, kind = '') => {
            el.querySelector('#log-wrap').hidden = false;
            const span = document.createElement('span');
            if (kind) span.className = kind;
            span.textContent = text + '\n';
            logEl.appendChild(span);
            logEl.scrollTop = logEl.scrollHeight;
        };
        const result = html => { el.querySelector('#result').innerHTML = html; };

        const showFolder = async () => {
            const root = fs.folder();
            el.querySelector('#folder-name').textContent = root ? `Connected: ${root.name}` : '';
            el.querySelector('#folder-tools').hidden = !root;
            el.querySelector('#pick').textContent = root ? 'Change folder…' : 'Choose folder…';
            el.querySelector('#pick').classList.toggle('primary', !root);
            if (!root) return;
            try {
                const st = await folderStatus();
                el.querySelector('#folder-status').innerHTML = statusHtml(st);
                const closeBtn = el.querySelector('#close-month');
                if (closeBtn) { closeBtn.disabled = busy; closeBtn.onclick = reviewClose; }
                dataTable(el.querySelector('#t-files'), {
                    columns: [
                        { id: 'name', label: 'File', value: f => f.name, cell: f => `<code>${esc(f.name)}</code>` },
                        { id: 'covers', label: 'Covers', value: f => f.months.at(-1) ?? '', text: monthLabel, sortLabels: ['Oldest → Newest', 'Newest → Oldest'], cell: f => esc(rangeLabel(f.months)) },
                        { id: 'status', label: 'Status', value: f => (f.pending ? 'New rows' : 'Loaded'),
                            cell: f => f.pending ? `<span class="badge badge-warn">${f.pending} new rows</span>` : '<span class="badge badge-ok">Loaded</span>' },
                    ],
                    rows: st.past,
                    sort: { col: 'name', dir: 'desc' },
                    empty: 'No bank files yet',
                });
            } catch (e) {
                el.querySelector('#folder-status').innerHTML = `<div class="banner bad">Couldn't read the folder: ${esc(e.message)}</div>`;
            }
        };

        /** Load pending past-month rows (and the current month, if asked), then show a summary. */
        const load = async ({ current = false, skipped = [] } = {}, useAI = !!el.querySelector('#use-ai')?.checked) => {
            busy = true;
            running = new AbortController();
            const signal = running.signal;
            el.querySelectorAll('#add-files, #refresh, #close-month').forEach(b => { b.disabled = true; });
            el.querySelector('#cancel').hidden = false;
            result(`<p class="muted">Loading…${useAI ? ' New merchants go to the AI, which can take a few seconds each.' : ''}</p>`);
            try {
                if (useAI) {
                    const st = await pingOllama();
                    if (!(st.ok && st.hasModel)) {
                        log(st.ok ? `Model ${ollamaSettings.model} isn't installed in Ollama.` : `Ollama ${st.error}.`, 'err');
                        result(`<div class="banner bad"><strong>Didn't load: AI isn't available</strong> (${st.ok ? `model <code>${esc(ollamaSettings.model)}</code> isn't installed` : esc(st.error)}). See Local AI below.
                            You can also load without AI: merchants you've categorized before use your history, and new ones get keyword rules.
                            <div class="row" style="margin-top:10px"><button class="primary" id="no-ai">Load without AI</button></div></div>`);
                        el.querySelector('#no-ai').onclick = () => load({ current, skipped }, false);
                        return;
                    }
                }
                const t = await backfill({ useAI, log, signal });
                let html = '';
                if (t.added) {
                    html += `<div class="banner ok"><strong>Loaded ${t.added} new transaction${t.added === 1 ? '' : 's'}</strong> from ${t.files.map(esc).join(', ')}.
                        ${t.history} matched merchants from your history${t.merchant ? `; ${t.merchant} matched your merchant rules` : ''}${t.ai ? `; ${t.ai} new merchant${t.ai === 1 ? ' was' : 's were'} categorized by the AI` : ''}${t.rules ? `; <strong>${t.rules} new merchant${t.rules === 1 ? ' was' : 's were'}</strong> categorized by keyword rules (mostly “Miscellaneous”). Check them in <a href="#edit">Finance Table</a> → Master history, filtering Category to Miscellaneous` : ''}.</div>`;
                }
                if (current) {
                    const p = await processCurrentMonth({ useAI, log, signal });
                    if (p) html += `<div class="banner ok"><strong>Current month updated.</strong> See <a href="#month">This Month</a>.</div>`;
                    else html += `<div class="banner bad">Couldn't process the current month; see Details below.</div>`;
                }
                if (skipped.length) html += `<div class="banner bad">Skipped ${skipped.map(esc).join(', ')}: not a bank export (needs Date, Description and Amount columns).</div>`;
                result(html || '<div class="banner ok">Everything is already loaded. Nothing new found.</div>');
            } catch (e) {
                if (e.name === 'AbortError') {
                    log('Cancelled. Finished rows were saved.', 'err');
                    result('<div class="banner">Cancelled. Rows that finished were saved; click Refresh to load the rest.</div>');
                    return;
                }
                console.error(e);
                log(`Error: ${e.message}`, 'err');
                result(`<div class="banner bad">${e.name === 'NotAllowedError' ? 'Lost access to your folder. Click Reconnect above.' : `Something went wrong: ${esc(e.message)}`}</div>`);
            } finally {
                busy = false;
                running = null;
                el.querySelectorAll('#add-files, #refresh').forEach(b => { b.disabled = false; });
                el.querySelector('#cancel').hidden = true;
                showFolder();
            }
        };
        el.querySelector('#cancel').onclick = () => running?.abort();

        /** Close month: show what will happen, then do it on confirm. */
        const reviewClose = async () => {
            const box = el.querySelector('#close-plan');
            const plan = await planClose();
            if (plan.error) { box.innerHTML = `<div class="banner bad">${esc(plan.error)}</div>`; return; }
            box.innerHTML = `
                <div class="banner" style="margin-bottom:12px">
                    <strong>Close ${esc(plan.label)}?</strong>
                    ${plan.skipped ? `<br>${plan.skipped} row(s) are already in the history and will be skipped.` : ''}
                    <div class="table-wrap" style="margin:10px 0">
                    ${plan.newRows.length ? `
                        <table class="summary-table">
                            <thead><tr><th>Category</th><th class="num">Txns</th><th class="num">Total</th></tr></thead>
                            <tbody>${plan.summary.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${v.count}</td><td class="num">${money(v.total, true)}</td></tr>`).join('')}
                            <tr class="total-row"><td><strong>Net</strong></td><td></td><td class="num"><strong>${money(plan.net, true)}</strong></td></tr></tbody>
                        </table>` : '<p>All transactions are already in the history. Nothing new to add.</p>'}
                    </div>
                    This will:
                    <ul style="margin:6px 0 10px 20px">
                        ${plan.newRows.length ? `<li>Add ${plan.newRows.length} transaction(s) to the history</li>` : ''}
                        ${plan.bankFiles.map(f => `<li>Archive <code>${esc(f)}</code> → <code>${esc(plan.archiveCsv)}</code></li>`).join('')}
                        <li>Archive the processed file → <code>${esc(plan.archiveProcessed)}</code></li>
                        <li>Clear <code>${PATHS.currentMonth}/</code></li>
                    </ul>
                    <div class="row"><button class="primary" id="confirm-close">Close ${esc(plan.label)}</button><button id="cancel-close">Cancel</button></div>
                </div>`;
            box.querySelector('#cancel-close').onclick = () => { box.innerHTML = ''; };
            box.querySelector('#confirm-close').onclick = async () => {
                box.querySelectorAll('button').forEach(b => { b.disabled = true; });
                logEl.textContent = '';
                try {
                    await closeMonth(plan, log);
                    result(`<div class="banner ok"><strong>${esc(plan.label)} closed.</strong> Add next month's bank export when it's ready.</div>`);
                    toast(`${plan.label} closed`, 'ok');
                } catch (e) {
                    console.error(e);
                    log(`Error: ${e.message}`, 'err');
                    result(`<div class="banner bad">Couldn't close ${esc(plan.label)}: ${esc(e.message)}. See Details below.</div>`);
                }
                showFolder();
            };
        };

        el.querySelector('#refresh').onclick = async () => {
            logEl.textContent = '';
            // Process the current month only if it hasn't been yet; edits in the processed file are kept either way.
            const hasCurrent = (await fs.listFiles(PATHS.currentMonth)).length === 1;
            load({ current: hasCurrent && !(await fs.exists(PATHS.processed)) });
        };

        const fileIn = el.querySelector('#file-in');
        el.querySelector('#add-files').onclick = () => fileIn.click();
        fileIn.onchange = async () => {
            const files = [...fileIn.files];
            fileIn.value = '';
            if (!files.length) return;
            logEl.textContent = '';
            try {
                const r = await importFiles(files, log);
                if (!r.past.length && !r.current) { result('<div class="banner bad">No files were added; see Details below.</div>'); el.querySelector('#log-wrap').open = true; return; }
                await load({ current: !!r.current, skipped: r.skipped });
            } catch (e) {
                result(`<div class="banner bad">${esc(e.message)}</div>`);
            }
        };

        el.querySelector('#pick').onclick = async () => {
            try { await fs.pickFolder(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'bad'); return; }
            el.querySelector('#reconnect').hidden = true;
            refreshStatus();
            showFolder();
        };

        if (!fs.folder() && supported) {
            const remembered = await fs.rememberedFolder().catch(() => null);
            if (remembered && !remembered.granted) {
                const btn = el.querySelector('#reconnect');
                btn.hidden = false;
                btn.textContent = `Reconnect “${remembered.handle.name}”`;
                btn.onclick = async () => {
                    if (await fs.reconnect(remembered.handle)) { btn.hidden = true; refreshStatus(); showFolder(); }
                };
            }
        }
        showFolder();

        // ── Optional AI ──
        const showOllama = async () => {
            const box = el.querySelector('#o-status');
            box.innerHTML = '<p class="muted">Checking…</p>';
            const st = await pingOllama();
            el.querySelector('#o-models').innerHTML = (st.models || []).map(m => `<option value="${esc(m)}">`).join('');
            if (!st.ok) box.innerHTML = `<div class="banner bad">Ollama ${esc(st.error)}.</div>`;
            else if (!st.hasModel) box.innerHTML = `<div class="banner">Ollama is running, but model <code>${esc(ollamaSettings.model)}</code> isn't pulled. Installed: ${esc(st.models.join(', ') || 'none')}. Run <code>ollama pull ${esc(ollamaSettings.model)}</code>.</div>`;
            else box.innerHTML = `<div class="banner ok">Connected — using <code>${esc(ollamaSettings.model)}</code>.</div>`;
        };
        el.querySelector('#ai-on').onchange = e => {
            setAiEnabled(e.target.checked);
            el.querySelector('#ai-settings').hidden = !e.target.checked;
            refreshStatus();
            if (e.target.checked) showOllama();
        };
        el.querySelector('#o-save').onclick = () => {
            ollamaSettings.save(el.querySelector('#o-base').value.trim(), el.querySelector('#o-model').value.trim());
            refreshStatus();
            showOllama();
        };
        if (ai) showOllama();
    },

    destroy() {
        closeFilterMenu();
    },

    canLeave(unloading) {
        if (!busy) return true;
        return unloading ? false : confirm('Files are still loading. Leave and cancel? Rows that finished are saved.') && (running?.abort(), true);
    },
};

export default home;
