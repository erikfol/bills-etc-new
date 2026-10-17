// Pet records: one CSV per pet in inputs/pets/ of the connected folder (kept out of git like all of inputs/).
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const PETS_DIR = 'inputs/pets';
export const TYPES_PATH = `${PETS_DIR}/types.json`;
const DEFAULT_TYPES = ['Vet visit', 'Vaccine', 'Medication', 'Grooming', 'Food', 'Other'];

// Column kinds are the shared record table's (shared/js/recordtable.js).
const COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Type', kind: 'choice' },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

export const SECTIONS = ['Jackie', 'Castle', 'Kona', 'Cosmo', 'Peaches'].map(name => ({
    id: name.toLowerCase(), label: name, path: `${PETS_DIR}/${name.toLowerCase()}.csv`, columns: COLUMNS,
}));

const names = section => section.columns.map(c => c.name);

/** Rows of a pet's file ([] when it doesn't exist yet); columns the file lacks read as blank. */
export async function loadRecords(section) {
    const text = await readTracked(section.path);
    if (text === null) return [];
    return parseCSV(text).rows.map(r => Object.fromEntries(names(section).map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(section, rows) {
    await writeTracked(section.path, toCSV(names(section), [...rows].sort(newestFirst(section.columns))));
    window.dispatchEvent(new Event('data-saved'));
}

export async function loadTypes() {
    const text = await readTracked(TYPES_PATH);
    if (text === null) return [...DEFAULT_TYPES];
    const list = JSON.parse(text).types;
    return Array.isArray(list) ? list : [...DEFAULT_TYPES];
}

export async function saveTypes(list) {
    await writeTracked(TYPES_PATH, JSON.stringify({ types: list }, null, 2) + '\n');
}
