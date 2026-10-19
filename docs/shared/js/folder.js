// Folder connection for the Home-page sections (Health, Vehicles). They use the same folder as Bills Etc: the
// browser remembers it for the whole site, so it's usually already connected.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';

export function refreshStatus() {
    const f = document.getElementById('st-folder');
    const root = fs.folder();
    f.textContent = root ? `📁 ${root.name}` : 'No folder';
    f.className = 'pill ' + (root ? 'ok' : 'bad');
}

/** Shown until a folder is connected: reconnect the remembered one, or choose one. `where` is e.g. 'inputs/health/'. */
export async function askForFolder(el, { what, where, onConnected }) {
    const rem = await fs.rememberedFolder().catch(() => null);
    const moved = rem?.moved;
    el.innerHTML = `
        <section>
            <h2>Connect your folder</h2>
            ${moved ? `<div class="banner bad" style="margin-bottom:12px">${esc(fs.movedMessage(rem.handle))} Choose it again where it is now.</div>` : ''}
            <p>${esc(what)} are saved in <code>${esc(where)}</code> inside your <code>erik-life-app</code> folder
            (the same folder Bills Etc uses). Nothing is uploaded, and <code>inputs/</code> is never put on GitHub.</p>
            ${fs.isSupported() ? '' : '<div class="banner bad" style="margin-top:12px">This browser can’t open local folders. Use Chrome or Edge.</div>'}
            <div class="row" style="margin-top:12px">
                ${rem && !moved ? `<button class="primary" id="reconnect">Reconnect “${esc(rem.handle.name)}”</button>` : ''}
                <button ${rem && !moved ? '' : 'class="primary"'} id="choose"${fs.isSupported() ? '' : ' disabled'}>Choose folder…</button>
            </div>
        </section>`;
    el.querySelector('#reconnect')?.addEventListener('click', async () => {
        if (await fs.reconnect(rem.handle)) { refreshStatus(); onConnected(); }
        else askForFolder(el, { what, where, onConnected }); // says so if the folder turned out to be moved
    });
    el.querySelector('#choose').addEventListener('click', async () => {
        try { await fs.pickFolder(); } catch { return; } // picker cancelled
        refreshStatus();
        onConnected();
    });
}
