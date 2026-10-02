export const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt2 = n => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $1,234.56 / -$1,234.56; with `signed`, always shows + or -. */
export function money(n, signed = false) {
    n = Number(n) || 0;
    if (signed) return (n >= 0 ? '+' : '-') + '$' + fmt2(n);
    return (n < 0 ? '-' : '') + '$' + fmt2(n);
}

export const round2 = n => Math.round(n * 100) / 100;

/** Parse an Amount cell ("$1,234.50", "-33.42") to a number; NaN when blank or invalid. */
export function amountOf(v) {
    const s = String(v ?? '').replace(/[$,]/g, '').trim();
    return s === '' ? NaN : Number(s);
}

export function toast(message, kind = '') {
    const el = document.createElement('div');
    el.textContent = message;
    if (kind) el.className = kind;
    document.getElementById('toast').appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3500);
}

/** Basic markdown (bold, bullets, headings) → HTML. Input is escaped first. */
export function mdToHtml(text) {
    const bullet = /^\s*(?:[*\-•]|\d+\.)\s+/;
    return esc(text).trim().split(/\n\s*\n/).map(block => {
        const lines = block.trim().split('\n').filter(l => l.trim());
        const inline = l => l.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/^#+\s*(.*)$/, '<strong>$1</strong>');
        if (lines.length && lines.every(l => bullet.test(l))) {
            return '<ul>' + lines.map(l => `<li>${inline(l.replace(bullet, ''))}</li>`).join('') + '</ul>';
        }
        return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('\n');
}

export const sum = arr => arr.reduce((a, b) => a + b, 0);
