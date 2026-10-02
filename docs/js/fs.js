// Access to the user's local bills-etc folder via the File System Access API (Chrome / Edge).
// The folder handle is remembered in IndexedDB so it can be reconnected after a reload.
// While an encrypted snapshot is open, reads come from it (in memory only) and writes are refused.

let root = null;
let snap = null; // { created: Date, files: Map<path, text> }

export const isSupported = () => typeof window.showDirectoryPicker === 'function';
export const folder = () => root;

/** Use an already-obtained directory handle (e.g. the browser-private OPFS root for testing). */
export const useFolder = handle => { root = handle; };

export const snapshot = () => snap;
export const useSnapshot = s => { snap = s; };
export const lockSnapshot = () => { snap = null; };
export const isReadOnly = () => snap !== null;
/** True when there's something to show: a connected folder or an open snapshot. */
export const hasData = () => snap !== null || root !== null;

function refuseWrite() {
    if (snap) throw new Error('This is a read-only snapshot. Lock it and connect your folder to make changes.');
}

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

/** Returns {handle, granted} for the remembered folder, or null. */
export async function rememberedFolder() {
    let handle;
    try { handle = await idbOp('readonly', s => s.get('root')); } catch { return null; }
    if (!handle) return null;
    const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    if (granted) root = handle;
    return { handle, granted };
}

/** Must be called from a user gesture. */
export async function reconnect(handle) {
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    root = handle;
    return true;
}

async function dir(path, create = false) {
    if (!root) throw new Error('No folder selected — choose your bills-etc folder on the Setup page.');
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
    if (snap) return snap.files.get(path) ?? null;
    const [d, name] = split(path);
    try {
        const fh = await (await dir(d)).getFileHandle(name);
        return await (await fh.getFile()).text();
    } catch (e) {
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

export async function writeText(path, text) {
    refuseWrite();
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
    refuseWrite();
    const [d, name] = split(path);
    await (await dir(d)).removeEntry(name);
}

/** Names of files in `path` ending with `ext` (case-insensitive), sorted. Missing folder → []. */
export async function listFiles(path, ext = '.csv') {
    if (snap) {
        return [...snap.files.keys()]
            .filter(p => split(p)[0] === path && p.toLowerCase().endsWith(ext))
            .map(p => split(p)[1]).sort();
    }
    let d;
    try { d = await dir(path); } catch (e) { if (e.name === 'NotFoundError') return []; throw e; }
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
