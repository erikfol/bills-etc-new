// Vehicles: the list (with each vehicle's information) in inputs/vehicles/vehicles.json, and one maintenance CSV
// per vehicle next to it. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const VEHICLES_DIR = 'inputs/vehicles';
export const VEHICLES_PATH = `${VEHICLES_DIR}/vehicles.json`;

// What each kind of vehicle tracks and the information fields a new one starts with (any can be renamed or removed).
export const TYPES = {
    car: {
        label: 'Car / truck', meter: 'Mileage',
        fields: ['Year', 'Make', 'Model', 'Trim', 'Engine', 'Transmission', 'Color', 'VIN', 'License Plate',
            'Registration Expires', 'Purchase Date', 'Notes'],
        actions: ['Oil change', 'Tire rotation', 'New tires', 'Brakes', 'Wiper blades', 'Engine air filter',
            'Cabin air filter', 'Battery', 'Inspection', 'Registration', 'Detailing'],
    },
    boat: {
        label: 'Boat', meter: 'Engine Hours',
        fields: ['Year', 'Make', 'Model', 'Style', 'Color', 'Length', 'Beam', 'Hull ID (HIN)', 'Bow Number', 'Engine',
            'Horsepower', 'Fuel', 'Drive', 'Features', 'Trailer', 'Registration Expires', 'Purchase Date', 'Notes'],
        actions: ['Winterize', 'De-winterize', 'Oil change', 'Lower unit oil', 'Impeller', 'Spark plugs', 'Fuel filter',
            'Battery', 'Bottom paint', 'Trailer bearings', 'Registration', 'Cleaning'],
    },
    other: {
        label: 'Other', meter: 'Mileage',
        fields: ['Year', 'Make', 'Model', 'Color', 'Serial Number', 'Registration Expires', 'Purchase Date', 'Notes'],
        actions: [],
    },
};

const blankInfo = (type, known = {}) => TYPES[type].fields.map(label => ({ label, value: known[label] ?? '' }));

// Used until vehicles.json is first saved.
const STARTING_VEHICLES = [
    { id: 'honda-accord', name: '2018 Honda Accord Sport (2.0T)', type: 'car', meter: 'Mileage',
        info: blankInfo('car', { Year: '2018', Make: 'Honda', Model: 'Accord', Trim: 'Sport 2.0T', Engine: '2.0L turbo 4-cylinder' }) },
    { id: 'four-winns', name: '1996 Four Winns 205 Sundowner', type: 'boat', meter: 'Engine Hours',
        info: blankInfo('boat', { Year: '1996', Make: 'Four Winns', Model: '205 Sundowner' }) },
];

/** track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing. */
export async function loadVehicles(track = true) {
    const text = track ? await readTracked(VEHICLES_PATH) : await fs.readText(VEHICLES_PATH);
    if (text === null) return structuredClone(STARTING_VEHICLES);
    const list = JSON.parse(text).vehicles;
    return Array.isArray(list) ? list : structuredClone(STARTING_VEHICLES);
}

