// House: the list (each house's information, service companies, and per area its information) in
// inputs/house/house.json, plus one records CSV per house and area next to it (and a maintenance CSV for areas with
// a Maintenance table). An area is one page: a tab, or one part (pill) of a tab. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const HOUSE_DIR = 'inputs/house';
export const HOUSE_PATH = `${HOUSE_DIR}/house.json`;

// The Overview's information fields a new house starts with (any can be renamed or removed).
// (Purchase, mortgage, value and taxes are on the Financing tab.)
export const FIELDS = ['Address', 'Year Built', 'Style', 'Bedrooms', 'Bathrooms', 'Square Footage', 'Lot Size', 'Stories',
    'Basement', 'Garage', 'Notes'];

// The tabs after the Overview. Each is a page with its own information (starting fields below), photos and records
// table — or, with `parts`, a row of pills (like Utilities → Electric's Bills / Mini-Splits), each part such a page.
// Parts keep their data under their own id, so part and tab ids must all differ.
// actions: offered in the records table's Action column (anything else can be typed).
// improvements: the page also has a Future improvements section (views/improvements.js).
// maintenance: the page also has a Maintenance table; with `due`, a banner at the top that's green once there's an
// entry dated this year, red from the 1st of due.month (1 = January) while there's none, and green before then.
// maintenanceNote: a line shown at the top of the Maintenance section.
// boxes: several information boxes instead of one [{ key, label, fields }], each kept under house.areas[<id>][key].
// gallery: { label, noun } for the photos section (default Photos). records: false = no records table.
// A tab or part with `table` (its columns) is just that one table, kept in <house>-<its id>.csv. The tab with
// `projects` is the Projects list and pages (views/projects.js).
const UPDATE_LOCATIONS = ['Whole house', 'Kitchen', 'Living room', 'Dining room', 'Bedroom', 'Bathroom', 'Basement', 'Garage',
    'Attic', 'Outside', 'Yard'];
const UPDATE_COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Update', kind: 'text' },
    { name: 'Location', kind: 'suggest', suggestions: UPDATE_LOCATIONS },
    { name: 'Additional Notes', kind: 'text' },
];
const FUTURE_UPDATE_COLUMNS = [
    { name: 'Planned Date', kind: 'date' },
    { name: 'Update', kind: 'text' },
    { name: 'Location', kind: 'suggest', suggestions: UPDATE_LOCATIONS },
    { name: 'Project', kind: 'choice', projects: true }, // a project's title (Projects tab), linked to its page
    { name: 'Notes', kind: 'text' },
];
export const AREAS = [
    { id: 'financing', label: 'Financing', records: false, gallery: { label: 'Documents & photos', noun: 'image' },
        boxes: [
            { key: 'info', label: 'Mortgage', fields: ['Purchase Date', 'House Cost', 'Down Payment', 'Loan Amount', 'Rate', 'Term',
                'Monthly Principal & Interest', 'Escrow Monthly', 'Monthly Payment', 'Lender / Servicer', 'Notes'] },
            { key: 'closing', label: 'Closing', fields: ['Closed On', 'Cash to Close', 'Closing Costs', 'Down Payment', 'Deposit',
                'Seller Credit', 'Notes'] },
            { key: 'taxes', label: 'Value & Taxes', fields: ['Assessed Value', 'Property Tax', 'Notes'] },
        ] },
    { id: 'updates', label: 'Updates', parts: [
        { id: 'updates-done', label: 'Updates Done', icon: '✅', table: UPDATE_COLUMNS },
        { id: 'future-updates', label: 'Future Updates', icon: '🗓️', table: FUTURE_UPDATE_COLUMNS },
    ] },
    { id: 'projects', label: 'Projects', projects: true },
    { id: 'heating', label: 'Heating/Cooling', parts: [
        { id: 'oil-furnace', label: 'Oil furnace', icon: '🔥',
            fields: ['Heating System', 'Fuel', 'Boiler / Furnace Make', 'Model', 'Installed', 'Oil Tank Size', 'Thermostats', 'Notes'],
            actions: ['Boiler / furnace service', 'Oil filter', 'Nozzle', 'Chimney cleaning', 'Thermostat', 'Repair'],
            maintenance: true, due: { what: 'Oil furnace maintenance', month: 9 },
            maintenanceNote: 'Must be cleaned every year by professional' },
        { id: 'mini-split', label: 'Mini-split', icon: '❄️',
            fields: ['Cooling System', 'Mini-split Units', 'Installed', 'Filter Size', 'Notes'],
            actions: ['Mini-split cleaning', 'Filter change', 'Repair'],
            maintenance: true, due: { what: 'Mini-split maintenance', month: 5 },
            maintenanceNote: 'Must be cleaned every year by professional' },
        { id: 'water-heater', label: 'Water heater', icon: '🚿',
            fields: ['Hot Water', 'Water Heater Tank', 'Installed', 'Notes'],
            actions: ['Flush tank', 'Element / thermostat', 'Anode rod', 'Replace', 'Repair'],
            maintenance: true, improvements: true,
            maintenanceNote: 'Must be drained every year, can be done DIY' },
    ] },
    { id: 'septic', label: 'Septic',
        fields: ['Tank Size', 'Tank Material', 'Tank Location', 'Leach Field Location', 'Installed', 'Pump Every', 'Notes'],
        actions: ['Pumped', 'Inspection', 'Effluent filter cleaned', 'Baffle repair', 'Riser / cover', 'Repair'],
        maintenance: true, maintenanceNote: 'Must be pumped every 7 years by a professional' },
];

