import * as fs from '../fs.js';
import { PATHS } from '../data.js';
import { backfill, processCurrentMonth, planClose, closeMonth } from '../workflow.js';
import { pingOllama, ollamaSettings } from '../ollama.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';

let running = null; // AbortController of the active run

const STEPS = [
    {
        n: 1, id: 'backfill', title: 'Backfill past months',
        text: 'Categorizes every new transaction in <code>inputs/past_months/</code> and appends it to the master history. Merchants you’ve categorized before reuse that category; only new merchants go to the AI. Rows already in the master are skipped.',
        importTo: PATHS.pastMonths,
        ai: 'on',
    },
    {
        n: 2, id: 'report', title: 'View the history report',
        text: 'Cash flow, category breakdowns, trends and every transaction from the master, with an optional AI analysis.',
    },
    {
        n: 3, id: 'current', title: 'Mid-month check',
        text: 'Categorizes the current month’s bank export (your edits → history → cache → AI → rules) and projects the full month against your config and history. Fix categories in <a href="#edit">Edit Categories</a> and re-run.',
        importTo: PATHS.currentMonth,
        ai: 'off',
    },
    {
        n: 4, id: 'close', title: 'Close the month',
        text: 'Appends the processed month to the master, archives the bank CSV and processed file, and clears <code>inputs/current_month/</code>.',
    },
];

