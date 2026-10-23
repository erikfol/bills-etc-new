// "📱 Phone copy" (Vehicles, House, Health and Pets top bars): writes one self-contained, read-only page — every vehicle
// (information, current mileage for cars, service places, maintenance, photos, guides, notes), every house
// (information, service companies, photos, and per area information, photos, maintenance with its due banners, records; Updates; Projects), every
// Health section and every pet (information, future appointments, photos, records) — into a folder you pick once,
// e.g. in Google Drive so it syncs to your phone. Photos are shrunk and embedded, so the page is a single file that
// opens offline (Android hands Chrome a single file, so a page can't load anything from next to itself).
import * as fs from '../../bills-etc/js/fs.js';
import { esc, toast } from '../../bills-etc/js/util.js';
import {
    loadVehicles, loadMaintenance, maintenanceColumns, photosDir, guideDir, noteDir, TYPES, hasMileageLog, loadMileage, MILEAGE_COLUMNS,
    latestMileage, mileageRate, mileageRateColumns,
} from '../../vehicles/js/vehicles.js';
import { SECTIONS, loadRecords, loadAccounts, accountSection } from '../../health/js/records.js';
import * as house from '../../house/js/house.js';
import { loadPets, ageText, RECORD_COLUMNS, loadRecords as loadPetRecords, photosDir as petPhotosDir,
    APPOINTMENT_COLUMNS, loadAppointments, appointmentStatus } from '../../pets/js/pets.js';

const FILE_NAME = 'Vehicles, House, Health and Pets.html';
const HANDLE_KEY = 'phoneCopyDir';
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MAX_SIDE = 1400; // px, longest side of an embedded photo — sharp on a phone, small in the file

/** Image file → JPEG data URL, at most MAX_SIDE px; null if the browser can't decode it. */
async function shrink(file) {
    try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k);
        c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        return c.toDataURL('image/jpeg', 0.75);
    } catch { return null; }
}

/** The images in `dir`, shrunk: [{ name, src }]. progress() is called once per image. */
async function images(dir, progress) {
    const stem = n => n.replace(/\.[^.]+$/, '');
    const names = (await fs.listFiles(dir, '')).filter(n => IMAGE.test(n))
        .sort((a, b) => stem(a).localeCompare(stem(b), undefined, { numeric: true }));
    const out = [];
    for (const name of names) {
        const file = await fs.readFile(`${dir}/${name}`);
        const src = file && await shrink(file);
        if (src) out.push({ name, src });
        progress();
    }
    return out;
}

/** Everything the phone page shows. */
export async function collectData(progress = () => {}) {
    let done = 0;
    const tick = () => progress(++done);
    const vehicles = [];
    for (const v of await loadVehicles(false)) {
        const guides = [];
        for (const g of v.guides || []) guides.push({ title: g.title, text: g.text || '', images: await images(guideDir(v, g), tick) });
        const notes = [];
        for (const n of v.notes || []) notes.push({ date: n.date || '', title: n.title || '', text: n.text || '', images: await images(noteDir(v, n), tick) });
        notes.sort((a, b) => b.date.localeCompare(a.date));
        const miles = hasMileageLog(v) ? await loadMileage(v, false) : null;
        const mileCols = miles && [...MILEAGE_COLUMNS, ...mileageRateColumns(v, () => miles)]; // with each reading's miles a month and a year
        vehicles.push({
            name: v.name,
            type: TYPES[v.type]?.label || 'Vehicle',
            info: v.info || [],
            places: v.places || [],
            mileage: miles && { columns: mileCols.map(c => ({ name: c.name, kind: c.kind })),
                rows: miles.map(r => Object.fromEntries(mileCols.map(c => [c.name, c.calc ? String(c.calc(r)) : r[c.name]]))),
                latest: latestMileage(miles), rate: mileageRate(v, miles) },
            maintenance: { columns: maintenanceColumns(v).map(c => ({ name: c.name, kind: c.kind })), rows: await loadMaintenance(v, false) },
            photos: await images(photosDir(v), tick),
            guides,
            notes,
        });
    }
    const houses = [];
    for (const h of await house.loadHouses(false)) {
        const areas = [];
        for (const t of house.AREAS) for (const a of t.parts || [t]) {
            if (a.table) { // a page that's just one table (Updates Done, Future Updates)
                areas.push({ label: a.label, tab: t.parts ? t.label : '', table: { columns: a.table.map(c => ({ name: c.name, kind: c.kind })), rows: await house.loadTable(h, a, false) } });
                continue;
            }
            if (a.projects) { // the Projects tab, each project with its images and the Future Updates linked to it
                const future = await house.loadTable(h, house.FUTURE_UPDATES, false), projects = [];
                for (const p of house.houseProjects(h)) projects.push({ title: p.title, status: p.status || '', text: p.text || '',
                    materials: (p.materials || []).map(r => ({ ...r, Cost: house.materialCost(r) })), specs: p.specs || [], images: await images(house.projectDir(h, p), tick),
                    updates: future.filter(r => r.Project === p.title) });
                areas.push({ label: a.label, tab: '', projects });
                continue;
            }
            areas.push({
                label: a.label,
                tab: t.parts ? t.label : '', // a part (pill) of this tab
                boxes: house.areaBoxes(a).map(b => ({ label: b.label, info: house.areaInfo(h, a, b) })),
                improvements: house.areaImprovements(h, a),
                maintenance: a.maintenance ? {
                    columns: house.maintenanceColumns(h).map(c => ({ name: c.name, kind: c.kind })),
                    rows: await house.loadMaintenance(h, a, false),
                    banner: house.bannerSettings(h, a).show ? house.bannerSettings(h, a) : null, // its due banner (House → ⚙ Settings)
                    note: a.maintenanceNote || '',
                } : null,
                photosLabel: a.gallery?.label || 'Photos',
                photos: await images(house.photosDir(h, a), tick),
                records: a.records === false ? null
                    : { columns: house.recordColumns(h, a).map(c => ({ name: c.name, kind: c.kind })), rows: await house.loadRecords(h, a, false) },
            });
        }
        houses.push({ name: h.name, info: h.info || [], places: h.places || [], photos: await images(house.photosDir(h), tick), areas });
    }
    const health = [];
    for (const s of SECTIONS) {
        if (!s.accounts) { health.push({ label: s.label, columns: s.columns, rows: await loadRecords(s, false) }); continue; }
        // the HSA: each account's title, website, balance and entries; its sign-in hint stays off the phone copy (the
        // file lives on Google Drive)
        const accounts = [];
        for (const a of await loadAccounts(s, false)) {
            const rows = await loadRecords(accountSection(s, a), false);
            accounts.push({ title: a.title || '', linkText: a.linkText || '', url: a.url || '', balance: s.balance(rows), rows });
        }
        health.push({ label: s.label, columns: s.columns, accounts });
    }
    const pets = [];
    for (const p of await loadPets(false)) pets.push({ name: p.name, info: p.info || [], appointments: { columns: APPOINTMENT_COLUMNS, rows: await loadAppointments(p, false) }, records: { columns: RECORD_COLUMNS, rows: await loadPetRecords(p, false) }, photos: await images(petPhotosDir(p), tick) });
    return { made: new Date().toISOString(), vehicles, houses, health, pets };
}

