// Pets: the list (with each pet's information) in inputs/pets/pets.json, and one records CSV per pet next to it.
// inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const PETS_DIR = 'inputs/pets';
export const PETS_PATH = `${PETS_DIR}/pets.json`;

// The information fields a new pet starts with (any can be renamed or removed).
export const FIELDS = ['Species', 'Breed', 'Sex', 'Birthday', 'Color', 'Weight', 'Microchip', 'Adopted', 'Vet', 'Notes'];

const blankInfo = () => FIELDS.map(label => ({ label, value: '' }));

// Used until pets.json is first saved.
const STARTING_PETS = ['Jackie', 'Castle', 'Kona', 'Cosmo', 'Peaches'].map(name => ({ id: name.toLowerCase(), name, info: blankInfo() }));

/** track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing. */
export async function loadPets(track = true) {
    const text = track ? await readTracked(PETS_PATH) : await fs.readText(PETS_PATH);
    if (text === null) return structuredClone(STARTING_PETS);
    const list = JSON.parse(text).pets;
    return Array.isArray(list) ? list : structuredClone(STARTING_PETS);
}

export async function savePets(list) {
    await writeTracked(PETS_PATH, JSON.stringify({ pets: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/** A new pet with a unique id made from its name. */
export function newPet(list, name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pet';
    let id = base;
    for (let n = 2; list.some(p => p.id === id); n++) id = `${base}-${n}`;
    return { id, name, info: blankInfo() };
}

/**
 * Age on `today` from a Birthday typed as 2018-03-05, 3/5/2018, Mar 5 2018, March 2018, 3/2018 or just 2018:
 * '8 years, 7 months' ('about 8 years' when only the year is known); null if it can't be read or is in the future.
 * Uses nothing outside itself: the phone copy (shared/js/phonecopy.js) embeds it as text.
 */
export function ageText(birthday, today = new Date()) {
    const s = String(birthday ?? '').trim();
    const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mon = w => MON.indexOf(w.slice(0, 3).toLowerCase());
    let y, m = -1, d = 1, m_;
    if ((m_ = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s))) [y, m, d] = [+m_[1], m_[2] - 1, +(m_[3] || 1)];
    else if ((m_ = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [y, m, d] = [+m_[3], m_[1] - 1, +m_[2]];
    else if ((m_ = /^(\d{1,2})\/(\d{4})$/.exec(s))) [y, m] = [+m_[2], m_[1] - 1];
    else if ((m_ = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) [y, m, d] = [+m_[3], mon(m_[1]), +m_[2]];
    else if ((m_ = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(s))) [y, m, d] = [+m_[3], mon(m_[2]), +m_[1]];
    else if ((m_ = /^([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(s))) [y, m] = [+m_[2], mon(m_[1])];
    else if ((m_ = /^(\d{4})$/.exec(s))) y = +m_[1];
    else return null;
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (m === -1) { // year only
        const years = today.getFullYear() - y;
        return years < 0 ? null : years === 0 ? 'under a year' : `about ${plural(years, 'year')}`;
    }
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    let months = (today.getFullYear() - y) * 12 + (today.getMonth() - m);
    if (today.getDate() < d) months--; // not yet reached this month's birthday day
    if (months < 0) return null;
    const years = Math.floor(months / 12), rest = months % 12;
    if (!years) return rest ? plural(rest, 'month') : 'under a month';
    return rest ? `${plural(years, 'year')}, ${plural(rest, 'month')}` : plural(years, 'year');
}

export const recordsPath = p => `${PETS_DIR}/${p.id}-records.csv`;
export const photosDir = p => `${PETS_DIR}/photos/${p.id}`;

export const RECORD_COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Other Notes', kind: 'text' },
];

export async function loadRecords(p, track = true) {
    const text = track ? await readTracked(recordsPath(p)) : await fs.readText(recordsPath(p));
    if (text === null) return [];
    const names = RECORD_COLUMNS.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(p, rows) {
    await writeTracked(recordsPath(p), toCSV(RECORD_COLUMNS.map(c => c.name), [...rows].sort(newestFirst(RECORD_COLUMNS))));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}
