// Access to the user's local erik-life-app folder via the File System Access API (Chrome / Edge).
// The folder handle is remembered in IndexedDB so it can be reconnected after a reload.

let root = null;

export const isSupported = () => typeof window.showDirectoryPicker === 'function';
export const folder = () => root;

/** Use an already-obtained directory handle (e.g. the browser-private OPFS root for testing). */
export const useFolder = handle => { root = handle; };

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('billsetc', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
    });
}

export async function pickFolder() {
    const handle = await window.showDirectoryPicker({ id: 'billsetc', mode: 'readwrite' });
    root = handle;
    try { await idbOp('readwrite', s => s.put(handle, 'root')); } catch { /* not remembered; fine */ }
    return handle;
}

/** True if the folder behind `handle` is no longer there (moved or renamed after it was chosen). Needs permission. */
export async function isGone(handle) {
    try { await handle.values().next(); return false; } catch (e) { return e.name === 'NotFoundError'; }
}

/** What to tell the user when their folder is no longer where it was chosen. */
export const movedMessage = handle =>
    `The folder “${handle.name}” was moved or renamed after it was chosen, so its files can’t be found.`;

function movedError() {
    const e = new Error(`${movedMessage(root)} Reload the page (F5) and choose it again where it is now.`);
    e.name = 'FolderMovedError';
    return e;
}

// A missing file is normal, but the whole folder missing is not: say so instead of acting as if it were empty.
async function checkFolder(e) {
    if (e.name === 'NotFoundError' && root && await isGone(root)) throw movedError();
}

/** Returns {handle, granted, moved} for the remembered folder, or null. A moved folder is not connected. */
export async function rememberedFolder() {
    let handle;
    try { handle = await idbOp('readonly', s => s.get('root')); } catch { return null; }
    if (!handle) return null;
    const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    const moved = granted && await isGone(handle);
    if (granted && !moved) root = handle;
    return { handle, granted, moved };
}

/** Remember another folder handle under `key` (e.g. where the phone copy goes). */
export async function rememberHandle(key, handle) {
    try { await idbOp('readwrite', s => s.put(handle, key)); } catch { /* not remembered; fine */ }
}

/** A folder handle remembered under `key`, or null. */
export async function rememberedHandle(key) {
    try { return (await idbOp('readonly', s => s.get(key))) || null; } catch { return null; }
}

/** Must be called from a user gesture. False if not allowed or moved (rememberedFolder() then reports `moved`). */
export async function reconnect(handle) {
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    if (await isGone(handle)) return false;
    root = handle;
    return true;
}

async function dir(path, create = false) {
    if (!root) throw new Error('No folder selected — choose your erik-life-app folder on the Setup page.');
    let d = root;
    for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
    return d;
}

function split(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
}

/** File text, or null if it doesn't exist. */
export async function readText(path) {
    const [d, name] = split(path);
    try {
        const fh = await (await dir(d)).getFileHandle(name);
        return await (await fh.getFile()).text();
    } catch (e) {
        await checkFolder(e);
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

/** The file itself (a File, e.g. for showing a photo), or null if it doesn't exist. */
export async function readFile(path) {
    const [d, name] = split(path);
    try {
        return await (await (await dir(d)).getFileHandle(name)).getFile();
    } catch (e) {
        await checkFolder(e);
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

/** When the file was last written, or null if it doesn't exist. */
export async function modifiedAt(path) {
    const [d, name] = split(path);
    try {
        return new Date((await (await (await dir(d)).getFileHandle(name)).getFile()).lastModified);
    } catch (e) {
        await checkFolder(e);
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

export async function writeText(path, text) {
    if (root && await isGone(root)) throw movedError(); // never write into a moved folder's old place
    const [d, name] = split(path);
    const fh = await (await dir(d, true)).getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
}

export async function exists(path) {
    return (await readText(path)) !== null;
}

export async function removeFile(path) {
    const [d, name] = split(path);
    try { await (await dir(d)).removeEntry(name); } catch (e) { await checkFolder(e); throw e; }
}

/** Names of files in `path` ending with `ext` (case-insensitive), sorted. Missing folder → []. */
export async function listFiles(path, ext = '.csv') {
    let d;
    try { d = await dir(path); } catch (e) { await checkFolder(e); if (e.name === 'NotFoundError') return []; throw e; }
    const names = [];
    for await (const [name, h] of d.entries()) {
        if (h.kind === 'file' && name.toLowerCase().endsWith(ext)) names.push(name);
    }
    return names.sort();
}

export async function moveFile(from, to) {
    await writeText(to, await readText(from));
    await removeFile(from);
}
