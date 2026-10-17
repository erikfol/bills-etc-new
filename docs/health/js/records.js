// Health records: one CSV per section in inputs/health/ of the connected folder (kept out of git like all of inputs/).
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';

export const HEALTH_DIR = 'inputs/health';
export const LOCATIONS_PATH = `${HEALTH_DIR}/locations.json`;
const DEFAULT_LOCATIONS = ['Head', 'Lips', 'Stomach', 'Arm', 'Leg', 'Penis'];

// Column kinds are the shared record table's (shared/js/recordtable.js).
export const SECTIONS = [
    { id: 'general', label: 'General Health', path: `${HEALTH_DIR}/general_health.csv`, columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Location', kind: 'choice' },
        { name: 'Description', kind: 'text' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
    { id: 'dental', label: 'Dental', path: `${HEALTH_DIR}/dental.csv`, columns: [
        { name: 'Start', kind: 'date' },
        { name: 'End', kind: 'end' },
        { name: 'Description', kind: 'text' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
    { id: 'eye', label: 'Eye', path: `${HEALTH_DIR}/eye.csv`, columns: [
        { name: 'Start', kind: 'date' },
        { name: 'End', kind: 'end' },
        { name: 'Description', kind: 'text' },
        { name: 'Additional Notes', kind: 'text' },
    ] },
];

const names = section => section.columns.map(c => c.name);

/** Rows of a section's file ([] when it doesn't exist yet); columns the file lacks read as blank. */
export async function loadRecords(section) {
    const text = await fs.readText(section.path);
    if (text === null) return [];
    return parseCSV(text).rows.map(r => Object.fromEntries(names(section).map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(section, rows) {
    await fs.writeText(section.path, toCSV(names(section), [...rows].sort(newestFirst(section.columns))));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

export async function loadLocations() {
    const text = await fs.readText(LOCATIONS_PATH);
    if (text === null) return [...DEFAULT_LOCATIONS];
    const list = JSON.parse(text).locations;
    return Array.isArray(list) ? list : [...DEFAULT_LOCATIONS];
}

export async function saveLocations(list) {
    await fs.writeText(LOCATIONS_PATH, JSON.stringify({ locations: list }, null, 2) + '\n');
}
