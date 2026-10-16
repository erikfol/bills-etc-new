// "📱 Phone copy" (Vehicles and Health top bars): writes one self-contained, read-only page — every vehicle
// (information, service places, maintenance, photos, guides) and every Health section — into a folder you pick once,
// e.g. in Google Drive so it syncs to your phone. Photos are shrunk and embedded, so the page is a single file that
// opens offline (Android hands Chrome a single file, so a page can't load anything from next to itself).
import * as fs from '../../bills-etc/js/fs.js';
import { esc, toast } from '../../bills-etc/js/util.js';
import { loadVehicles, loadMaintenance, maintenanceColumns, photosDir, guideDir, TYPES } from '../../vehicles/js/vehicles.js';
import { SECTIONS, loadRecords } from '../../health/js/records.js';

const FILE_NAME = 'Vehicles and Health.html';
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
    for (const v of await loadVehicles()) {
        const guides = [];
        for (const g of v.guides || []) guides.push({ title: g.title, text: g.text || '', images: await images(guideDir(v, g), tick) });
        vehicles.push({
            name: v.name,
            type: TYPES[v.type]?.label || 'Vehicle',
            info: v.info || [],
            places: v.places || [],
            maintenance: { columns: maintenanceColumns(v).map(c => ({ name: c.name, kind: c.kind })), rows: await loadMaintenance(v) },
            photos: await images(photosDir(v), tick),
            guides,
        });
    }
    const health = [];
    for (const s of SECTIONS) health.push({ label: s.label, columns: s.columns, rows: await loadRecords(s) });
    return { made: new Date().toISOString(), vehicles, health };
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
<title>Vehicles &amp; Health</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<header><div class="brand">Vehicles &amp; Health</div><select id="page" aria-label="Page"></select></header>
<main id="main"><p class="muted">This page needs JavaScript. On Android, open it with Chrome.</p></main>
<div id="lightbox" hidden><button id="lb-prev" aria-label="Previous">‹</button><img alt=""><button id="lb-next" aria-label="Next">›</button><div id="lb-cap"></div></div>
<script>(${viewer.toString()})(${json});</script>
</body>
</html>`;
}

// ── The viewer (runs inside the phone page; must not use anything from this module) ──────────────────────────
function viewer(D) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const showDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : (v || ''); };
    const num = v => { const s = String(v ?? '').replace(/[$,]/g, '').trim(); return s === '' ? NaN : Number(s); };
    const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const caption = n => n.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ');
    const main = document.getElementById('main');
    const pick = document.getElementById('page');

    const made = new Date(D.made);
    const pages = [
        ...D.vehicles.map((v, i) => ({ group: 'Vehicles', label: v.name, draw: () => drawVehicle(v) })),
        ...D.health.map((h, i) => ({ group: 'Health', label: h.label, draw: () => drawHealth(h) })),
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
        const moneyCol = cols.find(c => c.kind === 'money');
        el.innerHTML = `<div class="tools"><input type="search" placeholder="Search" aria-label="Search">
            <select aria-label="Order"><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></div>
            <div class="cards"></div><div class="total"></div>`;
        const q = el.querySelector('input'), order = el.querySelector('select'), list = el.querySelector('.cards'), total = el.querySelector('.total');
        const text = r => cols.map(c => (c.kind === 'date' || c.kind === 'end' ? showDate(r[c.name]) + ' ' : '') + (r[c.name] || '')).join(' ').toLowerCase();
        const card = r => {
            const when = dates.map(c => (c.kind === 'end' ? (r[c.name] ? showDate(r[c.name]) : 'ongoing') : showDate(r[c.name]))).filter(Boolean).join(' – ');
            const tags = cols.filter(c => (c.kind === 'choice' || c.kind === 'suggest') && r[c.name]).map(c => `<span class="tag">${esc(r[c.name])}</span>`).join('');
            const cost = moneyCol && !Number.isNaN(num(r[moneyCol.name])) ? `<span class="cost">${money(num(r[moneyCol.name]))}</span>` : '';
            const nums = cols.filter(c => c.kind === 'number' && r[c.name]).map(c => `<div class="sub">${esc(c.name)}: ${esc(Number.isNaN(num(r[c.name])) ? r[c.name] : num(r[c.name]).toLocaleString('en-US'))}</div>`).join('');
            const texts = cols.filter(c => c.kind === 'text' && r[c.name]).map((c, i) => i === 0
                ? `<div class="desc">${esc(r[c.name])}</div>` : `<div class="note"><b>${esc(c.name)}:</b> ${esc(r[c.name])}</div>`).join('');
            return `<div class="card"><div class="card-head"><span class="when">${esc(when || 'No date')}</span>${tags}${cost}</div>${nums}${texts}</div>`;
        };
        const draw = () => {
            const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const shown = rows.filter(r => { const t = text(r); return words.every(w => t.includes(w)); });
            if (first) {
                const sign = order.value === 'asc' ? 1 : -1;
                shown.sort((a, b) => (!a[first] || !b[first]) ? (!a[first]) - (!b[first]) : sign * a[first].localeCompare(b[first]));
            }
            list.innerHTML = shown.length ? shown.map(card).join('') : `<p class="muted">${rows.length ? 'No matches.' : esc(empty)}</p>`;
            total.innerHTML = moneyCol && shown.length
                ? `Total of ${shown.length} shown: <b>${money(shown.reduce((t, r) => t + (Number.isNaN(num(r[moneyCol.name])) ? 0 : num(r[moneyCol.name])), 0))}</b>` : '';
        };
        q.oninput = draw;
        order.onchange = draw;
        draw();
    }

    const stepsHtml = t => t.split('\n').map(line => {
        const s = line.trim();
        if (!s) return '<div class="gap"></div>';
        const n = /^(\d+[.)])\s+(.*)$/.exec(s) || (/^[-•*]\s+(.*)$/.exec(s) && ['', '•', s.replace(/^[-•*]\s+/, '')]);
        return n ? `<div class="step"><span class="num">${esc(n[1])}</span><span>${esc(n[2])}</span></div>` : `<p>${esc(s)}</p>`;
    }).join('');

    function drawVehicle(v) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(v.name)}</h1><p class="muted">${esc(v.type)}</p>`);
        section('Information', true, `<dl class="info">${v.info.filter(f => f.value).map(f =>
            `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('') || '<p class="muted">No information.</p>'}</dl>`);
        if (v.places.length) section(`Service places (${v.places.length})`, false, v.places.map(p => `<div class="place">
            <h3>${esc(p.name)}</h3>${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ''}
            ${p.phone ? `<p><a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(p.phone)}</a></p>` : ''}
            ${p.address ? `<p><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(p.address)}">📍 ${esc(p.address)}</a></p>` : ''}
            ${p.hours ? `<pre class="hours">${esc(p.hours)}</pre>` : ''}</div>`).join(''));
        section(`Maintenance (${v.maintenance.rows.length})`, true, el => records(el, v.maintenance.columns, v.maintenance.rows));
        if (v.guides.length) section(`Guides (${v.guides.length})`, false, el => {
            el.innerHTML = v.guides.map((g, i) => `<details class="guide"><summary>${esc(g.title)}</summary>
                <div class="steps">${stepsHtml(g.text)}</div>${g.images.length ? gallery(g.images) : ''}</details>`).join('');
        });
        if (v.photos.length) section(`Photos (${v.photos.length})`, false, gallery(v.photos));
    }

    function drawHealth(h) {
        main.insertAdjacentHTML('beforeend', `<h1>${esc(h.label)}</h1>`);
        section(`Entries (${h.rows.length})`, true, el => records(el, h.columns, h.rows));
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
.card-head { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:4px; }
.when { font-weight:600; }
.tag { background:var(--tag); color:var(--accent); border-radius:5px; padding:1px 7px; font-size:.82em; }
.cost { margin-left:auto; font-weight:700; }
.sub { font-size:.88em; color:var(--muted); }
.desc { margin-top:2px; white-space:pre-wrap; }
.note { margin-top:4px; font-size:.88em; color:var(--muted); white-space:pre-wrap; }
.total { text-align:right; margin-top:6px; }
.place { border-top:1px solid var(--line); padding:10px 0; }
.place:first-child { border-top:0; padding-top:0; }
.place h3 { font-size:1em; }
.place p { margin:4px 0; }
a { color:var(--accent); }
a.btn { display:inline-block; text-decoration:none; border:1px solid var(--line); border-radius:8px; padding:6px 12px; }
.hours { font:inherit; font-size:.88em; white-space:pre-wrap; color:var(--muted); }
.guide { border:1px solid var(--line); border-radius:8px; margin-bottom:8px; }
.guide > summary { padding:10px 12px; font-weight:600; cursor:pointer; }
.steps { padding:0 12px 8px; font-size:.95em; line-height:1.45; }
.steps p { margin:4px 0; }
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
.made { margin-top:20px; font-size:.8em; color:var(--muted); text-align:center; }
`;

