/**
 * The currency a shop catalogue is priced in (3c2a2): each catalogue picks its own, one of the
 * system's currencies, beside its name and on/off in the buildings section, and is priced in
 * the main currency when it says nothing (decided with the user, 2026-10-02). A system with no
 * currencies of its own, as every built-in is, has none: the app's single money.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { catalogueCurrency, ownBuildings } = require_('../systemBuilder/buildings');
const runtime = require_('../systemBuilder/runtime');

const CURRENCIES = [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }];
const HEARTH = {
  format: 1, name: 'Hearth', currencies: CURRENCIES,
  buildings: { catalogues: { cyberware: { name: 'Relics', currency: 'favor' }, weapons: { currency: 'gold' }, armor: { on: false, currency: 'favor' } } },
};

const where = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);

describe('a catalogue\'s currency, in the format', () => {
  it('is one of the system\'s currencies, beside the catalogue\'s name and on/off', () => {
    expect(where(HEARTH)).toEqual([]);
  });

  it('is refused when it is not one of them, or the system has none, or on a building type', () => {
    expect(where({ ...HEARTH, buildings: { catalogues: { gear: { currency: 'silver' } } } }))
      .toEqual(["buildings catalogues gear, currency: Not one of this system's currencies"]);
    expect(where({ format: 1, name: 'A', buildings: { catalogues: { gear: { currency: 'gold' } } } }))
      .toEqual(['buildings catalogues gear, currency: This system has no currencies of its own']);
    expect(where({ ...HEARTH, buildings: { types: { bar: { currency: 'gold' } } } }))
      .toEqual(['buildings types bar, currency: Only "name" and "on" are set here']);
    expect(where({ ...HEARTH, buildings: { catalogues: { gear: { price: 3 } } } }))
      .toEqual(['buildings catalogues gear, price: Only "name", "on" and "currency" are set here']);
  });
});

describe('which currency a catalogue is priced in', () => {
  it('is its own where it names one, and the main currency where it does not', () => {
    expect(catalogueCurrency(HEARTH, 'cyberware')).toBe('favor');
    expect(catalogueCurrency(HEARTH, 'weapons')).toBe('gold');
    expect(catalogueCurrency(HEARTH, 'gear')).toBe('gold');
    // Main currency is the first, whichever it is.
    expect(catalogueCurrency({ ...HEARTH, currencies: [CURRENCIES[1], CURRENCIES[0]] }, 'gear')).toBe('favor');
  });

  it('is none for a system with no currencies of its own', () => {
    expect(catalogueCurrency({ format: 1, name: 'A' }, 'gear')).toBeNull();
  });

  it('reaches the browser only where the system named it', () => {
    expect(ownBuildings(HEARTH).catalogues).toEqual({
      cyberware: { name: 'Relics', currency: 'favor' },
      weapons: { currency: 'gold' },
      armor: { on: false, currency: 'favor' },
    });
    expect(ownBuildings({ ...HEARTH, buildings: {} }).catalogues).toEqual({});
  });
});

describe('the running game', () => {
  const ID = 'sys_aaaaaaaaaaaaaaaa';
  const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
  beforeEach(async () => {
    const db = new sqlite3.Database(':memory:');
    await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
    const text = JSON.stringify(HEARTH);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hearth', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  it('gives each catalogue its currency, shaped as the bank uses it', () => {
    expect(runtime.catalogueCurrencyIn(ID, 'cyberware')).toMatchObject({ id: 'favor', name: 'Favor', debt: false, negative: false });
    expect(runtime.catalogueCurrencyIn(ID, 'gear')).toMatchObject({ id: 'gold' });
    expect(runtime.render(ID).buildings.catalogues.cyberware).toEqual({ name: 'Relics', currency: 'favor' });
  });

  it('gives every built-in system none, which keep the app\'s single money', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(runtime.catalogueCurrencyIn(system, 'gear'), system).toBeNull();
    }
  });
});