async function fileStatus(id) {
    switch (id) {
        case 'backfill': {
            const f = await fs.listFiles(PATHS.pastMonths);
            return `${f.length} CSV file(s) in <code>${PATHS.pastMonths}/</code>`;
        }
        case 'report':
            return (await fs.exists(PATHS.master)) ? 'Master history found.' : 'No master history yet; run step 1 first.';
        case 'current': {
            const f = await fs.listFiles(PATHS.currentMonth);
            return f.length ? `Current file: <code>${esc(f.join(', '))}</code>${f.length > 1 ? ' — <strong>keep only one</strong>' : ''}` : 'No CSV in <code>inputs/current_month/</code>.';
        }
        case 'close':
            return (await fs.exists(PATHS.processed)) ? 'Processed current month is ready to close.' : 'Nothing to close; run step 3 first.';
    }
}

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = `
            <h1 class="page">Workflow</h1>
            <p class="lead">The same four steps as the Python scripts, run against your folder.</p>
            ${STEPS.map(s => `
                <section class="step" data-step="${s.id}">
                    <div class="step-num">${s.n}</div>
                    <div>
                        <h3>${s.title}</h3>
                        <p>${s.text}</p>
                        <div class="file-status" data-status="${s.id}">…</div>
                        <div class="row">
                            ${s.importTo ? `<button data-import="${s.id}">Import bank CSV…</button>` : ''}
                            ${s.ai ? `<label class="check"><input type="checkbox" data-ai="${s.id}"${s.ai === 'on' ? ' checked' : ''}> Use AI for new merchants</label>` : ''}
                            <button class="primary" data-run="${s.id}">${s.id === 'report' ? 'Open dashboard' : s.id === 'close' ? 'Review & close…' : 'Run'}</button>
                        </div>
                        <div data-extra="${s.id}"></div>
                    </div>
                </section>`).join('')}
            <section>
                <h2>Log <span class="spacer"></span><button class="small danger" id="cancel" hidden>Cancel</button><button class="small" id="clear-log">Clear</button></h2>
                <div class="log" id="log"><span class="dim">Output from each step appears here.</span></div>
            </section>
            <input type="file" id="file-in" accept=".csv" multiple hidden>`;

        const logEl = el.querySelector('#log');
        const log = (text, kind = '') => {
            const span = document.createElement('span');
            if (kind) span.className = kind;
            span.textContent = text + '\n';
            logEl.appendChild(span);
            logEl.scrollTop = logEl.scrollHeight;
        };
        el.querySelector('#clear-log').onclick = () => { logEl.textContent = ''; };

        const refresh = () => Promise.all(STEPS.map(async s => {
            el.querySelector(`[data-status="${s.id}"]`).innerHTML = await fileStatus(s.id);
        }));
        refresh();

        const setBusy = busy => {
            el.querySelectorAll('[data-run],[data-import]').forEach(b => { b.disabled = busy; });
            el.querySelector('#cancel').hidden = !busy;
        };
        el.querySelector('#cancel').onclick = () => running?.abort();

        const run = async (fn) => {
            running = new AbortController();
            setBusy(true);
            try {
                return await fn(running.signal);
            } catch (e) {
                if (e.name === 'AbortError') log('Cancelled. Finished rows were saved.', 'err');
                else {
                    console.error(e);
                    log(`Error: ${e.message}`, 'err');
                    toast(e.name === 'NotAllowedError' ? 'Lost access to your folder. Reconnect it on the Setup page.' : `Error: ${e.message}`, 'bad');
                }
            } finally {
                running = null;
                setBusy(false);
                refresh();
            }
        };

        /** True if AI is usable; otherwise explain right under the step and offer to run without it. */
        const needOllama = async stepId => {
            const st = await pingOllama();
            if (st.ok && st.hasModel) return true;
            const fix = st.ok
                ? `Ollama is running, but the model <code>${esc(ollamaSettings.model)}</code> isn't installed. In a terminal, run:<pre class="cmd">ollama pull ${esc(ollamaSettings.model)}</pre>`
                : location.hostname === 'localhost' || location.hostname === '127.0.0.1'
                    ? 'Ollama isn’t reachable. Is it running?'
                    : `This page can’t reach Ollama. Run this once in a terminal, then quit Ollama from the system tray and start it again:<pre class="cmd">setx OLLAMA_ORIGINS "${esc(location.origin)}"</pre>`;
            log(st.ok ? `Model ${ollamaSettings.model} isn't installed in Ollama.` : `Ollama ${st.error}.`, 'err');
            const extra = el.querySelector(`[data-extra="${stepId}"]`);
            extra.innerHTML = `
                <div class="banner bad" style="margin-top:12px">
                    <strong>Didn't run: AI isn't available.</strong> ${fix}
                    You can also run without AI. Merchants you've categorized before use your history, and new ones get keyword rules you can fix in Edit Categories.
                    <div class="row" style="margin-top:10px"><button class="primary" data-noai>Run without AI</button></div>
                </div>`;
            extra.querySelector('[data-noai]').onclick = () => {
                extra.innerHTML = '';
                el.querySelector(`[data-ai="${stepId}"]`).checked = false;
                el.querySelector(`[data-run="${stepId}"]`).click();
            };
            return false;
        };

        // Import bank CSVs into the folder
        const fileIn = el.querySelector('#file-in');
        let importTarget = null;
        el.querySelectorAll('[data-import]').forEach(btn => btn.onclick = () => {
            importTarget = STEPS.find(s => s.id === btn.dataset.import).importTo;
            fileIn.multiple = importTarget === PATHS.pastMonths;
            fileIn.click();
        });
        fileIn.onchange = async () => {
            const files = [...fileIn.files];
            fileIn.value = '';
            if (!files.length) return;
            if (importTarget === PATHS.currentMonth) {
                const existing = await fs.listFiles(PATHS.currentMonth);
                if (existing.length && !confirm(`Replace ${existing.join(', ')} in inputs/current_month/ with ${files[0].name}?`)) return;
                for (const f of existing) await fs.removeFile(`${PATHS.currentMonth}/${f}`);
            }
            for (const f of files) {
                const dest = `${importTarget}/${f.name}`;
                if (importTarget === PATHS.pastMonths && await fs.exists(dest) && !confirm(`${f.name} already exists in inputs/past_months/. Overwrite?`)) continue;
                await fs.writeText(dest, await f.text());
                log(`Imported ${f.name} → ${dest}`, 'ok');
            }
            refresh();
        };

        el.querySelector('[data-run="backfill"]').onclick = () => run(async signal => {
            el.querySelector('[data-extra="backfill"]').innerHTML = '';
            const useAI = el.querySelector('[data-ai="backfill"]').checked;
            log(`\n=== Step 1: Backfill past months${useAI ? ' (AI for new merchants)' : ''} ===`);
            if (useAI && !(await needOllama('backfill'))) return;
            await backfill({ useAI, log, signal });
        });

        el.querySelector('[data-run="report"]').onclick = () => { location.hash = '#dashboard'; };

        el.querySelector('[data-run="current"]').onclick = () => run(async signal => {
            const useAI = el.querySelector('[data-ai="current"]').checked;
            log(`\n=== Step 3: Current month${useAI ? ' (with AI)' : ''} ===`);
            if (useAI && !(await needOllama('current'))) return;
            const projection = await processCurrentMonth({ useAI, log, signal });
            if (projection) {
                el.querySelector('[data-extra="current"]').innerHTML =
                    `<p style="margin-top:10px"><a href="#month">View the projection →</a></p>`;
            }
        });

        el.querySelector('[data-run="close"]').onclick = () => run(async () => {
            const extra = el.querySelector('[data-extra="close"]');
            const plan = await planClose();
            if (plan.error) { log(plan.error, 'err'); return; }
            extra.innerHTML = `
                <div class="banner" style="margin-top:14px">
                    <strong>Close ${esc(plan.label)}?</strong>
                    ${plan.skipped ? `<br>${plan.skipped} row(s) are already in the master and will be skipped.` : ''}
                    <div class="table-wrap" style="margin:10px 0">
                    ${plan.newRows.length ? `
                        <table class="summary-table">
                            <thead><tr><th>Category</th><th class="num">Txns</th><th class="num">Total</th></tr></thead>
                            <tbody>${plan.summary.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${v.count}</td><td class="num">${money(v.total, true)}</td></tr>`).join('')}
                            <tr class="total-row"><td><strong>Net</strong></td><td></td><td class="num"><strong>${money(plan.net, true)}</strong></td></tr></tbody>
                        </table>` : '<p>All transactions are already in the master. Nothing new to append.</p>'}
                    </div>
                    This will:
                    <ul style="margin:6px 0 10px 20px">
                        ${plan.newRows.length ? `<li>Append ${plan.newRows.length} transaction(s) to the master</li>` : ''}
                        ${plan.bankFiles.map(f => `<li>Archive <code>${esc(f)}</code> → <code>${esc(plan.archiveCsv)}</code></li>`).join('')}
                        <li>Archive the processed file → <code>${esc(plan.archiveProcessed)}</code></li>
                        <li>Clear <code>inputs/current_month/</code></li>
                    </ul>
                    <div class="row"><button class="primary" id="confirm-close">Close month</button><button id="cancel-close">Cancel</button></div>
                </div>`;
            extra.querySelector('#cancel-close').onclick = () => { extra.innerHTML = ''; };
            extra.querySelector('#confirm-close').onclick = () => run(async () => {
                extra.innerHTML = '';
                log(`\n=== Step 4: Close ${plan.label} ===`);
                await closeMonth(plan, log);
                toast(`${plan.label} closed`, 'ok');
            });
        });
    },

    canLeave(unloading) {
        if (!running) return true;
        return unloading ? false : confirm('A step is still running. Leave and cancel it?') && (running.abort(), true);
    },
};