// ── The top-bar button and its panel ──────────────────────────────────────────────────────────────────────────
export function setupPhoneCopy(button) {
    const panel = document.createElement('div');
    panel.className = 'phone-panel';
    panel.hidden = true;
    document.body.appendChild(panel);

    const draw = async () => {
        const dir = await fs.rememberedHandle(HANDLE_KEY);
        panel.innerHTML = `
            <h3>📱 Phone copy</h3>
            <p>A read-only page with Vehicles and Health (information, maintenance, guides, photos, health records) as one file.
               Save it in a Google Drive folder and open it on your phone from the Drive app with Chrome.</p>
            <p class="pc-folder">Folder: <strong>${dir ? esc(dir.name) : 'not chosen yet'}</strong>
               <button type="button" class="small" data-choose>${dir ? 'Change…' : 'Choose folder…'}</button></p>
            <div class="row"><button type="button" class="primary" data-make${dir ? '' : ' disabled'}>Make phone copy</button>
               <span class="muted" data-status></span></div>`;
        panel.querySelector('[data-choose]').onclick = async () => {
            try {
                const h = await window.showDirectoryPicker({ id: 'phonecopy', mode: 'readwrite' });
                await fs.rememberHandle(HANDLE_KEY, h);
            } catch { return; } // cancelled
            draw();
        };
        panel.querySelector('[data-make]').onclick = () => make(dir);
    };

    const make = async dir => {
        const status = panel.querySelector('[data-status]'), btn = panel.querySelector('[data-make]');
        if (!fs.folder()) return toast('Connect your bills-etc-new folder first.', 'bad');
        if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('The phone-copy folder needs permission to write.', 'bad');
        btn.disabled = true;
        try {
            const data = await collectData(n => { status.textContent = `Shrinking photos… ${n}`; });
            status.textContent = 'Saving…';
            const html = buildHtml(data);
            const fh = await dir.getFileHandle(FILE_NAME, { create: true });
            const w = await fh.createWritable();
            await w.write(html);
            await w.close();
            const mb = (new Blob([html]).size / 1048576).toFixed(1);
            status.textContent = `Saved “${FILE_NAME}” (${mb} MB) in ${dir.name}.`;
            toast('Phone copy saved', 'ok');
        } catch (err) {
            status.textContent = '';
            toast(`Couldn't make the phone copy: ${err.message}`, 'bad');
        } finally {
            btn.disabled = false;
        }
    };

    button.onclick = () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) draw();
    };
    document.addEventListener('mousedown', e => {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== button) panel.hidden = true;
    });
}