/** Updates → Future Updates, whose Project column links a planned update to a project. */
export const FUTURE_UPDATES = AREAS.find(t => t.id === 'updates').parts.find(p => p.id === 'future-updates');

// The Projects tab's projects, kept on the house in house.json as areas.projects.items:
// [{ id, title, status, text (plan & notes), materials: [{ Brand, Item, Quantity, 'Size / Spec', Price (each), Source, Link, Notes }],
//    specs: [{ label, value }] }];
// each project's photos and sketches in its own folder.
export const houseProjects = h => h.areas?.projects?.items ?? [];
export const projectDir = (h, p) => `${HOUSE_DIR}/projects/${h.id}-${p.id}`;
export const PROJECT_SPECS = ['Dimensions', 'Notes']; // a new project's starting Measurements & specs fields
export const MATERIAL_COLUMNS = [
    { name: 'Brand', kind: 'suggest' },
    { name: 'Item', kind: 'text' },
    { name: 'Quantity', kind: 'suggest' },
    { name: 'Size / Spec', kind: 'suggest' },
    { name: 'Price', kind: 'money' },
    { name: 'Source', kind: 'suggest' },
    { name: 'Link', kind: 'link' },
    { name: 'Notes', kind: 'text' },
];

/** A material's quantity as a number ('3', '2 bags', '1.5', '3/4', '1 1/2'); blank or no number counts as 1. */
export function quantityOf(v) {
    const m = /^\s*(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?/.exec(String(v ?? '').replace(/,/g, ''));
    if (!m) return 1;
    if (m[4]) return +m[4] ? +m[1] / +m[4] : +m[1];
    return +m[1] + (m[2] && +m[3] ? +m[2] / +m[3] : 0);
}

/** What a material costs: its price times its quantity, or '' when it has no price. */
export const materialCost = r => {
    const price = String(r.Price ?? '').trim();
    return price === '' || Number.isNaN(Number(price)) ? '' : Number(price) * quantityOf(r.Quantity);
};

// Offered in a future improvement's (and a project's) Status (anything else can be typed). 'Done' ones are shown crossed out.
export const IMPROVEMENT_STATUSES = ['Idea', 'Researching', 'Getting quotes', 'Planned', 'In progress', 'Done'];

/** An area's future improvements on house `h`: [{ id, title, status, cost, text }]. */
export const areaImprovements = (h, a) => h.areas?.[a.id]?.improvements ?? [];

const blank = fields => fields.map(label => ({ label, value: '' }));

/** An area's information boxes: its `boxes`, or one box of its `fields`. */
export const areaBoxes = a => a.boxes || [{ key: 'info', label: `${a.label} information`, fields: a.fields }];

/** One information box of an area on house `h` (its starting fields until saved). */
export const areaInfo = (h, a, box = areaBoxes(a)[0]) => h.areas?.[a.id]?.[box.key] ?? blank(box.fields);

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

const doneBy = h => ['Me', ...(h.places || []).map(p => p.name)];

export const recordColumns = (h, a) => [
    { name: 'Date', kind: 'date' },
    { name: 'Action', kind: 'suggest', suggestions: a.actions },
    { name: 'Done By', kind: 'suggest', suggestions: doneBy(h) },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

export const maintenancePath = (h, a) => `${HOUSE_DIR}/${h.id}-${a.id}-maintenance.csv`;

export const maintenanceColumns = h => [
    { name: 'Date', kind: 'date' },
    { name: 'Done By', kind: 'suggest', suggestions: doneBy(h) },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

async function readRows(path, cols, track) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return [];
    const names = cols.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

async function writeRows(path, cols, rows) {
    await writeTracked(path, toCSV(cols.map(c => c.name), rows));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

export const loadRecords = (h, a, track = true) => readRows(recordsPath(h, a), recordColumns(h, a), track);
export const saveRecords = (h, a, rows) => writeRows(recordsPath(h, a), recordColumns(h, a), rows);
export const tablePath = (h, t) => `${HOUSE_DIR}/${h.id}-${t.id}.csv`;
export const loadTable = (h, t, track = true) => readRows(tablePath(h, t), t.table, track);
export const saveTable = (h, t, rows) => writeRows(tablePath(h, t), t.table, rows);
export const loadMaintenance = (h, a, track = true) => readRows(maintenancePath(h, a), maintenanceColumns(h), track);
export const saveMaintenance = (h, a, rows) => writeRows(maintenancePath(h, a), maintenanceColumns(h), rows);

/**
 * The banner at the top of a page with maintenance `due` (see AREAS), from the rows with a YYYY-MM-DD Date:
 * { level, done, last } — level 'done' (green) when there's an entry dated this year, else 'due' (red) from the 1st of
 * due.month, else 'later' (green); done = this year's latest entry, last = the latest entry ever (either may be missing).
 * Uses nothing outside itself: the phone copy (shared/js/phonecopy.js) embeds it as text.
 */
export function maintenanceStatus(rows, due, today = new Date()) {
    const dated = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.Date || '')).sort((a, b) => b.Date.localeCompare(a.Date));
    const done = dated.find(r => r.Date.slice(0, 4) === String(today.getFullYear()));
    return { level: done ? 'done' : today.getMonth() + 1 >= due.month ? 'due' : 'later', done, last: dated[0] };
}
