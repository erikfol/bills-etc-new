// Minimal RFC 4180 CSV reader/writer. All cells stay strings so files round-trip unchanged.

export function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const records = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); records.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }

    const nonEmpty = records.filter(r => !(r.length === 1 && r[0].trim() === ''));
    if (!nonEmpty.length) return { columns: [], rows: [] };
    const columns = nonEmpty[0].map(h => h.trim());
    const rows = nonEmpty.slice(1).map(r => Object.fromEntries(columns.map((c, j) => [c, r[j] ?? ''])));
    return { columns, rows };
}

function escapeCell(v) {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toCSV(columns, rows) {
    const lines = [columns.map(escapeCell).join(',')];
    for (const r of rows) lines.push(columns.map(c => escapeCell(r[c])).join(','));
    return lines.join('\n') + '\n';
}