/** The phone page: data + viewer in one HTML file. */
export function buildHtml(data) {
    const json = JSON.stringify(data).replace(/</g, '\\u003c'); // can't close the <script>
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Vehicles, House, Health &amp; Pets</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<header><div class="brand">Vehicles, House, Health &amp; Pets</div><select id="page" aria-label="Page"></select></header>
<main id="main"><p class="muted">This page needs JavaScript. On Android, open it with Chrome.</p></main>
<div id="lightbox" hidden><button id="lb-prev" aria-label="Previous">‹</button><img alt=""><button id="lb-next" aria-label="Next">›</button><div id="lb-cap"></div></div>
<script>(${viewer.toString()})(${json}, ${ageText.toString()}, ${house.houseAge.toString()}, ${appointmentStatus.toString()}, ${house.maintenanceStatus.toString()});</script>
</body>
</html>`;
}

// ── The viewer (runs inside the phone page; must not use anything from this module) ──────────────────────────
function viewer(D, ageText, houseAge, appointmentStatus, maintenanceStatus) { // pets.js ageText + appointmentStatus and house.js houseAge + maintenanceStatus, embedded so they count from the day the page is opened
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const showDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : (v || ''); };
    const num = v => { const s = String(v ?? '').replace(/[$,]/g, '').trim(); return s === '' ? NaN : Number(s); };
    const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const linkText = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }; // 'homedepot.com'
    const caption = n => n.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ');
    const main = document.getElementById('main');
    const pick = document.getElementById('page');

    const made = new Date(D.made);
    const pages = [
        ...D.vehicles.map((v, i) => ({ group: 'Vehicles', label: v.name, draw: () => drawVehicle(v) })),
        ...(D.houses || []).flatMap(h => [
            { group: 'House', label: h.name, draw: () => drawHouse(h) },
            ...h.areas.map(a => ({ group: 'House', label: `${h.name} · ${a.label}`, draw: () => drawArea(h, a) })),
        ]),
        ...D.health.map((h, i) => ({ group: 'Health', label: h.label, draw: () => drawHealth(h) })),
        ...(D.pets || []).map(p => ({ group: 'Pets', label: p.name, draw: () => drawPet(p) })),
    ];
    const groups = [...new Set(pages.map(p => p.group))];
    pick.innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${pages.map((p, i) => p.group === g
        ? `<option value="${i}">${esc(p.label)}</option>` : '').join('')}</optgroup>`).join('');
    let saved = 0;
    try { saved = +sessionStorage.getItem('page') || 0; } catch { /* storage blocked */ }
    pick.value = String(saved < pages.length ? saved : 0);
    pick.onchange = () => { try { sessionStorage.setItem('page', pick.value); } catch { /* fine */ } show(); window.scrollTo(0, 0); };

    function show() {
        const p = pages[+pick.value];
        main.innerHTML = '';
        p.draw();
        main.insertAdjacentHTML('beforeend', `<p class="made">Read-only copy made ${esc(made.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}. Changes are made on the computer.</p>`);
    }

    const section = (title, open, body) => {
        const d = document.createElement('details');
        d.className = 'sec';
        d.open = open;
        d.innerHTML = `<summary>${title}</summary><div class="sec-body"></div>`;
        main.appendChild(d);
        if (typeof body === 'string') d.querySelector('.sec-body').innerHTML = body;
        else body(d.querySelector('.sec-body'));
        return d;
    };

    // Tap a thumbnail for the full image; ‹ › or swipe to move, tap the image's background to close.
    const lb = document.getElementById('lightbox'), lbImg = lb.querySelector('img'), lbCap = document.getElementById('lb-cap');
    let lbList = [], lbI = 0;
    const lbShow = () => { lbImg.src = lbList[lbI].src; lbCap.textContent = `${lbI + 1} of ${lbList.length} · ${caption(lbList[lbI].name)}`; };
    const lbStep = d => { lbI = (lbI + d + lbList.length) % lbList.length; lbShow(); };
    document.getElementById('lb-prev').onclick = e => { e.stopPropagation(); lbStep(-1); };
    document.getElementById('lb-next').onclick = e => { e.stopPropagation(); lbStep(1); };
    lb.onclick = e => { if (e.target === lb || e.target === lbCap) lb.hidden = true; };
    let x0 = null;
    lbImg.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    lbImg.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) lbStep(dx < 0 ? 1 : -1); else lb.hidden = true; });
    const gallery = list => {
        if (!list.length) return '<p class="muted">No images.</p>';
        const id = 'g' + Math.random().toString(36).slice(2);
        galleries[id] = list;
        return `<div class="thumbs" data-g="${id}">${list.map((p, i) => `<button data-i="${i}"><img src="${p.src}" alt="${esc(caption(p.name))}" loading="lazy"><span>${esc(caption(p.name))}</span></button>`).join('')}</div>`;
    };
    const galleries = {};
    main.addEventListener('click', e => {
        const b = e.target.closest('.thumbs button');
        if (!b) return;
        lbList = galleries[b.parentElement.dataset.g];
        lbI = +b.dataset.i;
        lbShow();
        lb.hidden = false;
    });

    /** Records as cards with a search box and newest/oldest order; money columns get a total of what's shown. */
    function records(el, cols, rows, { empty = 'Nothing here yet.' } = {}) {
        const dates = cols.filter(c => c.kind === 'date' || c.kind === 'end');
        const first = dates[0]?.name;
        const moneyCols = cols.filter(c => c.kind === 'money'), moneyCol = moneyCols[0]; // the first is shown in each card's heading
        el.innerHTML = `<div class="tools"><input type="search" placeholder="Search" aria-label="Search">
            <select aria-label="Order"><option value="saved">Your order</option><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></div>
            <div class="cards"></div><div class="total"></div>`;
        const q = el.querySelector('input'), order = el.querySelector('select'), list = el.querySelector('.cards'), total = el.querySelector('.total');
        const text = r => cols.map(c => (c.kind === 'date' || c.kind === 'end' ? showDate(r[c.name]) + ' ' : '') + (r[c.name] || '')).join(' ').toLowerCase();
        const card = r => {
            const when = dates.map(c => (c.kind === 'end' ? (r[c.name] ? showDate(r[c.name]) : 'ongoing') : showDate(r[c.name]))).filter(Boolean).join(' – ');
            const tags = cols.filter(c => (c.kind === 'choice' || c.kind === 'suggest') && r[c.name]).map(c => `<span class="tag">${esc(r[c.name])}</span>`).join('');
            const cost = moneyCol && !Number.isNaN(num(r[moneyCol.name])) ? `<span class="cost">${money(num(r[moneyCol.name]))}</span>` : '';
            const nums = cols.filter(c => c.kind === 'number' && r[c.name]).map(c => `<div class="sub">${esc(c.name)}: ${esc(Number.isNaN(num(r[c.name])) ? r[c.name] : num(r[c.name]).toLocaleString('en-US'))}</div>`).join('')
                + moneyCols.slice(1).filter(c => !Number.isNaN(num(r[c.name]))).map(c => `<div class="sub">${esc(c.name)}: ${money(num(r[c.name]))}</div>`).join('');
            const texts = cols.filter(c => c.kind === 'text' && r[c.name]).map((c, i) => i === 0
                ? `<div class="desc">${esc(r[c.name])}</div>` : `<div class="note"><b>${esc(c.name)}:</b> ${esc(r[c.name])}</div>`).join('');
            return `<div class="card"><div class="card-head"><span class="when">${esc(when || 'No date')}</span>${tags}${cost}</div>${nums}${texts}</div>`;
        };
        const draw = () => {
            const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const shown = rows.filter(r => { const t = text(r); return words.every(w => t.includes(w)); });
            if (first && order.value !== 'saved') { // 'saved': the order they're in on the computer
                const sign = order.value === 'asc' ? 1 : -1;
                shown.sort((a, b) => (!a[first] || !b[first]) ? (!a[first]) - (!b[first]) : sign * a[first].localeCompare(b[first]));
            }
            list.innerHTML = shown.length ? shown.map(card).join('') : `<p class="muted">${rows.length ? 'No matches.' : esc(empty)}</p>`;
            const sum = c => money(shown.reduce((t, r) => t + (Number.isNaN(num(r[c.name])) ? 0 : num(r[c.name])), 0));
            total.innerHTML = moneyCol && shown.length ? `Total of ${shown.length} shown: ${moneyCols.length === 1 ? `<b>${sum(moneyCol)}</b>`
                : moneyCols.map(c => `${esc(c.name)} <b>${sum(c)}</b>`).join(' · ')}` : '';
        };
        q.oninput = draw;
        order.onchange = draw;
        draw();
    }

    const stepsHtml = t => t.split('\n').map(line => {
        const s = line.trim();
        if (!s) return '<div class="gap"></div>';
        const head = /^#{1,3}\s+(.*)$/.exec(s);
        if (head) return `<h4>${esc(head[1])}</h4>`;
        const check = /^\[([ xX])\]\s*(.*)$/.exec(s);
        if (check) return `<div class="step${check[1] === ' ' ? '' : ' done'}"><span class="num">${check[1] === ' ' ? '☐' : '☑'}</span><span>${esc(check[2])}</span></div>`;
        const n =/^(\d+[.)])\s+(.*)$/.exec(s) || (/^[-•*]\s+(.*)$/.exec(s) && ['', '•', s.replace(/^[-•*]\s+/, '')]);
        return n ? `<div class="step"><span class="num">${esc(n[1])}</span><span>${esc(n[2])}</span></div>` : `<p>${esc(s)}</p>`;
    }).join('');

    const placesHtml = places => places.map(p => `<div class="place${p.crossed ? ' crossed' : ''}">
        <h3>${p.crossed ? `<s>${esc(p.name)}</s> (don't use)` : esc(p.name)}</h3>${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ''}
        ${p.phone ? `<p><a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(p.phone)}</a></p>` : ''}
        ${p.address ? `<p><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(p.address)}">📍 ${esc(p.address)}</a></p>` : ''}
        ${p.hours ? `<pre class="hours">${esc(p.hours)}</pre>` : ''}</div>`).join('');

    const infoList = info => `<dl class="info">${info.filter(f => f.value).map(f =>
        `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('') || '<p class="muted">No information.</p>'}</dl>`;

    function drawVehicle(v) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(v.name)}</h1><p class="muted">${esc(v.type)}</p>`);
        section('Information', true, infoList(v.info));
        if (v.mileage) section('Current mileage', true, el => { // the newest reading and the miles a month and a year it works out to, then the log
            const { latest: r, rate } = v.mileage, n = x => (Number.isNaN(num(x)) ? String(x) : num(x).toLocaleString('en-US'));
            el.innerHTML = `${r ? `<p><b>${esc(n(r.Mileage))} miles</b> <span class="muted">· ${esc(showDate(r.Date))}</span></p>${rate.why
                ? `<p class="muted">Miles per month / year: ${esc(rate.why)}</p>`
                : `<p>≈ <b>${esc(n(rate.perMonth))}</b> miles a month · ≈ <b>${esc(n(rate.perYear))}</b> a year <span class="muted">(since ${esc(rate.from)})</span></p>`}
                <p class="muted">Each reading's miles a month and a year are since the one before it (the oldest one's since the purchase).</p>`
                : '<p class="muted">Nothing logged yet.</p>'}<div></div>`;
            records(el.lastElementChild, v.mileage.columns, v.mileage.rows);
        });
        if (v.places.length) section(`Service places (${v.places.length})`, false, placesHtml(v.places));
        section(`Maintenance (${v.maintenance.rows.length})`, true, el => records(el, v.maintenance.columns, v.maintenance.rows));
        if (v.notes.length) section(`Notes (${v.notes.length})`, false, el => {
            el.innerHTML = `<div class="tools"><input type="search" placeholder="Search notes" aria-label="Search notes"></div>${v.notes.map(n => `
                <div class="card"><div class="card-head"><span class="when">${esc(n.date ? showDate(n.date) : 'No date')}</span><b>${esc(n.title)}</b></div>
                ${n.text ? `<div class="desc">${esc(n.text)}</div>` : ''}${n.images.length ? gallery(n.images) : ''}</div>`).join('')}`;
            const q = el.querySelector('input'), cards = [...el.querySelectorAll('.card')];
            q.oninput = () => {
                const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
                cards.forEach((c, i) => { const n = v.notes[i]; const t = `${n.date} ${showDate(n.date)} ${n.title} ${n.text}`.toLowerCase(); c.hidden = !words.every(w => t.includes(w)); });
            };
        });
        if (v.guides.length) section(`Guides (${v.guides.length})`, false, el => {
            el.innerHTML = v.guides.map((g, i) => `<details class="guide"><summary>${esc(g.title)}</summary>
                <div class="steps">${stepsHtml(g.text)}</div>${g.images.length ? gallery(g.images) : ''}</details>`).join('');
        });
        if (v.photos.length) section(`Photos (${v.photos.length})`, false, gallery(v.photos));
    }

    /** An Age line after a Year Built (house) or Manufactured (e.g. the boiler) field, as in House. */
    const withAge = info => info.flatMap(f => (/built|manufactured/i.test(f.label) && f.value && houseAge(f.value) ? [f, { label: 'Age', value: houseAge(f.value) }] : [f]));

    function drawHouse(h) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(h.name)}</h1><p class="muted">House · the areas are in the page list above</p>`);
        section('Information', true, infoList(withAge(h.info)));
        if (h.places.length) section(`Service companies (${h.places.length})`, false, placesHtml(h.places));
        if (h.photos.length) section(`Photos (${h.photos.length})`, false, gallery(h.photos));
    }

    /** Future improvements or projects: collapsed cards, Done ones crossed out. */
    const cardsHtml = items => items.map(x => `
        <details class="guide"><summary>${/^done$/i.test(x.status || '') ? `<s>${esc(x.title)}</s>` : esc(x.title)}${x.status ? ` <span class="tag">${esc(x.status)}</span>` : ''}</summary>
            <div class="steps">${x.cost ? `<p><b>Estimated cost:</b> ${esc(x.cost)}</p>` : ''}${stepsHtml(x.text || '')}</div></details>`).join('');

    /** One project: its estimated total, plan & notes, materials, measurements & specs, images, linked future updates. */
    const projectHtml = p => {
        const sum = (rows, col) => rows.reduce((t, r) => t + (Number.isNaN(num(r[col])) ? 0 : num(r[col])), 0);
        const total = sum(p.materials, 'Cost');
        const specs = p.specs.filter(f => f.value);
        return `<details class="guide"><summary>${/^done$/i.test(p.status) ? `<s>${esc(p.title)}</s>` : esc(p.title)}${p.status ? ` <span class="tag">${esc(p.status)}</span>` : ''}</summary>
            <div class="steps"><p><b>Estimated total:</b> ${money(total)}</p>
                ${p.text ? `<h3>Plan &amp; notes</h3>${stepsHtml(p.text)}` : ''}
                ${p.materials.length ? `<h3>Materials</h3>${p.materials.map(r => `<div class="sub">${esc([r.Brand, r.Item].filter(Boolean).join(' ') || '—')}${[r.Quantity, r['Size / Spec']].filter(Boolean).length ? `: ${esc([r.Quantity, r['Size / Spec']].filter(Boolean).join(', '))}` : ''}${Number.isNaN(num(r.Price)) ? '' : ` — ${money(num(r.Price))}${num(r.Cost) !== num(r.Price) ? ` each, ${money(num(r.Cost))}` : ''}`}${r.Source ? ` (${esc(r.Source)})` : ''}${/^https?:\/\//i.test(r.Link || '') ? ` · <a href="${esc(r.Link)}" target="_blank" rel="noopener">${esc(linkText(r.Link))}</a>` : r.Link ? ` · ${esc(r.Link)}` : ''}${r.Notes ? ` — ${esc(r.Notes)}` : ''}</div>`).join('')}` : ''}
                ${specs.length ? `<h3>Measurements &amp; specs</h3>${infoList(specs)}` : ''}
                ${p.updates.length ? `<h3>Future updates</h3>${p.updates.map(r => `<div class="sub">${esc(r.Update || '')}${r['Planned Date'] ? ` — planned ${esc(showDate(r['Planned Date']))}` : ''}</div>`).join('')}` : ''}
            </div>${p.images.length ? gallery(p.images) : ''}</details>`;
    };

    function drawArea(h, a) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(a.label)}</h1><p class="muted">${esc(h.name)}${a.tab ? ` · ${esc(a.tab)}` : ''}</p>`);
        if (a.table) return section(`Entries (${a.table.rows.length})`, true, el => records(el, a.table.columns, a.table.rows));
        if (a.projects) return section(`${a.label} (${a.projects.length})`, true, a.projects.length ? a.projects.map(projectHtml).join('') : '<p class="muted">Nothing here yet.</p>');
        const m = a.maintenance;
        if (m?.banner) { // like House's (views/settings.js maintenanceBanner): red once due, yellow when it's coming up, else green
            const b = m.banner, { level, due, last } = maintenanceStatus(m.rows, b);
            const by = due.toLocaleString('en-US', { month: 'long', year: 'numeric' });
            const since = b.since ? new Date(+b.since.slice(0, 4), +b.since.slice(5, 7) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : '';
            const before = last ? `Last done ${esc(showDate(last.Date))}` : since ? `Nothing logged yet; counting from ${esc(since)}` : 'Nothing logged yet';
            main.insertAdjacentHTML('beforeend', level === 'due' ? `<div class="banner bad"><b>${esc(b.what)} is due.</b> ${before} (due by ${by}).</div>`
                : level === 'soon' ? `<div class="banner soon"><b>${esc(b.what)} is due by ${by}.</b> ${before}.</div>`
                : last ? `<div class="banner ok"><b>${esc(b.what)} done ${esc(showDate(last.Date))}</b>${last.Description ? ` — ${esc(last.Description)}` : ''}. Next due by ${by}.</div>`
                : `<div class="banner ok"><b>${esc(b.what)} is due by ${by}.</b> ${before}.</div>`);
        }
        for (const b of a.boxes) section(a.boxes.length > 1 ? b.label : 'Information', true, infoList(withAge(b.info)));
        if (a.photos.length) section(`${a.photosLabel} (${a.photos.length})`, false, gallery(a.photos));
        if (a.improvements?.length) section(`Future improvements (${a.improvements.length})`, false, cardsHtml(a.improvements));
        if (m) section(`Maintenance (${m.rows.length})`, true, el => {
            if (!m.note) return records(el, m.columns, m.rows);
            el.innerHTML = `<p class="section-note">📌 ${esc(m.note)}</p><div></div>`;
            records(el.lastElementChild, m.columns, m.rows);
        });
        if (a.records) section(`Records (${a.records.rows.length})`, true, el => records(el, a.records.columns, a.records.rows));
    }

    function drawHealth(h) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(h.label)}</h1>`);
        if (!h.accounts) return section(`Entries (${h.rows.length})`, true, el => records(el, h.columns, h.rows));
        if (!h.accounts.length) main.insertAdjacentHTML('beforeend', '<p class="muted">No accounts yet.</p>');
        for (const a of h.accounts) {
            const b = a.balance;
            main.insertAdjacentHTML('beforeend', `<div class="sec acct"><div><b>${esc(a.title)}</b>
                <div class="sub">Total balance <b class="${b.balance < 0 ? 'neg' : 'pos'}">${money(b.balance)}</b> (${money(b.deposits)} deposits − ${money(b.charges)} charges)</div></div>
                ${/^https?:\/\//i.test(a.url) ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.linkText || 'Website')} ↗</a>` : ''}</div>`);
            section(`${esc(a.title)} entries (${a.rows.length})`, false, el => records(el, h.columns, a.rows));
        }
    }

    function drawPet(p) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(p.name)}</h1>`);
        const appts = p.appointments?.rows || [];
        const s = appointmentStatus(appts);
        const inDays = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
        const what = r => `${esc(showDate(r.Date))}${r.Time ? ` at ${esc(r.Time)}` : ''}${r.Description ? ` — ${esc(r.Description)}` : ''}`;
        main.insertAdjacentHTML('beforeend', s.level === 'none' ? '<div class="banner bad"><b>No future appointment</b></div>'
            : `<div class="banner ${s.level === 'soon' ? 'soon' : 'ok'}"><b>${s.level === 'soon' ? 'Coming up' : 'Next appointment'} ${inDays(s.days)}:</b> ${what(s.next)}</div>`);
        const info = p.info.flatMap(f => (/birth/i.test(f.label) && f.value && ageText(f.value) ? [f, { label: 'Age', value: ageText(f.value) }] : [f]));
        section('General information', true, infoList(info));
        if (p.photos?.length) section(`Photos (${p.photos.length})`, false, gallery(p.photos));
        if (p.appointments) section(`Future appointments (${appts.length})`, true, el => records(el, p.appointments.columns, appts));
        section(`Records (${p.records.rows.length})`, true, el => records(el, p.records.columns, p.records.rows));
    }

    show();
}

