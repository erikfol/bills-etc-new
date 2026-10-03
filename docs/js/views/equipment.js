// Utilities → Electric → Mini-Splits: details of each mini-split heat pump and its maintenance log.
import { loadUnits, saveUnits, unitId, EQUIPMENT_PATH } from '../equipment.js';
import { esc, money, sum, toast } from '../util.js';
import { dLong, today, isoDate, dateOf, numOf, sameDay, sameAmount, dupText } from './utilcommon.js';

const DAY = 864e5;
const num = v => (Number.isFinite(v) ? v.toLocaleString('en-US') : '–');
const dateFrom = s => (s ? dateOf(s) : null);
const FIELDS = [
    { k: 'name', label: 'Name / room', type: 'text' },
    { k: 'brand', label: 'Brand', type: 'text' },
    { k: 'indoorModel', label: 'Indoor head model', type: 'text' },
    { k: 'outdoorModel', label: 'Outdoor unit model', type: 'text' },
    { k: 'btu', label: 'Capacity (BTU)', type: 'number' },
    { k: 'tons', label: 'Tons', type: 'number', step: '0.25' },
    { k: 'coverage', label: 'Covers (sq ft)', type: 'text' },
    { k: 'seer2', label: 'SEER2 (cooling)', type: 'number', step: '0.1' },
    { k: 'hspf2', label: 'HSPF2 (heating)', type: 'number', step: '0.1' },
    { k: 'installed', label: 'Installed', type: 'date' },
    { k: 'status', label: 'Status', type: 'text', wide: true },
    { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
];
/** Green when the status sounds fine, red when it mentions a problem, grey when blank. */
const statusBadge = st => {
    const s = String(st || '').trim();
    if (!s) return '<span class="badge badge-neutral">status not set</span>';
    const bad = /error|fault|leak|not (working|cooling|heating)|broken|repair|code/i.test(s) && !/zero errors|no errors/i.test(s);
    return `<span class="badge ${bad ? 'badge-over' : 'badge-ok'}">${esc(s)}</span>`;
};

export default async function renderEquipment(el) {
    el.innerHTML = '<p class="muted">Loading your mini-splits…</p>';
    let units = await loadUnits();
    if (units == null) units = [];
    const save = async (next, msg) => {
        try { await saveUnits(next); toast(msg, 'ok'); await renderEquipment(el); }
        catch (err) { toast(`Save failed: ${err.message}`, 'bad'); }
    };
    const totalBtu = sum(units.map(u => u.btu).filter(Number.isFinite));
    const totalTons = sum(units.map(u => u.tons).filter(Number.isFinite));
    const allLog = units.flatMap(u => u.log.map(l => ({ ...l, unit: u.name })));
    const spent = sum(allLog.map(l => l.cost).filter(Number.isFinite));

    el.innerHTML = `
        <div class="row dash-head">
            <h2 class="page-sub">Mini-split heat pumps <span class="muted" style="font-weight:400;font-size:0.8em">${units.length} unit${units.length === 1 ? '' : 's'}</span></h2>
            <span class="spacer"></span>
            <button class="primary" id="unit-add">+ Add a unit</button>
        </div>
        <div class="cards kpis">
            <div class="card"><div class="label">Total capacity</div><div class="value">${esc(num(totalBtu))} BTU</div><div class="sub cmp"><span class="muted">${esc(String(totalTons))} ton${totalTons === 1 ? '' : 's'} across ${units.length} unit${units.length === 1 ? '' : 's'}</span></div></div>
            <div class="card"><div class="label">Maintenance logged</div><div class="value">${allLog.length}</div><div class="sub cmp"><span class="muted">${spent ? `${esc(money(spent))} spent` : 'no costs recorded'}</span></div></div>
            <div class="card"><div class="label">Last maintenance</div><div class="value">${(() => { const l = allLog.filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date))[0]; return l ? esc(dLong(dateFrom(l.date))) : '–'; })()}</div><div class="sub cmp"><span class="muted">${(() => { const l = allLog.filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date))[0]; return l ? `${esc(l.unit)}: ${esc(l.work)}` : 'add one under a unit'; })()}</span></div></div>
        </div>
        <section class="unit-help">
            <h2>Reading the ratings</h2>
            <ul class="insight-list">
                <li><strong>SEER2</strong> is cooling efficiency, and <strong>HSPF2</strong> is heating efficiency: higher means less electricity for the same comfort. New heat pumps must be at least about 14.3 SEER2 and 7.5 HSPF2, so ${units.length ? 'both of yours are well above that' : 'higher than that is better'}.</li>
                <li><strong>BTU / tons</strong> is how much heat it can move: 12,000 BTU = 1 ton. The square-footage range is a rule of thumb; insulation, windows and ceiling height change it.</li>
                <li>Indoor filters usually need rinsing every few weeks when the system runs a lot, and the outdoor unit should be kept clear of snow, leaves and plants. Log those here to keep track.</li>
            </ul>
        </section>
        <form id="unit-form" class="add-bill" hidden style="margin-bottom:18px"></form>
        <div id="units"></div>
        <p class="note">Saved in ${esc(EQUIPMENT_PATH)}.</p>`;
    const $ = s => el.querySelector(s);

    const formHtml = (u, title, submit) => `
        <h3>${title}</h3>
        <div class="add-grid">${FIELDS.map(f => {
            const v = u[f.k] ?? '';
            const input = f.type === 'textarea' ? `<textarea name="${f.k}" rows="2">${esc(v)}</textarea>`
                : `<input type="${f.type}" name="${f.k}"${f.step ? ` step="${f.step}"` : ''} value="${esc(v)}">`;
            return `<label class="field"${f.wide ? ' style="grid-column:1/-1"' : ''}>${f.label}${input}</label>`;
        }).join('')}</div>
        <div class="row"><button type="submit" class="primary">${submit}</button><button type="button" data-cancel>Cancel</button></div>`;
    const readForm = form => Object.fromEntries(FIELDS.map(f => {
        const v = form[f.k].value;
        return [f.k, f.type === 'number' ? (String(v).trim() === '' ? null : numOf(v)) : String(v).trim()];
    }));

    // ── Add a unit ──
    const uf = $('#unit-form');
    $('#unit-add').onclick = () => {
        uf.innerHTML = formHtml({ brand: units[0]?.brand || '' }, 'Add a mini-split', 'Add unit');
        uf.hidden = false;
        $('#unit-add').hidden = true;
        uf.name.focus();
        uf.querySelector('[data-cancel]').onclick = () => { uf.hidden = true; $('#unit-add').hidden = false; };
    };
    uf.onsubmit = e => {
        e.preventDefault();
        const u = readForm(uf);
        if (!u.name) { toast('Give the unit a name, like the room it is in', 'bad'); return; }
        save([...units, { id: unitId(u.name, new Set(units.map(x => x.id))), ...u, log: [] }], `Added ${u.name}`);
    };

    // ── One card per unit ──
    $('#units').innerHTML = units.length ? units.map((u, k) => {
        const log = [...u.log].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const last = log.find(l => l.date);
        const since = last ? Math.round((today() - dateFrom(last.date)) / DAY) : null;
        return `<section class="unit" data-i="${k}">
            <h2>❄️🔥 ${esc(u.name)} ${statusBadge(u.status)}<span class="spacer"></span>
                <button type="button" class="small" data-edit>✎ Edit</button></h2>
            <div class="unit-view">
                <div class="spec-grid">
                    <div><span class="spec-label">Brand</span>${esc(u.brand || '–')}</div>
                    <div><span class="spec-label">Indoor head</span><span class="mono">${esc(u.indoorModel || '–')}</span></div>
                    <div><span class="spec-label">Outdoor unit</span><span class="mono">${esc(u.outdoorModel || '–')}</span></div>
                    <div><span class="spec-label">Capacity</span>${esc(num(u.btu))} BTU · ${esc(String(u.tons ?? '–'))} ton${u.tons === 1 ? '' : 's'}</div>
                    <div><span class="spec-label">Covers about</span>${esc(u.coverage || '–')}</div>
                    <div><span class="spec-label">Cooling efficiency</span><strong>${Number.isFinite(u.seer2) ? u.seer2.toFixed(1) : '–'}</strong> SEER2</div>
                    <div><span class="spec-label">Heating efficiency</span><strong>${Number.isFinite(u.hspf2) ? u.hspf2.toFixed(1) : '–'}</strong> HSPF2</div>
                    <div><span class="spec-label">Installed</span>${u.installed ? esc(dLong(dateFrom(u.installed))) : '<span class="muted">not set</span>'}</div>
                </div>
                ${u.notes ? `<p class="b-notes" style="margin:10px 0">${esc(u.notes).replace(/\n/g, '<br>')}</p>` : ''}
                <h3 class="chart-title" style="margin-top:14px">Maintenance log <span class="muted" style="font-weight:400">${last ? `last: ${esc(last.work)} on ${esc(dLong(dateFrom(last.date)))} (${since} day${since === 1 ? '' : 's'} ago)` : 'nothing logged yet'}</span></h3>
                ${log.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>What was done</th><th class="num">Cost</th><th>Notes</th><th></th></tr></thead><tbody>
                    ${log.map(l => `<tr><td class="nowrap">${l.date ? esc(dLong(dateFrom(l.date))) : ''}</td><td>${esc(l.work)}</td><td class="amt">${Number.isFinite(l.cost) ? esc(money(l.cost)) : ''}</td><td class="note-text">${esc(l.notes || '')}</td>
                        <td><button type="button" class="small danger" data-del-log="${u.log.indexOf(l)}" title="Remove this entry">✕</button></td></tr>`).join('')}
                </tbody></table></div>` : ''}
                <form class="row log-form" style="margin-top:10px;align-items:flex-end">
                    <label class="field">Date<input type="date" name="date" value="${isoDate(new Date())}" required></label>
                    <label class="field" style="flex:1;min-width:200px">What was done<input type="text" name="work" list="log-work" placeholder="e.g. Cleaned indoor filters" required></label>
                    <label class="field">Cost ($)<input type="number" name="cost" step="0.01" min="0" placeholder="0.00"></label>
                    <label class="field" style="flex:1;min-width:160px">Notes<input type="text" name="notes" placeholder="optional"></label>
                    <button type="submit" class="primary small">Log it</button>
                </form>
            </div>
            <form class="unit-edit add-bill" hidden></form>
        </section>`;
    }).join('') + `<datalist id="log-work">${['Cleaned indoor filters', 'Cleared around outdoor unit', 'Professional cleaning / service', 'Coil cleaning', 'Repair', 'Remote battery change']
        .map(w => `<option value="${w}">`).join('')}</datalist>`
        : '<section><p>No units yet. Press <strong>+ Add a unit</strong>.</p></section>';

    el.querySelectorAll('section.unit').forEach(sec => {
        const i = +sec.dataset.i, u = units[i];
        const ef = sec.querySelector('.unit-edit');
        sec.querySelector('[data-edit]').onclick = () => {
            const logRow = (l = {}) => `<tr>
                <td><input type="date" data-k="date" value="${esc(l.date || '')}"></td>
                <td><input type="text" data-k="work" value="${esc(l.work || '')}" list="log-work"></td>
                <td><input type="number" step="0.01" min="0" data-k="cost" value="${Number.isFinite(l.cost) ? l.cost : ''}"></td>
                <td><input type="text" data-k="notes" value="${esc(l.notes || '')}"></td>
                <td><button type="button" class="small danger" data-del-row title="Remove this entry">✕</button></td></tr>`;
            ef.innerHTML = formHtml(u, `Edit ${esc(u.name)}`, 'Save changes').replace(/<div class="row"><button type="submit"[\s\S]*$/, '')
                + `<h3 class="chart-title" style="margin-top:6px">Maintenance log</h3>
                <div class="table-wrap loan-grid"><table class="sheet-table log-grid"><thead><tr><th>Date</th><th>What was done</th><th>Cost</th><th>Notes</th><th></th></tr></thead>
                    <tbody>${[...u.log].sort((a, b) => String(a.date).localeCompare(String(b.date))).map(logRow).join('')}</tbody></table></div>
                <div class="row" style="margin:8px 0 14px"><button type="button" class="small" data-add-row>+ Add log entry</button>
                    <span class="spacer"></span><button type="button" class="small danger" data-remove>Remove this unit</button></div>
                <div class="row"><button type="submit" class="primary">Save changes</button><button type="button" data-cancel>Cancel</button></div>`;
            ef.querySelector('[data-add-row]').onclick = () => ef.querySelector('.log-grid tbody').insertAdjacentHTML('beforeend', logRow({ date: isoDate(new Date()) }));
            ef.addEventListener('click', ev => { if (ev.target.closest('[data-del-row]')) ev.target.closest('tr').remove(); });
            ef.hidden = false;
            sec.querySelector('.unit-view').hidden = true;
            sec.querySelector('[data-edit]').hidden = true;
            ef.querySelector('[data-cancel]').onclick = () => renderEquipment(el);
            ef.querySelector('[data-remove]').onclick = () => {
                if (!confirm(`Remove ${u.name} and its maintenance log?`)) return;
                save(units.filter((_, k) => k !== i), `Removed ${u.name}`);
            };
        };
        ef.onsubmit = e => {
            e.preventDefault();
            const changes = readForm(ef);
            if (!changes.name) { toast('The unit needs a name', 'bad'); return; }
            const log = [...ef.querySelectorAll('.log-grid tbody tr')].map(tr => {
                const v = k => tr.querySelector(`[data-k=${k}]`).value.trim();
                const cost = numOf(v('cost'));
                return { date: v('date'), work: v('work'), cost: Number.isFinite(cost) ? cost : null, notes: v('notes') };
            }).filter(l => l.date || l.work || l.notes || Number.isFinite(l.cost));
            if (log.some(l => !l.date || !l.work)) { toast('Each log entry needs a date and what was done', 'bad'); return; }
            const keys = log.map(l => `${l.date}|${Number.isFinite(l.cost) ? l.cost.toFixed(2) : l.work.toLowerCase()}`);
            const d = keys.findIndex((k, n) => keys.indexOf(k) !== n);
            if (d >= 0) { const l = log[d]; toast(Number.isFinite(l.cost) ? dupText(dateFrom(l.date), l.cost, 'an entry on') : `This is a duplicate entry: "${l.work}" on ${dLong(dateFrom(l.date))} is in the log twice.`, 'bad'); return; }
            changes.log = log;
            save(units.map((x, k) => (k === i ? { ...x, ...changes } : x)), `Saved ${changes.name}`);
        };
        sec.querySelector('.log-form').onsubmit = e => {
            e.preventDefault();
            const f = e.target, date = f.date.value, cost = numOf(f.cost.value), work = f.work.value.trim();
            if (!date || !work) { toast('Enter the date and what was done', 'bad'); return; }
            if (u.log.some(l => sameDay(dateFrom(l.date), dateFrom(date)) && (Number.isFinite(cost) ? sameAmount(l.cost, cost) : l.work.toLowerCase() === work.toLowerCase()))) {
                toast(Number.isFinite(cost) ? dupText(dateFrom(date), cost, 'an entry on') : `This is a duplicate entry: "${work}" on ${dLong(dateFrom(date))} is already there.`, 'bad');
                return;
            }
            const entry = { date, work, cost: Number.isFinite(cost) ? cost : null, notes: f.notes.value.trim() };
            save(units.map((x, k) => (k === i ? { ...x, log: [...x.log, entry] } : x)), `Logged for ${u.name}: ${work}`);
        };
        sec.querySelectorAll('[data-del-log]').forEach(b => {
            b.onclick = () => {
                const j = +b.dataset.delLog;
                if (!confirm(`Remove "${u.log[j].work}" from the log?`)) return;
                save(units.map((x, k) => (k === i ? { ...x, log: x.log.filter((_, m) => m !== j) } : x)), 'Removed the entry');
            };
        });
    });
}
