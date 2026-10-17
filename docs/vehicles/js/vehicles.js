// Vehicles: the list (with each vehicle's information) in inputs/vehicles/vehicles.json, and one maintenance CSV
// per vehicle next to it. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { newestFirst } from '../../shared/js/recordtable.js';
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

export async function loadMaintenance(v, track = true) {
    const text = track ? await readTracked(maintenancePath(v)) : await fs.readText(maintenancePath(v));
    if (text === null) return [];
    const names = maintenanceColumns(v).map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

export async function saveMaintenance(v, rows) {
    const cols = maintenanceColumns(v);
    await writeTracked(maintenancePath(v), toCSV(cols.map(c => c.name), [...rows].sort(newestFirst(cols))));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}