const VIEWER_CSS = `
:root { --bg:#f5f7fa; --card:#fff; --text:#2d2d2d; --muted:#7a7f88; --line:#e3e8f0; --head:#1a1a2e; --accent:#3a5ca8; --tag:#eef3ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#14161c; --card:#1e2129; --text:#e6e8ec; --muted:#9aa1ad; --line:#2c303a; --head:#0e0f14; --accent:#8fb0ff; --tag:#26304a; } }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); font-size:16px; }
header { position:sticky; top:0; z-index:5; background:var(--head); color:#fff; padding:10px 16px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.brand { font-weight:700; }
header select { flex:1; min-width:180px; font:inherit; font-size:15px; padding:7px 10px; border-radius:8px; border:0; }
main { max-width:760px; margin:0 auto; padding:16px 16px 40px; }
h1 { font-size:1.35em; margin:6px 0 2px; }
.muted { color:var(--muted); }
.sec { background:var(--card); border:1px solid var(--line); border-radius:10px; margin:12px 0; }
.sec > summary { padding:12px 14px; font-weight:600; cursor:pointer; }
.sec-body { padding:0 14px 14px; }
.info { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px 16px; }
.info dt { font-size:.72em; text-transform:uppercase; letter-spacing:.4px; color:var(--muted); }
.info dd { overflow-wrap:anywhere; white-space:pre-wrap; }
.tools { display:flex; gap:8px; margin-bottom:10px; }
.tools input { flex:1; min-width:0; }
input, select { font:inherit; font-size:15px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--text); }
.card { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:8px; }
.card[hidden] { display:none; }
.card .thumbs { padding:8px 0 0; }
.card-head { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:4px; }
.when { font-weight:600; }
.tag { background:var(--tag); color:var(--accent); border-radius:5px; padding:1px 7px; font-size:.82em; }
.cost { margin-left:auto; font-weight:700; }
.sub { font-size:.88em; color:var(--muted); }
.desc { margin-top:2px; white-space:pre-wrap; }
.note { margin-top:4px; font-size:.88em; color:var(--muted); white-space:pre-wrap; }
.section-note { margin:0 0 10px; padding:8px 12px; border-left:3px solid var(--accent); background:var(--tag); border-radius:0 6px 6px 0; }
.total { text-align:right; margin-top:6px; }
.place { border-top:1px solid var(--line); padding:10px 0; }
.place:first-child { border-top:0; padding-top:0; }
.place h3 { font-size:1em; }
.place p { margin:4px 0; }
.sec.acct { padding:12px 14px; display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; justify-content:space-between; }
.sec.acct .pos { color:#27ae60; } .sec.acct .neg { color:#e74c3c; } .sec.acct .sub b { font-size:1.1em; }
.place.crossed { opacity:0.6; }
a { color:var(--accent); }
a.btn { display:inline-block; text-decoration:none; border:1px solid var(--line); border-radius:8px; padding:6px 12px; }
.hours { font:inherit; font-size:.88em; white-space:pre-wrap; color:var(--muted); }
.guide { border:1px solid var(--line); border-radius:8px; margin-bottom:8px; }
.guide > summary { padding:10px 12px; font-weight:600; cursor:pointer; }
.steps { padding:0 12px 8px; font-size:.95em; line-height:1.45; }
.steps p { margin:4px 0; }
.steps h4 { font-size:1em; margin:12px 0 4px; }
.step.done > span:last-child { color:var(--muted); text-decoration:line-through; }
.step { display:flex; gap:8px; margin:5px 0; }
.num { min-width:22px; font-weight:600; color:var(--accent); }
.gap { height:6px; }
.thumbs { display:grid; grid-template-columns:repeat(auto-fill,minmax(105px,1fr)); gap:8px; padding:4px 12px 12px; }
.sec-body > .thumbs { padding:0; }
.thumbs button { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--card); padding:0; text-align:left; color:var(--text); }
.thumbs img { width:100%; aspect-ratio:4/3; object-fit:cover; display:block; }
.thumbs span { display:block; font-size:.72em; padding:4px 6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lightbox { position:fixed; inset:0; z-index:10; background:rgba(0,0,0,.94); display:flex; align-items:center; justify-content:center; }
#lightbox[hidden] { display:none; }
#lightbox img { max-width:100%; max-height:88vh; object-fit:contain; }
#lightbox button { position:absolute; bottom:18px; background:rgba(255,255,255,.18); color:#fff; border:0; border-radius:8px; font-size:28px; padding:6px 18px; }
#lb-prev { left:16px; } #lb-next { right:16px; }
#lb-cap { position:absolute; top:12px; left:0; right:0; text-align:center; color:#ccc; font-size:.85em; padding:0 12px; }
.banner { border-radius:8px; padding:10px 14px; margin:10px 0; border:1px solid; }
.banner.bad { background:#fdecea; color:#a8322a; border-color:#f5c6c0; }
.banner.soon { background:#fffbe0; color:#7a6400; border-color:#f0e08a; }
.banner.ok { background:#e8f8ef; color:#1e7a46; border-color:#bfe8cf; }
.made { margin-top:20px; font-size:.8em; color:var(--muted); text-align:center; }
`;

