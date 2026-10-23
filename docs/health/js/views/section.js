// One Health section (General Health, Dental, Eye, HSA): the shared record table over the section's CSV. A section with
// accounts (the HSA: FLORES, WealthCare…) has a box per account instead, like a Loan/CC card: the account's title,
// sign-in hint, website and total balance above its own table of entries.
import { esc, toast, money } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import {
    HEALTH_DIR, loadRecords, saveRecords, loadLocations, saveLocations, loadAccounts, saveAccounts, newAccount, accountSection,
} from '../records.js';

let checks = []; // one "has unsaved edits?" per table and account box on the page

export const hasUnsavedEdits = () => checks.some(f => f());
export const forget = () => { checks = []; closeFilterMenu(); };

export async function renderSection(el, section) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    if (section.accounts) return renderAccounts(el, section);
    const [rows, locations] = await Promise.all([loadRecords(section), loadLocations()]);
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <p class="lead">Saved in <code>${esc(section.path)}</code> in your folder.</p>
        <section id="records"></section>`;
    const location = { list: locations, noun: 'location', add: name => saveLocations([...location.list, name]) };
    const table = recordTable(el.querySelector('#records'), {
        columns: section.columns,
        rows,
        save: rows => saveRecords(section, rows),
        choices: { Location: location },
    });
    checks.push(() => table.hasUnsavedEdits());
}

/** Every account's box, then ＋ Add account. */
async function renderAccounts(el, section) {
    const list = await loadAccounts(section);
    const rows = await Promise.all(list.map(a => loadRecords(accountSection(section, a))));
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <p class="lead">Saved in <code>${esc(HEALTH_DIR)}/</code> in your folder: the accounts in <code>${esc(section.accounts.split('/').pop())}</code>,
            and each one's entries in a file of its own (its ✎ Edit says which).</p>
        <div data-accounts></div>
        <div class="row" data-add-row><button type="button" data-add>＋ Add account</button></div>`;
    const boxes = el.querySelector('[data-accounts]');
    const addRow = el.querySelector('[data-add-row]');
    const ctx = {
        list,
        save: async next => { await saveAccounts(section, next); list.splice(0, list.length, ...next); },
    };
    const addBox = (account, entries) => {
        const box = document.createElement('section');
        boxes.appendChild(box);
        accountBox(box, section, account, entries, ctx);
    };
    list.forEach((a, i) => addBox(a, rows[i]));
    if (!list.length) boxes.innerHTML = '<p class="muted" data-none>No accounts yet. Press ＋ Add account.</p>';

    el.querySelector('[data-add]').onclick = () => {
        addRow.hidden = true;
        const box = document.createElement('section');
        boxes.appendChild(box);
        let changed = () => false, gone = false;
        checks.push(() => !gone && changed());
        const close = () => { gone = true; box.remove(); addRow.hidden = false; };
        accountForm(box, {}, {
            heading: 'New account',
            saveLabel: 'Add account',
            onChange: f => { changed = f; },
            onCancel: close,
            onSave: async v => {
                const account = { ...newAccount(section, list, v.title), ...v };
                await ctx.save([...list, account]);
                close();
                boxes.querySelector('[data-none]')?.remove();
                addBox(account, await loadRecords(accountSection(section, account))); // [] unless the file is left from before
                toast(`Added “${account.title}”`, 'ok');
            },
        });
    };
}

/** The "Total balance" card (like Bills Etc → Loan/CC → Credit Cards), over every entry whatever the table's filters. */
const balanceCard = b => `
    <div class="cards kpis balance-cards"><div class="card"><div class="label">Total balance</div>
        <div class="value" style="color:var(${b.balance < 0 ? '--red' : '--green'})">${esc(money(b.balance))}</div>
        <div class="sub cmp"><span class="muted">${esc(money(b.deposits))} deposits − ${esc(money(b.charges))} charges${b.other
            ? `<br>${b.other} entr${b.other === 1 ? 'y' : 'ies'} of another type not counted` : ''}</span></div></div></div>`;

