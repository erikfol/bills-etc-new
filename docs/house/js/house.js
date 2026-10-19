// House: the list (each house's information, service companies, and per area its information) in
// inputs/house/house.json, plus one records CSV per house and area next to it. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const HOUSE_DIR = 'inputs/house';
export const HOUSE_PATH = `${HOUSE_DIR}/house.json`;

// The Overview's information fields a new house starts with (any can be renamed or removed).
export const FIELDS = ['Address', 'Year Built', 'Style', 'Bedrooms', 'Bathrooms', 'Square Footage', 'Lot Size', 'Stories',
    'Basement', 'Garage', 'Purchase Date', 'Purchase Price', 'Notes'];

// The tabs after the Overview: each has its own information (starting fields below), photos and records table.
// actions: offered in the records table's Action column (anything else can be typed).
// improvements: the tab also has a Future improvements section (views/improvements.js).
export const AREAS = [
    { id: 'heating', label: 'Heating/Cooling',
        fields: ['Heating System', 'Fuel', 'Boiler / Furnace Make', 'Model', 'Installed', 'Oil Tank Size', 'Cooling System',
            'Mini-split Units', 'Filter Size', 'Thermostats', 'Notes'],
        actions: ['Boiler / furnace service', 'Oil filter', 'Nozzle', 'Chimney cleaning', 'Mini-split cleaning', 'Filter change',
            'Thermostat', 'Repair'],
        improvements: true },
    { id: 'septic', label: 'Septic',
        fields: ['Tank Size', 'Tank Material', 'Tank Location', 'Leach Field Location', 'Installed', 'Pump Every', 'Notes'],
        actions: ['Pumped', 'Inspection', 'Effluent filter cleaned', 'Baffle repair', 'Riser / cover', 'Repair'] },
    { id: 'inside', label: 'Other Inside',
        fields: ['Water Heater', 'Water Source', 'Well Pump', 'Water Treatment', 'Electrical Panel', 'Main Breaker',
            'Appliances', 'Smoke / CO Detectors', 'Notes'],
        actions: ['Plumbing', 'Electrical', 'Water heater', 'Water test', 'Appliance repair', 'Painting', 'Flooring',
            'Smoke / CO detectors', 'Repair'] },
    { id: 'outside', label: 'Other Outside',
        fields: ['Roof', 'Roof Installed', 'Siding', 'Gutters', 'Windows', 'Foundation', 'Driveway', 'Deck / Porch', 'Generator', 'Notes'],
        actions: ['Roof repair', 'Gutter cleaning', 'Painting / staining', 'Lawn / yard', 'Tree work', 'Snow removal', 'Driveway',
            'Deck', 'Pest control', 'Repair'] },
];

// Offered in a future improvement's Status (anything else can be typed). 'Done' ones are shown crossed out.
export const IMPROVEMENT_STATUSES = ['Idea', 'Researching', 'Getting quotes', 'Planned', 'In progress', 'Done'];

/** An area's future improvements on house `h`: [{ id, title, status, cost, text }]. */
export const areaImprovements = (h, a) => h.areas?.[a.id]?.improvements ?? [];

const blank = fields => fields.map(label => ({ label, value: '' }));

/** An area's information on house `h` (its starting fields until saved). */
export const areaInfo = (h, a) => h.areas?.[a.id]?.info ?? blank(a.fields);

// Used until house.json is first saved.
const STARTING_HOUSES = [{ id: 'home', name: 'Home', info: blank(FIELDS) }];

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
    return { id, name, info: blank(FIELDS) };
}

/** 'Year Built' 1985 (or a date with a year in it) → '41 years'; null if there's no year or it's in the future. */
export function houseAge(value, today = new Date()) {
    const m = /\b(1[6-9]\d\d|20\d\d)\b/.exec(String(value ?? ''));
    if (!m) return null;
    const years = today.getFullYear() - +m[1];
    return years < 0 ? null : years === 0 ? 'under a year' : `${years} year${years === 1 ? '' : 's'}`;
}

/** Photos of the house (Overview) or of one area. */
export const photosDir = (h, a = null) => `${HOUSE_DIR}/photos/${h.id}${a ? '-' + a.id : ''}`;
export const recordsPath = (h, a) => `${HOUSE_DIR}/${h.id}-${a.id}-records.csv`;

// For the Vehicles service-places view.
export const STORE = {
    save: list => saveHouses(list),
    noPlaces: 'No companies yet. Press Edit to add a plumber, electrician, oil company…',
};

export const recordColumns = (h, a) => [
    { name: 'Date', kind: 'date' },
    { name: 'Action', kind: 'suggest', suggestions: a.actions },
    { name: 'Done By', kind: 'suggest', suggestions: ['Me', ...(h.places || []).map(p => p.name)] },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

export async function loadRecords(h, a, track = true) {
    const text = track ? await readTracked(recordsPath(h, a)) : await fs.readText(recordsPath(h, a));
    if (text === null) return [];
    const names = recordColumns(h, a).map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(h, a, rows) {
    const cols = recordColumns(h, a);
    await writeTracked(recordsPath(h, a), toCSV(cols.map(c => c.name), [...rows].sort(newestFirst(cols))));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}
