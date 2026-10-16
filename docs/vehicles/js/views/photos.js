// A vehicle's photos: the images in inputs/vehicles/photos/<id>/, shown as thumbnails; click one to see it large.
// "＋ Add photos" copies picked images into that folder (it never deletes; remove a photo from the folder itself).
import * as fs from '../../../bills-etc/js/fs.js';
import { esc, toast } from '../../../bills-etc/js/util.js';
import { photosDir } from '../vehicles.js';

const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp)$/i;
let urls = []; // object URLs to release when the page changes
let closeBox = null; // closes an open large photo

export function releasePhotos() {
    urls.forEach(u => URL.revokeObjectURL(u));
    urls = [];
    closeBox?.();
}

/** '03-engine-ford-logo.png' → 'engine ford logo'. */
const caption = name => name.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ');

export async function renderPhotos(el, v) {
    releasePhotos();
    const dir = photosDir(v);
    const stem = n => n.replace(/\.[^.]+$/, '');
    const names = (await fs.listFiles(dir, '')).filter(n => IMAGE.test(n))
        .sort((a, b) => stem(a).localeCompare(stem(b), undefined, { numeric: true })); // 'x.png' before 'x (2).png'
    const photos = [];
    for (const name of names) {
        const file = await fs.readFile(`${dir}/${name}`);
        if (!file) continue;
        const url = URL.createObjectURL(file);
        urls.push(url);
        photos.push({ name, url });
    }
    el.innerHTML = `
        <div class="row table-tools">
            <button type="button" class="small" id="add-photos">＋ Add photos</button>
            <span class="muted edit-hint">${photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} · click one to see it large.` : 'No photos yet.'} Saved in <code>${esc(dir)}/</code>.</span>
            <input type="file" id="photo-files" accept="image/*" multiple hidden>
        </div>
        <div class="photo-grid">${photos.map((p, i) => `
            <button type="button" class="photo" data-i="${i}" title="${esc(p.name)}">
                <img src="${p.url}" alt="${esc(caption(p.name))}" loading="lazy">
                <span>${esc(caption(p.name))}</span>
            </button>`).join('')}</div>`;

    el.querySelector('.photo-grid').addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (b) openLightbox(photos, +b.dataset.i);
    });
    const picker = el.querySelector('#photo-files');
    el.querySelector('#add-photos').onclick = () => picker.click();
    picker.onchange = async () => {
        const files = [...picker.files];
        if (!files.length) return;
        const taken = new Set(names.map(n => n.toLowerCase()));
        try {
            for (const f of files) {
                // Never overwrite: 'IMG_1.jpg' becomes 'IMG_1 (2).jpg' if the name is already used.
                let name = f.name;
                const dot = name.lastIndexOf('.');
                for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${f.name.slice(0, dot)} (${n})${f.name.slice(dot)}`;
                taken.add(name.toLowerCase());
                await fs.writeText(`${dir}/${name}`, f);
            }
            toast(`Added ${files.length} photo${files.length === 1 ? '' : 's'}`, 'ok');
        } catch (err) {
            toast(`Couldn't add photos: ${err.message}`, 'bad');
        }
        renderPhotos(el, v);
    };
}

function openLightbox(photos, start) {
    let i = start;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `
        <button type="button" class="lb-close" aria-label="Close" title="Close (Esc)">✕</button>
        <button type="button" class="lb-prev" aria-label="Previous photo" title="Previous (←)">‹</button>
        <figure><img alt=""><figcaption></figcaption></figure>
        <button type="button" class="lb-next" aria-label="Next photo" title="Next (→)">›</button>`;
    const img = box.querySelector('img'), cap = box.querySelector('figcaption');
    const show = () => {
        img.src = photos[i].url;
        img.alt = caption(photos[i].name);
        cap.textContent = `${i + 1} of ${photos.length} · ${photos[i].name}`;
    };
    const step = d => { i = (i + d + photos.length) % photos.length; show(); };
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); closeBox = null; };
    const onKey = e => {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
    };
    box.querySelector('.lb-close').onclick = close;
    box.querySelector('.lb-prev').onclick = () => step(-1);
    box.querySelector('.lb-next').onclick = () => step(1);
    box.addEventListener('click', e => { if (e.target === box) close(); }); // click outside the photo
    document.addEventListener('keydown', onKey);
    closeBox?.();
    closeBox = close;
    document.body.appendChild(box);
    show();
}
