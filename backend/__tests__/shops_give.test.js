/**
 * What a GM can give, and where a gift lands (4g2a; approved mockup docs/mockups/give-item.html).
 *
 * Everything the running game's shops could sell, free: the CWN book's items on CWN, the GM's
 * uploads everywhere, only on the shelves the game has on. A gift lands where buying it would
 * (bookPlacement.js and placement.js, each held to the shop's own placement by frontend tests),
 * all of it or none.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const give = require_('../shops/give');
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const { CATALOGUE } = require_('../shops/prices');
const { CATALOGUES } = require_('../buildingTypes');
const { readInventory } = require_('../shops/placement');

const CWN = 'cities_without_number';
const CPR = 'cyberpunk_red';
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const BARE = 'sys_bbbbbbbbbbbbbbbb';

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));

beforeAll(async () => {
  const db = new sqlite3.Database(':memory:');
  await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
  const systems = [
    // Gear off by its own switch, cyberware off with its part, weapons renamed (still offered).
    [HEARTH, { format: 1, name: 'Hearth', parts: { cyberware: { on: false } }, buildings: { catalogues: { gear: { on: false }, weapons: { name: 'Blades' } } } }],
    [BARE, { format: 1, name: 'Bare' }],
  ];
  for (const [id, definition] of systems) {
    const text = JSON.stringify(definition);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, id, text, text]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
});

beforeEach(() => store.clear());

const ids = (list) => list.map((c) => c.catalogue);
const SHELVED = CATALOGUES.filter((c) => c.shelved).map((c) => c.id);
const pistol = { id: 'heavy_pistol', name: 'House Pistol', price: 300, fields: { dmg: '1d10', enc: '1' } };

describe('what a CWN game can give', () => {
  it('is every shelf of the book, item for item, at its price', () => {
    store.load(CWN, {});
    const list = give.givable(CWN);
    expect(ids(list).sort()).toEqual(Object.keys(CATALOGUE).sort());
    expect(ids(list).sort()).toEqual([...SHELVED].sort());
    for (const { catalogue, items } of list) {
      expect(items).toEqual(Object.entries(CATALOGUE[catalogue]).map(([id, [name, price]]) => ({ id, name, price })));
    }
  });

  it('can place every one of them on an empty sheet', () => {
    store.load(CWN, {});
    for (const { catalogue, items } of give.givable(CWN)) {
      for (const item of items) {
        const placed = give.placeGift(CWN, catalogue, item.id, {});
        expect(placed.ok, `${catalogue} ${item.id}`).toBe(true);
        expect(placed.item).toEqual({ ...item, fields: {} });
      }
    }
  });

  it('has the GM\'s uploads too, one replacing the book\'s item of the same id', () => {
    store.load(CWN, { weapons: [pistol, { id: 'zip_gun', name: 'Zip Gun', price: 15 }] });
    const weapons = give.givable(CWN).find((c) => c.catalogue === 'weapons').items;
    expect(weapons.filter((w) => w.id === 'heavy_pistol')).toEqual([{ id: 'heavy_pistol', name: 'House Pistol', price: 300 }]);
    expect(weapons[weapons.length - 1]).toEqual({ id: 'zip_gun', name: 'Zip Gun', price: 15 });
    expect(weapons).toHaveLength(Object.keys(CATALOGUE.weapons).length + 1);
  });

  it('places an upload on a book shelf as a row of it, the CWN way', () => {
    store.load(CWN, { weapons: [pistol] });
    const placed = give.placeGift(CWN, 'weapons', 'heavy_pistol', { weapon1_name: 'Knife' });
    expect(placed.patch).toMatchObject({ weapon2_name: 'House Pistol', weapon2_dmg: '1d10', weapon2_enc: '1', weapon2_carry: 'stowed', weapon2_atk: 0 });
    expect(placed.item).toEqual(pistol);
  });

  it('places a book item from the book', () => {
    store.load(CWN, {});
    const placed = give.placeGift(CWN, 'weapons', 'heavy_pistol', {});
    expect(placed.patch).toMatchObject({ weapon1_name: 'Heavy Pistol', weapon1_dmg: '1d8', weapon1_carry: 'stowed' });
  });
});

describe('what another game can give', () => {
  it('is only what its GM uploaded, on shelves with something on them', () => {
    store.load(CPR, { weapons: [pistol], gear: [{ id: 'rope', name: 'Rope', price: 2 }] });
    expect(give.givable(CPR)).toEqual([
      { catalogue: 'weapons', items: [{ id: 'heavy_pistol', name: 'House Pistol', price: 300 }] },
      { catalogue: 'gear', items: [{ id: 'rope', name: 'Rope', price: 2 }] },
    ]);
  });

  it('never gives the CWN book\'s items', () => {
    store.load(CPR, {});
    expect(give.givable(CPR)).toEqual([]);
    expect(give.placeGift(CPR, 'weapons', 'heavy_pistol', {})).toEqual({ ok: false, reason: 'Not something this game can give.' });
  });

  it('places an upload the uploaded way, into its own sheet\'s rows', () => {
    store.load(CPR, { weapons: [pistol] });
    const placed = give.placeGift(CPR, 'weapons', 'heavy_pistol', {});
    expect(placed.ok).toBe(true);
    expect(placed.patch.weapon1_name).toBe('House Pistol');
    expect(placed.patch.weapon1_carry).toBeUndefined();
  });

  it('leaves out a catalogue a shop can\'t shelve, upload or not', () => {
    store.load(CWN, { cyber_mods: [{ id: 'm', name: 'Mod', price: 1 }], skillplugs: [{ id: 'p', name: 'Plug', price: 1 }] });
    expect(ids(give.givable(CWN))).not.toContain('cyber_mods');
    expect(ids(give.givable(CWN))).not.toContain('skillplugs');
    expect(give.placeGift(CWN, 'cyber_mods', 'm', {}).ok).toBe(false);
  });
});

describe('what a custom system can give', () => {
  const uploads = {
    weapons: [{ id: 'sword', name: 'Sword', price: 10, fields: { dmg: '1d8' } }],
    gear: [{ id: 'rope', name: 'Rope', price: 2 }],
    cyberware: [{ id: 'eye', name: 'Glass Eye', price: 5 }],
    armor: [{ id: 'mail', name: 'Mail', price: 40, fields: { enc: '2' } }],
  };

  it('offers only the catalogues it has on, renamed ones included', () => {
    store.load(HEARTH, uploads);
    expect(ids(give.givable(HEARTH))).toEqual(['weapons', 'armor']);
    expect(give.placeGift(HEARTH, 'gear', 'rope', {}).ok).toBe(false);
    expect(give.placeGift(HEARTH, 'cyberware', 'eye', {}).ok).toBe(false);
    expect(give.offers(HEARTH, 'weapons')).toBe(true);
  });

  it('offers them all when it turned none off', () => {
    store.load(BARE, uploads);
    expect(ids(give.givable(BARE))).toEqual(['cyberware', 'weapons', 'armor', 'gear']);
  });

  it('puts everything in the inventory, its sheet having no rows of the app\'s', () => {
    store.load(HEARTH, uploads);
    const placed = give.placeGift(HEARTH, 'weapons', 'sword', {});
    expect(Object.keys(placed.patch)).toEqual(['inventory']);
    expect(readInventory(placed.patch)).toEqual([{ name: 'Sword', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' }]);
    expect(readInventory(give.placeGift(HEARTH, 'armor', 'mail', {}).patch)[0].enc).toBe('2');
  });

  it('gives nothing in a game the shops don\'t know', () => {
    store.load('nonsense', uploads);
    expect(give.givable('nonsense')).toEqual([]);
    expect(give.placeGift('nonsense', 'weapons', 'sword', {}).ok).toBe(false);
  });
});

describe('how many', () => {
  it('stacks them in the inventory as one line', () => {
    store.load(BARE, { gear: [{ id: 'rope', name: 'Rope', price: 2 }] });
    const placed = give.placeGift(BARE, 'gear', 'rope', { inventory: [{ name: 'Rope', qty: 2, carry: 'readied' }] }, 3);
    expect(readInventory(placed.patch)).toEqual([{ name: 'Rope', qty: 5, enc: '', bundled: false, carry: 'readied', location: '' }]);
  });

  it('fills a row each, and gives none when they don\'t all fit', () => {
    store.load(CWN, {});
    const two = give.placeGift(CWN, 'weapons', 'knife', { weapon1_name: 'Owned' }, 2);
    expect(two.ok).toBe(true);
    expect([two.patch.weapon2_name, two.patch.weapon3_name]).toEqual(['Knife', 'Knife']);
    expect(two.patch.weapon4_name).toBeUndefined();
    const tooMany = give.placeGift(CWN, 'weapons', 'knife', { weapon1_name: 'Owned' }, 6);
    expect(tooMany).toEqual({ ok: false, reason: expect.stringMatching(/^No free weapon row/), placed: 5 });
  });

  it('reads one when it isn\'t told', () => {
    store.load(BARE, { gear: [{ id: 'rope', name: 'Rope', price: 2 }] });
    expect(readInventory(give.placeGift(BARE, 'gear', 'rope', {}).patch)[0].qty).toBe(1);
  });
});

describe('something this game hasn\'t got', () => {
  it('is refused, whatever the shelf', () => {
    store.load(CWN, {});
    expect(give.placeGift(CWN, 'weapons', 'no_such_gun', {})).toEqual({ ok: false, reason: 'Not something this game can give.' });
    expect(give.placeGift(CWN, 'nonsense', 'knife', {}).ok).toBe(false);
    expect(give.placeGift(CWN, 'weapons', undefined, {}).ok).toBe(false);
    expect(give.itemOf(CWN, 'weapons', 'no_such_gun')).toBeNull();
  });
});
