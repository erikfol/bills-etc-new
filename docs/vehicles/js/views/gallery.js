// Image galleries (a vehicle's Photos, a guide's images): the images in one folder, shown as thumbnails; click one
// to see it large. "＋ Add …" copies picked images into that folder (it never deletes; remove an image from the
// folder itself).
import * as fs from '../../../bills-etc/js/fs.js';
import { esc, toast } from '../../../bills-etc/js/util.js';

const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp)$/i;
const open = new Map(); // gallery element → its object URLs, released when it re-draws or the page changes
let closeBox = null; // closes an open large image

const release = el => { open.get(el)?.forEach(u => URL.revokeObjectURL(u)); open.delete(el); };

/** Release every gallery's images (when leaving the page). */
export function releaseGalleries() {
    [...open.keys()].forEach(release);
    closeBox?.();
}

/** '03-engine-ford-logo.png' → 'engine ford logo'. */
const caption = name => name.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ');
const stem = n => n.replace(/\.[^.]+$/, '');

/** Image file names in `dir`, in order ('x.png' before 'x (2).png'). Missing folder → []. */
export async function listImages(dir) {
    return (await fs.listFiles(dir, '')).filter(n => IMAGE.test(n))
        .sort((a, b) => stem(a).localeCompare(stem(b), undefined, { numeric: true }));
}

/** Draw the gallery for `dir` into `el`. noun: 'photo' / 'image'; onChange(count) after images are added. */
export async function renderGallery(el, dir, { noun = 'photo', onChange } = {}) {
    release(el);
    const names = await listImages(dir);
    const images = [], urls = [];
    for (const name of names) {
        const file = await fs.readFile(`${dir}/${name}`);
        if (!file) continue;
        const url = URL.createObjectURL(file);
        urls.push(url);
        images.push({ name, url });
    }
    open.set(el, urls);
    const n = images.length, plural = c => `${c} ${noun}${c === 1 ? '' : 's'}`;
    el.innerHTML = `
        <div class="row table-tools">
            <button type="button" class="small" data-add-images>＋ Add ${noun}s</button>
            <span class="muted edit-hint">${n ? `${plural(n)} · click one to see it large.` : `No ${noun}s yet.`} Saved in <code>${esc(dir)}/</code>.</span>
            <input type="file" accept="image/*" multiple hidden>
        </div>
        ${n ? `<div class="photo-grid">${images.map((p, i) => `
            <button type="button" class="photo" data-i="${i}" title="${esc(p.name)}">
                <img src="${p.url}" alt="${esc(caption(p.name))}" loading="lazy">
                <span>${esc(caption(p.name))}</span>
            </button>`).join('')}</div>` : ''}`;

    el.querySelector('.photo-grid')?.addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (b) openLightbox(images, +b.dataset.i);
    });
    const picker = el.querySelector('input[type=file]');
    el.querySelector('[data-add-images]').onclick = () => picker.click();
    picker.onchange = async () => {
        const files = [...picker.files];
        if (!files.length) return;
        const taken = new Set(names.map(x => x.toLowerCase()));
        try {
            for (const f of files) {
                // Never overwrite: 'IMG_1.jpg' becomes 'IMG_1 (2).jpg' if the name is already used.
                let name = f.name;
                const dot = name.lastIndexOf('.');
                for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${f.name.slice(0, dot)} (${k})${f.name.slice(dot)}`;
                taken.add(name.toLowerCase());
                await fs.writeText(`${dir}/${name}`, f);
            }
            toast(`Added ${plural(files.length)}`, 'ok');
            window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
        } catch (err) {
            toast(`Couldn't add ${noun}s: ${err.message}`, 'bad');
        }
        await renderGallery(el, dir, { noun, onChange });
        onChange?.(taken.size);
    };
}

function openLightbox(images, start) {
    let i = start;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `
        <button type="button" class="lb-close" aria-label="Close" title="Close (Esc)">✕</button>
        <button type="button" class="lb-prev" aria-label="Previous" title="Previous (←)">‹</button>
        <figure><img alt=""><figcaption></figcaption></figure>
        <button type="button" class="lb-next" aria-label="Next" title="Next (→)">›</button>`;
    const img = box.querySelector('img'), cap = box.querySelector('figcaption');
    const show = () => {
        img.src = images[i].url;
        img.alt = caption(images[i].name);
        cap.textContent = `${i + 1} of ${images.length} · ${images[i].name}`;
    };
    const step = d => { i = (i + d + images.length) % images.length; show(); };
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); closeBox = null; };
    const onKey = e => {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
    };
    box.querySelector('.lb-close').onclick = close;
    box.querySelector('.lb-prev').onclick = () => step(-1);
    box.querySelector('.lb-next').onclick = () => step(1);
    box.addEventListener('click', e => { if (e.target === box) close(); }); // click outside the image
    document.addEventListener('keydown', onKey);
    closeBox?.();
    closeBox = close;
    document.body.appendChild(box);
    show();
}
