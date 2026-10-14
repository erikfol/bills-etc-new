// Setup's "Things to update": everything due, or flagged yellow/red, on Savings, Utilities and Credit Cards in one list.
// Each check follows the same rule as the banner on its own page, so the two always agree.
import { loadSavings } from '../savings.js';
import { loadElectric } from '../electric.js';
import { loadWater, nextQuarter } from '../water.js';
import { loadDeliveries } from '../heating.js';
import { loadPropane } from '../propane.js';
import { loadTaxes } from '../taxes.js';
import { loadAccounts, loadPayments, loadActivity, ledger, updateAccount } from '../loans.js';
import { esc, money, sum, toast } from '../util.js';
import { dLong, addMonths, today } from './utilcommon.js';
import { depositsDue, BALANCES_STALE_DAYS } from './savings.js';
import { amountDue, staleCards, VERY_STALE_DAYS } from './loans.js';
import { portalLink as electricPortal } from './utilities.js';
import { portalLink as waterPortal } from './water.js';
import { portalLink as taxPortal } from './taxes.js';

const DAY = 864e5;
const days = n => `${n} day${n === 1 ? '' : 's'}`;
/** Levels, worst first; the names match the .banner.updated-* colours. */
const LEVELS = ['stale', 'old', 'aging'];

async function savingsItems(t0) {
    const data = await loadSavings();
    if (!data) return [];
    const out = [], where = 'Savings', href = '#savings';
    // Paycheck deposits behind: yellow 1–2, orange 3–4, red 5+ (as the Savings status banner)
    const behind = data.buckets.map(b => ({ b, n: depositsDue(b) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    if (behind.length) {
        const most = behind[0].n;
        out.push({ level: most <= 2 ? 'aging' : most <= 4 ? 'old' : 'stale', where, href,
            text: `<strong>${most} paycheck deposit${most === 1 ? '' : 's'} behind</strong> · ${behind.map(x => `${esc(x.b.name)} ${x.n}×`).join(', ')}` });
    }
    const updated = data.available?.updated;
    const age = updated ? Math.round((t0 - updated) / DAY) : null;
    if (age > BALANCES_STALE_DAYS) {
        out.push({ level: 'aging', where, href,
            text: `<strong>Balances last updated ${esc(dLong(updated))}</strong> (${days(age)} ago) · check the account and press Update balances` });
    }
    return out;
}

async function electricItems(t0) {
    const bills = (await loadElectric())?.bills;
    if (!bills?.length) return [];
    const last = bills.at(-1), lastDue = last.due || last.end;
    const nextDue = addMonths(lastDue, 1), detailsOn = addMonths(last.end, 1);
    const where = 'Electric', href = '#utilities/electric';
    if (t0 >= nextDue) return [{ level: 'aging', where, href, text: `<strong>New statement to add</strong> · the next one was due around ${esc(dLong(nextDue))} ${electricPortal}` }];
    if (detailsOn < nextDue && t0 >= detailsOn) return [{ level: 'aging', where, href, text: `<strong>This month's bill details should be available</strong> (since ${esc(dLong(detailsOn))}) ${electricPortal}` }];
    return [];
}

async function waterItems(t0) {
    const bills = (await loadWater())?.bills;
    if (!bills?.length) return [];
    const out = [], where = 'Water', href = '#utilities/water';
    const last = bills.at(-1), lastDue = last.due || last.end;
    const nextDue = addMonths(lastDue, 3), detailsOn = addMonths(nextDue, -1);
    const nq = last.q ? nextQuarter(last) : null;
    const nqText = nq ? `Q${nq.q} ${nq.year}` : 'next quarter';
    if (t0 >= nextDue) out.push({ level: 'aging', where, href, text: `<strong>New statement to add (${esc(nqText)})</strong> · it was due around ${esc(dLong(nextDue))} ${waterPortal}` });
    else if (t0 >= detailsOn) out.push({ level: 'aging', where, href, text: `<strong>${esc(nqText)} details should be available</strong> (since ${esc(dLong(detailsOn))}) ${waterPortal}` });
    for (const b of bills.filter(x => !x.isPaid)) {
        out.push({ level: 'stale', where, href, text: `<strong>Not paid yet: Q${b.q} ${b.year}</strong> · ${esc(money(b.total))}${b.due ? `, due ${esc(dLong(b.due))}` : ''}` });
    }
    return out;
}

async function heatingItems() {
    const deliveries = (await loadDeliveries())?.deliveries;
    if (!deliveries?.length) return [];
    return deliveries.filter(d => !d.isPaidBack).map(d => ({ level: 'stale', where: 'Home Heating', href: '#utilities/heating',
        text: `<strong>Not paid back yet: ${esc(dLong(d.date))} delivery</strong> · ${esc(money(d.actual))} (${esc(d.paidBack || 'blank')})` }));
}

async function propaneItems(t0) {
    const fills = (await loadPropane())?.fills;
    if (!fills?.length) return [];
    const gaps = fills.map(f => f.days).filter(d => d > 0);
    if (!gaps.length) return [];
    const nextFill = new Date(fills.at(-1).date.getTime() + Math.round(sum(gaps) / gaps.length) * DAY);
    const detailsOn = addMonths(nextFill, -1);
    return t0 >= detailsOn ? [{ level: 'aging', where: 'Propane', href: '#utilities/propane',
        text: `<strong>Next fill-up expected around ${esc(dLong(nextFill))}</strong> · time to check the tank and get the details` }] : [];
}

async function taxItems(t0) {
    const bills = (await loadTaxes())?.bills;
    if (!bills?.length) return [];
    const last = bills.at(-1), lastBilled = last.billed || last.due;
    if (!lastBilled) return [];
    const next = last.half === 1 ? `${last.year} 2nd half` : `${last.year + 1} 1st half`;
    const expected = addMonths(lastBilled, 6), detailsOn = addMonths(expected, -1);
    const where = 'Property Taxes', href = '#utilities/taxes';
    if (t0 >= expected) return [{ level: 'aging', where, href, text: `<strong>New bill to add (${esc(next)})</strong> · it was billed around ${esc(dLong(expected))} ${taxPortal}` }];
    if (t0 >= detailsOn) return [{ level: 'aging', where, href, text: `<strong>${esc(next)} details should be available</strong> (since ${esc(dLong(detailsOn))}) ${taxPortal}` }];
    return [];
}

async function cardItems(t0) {
    const accounts = (await loadAccounts()).filter(a => a.type === 'Credit card');
    const all = await Promise.all(accounts.map(async a => {
        const rawPayments = await loadPayments(a), rawActivity = await loadActivity(a);
        return { account: a, rawActivity, payments: ledger(a, rawPayments, rawActivity).payments };
    }));
    const out = [], where = 'Credit Cards', href = '#loans/cards';
    // Payments not made: past due (red) and due in the next two weeks (yellow), as on the Credit Cards tab
    for (const { account, payments } of all) {
        for (const p of payments.filter(x => !x.made && x.date && x.date - t0 <= 14 * DAY)) {
            const late = p.date < t0;
            out.push({ level: late ? 'stale' : 'aging', where, href,
                text: `<strong>${esc(account.title)}: ${late ? 'payment not made' : 'payment coming up'}</strong> · ${esc(money(amountDue(p)))}${Number.isFinite(p.payment) ? '' : ' minimum'} ${late ? 'was due' : 'due'} ${esc(dLong(p.date))}` });
        }
    }
    for (const x of staleCards(all, t0)) {
        out.push({ level: x.days >= VERY_STALE_DAYS ? 'stale' : 'aging', where, href, checkId: x.account.id,
            text: `<strong>${esc(x.account.title)}: activity not updated</strong> · ${x.lastEntry ? `last entry ${esc(dLong(x.lastEntry))}` : 'no activity yet'}${x.checked ? `, checked ${esc(dLong(x.checked))}` : ''}${Number.isFinite(x.days) ? ` (${days(x.days)})` : ''}` });
    }
    return out;
}

const SOURCES = [
    ['Savings', savingsItems], ['Electric', electricItems], ['Water', waterItems], ['Home Heating', heatingItems],
    ['Propane', propaneItems], ['Property Taxes', taxItems], ['Credit Cards', cardItems],
];

/** Fill el with the list. A source that can't be read shows as its own line instead of hiding the rest. */
export default async function renderUpdates(el) {
    el.innerHTML = '<p class="muted">Checking what\'s due…</p>';
    const t0 = today();
    const results = await Promise.all(SOURCES.map(([name, fn]) => fn(t0).catch(e => [{ level: 'old', where: name, text: `<strong>Couldn't check</strong> · ${esc(e.message)}` }])));
    const items = results.flat().sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
    if (!items.length) {
        el.innerHTML = '<div class="banner ok">✓ <strong>Nothing to update.</strong> Savings, utilities and credit cards are all caught up.</div>';
        return;
    }
    const red = items.filter(x => x.level === 'stale').length;
    el.innerHTML = `<p class="muted" style="margin-bottom:10px">${items.length} thing${items.length === 1 ? '' : 's'} to look at${red ? `, ${red} overdue` : ''}.</p>
        <div class="due-list">${items.map(x => `<div class="banner updated-${x.level} row">
            <span><span class="due-where">${esc(x.where)}</span> ${x.text}</span>
            <span class="spacer"></span>
            ${x.checkId ? `<button type="button" class="small" data-activity-checked="${esc(x.checkId)}" title="You looked at the statement and there's nothing new to add. Saves today's date on the card; no activity row is added.">✓ Checked – no new activity</button>` : ''}
            ${x.href ? `<a class="ext-link" href="${x.href}">Open →</a>` : ''}
        </div>`).join('')}</div>`;
    el.querySelectorAll('[data-activity-checked]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try {
            await updateAccount(b.dataset.activityChecked, { activityChecked: today() });
            toast('Marked checked today', 'ok');
            renderUpdates(el);
        } catch (err) {
            b.disabled = false;
            toast(`Couldn't save it: ${err.message}`, 'bad');
        }
    });
}
