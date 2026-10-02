/**
 * A custom system with cyberware turned off (3b5).
 *
 * A custom sheet cannot have a cyberware table (its layouts are list, grid, notes and
 * inventory), so the body diagram, strain and the installed-implant warnings never reach a
 * custom system. What the part decides today is the shops: without cyberware the
 * ripperdoc's three catalogues are off, and so is the ripperdoc, having nothing left to sell
 * (the rule from 3b4). The built-in systems keep their ripperdocs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { checkDefinition } = require_('../systemBuilder/definition');
const { BUILDING_TYPES } = require_('../buildingTypes');

const NOCHROME = 'sys_aaaaaaaaaaaaaaaa';
const CHROME = 'sys_bbbbbbbbbbbbbbbb';
const NEITHER = 'sys_cccccccccccccccc';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const DOC_STOCK = ['cyberware', 'cyber_mods', 'skillplugs'];

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const def = (parts, buildings) => JSON.stringify({ format: 1, name: 'Hearth', parts, ...(buildings ? { buildings } : {}) });

let db;
beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
  const rows = [
    // Asks for the ripperdoc by its own name while cyberware is off: the part still wins.
    [NOCHROME, def({ cyberware: { on: false } }, { types: { ripperdoc: { name: 'Temple', on: true } } })],
    [CHROME, def({ cyberware: { on: true } })],
    [NEITHER, def({ cyberware: { on: false }, vehicles: { on: false } })],
  ];
  for (const [id, text] of rows) {
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, id, text, text]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
});

const offTypes = (system) => BUILDING_TYPES.filter((t) => !runtime.buildingIn(system, 'types', t.id)).map((t) => t.id);
const offStock = (system) => DOC_STOCK.filter((c) => !runtime.buildingIn(system, 'catalogues', c));

describe('a custom system without cyberware', () => {
  it('has no ripperdoc, and none of its stock, and nothing else goes', () => {
    expect(offTypes(NOCHROME)).toEqual(['ripperdoc']);
    expect(offStock(NOCHROME)).toEqual(DOC_STOCK);
  });

  it('tells the browser, keeping the name for when it comes back', () => {
    expect(runtime.render(NOCHROME).buildings).toEqual({
      types: { ripperdoc: { name: 'Temple', on: false } },
      catalogues: { cyberware: { on: false }, cyber_mods: { on: false }, skillplugs: { on: false } },
    });
  });

  it('loses the garage too when vehicles are off as well', () => {
    expect(offTypes(NEITHER)).toEqual(['ripperdoc', 'garage']);
  });

  it('gets them back when cyberware is turned on', async () => {
    await run(db, 'UPDATE custom_systems SET published = ?, version = 2 WHERE id = ?', [def({ cyberware: { on: true } }), NOCHROME]);
    await new Promise((resolve) => runtime.refresh(db, NOCHROME, resolve));
    expect(offTypes(NOCHROME)).toEqual([]);
    expect(offStock(NOCHROME)).toEqual([]);
  });

  it('cannot have a cyberware table on its sheet, so there is nothing else to hide', () => {
    const sheet = { tabs: ['MAIN'], sections: [{ id: 'chrome', label: 'CHROME', layout: 'cyberware', fields: [] }] };
    expect(checkDefinition({ format: 1, name: 'A', sheet }).problems.map((p) => p.where)).toContain('sheet section chrome, layout');
  });
});

describe('where cyberware is on', () => {
  it('has the ripperdoc and its stock, under the built-ins and a custom system that kept cyberware', () => {
    for (const system of [...BUILT_INS, CHROME]) {
      expect(offTypes(system), system).toEqual([]);
      expect(offStock(system), system).toEqual([]);
    }
  });
});
