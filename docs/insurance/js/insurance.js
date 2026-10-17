// Insurance: the list of policies (each with its information and contacts) in inputs/insurance/insurance.json, and
// one records CSV per policy next to it. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const INSURANCE_DIR = 'inputs/insurance';
export const INSURANCE_PATH = `${INSURANCE_DIR}/insurance.json`;

// The information fields a new policy starts with (any can be renamed, removed or reordered).
export const FIELDS = ['Insurance Company', 'Policy Number', 'Covers', 'Policy Period', 'Renewal Date', 'Premium', 'Paid How',
    'Deductible', 'Coverage Limits', 'Website', 'Notes'];

const blankInfo = () => FIELDS.map(label => ({ label, value: '' }));

// Used until insurance.json is first saved.
const STARTING_POLICIES = [
    { id: 'home', name: 'Home', info: blankInfo() },
    { id: 'auto', name: 'Auto', info: blankInfo() },
    { id: 'boat', name: 'Boat', info: blankInfo() },
];

/** track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing. */
export async function loadPolicies(track = true) {
    const text = track ? await readTracked(INSURANCE_PATH) : await fs.readText(INSURANCE_PATH);
    if (text === null) return structuredClone(STARTING_POLICIES);
    const list = JSON.parse(text).policies;
    return Array.isArray(list) ? list : structuredClone(STARTING_POLICIES);
}

export async function savePolicies(list) {
    await writeTracked(INSURANCE_PATH, JSON.stringify({ policies: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved'));
}

/** A new policy with a unique id made from its name. */
export function newPolicy(list, name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'policy';
    let id = base;
    for (let n = 2; list.some(p => p.id === id); n++) id = `${base}-${n}`;
    return { id, name, info: blankInfo() };
}

export const recordsPath = p => `${INSURANCE_DIR}/${p.id}-records.csv`;
export const documentsDir = p => `${INSURANCE_DIR}/documents/${p.id}`;

// For the Vehicles service-places view (here: agents, claims lines, the company's office).
export const STORE = {
    save: list => savePolicies(list),
    noPlaces: 'No contacts yet. Press Edit to add the agent, the claims line or the company.',
};

export const RECORD_COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Type', kind: 'suggest', suggestions: ['Payment', 'Renewal', 'Claim', 'Policy change', 'Quote', 'Call'] },
    { name: 'Description', kind: 'text' },
    { name: 'Amount', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

export async function loadRecords(p, track = true) {
    const text = track ? await readTracked(recordsPath(p)) : await fs.readText(recordsPath(p));
    if (text === null) return [];
    const names = RECORD_COLUMNS.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(p, rows) {
    await writeTracked(recordsPath(p), toCSV(RECORD_COLUMNS.map(c => c.name), [...rows].sort(newestFirst(RECORD_COLUMNS))));
    window.dispatchEvent(new Event('data-saved'));
}