export async function saveVehicles(list) {
    await writeTracked(VEHICLES_PATH, JSON.stringify({ vehicles: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/** A new vehicle with a unique id made from its name. */
export function newVehicle(list, name, type) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
    let id = base;
    for (let n = 2; list.some(v => v.id === id); n++) id = `${base}-${n}`;
    return { id, name, type, meter: TYPES[type].meter, info: blankInfo(type) };
}

// What the shared views (places, guides, notes) save with and say; another app (House) passes its own.
export const STORE = {
    save: list => saveVehicles(list),
    guideDir: (v, g) => guideDir(v, g),
    noteDir: (v, n) => noteDir(v, n),
    noPlaces: 'No places yet. Press Edit to add a shop or marina.',
    noNotes: 'No notes yet. Add things you noticed, questions for the marina, ideas…',
};

export const maintenancePath = v => `${VEHICLES_DIR}/${v.id}-maintenance.csv`;
export const photosDir = v => `${VEHICLES_DIR}/photos/${v.id}`;
export const guideDir = (v, g) => `${VEHICLES_DIR}/guides/${v.id}/${g.id}`;
export const noteDir = (v, n) => `${VEHICLES_DIR}/notes/${v.id}/${n.id}`;

/** Maintenance columns; the second one is what the vehicle tracks (Mileage, Engine Hours). */
export const maintenanceColumns = v => [
    { name: 'Date', kind: 'date' },
    { name: v.meter || 'Mileage', kind: 'number' },
    { name: 'Action', kind: 'suggest', suggestions: TYPES[v.type]?.actions || [] },
    { name: 'Location', kind: 'suggest', suggestions: (v.places || []).map(p => p.name) }, // where it was done
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

/** A CSV's rows with just these columns ([] if there's no file yet). */
async function loadRows(path, cols, track) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return [];
    const names = cols.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

async function saveRows(path, cols, rows) {
    await writeTracked(path, toCSV(cols.map(c => c.name), rows));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

export const loadMaintenance = (v, track = true) => loadRows(maintenancePath(v), maintenanceColumns(v), track);
export const saveMaintenance = (v, rows) => saveRows(maintenancePath(v), maintenanceColumns(v), rows);

// Cars also keep a mileage log (Date, Mileage) whenever it's read off the dash; the latest is the current mileage.
export const hasMileageLog = v => v.type === 'car';
export const mileagePath = v => `${VEHICLES_DIR}/${v.id}-mileage.csv`;
export const MILEAGE_COLUMNS = [{ name: 'Date', kind: 'date' }, { name: 'Mileage', kind: 'number' }];
export const loadMileage = (v, track = true) => loadRows(mileagePath(v), MILEAGE_COLUMNS, track);
export const saveMileage = (v, rows) => saveRows(mileagePath(v), MILEAGE_COLUMNS, rows);

/** The newest dated reading ({ Date, Mileage }), or null. */
export const latestMileage = rows => rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.Date || '') && r.Mileage !== '')
    .sort((a, b) => b.Date.localeCompare(a.Date))[0] || null;

const infoValue = (v, label) => (v.info || []).find(f => f.label.trim().toLowerCase() === label.toLowerCase())?.value.trim() || '';
const milesOf = x => Number(String(x ?? '').replace(/,/g, '').trim() || NaN);

/** A day typed into the information ('2018-09-05', 'Sep 05 2018'), or null. */
function parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(text);
    return text && !Number.isNaN(d.getTime()) ? d : null;
}

/** The purchase as a reading ({ day, miles, from: 'bought new, Sep 5, 2018' }), or null without a Purchase Date. */
function purchase(v) {
    const bought = parseDay(infoValue(v, 'Purchase Date'));
    if (!bought) return null;
    const miles = milesOf(infoValue(v, 'Purchase Mileage')) || 0; // 0: bought new
    const day = bought.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return { day: Date.UTC(bought.getFullYear(), bought.getMonth(), bought.getDate()) / 864e5, miles,
        from: miles ? `bought at ${miles.toLocaleString('en-US')} miles, ${day}` : `bought new, ${day}` };
}

/** A dated reading as { day, miles }. */
const point = r => { const [y, m, d] = r.Date.split('-').map(Number); return { day: Date.UTC(y, m - 1, d) / 864e5, miles: milesOf(r.Mileage) }; };

/** Miles a month and a year, on average, from point `a` to point `b`, or null if they're under `minDays` apart. */
function rate(a, b, minDays) {
    const days = b.day - a.day, miles = b.miles - a.miles;
    if (Number.isNaN(miles) || days < minDays) return null;
    const perYear = miles / days * 365.25;
    return { perMonth: Math.round(perYear / 12), perYear: Math.round(perYear) };
}

/**
 * Miles put on a month and a year, on average, from the purchase (the information's Purchase Date, at 0 miles — bought
 * new — or its Purchase Mileage if it has one) to the newest reading: { perMonth, perYear, from: 'bought new, Sep 5,
 * 2018' }, { why } when it can't be worked out, or null with no readings.
 */
export function mileageRate(v, rows) {
    const last = latestMileage(rows);
    if (!last) return null;
    const p = purchase(v);
    if (!p) return { why: 'Needs a Purchase Date in Vehicle information' };
    const r = rate(p, point(last), 28);
    return r ? { ...r, from: p.from } : { why: 'Needs a reading at least a month after the purchase' };
}

/**
 * The mileage log's worked-out columns (shown, never saved): for each reading, the miles a month and a year since the
 * reading before it — the oldest one since the purchase. rows() gives the log as it is now.
 */
export const mileageRateColumns = (v, rows) => {
    const since = r => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.Date || '') || r.Mileage === '') return null;
        const before = latestMileage(rows().filter(x => (x.Date || '') < r.Date));
        const from = before ? point(before) : purchase(v);
        return from && rate(from, point(r), 1);
    };
    return [
        { name: 'Miles per month', kind: 'number', calc: r => since(r)?.perMonth ?? '' },
        { name: 'Miles per year', kind: 'number', calc: r => since(r)?.perYear ?? '' },
    ];
};
