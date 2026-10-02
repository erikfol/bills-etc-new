// Encrypted, read-only snapshots for viewing your data on other devices.
// File format: "BETC1" | salt (16) | iv (12) | AES-256-GCM(gzip(JSON)). Key = PBKDF2-SHA256(passphrase, salt).
import * as fs from './fs.js';
import { PATHS } from './data.js';

const MAGIC = new TextEncoder().encode('BETC1');
const ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;

async function deriveKey(passphrase, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function encryptJSON(obj, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const plain = await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('gzip'));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, plain));
    const out = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length);
    out.set(MAGIC, 0);
    out.set(salt, MAGIC.length);
    out.set(iv, MAGIC.length + 16);
    out.set(cipher, MAGIC.length + 28);
    return out;
}

export async function decryptJSON(bytes, passphrase) {
    if (bytes.length < MAGIC.length + 28 || !MAGIC.every((b, i) => bytes[i] === b)) {
        throw new Error("This isn't a Bills Etc snapshot file.");
    }
    const salt = bytes.slice(MAGIC.length, MAGIC.length + 16);
    const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
    const key = await deriveKey(passphrase, salt);
    let plain;
    try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, bytes.slice(MAGIC.length + 28));
    } catch {
        throw new Error('Wrong passphrase, or the file is damaged.');
    }
    return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(plain), new DecompressionStream('gzip'))));
}

const SNAPSHOT_FILES = [PATHS.master, PATHS.processed, PATHS.config];

/** Encrypt the connected folder's data and save it. Returns the saved file name, or null if cancelled. */
export async function exportSnapshot(passphrase) {
    const files = {};
    for (const p of SNAPSHOT_FILES) {
        const text = await fs.readText(p);
        if (text != null) files[p] = text;
    }
    if (!files[PATHS.master] && !files[PATHS.processed]) throw new Error('Nothing to export yet. Run step 1 or step 3 first.');

    const now = new Date();
    const bytes = await encryptJSON({ version: 1, created: now.toISOString(), files }, passphrase);
    const name = `bills-etc-${now.toISOString().slice(0, 10)}.betc`;

    if (window.showSaveFilePicker) {
        let handle;
        try {
            handle = await window.showSaveFilePicker({
                id: 'billsetc-snapshot', suggestedName: name,
                types: [{ description: 'Bills Etc snapshot', accept: { 'application/octet-stream': ['.betc'] } }],
            });
        } catch (e) {
            if (e.name === 'AbortError') return null;
            throw e;
        }
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        return handle.name;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return name;
}

/** Decrypt a snapshot file and switch the app into read-only snapshot mode. */
export async function openSnapshot(file, passphrase) {
    const data = await decryptJSON(new Uint8Array(await file.arrayBuffer()), passphrase);
    if (data.version !== 1 || !data.files) throw new Error('Unsupported snapshot version.');
    fs.useSnapshot({ created: new Date(data.created), files: new Map(Object.entries(data.files)) });
    return fs.snapshot();
}