/** One account's box: its header (read-only until ✎ Edit), total balance and table. */
function accountBox(box, section, account, rows, ctx) {
    const sec = accountSection(section, account);
    box.innerHTML = '<div class="acct-box"></div><div data-balance></div><div data-records></div>';
    const head = box.querySelector('.acct-box');
    const showBalance = rows => { box.querySelector('[data-balance]').innerHTML = balanceCard(section.balance(rows)); };
    let changed = () => false, gone = false;
    const show = () => {
        changed = () => false;
        const a = account;
        head.innerHTML = `
            <h2>${esc(a.title)}
                <span class="spacer"></span>
                ${a.url ? `<a class="ext-link" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.url)}">${esc(a.linkText || 'Website')} ↗</a>` : ''}
                <button type="button" class="small" data-edit>✎ Edit</button></h2>
            ${a.hint ? `<p class="acct-hint">${esc(a.hint)}</p>` : ''}`;
        head.querySelector('[data-edit]').onclick = () => accountForm(head, account, {
            heading: 'Account',
            note: `Its entries are kept in <code>${esc(sec.path)}</code>.`,
            onChange: f => { changed = f; },
            onCancel: show,
            onSave: async v => {
                const updated = { id: account.id, file: account.file, ...v };
                await ctx.save(ctx.list.map(x => (x.id === account.id ? updated : x)));
                account = updated;
                toast('Saved', 'ok');
                show();
            },
            onRemove: async () => {
                if (table.hasUnsavedEdits()) return toast('Save or cancel the edits to its entries first', 'bad');
                if (!confirm(`Remove “${account.title}” from the HSA?\n\nIts entries file (${sec.path}) is kept in your folder.`)) return;
                await ctx.save(ctx.list.filter(x => x.id !== account.id));
                gone = true;
                box.remove();
                toast(`Removed “${account.title}”`, 'ok');
            },
        });
    };
    show();
    showBalance(rows);
    const table = recordTable(box.querySelector('[data-records]'), {
        columns: section.columns,
        rows,
        save: async rows => { await saveRecords(sec, rows); showBalance(rows); },
    });
    checks.push(() => !gone && (changed() || table.hasUnsavedEdits()));
}

/** 'flores247.com' → 'https://flores247.com'; '' stays ''; null if it isn't a web address. */
function cleanUrl(url) {
    let u = url.trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return /^https?:\/\//i.test(u) ? u : null;
}

const ACCOUNT_FIELDS = [
    { key: 'title', label: 'Title', placeholder: 'e.g. HealthEquity' },
    { key: 'hint', label: 'Hint', placeholder: 'optional: e.g. [UN: …] [PW: …]' },
    { key: 'linkText', label: 'Link text', placeholder: 'e.g. HealthEquity Online' },
    { key: 'url', label: 'Link', placeholder: 'optional: https://…' },
];

/**
 * The account fields in `el` (filled from `values`). onSave gets the fields that aren't blank, the link made a full
 * web address; onRemove (if given) adds a Remove account button; onChange gets a "changed since it opened?" check.
 */
function accountForm(el, values, { heading, note = '', saveLabel = 'Save', onSave, onCancel, onRemove, onChange }) {
    el.innerHTML = `
        <h2>${esc(heading)}</h2>
        <div class="add-grid">${ACCOUNT_FIELDS.map(f => `<label class="field">${f.label}<input type="text" name="${f.key}"
            value="${esc(values[f.key] || '')}" placeholder="${esc(f.placeholder)}"${f.key === 'url' ? ' inputmode="url"' : ''}></label>`).join('')}</div>
        ${note ? `<p class="muted" style="margin-bottom:10px">${note}</p>` : ''}
        <div class="row">${onRemove ? '<button type="button" class="danger" data-remove>Remove account</button>' : ''}
            <span class="spacer"></span>
            <button type="button" data-cancel>Cancel</button>
            <button type="button" class="primary" data-save>${esc(saveLabel)}</button></div>`;
    const read = () => Object.fromEntries(ACCOUNT_FIELDS.map(f => [f.key, el.querySelector(`[name=${f.key}]`).value.trim()]));
    const before = JSON.stringify(read());
    onChange(() => JSON.stringify(read()) !== before);
    el.querySelector('[data-cancel]').onclick = onCancel;
    if (onRemove) el.querySelector('[data-remove]').onclick = () => onRemove().catch(err => toast(`Couldn't save: ${err.message}`, 'bad'));
    el.querySelector('[data-save]').onclick = async () => {
        const v = read();
        if (!v.title) return toast('Give the account a title', 'bad');
        const url = cleanUrl(v.url);
        if (url === null) return toast('The link should be a web address, like https://…', 'bad');
        try {
            await onSave(Object.fromEntries(Object.entries({ ...v, url }).filter(([, x]) => x))); // blank fields left out
        } catch (err) { toast(`Couldn't save: ${err.message}`, 'bad'); }
    };
    el.querySelector('[name=title]').focus();
}
