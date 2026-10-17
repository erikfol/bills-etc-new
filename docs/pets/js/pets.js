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

export const recordsPath = p => `${PETS_DIR}/${p.id}-records.csv`;

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
