// Guards against an old page overwriting newer data: remembers when each file was last changed at the time this page
// read it, and refuses to save over a file that has changed since (another tab, an older copy of the app still open,
// or a program). Without this, saving in a tab opened earlier writes back the old data it loaded.
import * as fs from '../../bills-etc/js/fs.js';

const seen = new Map(); // path → lastModified (ms) when this page last read or wrote it; null = didn't exist

const stamp = async path => (await fs.modifiedAt(path))?.getTime() ?? null;

/** Read a file's text and remember its version. */
export async function readTracked(path) {
    const text = await fs.readText(path);
    seen.set(path, await stamp(path));
    return text;
}

/** Write a file, unless it changed on disk since this page read it. */
export async function writeTracked(path, text) {
    if (seen.has(path) && await stamp(path) !== seen.get(path)) {
        throw new Error(`${path} was changed somewhere else (another tab, or another program) after this page loaded it, `
            + 'so nothing was saved — saving would undo that change. Close any other tabs of this page, reload this one (F5), '
            + 'and make your change again.');
    }
    await fs.writeText(path, text);
    seen.set(path, await stamp(path));
}
