// House: the list (with each house's information, service companies, guides and notes) in inputs/house/house.json,
// and one maintenance CSV per house next to it. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const HOUSE_DIR = 'inputs/house';
export const HOUSE_PATH = `${HOUSE_DIR}/house.json`;

// The information fields a new house starts with (any can be renamed or removed).
export const FIELDS = ['Address', 'Year Built', 'Style', 'Bedrooms', 'Bathrooms', 'Square Footage', 'Lot Size', 'Stories',
    'Basement', 'Garage', 'Heating', 'Cooling', 'Water Heater', 'Water Source', 'Sewer / Septic', 'Roof', 'Siding',
    'Foundation', 'Electrical Panel', 'Purchase Date', 'Purchase Price', 'Notes'];

// Offered in the maintenance table (anything else can be typed).
const ACTIONS = ['Furnace / boiler service', 'Furnace filter', 'Mini-split cleaning', 'Chimney cleaning', 'Septic pumped',
    'Water heater', 'Water test', 'Gutter cleaning', 'Roof repair', 'Plumbing', 'Electrical', 'Painting', 'Appliance repair',
    'Smoke / CO detectors', 'Lawn / yard', 'Snow removal', 'Pest control'];
const AREAS = ['Whole house', 'Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Basement', 'Attic', 'Garage', 'Roof',
    'Exterior', 'Yard'];

const blankInfo = () => FIELDS.map(label => ({ label, value: '' }));

// Used until house.json is first saved.
const STARTING_HOUSES = [{ id: 'home', name: 'Home', info: blankInfo() }];

/** track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing. */
export async function loadHouses(track = true) {
    const text = track ? await readTracked(HOUSE_PATH) : await fs.readText(HOUSE_PATH);
    if (text === null) return structuredClone(STARTING_HOUSES);
    const list = JSON.parse(text).houses;
    return Array.isArray(list) ? list : structuredClone(STARTING_HOUSES);
}

export async function saveHouses(list) {
    await writeTracked(HOUSE_PATH, JSON.stringify({ houses: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/** A new house with a unique id made from its name. */
export function newHouse(list, name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'house';
    let id = base;
    for (let n = 2; list.some(h => h.id === id); n++) id = `${base}-${n}`;
    return { id, name, info: blankInfo() };
}

/** 'Year Built' 1985 (or a date with a year in it) → '41 years'; null if there's no year or it's in the future. */
export function houseAge(value, today = new Date()) {
    const m = /\b(1[6-9]\d\d|20\d\d)\b/.exec(String(value ?? ''));
    if (!m) return null;
    const years = today.getFullYear() - +m[1];
    return years < 0 ? null : years === 0 ? 'under a year' : `${years} year${years === 1 ? '' : 's'}`;
}

export const maintenancePath = h => `${HOUSE_DIR}/${h.id}-maintenance.csv`;
export const photosDir = h => `${HOUSE_DIR}/photos/${h.id}`;
export const guideDir = (h, g) => `${HOUSE_DIR}/guides/${h.id}/${g.id}`;
export const noteDir = (h, n) => `${HOUSE_DIR}/notes/${h.id}/${n.id}`;

// For the views shared with Vehicles (service places, guides, notes).
export const STORE = {
    save: list => saveHouses(list),
    guideDir,
    noteDir,
    noPlaces: 'No companies yet. Press Edit to add a plumber, electrician, oil company…',
    noNotes: 'No notes yet. Add things you noticed, projects, questions for a contractor, ideas…',
};

export const maintenanceColumns = h => [
    { name: 'Date', kind: 'date' },
    { name: 'Action', kind: 'suggest', suggestions: ACTIONS },
    { name: 'Area', kind: 'suggest', suggestions: AREAS },
    { name: 'Done By', kind: 'suggest', suggestions: ['Me', ...(h.places || []).map(p => p.name)] },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

export async function loadMaintenance(h, track = true) {
    const text = track ? await readTracked(maintenancePath(h)) : await fs.readText(maintenancePath(h));
    if (text === null) return [];
    const names = maintenanceColumns(h).map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

export async function saveMaintenance(h, rows) {
    const cols = maintenanceColumns(h);
    await writeTracked(maintenancePath(h), toCSV(cols.map(c => c.name), [...rows].sort(newestFirst(cols))));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}
