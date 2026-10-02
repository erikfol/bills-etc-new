import * as fs from '../fs.js';
import { ollamaSettings, pingOllama } from '../ollama.js';
import { PATHS } from '../data.js';
import { esc, toast } from '../util.js';
import { refreshStatus } from '../app.js';

async function folderSummary() {
    const [past, current, master, processed, config] = await Promise.all([
        fs.listFiles(PATHS.pastMonths), fs.listFiles(PATHS.currentMonth),
        fs.exists(PATHS.master), fs.exists(PATHS.processed), fs.exists(PATHS.config),
    ]);
    const item = (ok, text) => `<li>${ok ? '✅' : '⚪'} ${text}</li>`;
    return `<ul style="list-style:none;line-height:1.9">
        ${item(past.length, `<code>${PATHS.pastMonths}/</code> — ${past.length} CSV file(s)`)}
        ${item(current.length, `<code>${PATHS.currentMonth}/</code> — ${current.length} CSV file(s)`)}
        ${item(master, `<code>${PATHS.master}</code>${master ? '' : ' — not created yet (run step 1)'}`)}
        ${item(processed, `<code>${PATHS.processed}</code>${processed ? '' : ' — not created yet (run step 3)'}`)}
        ${item(config, `<code>${PATHS.config}</code>${config ? '' : ' — missing (create it on the Config page)'}`)}
    </ul>`;
}

const home = {
    async render(el) {
        const origin = location.origin;
        const supported = fs.isSupported();
        el.innerHTML = `
            <h1 class="page">Setup</h1>
            <p class="lead">Bills Etc runs entirely in your browser. Your bank files stay on your computer, and AI calls go to your local Ollama.</p>
            ${supported ? '' : `<div class="banner bad">This browser can't open local folders. Use <strong>Chrome</strong> or <strong>Edge</strong> on desktop.</div>`}

            <section>
                <h2>1 · Your data folder</h2>
                <p>Choose your <code>bills-etc-new</code> folder, the one that contains <code>inputs/</code> and <code>config.json</code>.
                The app reads and writes the same files as the Python scripts, so you can switch between them.</p>
                <div class="row" style="margin:14px 0">
                    <button class="primary" id="pick" ${fs.isSupported() ? '' : 'disabled'}>Choose folder…</button>
                    <button id="reconnect" hidden></button>
                    <span id="folder-name" class="muted"></span>
                </div>
                <div id="folder-summary"></div>
            </section>

            <section>
                <h2>2 · Local AI (Ollama)</h2>
                <div class="row" style="align-items:flex-end;margin-bottom:12px">
                    <label class="field">Ollama URL<input type="url" id="o-base" value="${esc(ollamaSettings.base)}" style="width:240px"></label>
                    <label class="field">Model<input type="text" id="o-model" value="${esc(ollamaSettings.model)}" list="o-models" style="width:180px"><datalist id="o-models"></datalist></label>
                    <button id="o-save">Save &amp; test</button>
                </div>
                <div id="o-status"></div>
                <p class="note" style="font-style:normal">For this page to reach Ollama, Ollama has to allow its address. Run this once in a terminal, then quit Ollama from the system tray and start it again:</p>
                <pre class="cmd">setx OLLAMA_ORIGINS "${esc(origin)}"</pre>
                <p class="note" style="font-style:normal">If Chrome asks whether this site may access devices on your local network, click <strong>Allow</strong>.
                You only need AI for step 1, the <em>Use AI</em> option in step 3, and the dashboard's AI analysis.</p>
            </section>`;

        const showFolder = async () => {
            const root = fs.folder();
            el.querySelector('#folder-name').textContent = root ? `Connected: ${root.name}` : '';
            el.querySelector('#folder-summary').innerHTML = root ? await folderSummary() : '';
            if (root && !(await fs.exists('1_backfill_prev_months_to_master.py')) && !(await fs.listFiles(PATHS.pastMonths)).length && !(await fs.exists(PATHS.config))) {
                el.querySelector('#folder-summary').insertAdjacentHTML('afterbegin',
                    `<div class="banner">This doesn't look like the bills-etc folder (no scripts, <code>inputs/</code> or <code>config.json</code>). Missing folders will be created as needed.</div>`);
            }
        };

        el.querySelector('#pick').onclick = async () => {
            try { await fs.pickFolder(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'bad'); return; }
            el.querySelector('#reconnect').hidden = true;
            refreshStatus();
            showFolder();
        };

        if (!fs.folder() && fs.isSupported()) {
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

        const showOllama = async () => {
            const box = el.querySelector('#o-status');
            box.innerHTML = '<p class="muted">Checking…</p>';
            const st = await pingOllama();
            el.querySelector('#o-models').innerHTML = (st.models || []).map(m => `<option value="${esc(m)}">`).join('');
            if (!st.ok) box.innerHTML = `<div class="banner bad">Ollama ${esc(st.error)}.</div>`;
            else if (!st.hasModel) box.innerHTML = `<div class="banner">Ollama is running, but model <code>${esc(ollamaSettings.model)}</code> isn't pulled. Installed: ${esc(st.models.join(', ') || 'none')}. Run <code>ollama pull ${esc(ollamaSettings.model)}</code>.</div>`;
            else box.innerHTML = `<div class="banner ok">Connected — using <code>${esc(ollamaSettings.model)}</code>.</div>`;
        };
        el.querySelector('#o-save').onclick = () => {
            ollamaSettings.save(el.querySelector('#o-base').value.trim(), el.querySelector('#o-model').value.trim());
            refreshStatus();
            showOllama();
        };
        showOllama();
    },
};

export default home;
