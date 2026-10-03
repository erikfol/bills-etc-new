// Mini-split heat pumps (Utilities → Electric → Mini-Splits): inputs/electric/minisplits.json.
// Each unit: {id, name, brand, indoorModel, outdoorModel, btu, tons, coverage, seer2, hspf2, status, installed,
// notes, log: [{date (YYYY-MM-DD), work, cost, notes}]}.
import * as fs from './fs.js';

export const EQUIPMENT_PATH = 'inputs/electric/minisplits.json';

export async function loadUnits() {
    const text = await fs.readText(EQUIPMENT_PATH);
    if (text == null) return null;
    const data = JSON.parse(text);
    return (Array.isArray(data.units) ? data.units : []).map(u => ({ log: [], ...u }));
}

export async function saveUnits(units) {
    await fs.writeText(EQUIPMENT_PATH, JSON.stringify({
        _readme: 'Mini-split heat pumps for the Utilities → Electric → Mini-Splits page. "log" is the maintenance history.',
        units,
    }, null, 2) + '\n');
}

/** 'Living room' → 'living-room', unique among the existing ids. */
export function unitId(name, taken) {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unit';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
}
