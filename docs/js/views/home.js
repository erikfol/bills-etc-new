import * as fs from '../fs.js';
import { ollamaSettings, pingOllama } from '../ollama.js';
import { PATHS } from '../data.js';
import { esc, toast } from '../util.js';
import { refreshStatus } from '../app.js';
import { exportSnapshot, openSnapshot, MIN_PASSPHRASE } from '../snapshot.js';

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

function snapshotSection(canExport) {
    return `
        <section id="snap">
            <h2>View on other devices <span class="sub">encrypted snapshot</span></h2>
            ${canExport ? `
            <p>Save an encrypted copy of your history, current month and config to a file, for example in OneDrive or Google Drive.
            On your phone or another computer, open this page and unlock the file with your passphrase to see the Dashboard and This Month (read-only).</p>
            <div class="row" style="align-items:flex-end;margin:14px 0 6px">
                <label class="field">Passphrase<input type="password" id="ex-pass" autocomplete="new-password" style="width:220px"></label>
                <label class="field">Repeat<input type="password" id="ex-pass2" autocomplete="new-password" style="width:220px"></label>
                <button class="primary" id="ex-go">Export snapshot…</button>
            </div>
            <p class="note" style="font-style:normal">Use at least ${MIN_PASSPHRASE} characters; a few random words work well. <strong>There is no recovery</strong>: forget it and the file can't be opened. Export again after each update.</p>
            <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">` : ''}
            <p><strong>Open a snapshot</strong>${canExport ? ' (to check one, or on this device)' : ''}</p>
            <div class="row" style="align-items:flex-end;margin-top:10px">
                <label class="field">Snapshot file<input type="file" id="op-file" style="max-width:260px"></label>
                <label class="field">Passphrase<input type="password" id="op-pass" autocomplete="current-password" style="width:220px"></label>
                <button class="primary" id="op-go">Unlock</button>
            </div>
            <div id="snap-msg" style="margin-top:10px"></div>
        </section>`;
}

function bindSnapshot(el) {
    const msg = (html, kind = '') => { el.querySelector('#snap-msg').innerHTML = html ? `<div class="banner ${kind}">${html}</div>` : ''; };
    const ex = el.querySelector('#ex-go');
    if (ex) ex.onclick = async () => {
        const p1 = el.querySelector('#ex-pass').value, p2 = el.querySelector('#ex-pass2').value;
        if (p1.length < MIN_PASSPHRASE) return msg(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`, 'bad');
        if (p1 !== p2) return msg("The passphrases don't match.", 'bad');
        ex.disabled = true;
        msg('Encrypting…');
        try {
            const name = await exportSnapshot(p1);
            if (!name) return msg('');
            el.querySelector('#ex-pass').value = el.querySelector('#ex-pass2').value = '';
            msg(`Saved <code>${esc(name)}</code>. Put it somewhere your other devices can reach, like OneDrive.`, 'ok');
        } catch (e) {
            msg(esc(e.message), 'bad');
        } finally {
            ex.disabled = false;
        }
    };
    el.querySelector('#op-go').onclick = async () => {
        const file = el.querySelector('#op-file').files[0];
        const pass = el.querySelector('#op-pass').value;
        if (!file) return msg('Choose the snapshot file first.', 'bad');
        if (!pass) return msg('Enter the passphrase.', 'bad');
        const btn = el.querySelector('#op-go');
        btn.disabled = true;
        msg('Unlocking…');
        try {
            await openSnapshot(file, pass);
            await refreshStatus();
            location.hash = '#month';
        } catch (e) {
            msg(esc(e.message), 'bad');
        } finally {
            btn.disabled = false;
        }
    };
}

function renderUnlocked(el) {
    const snap = fs.snapshot();
    el.innerHTML = `
        <h1 class="page">Snapshot unlocked</h1>
        <p class="lead">Read-only view of your data as of ${esc(snap.created.toLocaleString())}. It lives only in this tab's memory.</p>
        <section>
            <div class="row">
                <a href="#month"><button class="primary">This Month</button></a>
                <a href="#dashboard"><button>Dashboard</button></a>
                <span class="spacer"></span>
                <button class="danger" id="lock">Lock</button>
            </div>
            <p class="note">Lock (or close or reload the tab) clears the decrypted data. You'll need the passphrase again.</p>
        </section>`;
    el.querySelector('#lock').onclick = async () => {
        fs.lockSnapshot();
        await refreshStatus();
        home.render(el);
    };
}

const home = {
    async render(el) {
        if (fs.isReadOnly()) return renderUnlocked(el);
        const origin = location.origin;
        const supported = fs.isSupported();
        el.innerHTML = `
            <h1 class="page">Setup</h1>
            <p class="lead">Bills Etc runs entirely in your browser. Your bank files stay on your computer, and AI calls go to your local Ollama.</p>
            ${supported ? '' : `<div class="banner">This browser can't open local folders, so it can only view an encrypted snapshot. To run the workflow, use <strong>Chrome</strong> or <strong>Edge</strong> on your computer.</div>${snapshotSection(false)}`}

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
            </section>
            ${supported ? snapshotSection(true) : ''}`;
        bindSnapshot(el);

        const showFolder = async () => {
            const root = fs.folder();
            const ex = el.querySelector('#ex-go');
            if (ex) { ex.disabled = !root; ex.title = root ? '' : 'Connect your folder first'; }
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