// ── Keeping it up to date ─────────────────────────────────────────────────────────────────────────────────────
// Every save in Vehicles, House, Health or Pets fires a 'data-saved' event on window (the save functions in vehicles.js,
// house/js/house.js, health/js/records.js, pets/js/pets.js and the image gallery). A few seconds after the last one,
// the phone copy is rebuilt in the background — if a folder was chosen and Chrome still allows writing to it. After
// Chrome restarts it has to ask again, which needs a click: then an "Update phone copy" notice stays up instead.
// "Out of date" is remembered in this browser, so the notice is back if the page is closed before updating.
const STALE_KEY = 'phoneCopyStale';
const AUTO_DELAY = 4000; // ms after the last save

const stale = {
    get() { try { return !!localStorage.getItem(STALE_KEY); } catch { return false; } },
    set(on) { try { on ? localStorage.setItem(STALE_KEY, new Date().toISOString()) : localStorage.removeItem(STALE_KEY); } catch { /* fine */ } },
};

/** Build and write the phone copy into `dir` (permission already granted). Returns its size in MB. */
async function writeCopy(dir, progress = () => {}) {
    const html = buildHtml(await collectData(progress));
    const fh = await dir.getFileHandle(FILE_NAME, { create: true });
    const w = await fh.createWritable();
    await w.write(html);
    await w.close();
    stale.set(false);
    return (new Blob([html]).size / 1048576).toFixed(1);
}

