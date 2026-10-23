// One Health section (General Health, Dental, Eye, HSA): the shared record table over the section's CSV, and for a
// section with an account (the HSA) the account's title, sign-in hint and website and its total balance above the
// table in the same box, like a Loan/CC card.
import { esc, toast, money } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { loadRecords, saveRecords, loadLocations, saveLocations, loadAccount, saveAccount } from '../records.js';

let table = null;
let accountChanged = () => false; // true while the account box is being edited with changes not saved

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || accountChanged();
export const forget = () => { table = null; accountChanged = () => false; closeFilterMenu(); };

export async function renderSection(el, section) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, locations, account] = await Promise.all([
        loadRecords(section), loadLocations(), section.account ? loadAccount(section) : null]);
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <p class="lead">Saved in <code>${esc(section.path)}</code>${account ? ` (the account in <code>${esc(section.account)}</code>)` : ''} in your folder.</p>
        <section>${account ? '<div id="account" class="acct-box"></div>' : ''}${section.balance ? '<div id="balance"></div>' : ''}<div id="records"></div></section>`;
    if (account) renderAccount(el.querySelector('#account'), section, account);
    const balanceEl = el.querySelector('#balance');
    const showBalance = rows => { if (balanceEl) balanceEl.innerHTML = balanceCard(section.balance(rows)); };
    showBalance(rows);
    const location = { list: locations, noun: 'location', add: name => saveLocations([...location.list, name]) };
    table = recordTable(el.querySelector('#records'), {
        columns: section.columns,
        rows,
        save: async rows => { await saveRecords(section, rows); showBalance(rows); },
        choices: { Location: location },
    });
}

/** The "Total balance" card (like Bills Etc → Loan/CC → Credit Cards), over every entry whatever the table's filters. */
const balanceCard = b => `
    <div class="cards kpis balance-cards"><div class="card"><div class="label">Total balance</div>
        <div class="value" style="color:var(${b.balance < 0 ? '--red' : '--green'})">${esc(money(b.balance))}</div>
        <div class="sub cmp"><span class="muted">${esc(money(b.deposits))} deposits − ${esc(money(b.charges))} charges${b.other
            ? `<br>${b.other} entr${b.other === 1 ? 'y' : 'ies'} of another type not counted` : ''}</span></div></div></div>`;

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

/** The account box: title, hint and a link to the website; read-only until ✎ Edit, like the tables. */
function renderAccount(box, section, account) {
    const show = () => {
        accountChanged = () => false;
        const a = account;
        box.innerHTML = `
            <h2>${a.title ? esc(a.title) : 'Account'}
                <span class="spacer"></span>
                ${a.url ? `<a class="ext-link" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.url)}">${esc(a.linkText || 'Website')} ↗</a>` : ''}
                <button type="button" class="small" data-edit>✎ Edit</button></h2>
            ${a.hint ? `<p class="acct-hint">${esc(a.hint)}</p>`
                : !a.title && !a.url ? '<p class="muted">No account details yet. Press Edit to add who holds it, a sign-in hint and its website.</p>' : ''}`;
        box.querySelector('[data-edit]').onclick = edit;
    };
    const edit = () => {
        box.innerHTML = `
            <h2>Account</h2>
            <div class="add-grid">${ACCOUNT_FIELDS.map(f => `<label class="field">${f.label}<input type="text" name="${f.key}"
                value="${esc(account[f.key] || '')}" placeholder="${esc(f.placeholder)}"${f.key === 'url' ? ' inputmode="url"' : ''}></label>`).join('')}</div>
            <div class="row"><span class="spacer"></span>
                <button type="button" data-cancel>Cancel</button>
                <button type="button" class="primary" data-save>Save</button></div>`;
        const values = () => Object.fromEntries(ACCOUNT_FIELDS.map(f => [f.key, box.querySelector(`[name=${f.key}]`).value.trim()]));
        const before = JSON.stringify(values());
        accountChanged = () => JSON.stringify(values()) !== before;
        box.querySelector('[data-cancel]').onclick = show;
        box.querySelector('[data-save]').onclick = async () => {
            const v = values();
            const url = cleanUrl(v.url);
            if (url === null) return toast('The link should be a web address, like https://…', 'bad');
            const updated = Object.fromEntries(Object.entries({ ...v, url }).filter(([, x]) => x)); // blank fields left out
            try {
                await saveAccount(section, updated);
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            account = updated;
            toast('Saved', 'ok');
            show();
        };
        box.querySelector('[name=title]').focus();
    };
    show();
}
