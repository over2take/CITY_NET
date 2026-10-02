/**
 * A custom system with vehicles turned off (3b4).
 *
 * Custom systems have no vehicle rows yet (sheets/vehicleSystems.js knows CWN and Cyberpunk RED
 * only), so seating, the vehicle badge and ramming never reach them. What the part decides
 * today is the shops: without vehicles the garage's three catalogues are off, and so is the
 * garage, having nothing left to sell. The render copy says so, so the windows follow without
 * a change of their own. The built-in systems keep their garages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { hasVehicles } = require_('../sheets/vehicleSystems');
const { BUILDING_TYPES } = require_('../buildingTypes');

const NOWHEELS = 'sys_aaaaaaaaaaaaaaaa';
const WHEELS = 'sys_bbbbbbbbbbbbbbbb';
const STUBBORN = 'sys_cccccccccccccccc';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const GARAGE_STOCK = ['vehicles', 'vehicle_fittings', 'vehicle_weapons'];

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const def = (vehiclesOn, buildings) => JSON.stringify({ format: 1, name: 'Hearth', parts: { vehicles: { on: vehiclesOn } }, ...(buildings ? { buildings } : {}) });

let db;
beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
  const rows = [
    [NOWHEELS, def(false, { types: { garage: { name: 'Stables' } } })],
    [WHEELS, def(true)],
    // Asks for the garage's stock by name while vehicles are off: the part still wins.
    [STUBBORN, def(false, { types: { garage: { on: true } }, catalogues: { vehicles: { on: true } } })],
  ];
  for (const [id, text] of rows) {
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, id, text, text]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
});

const offTypes = (system) => BUILDING_TYPES.filter((t) => !runtime.buildingIn(system, 'types', t.id)).map((t) => t.id);
const offStock = (system) => GARAGE_STOCK.filter((c) => !runtime.buildingIn(system, 'catalogues', c));

describe('a custom system without vehicles', () => {
  it('has no garage, and none of its stock, and nothing else goes', () => {
    for (const system of [NOWHEELS, STUBBORN]) {
      expect(offTypes(system), system).toEqual(['garage']);
      expect(offStock(system), system).toEqual(GARAGE_STOCK);
    }
  });

  it('tells the browser, so the windows leave them out', () => {
    expect(runtime.render(NOWHEELS).buildings).toEqual({
      types: { garage: { name: 'Stables', on: false } },
      catalogues: { vehicles: { on: false }, vehicle_fittings: { on: false }, vehicle_weapons: { on: false } },
    });
  });

  it('gets them all back when vehicles are turned on', async () => {
    const text = def(true, { types: { garage: { name: 'Stables' } } });
    await run(db, 'UPDATE custom_systems SET published = ?, version = 2 WHERE id = ?', [text, NOWHEELS]);
    await new Promise((resolve) => runtime.refresh(db, NOWHEELS, resolve));
    expect(offTypes(NOWHEELS)).toEqual([]);
    expect(offStock(NOWHEELS)).toEqual([]);
    expect(runtime.render(NOWHEELS).buildings.types.garage).toEqual({ name: 'Stables' });
  });
});

describe('where vehicles are on', () => {
  it('has the garage and its stock, under the built-ins and a custom system that kept vehicles', () => {
    for (const system of [...BUILT_INS, WHEELS]) {
      expect(offTypes(system), system).toEqual([]);
      expect(offStock(system), system).toEqual([]);
    }
  });

  it('seats vehicles only in the built-in systems that have them, as before', () => {
    expect(hasVehicles('cities_without_number')).toBe(true);
    expect(hasVehicles('cyberpunk_red')).toBe(true);
    for (const system of ['shadowrun_6e', 'generic', WHEELS, NOWHEELS]) expect(hasVehicles(system), system).toBe(false);
  });
});