// ── The top-bar button, its panel and the "out of date" notice ──────────────────────────────────────────────────
export function setupPhoneCopy(button) {
    const panel = document.createElement('div');
    panel.className = 'phone-panel';
    panel.hidden = true;
    document.body.appendChild(panel);
    const notice = document.createElement('div');
    notice.className = 'phone-notice';
    notice.hidden = true;
    document.body.appendChild(notice);

    let busy = false, again = false, timer = null;

    const showNotice = () => {
        notice.hidden = !stale.get() || busy;
        button.classList.toggle('stale', stale.get());
        notice.innerHTML = `<span>📱 Phone copy is out of date.</span>
            <button type="button" class="small primary" data-update>Update phone copy</button>
            <button type="button" class="small" data-later title="Hide until the next change">Later</button>`;
        notice.querySelector('[data-update]').onclick = () => makeNow();
        notice.querySelector('[data-later]').onclick = () => { notice.hidden = true; };
    };

    /** Rebuild now. From a click it may ask Chrome for permission; in the background it only writes if allowed. */
    const makeNow = async ({ background = false, status = () => {} } = {}) => {
        const dir = await fs.rememberedHandle(HANDLE_KEY);
        if (!dir) return false;
        if (!fs.folder()) { if (!background) toast('Connect your erik-life-app folder first.', 'bad'); showNotice(); return false; }
        const allowed = background
            ? (await dir.queryPermission({ mode: 'readwrite' })) === 'granted'
            : (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
        if (!allowed) {
            if (!background) toast('The phone-copy folder needs permission to write.', 'bad');
            showNotice();
            return false;
        }
        if (busy) { again = true; return false; }
        busy = true;
        notice.hidden = true;
        try {
            const mb = await writeCopy(dir, n => status(`Shrinking photos… ${n}`));
            status(`Saved “${FILE_NAME}” (${mb} MB) in ${dir.name}.`);
            toast(background ? 'Phone copy updated' : 'Phone copy saved', 'ok');
            return true;
        } catch (err) {
            status('');
            const why = err.name !== 'FolderMovedError' && await fs.isGone(dir)
                ? `${fs.movedMessage(dir)} Choose it again with Change… in the 📱 panel.` : err.message;
            toast(`Couldn't update the phone copy: ${why}`, 'bad');
            return false;
        } finally {
            busy = false;
            showNotice();
            if (again) { again = false; makeNow({ background: true }); } // something was saved while building
        }
    };

    window.addEventListener('data-saved', async () => {
        if (!await fs.rememberedHandle(HANDLE_KEY)) return; // no phone copy set up
        stale.set(true);
        clearTimeout(timer);
        timer = setTimeout(() => makeNow({ background: true }), AUTO_DELAY);
    });
    window.addEventListener('beforeunload', () => { clearTimeout(timer); });

    const draw = async () => {
        const dir = await fs.rememberedHandle(HANDLE_KEY);
        panel.innerHTML = `
            <h3>📱 Phone copy</h3>
            <p>A read-only page with Vehicles, House, Health and Pets (information, maintenance, guides, notes, photos, health and pet records) as one file.
               Save it in a Google Drive folder and open it on your phone from the Drive app with Chrome.</p>
            <p>It updates by itself a few seconds after you save something here.</p>
            <p class="pc-folder">Folder: <strong>${dir ? esc(dir.name) : 'not chosen yet'}</strong>
               <button type="button" class="small" data-choose>${dir ? 'Change…' : 'Choose folder…'}</button></p>
            <div class="row"><button type="button" class="primary" data-make${dir ? '' : ' disabled'}>Make phone copy now</button>
               <span class="muted" data-status>${stale.get() ? 'Out of date.' : ''}</span></div>`;
        panel.querySelector('[data-choose]').onclick = async () => {
            try {
                const h = await window.showDirectoryPicker({ id: 'phonecopy', mode: 'readwrite' });
                await fs.rememberHandle(HANDLE_KEY, h);
            } catch { return; } // cancelled
            draw();
        };
        const status = t => { const el = panel.querySelector('[data-status]'); if (el) el.textContent = t; };
        panel.querySelector('[data-make]').onclick = async e => {
            e.target.disabled = true;
            await makeNow({ status });
            e.target.disabled = false;
        };
    };

    button.onclick = () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) draw();
    };
    document.addEventListener('mousedown', e => {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== button) panel.hidden = true;
    });

    // Opening the page: if a change wasn't copied yet, try now (works when Chrome kept the permission), else ask.
    button.classList.toggle('stale', stale.get());
    if (stale.get()) setTimeout(() => makeNow({ background: true }), AUTO_DELAY);
}
