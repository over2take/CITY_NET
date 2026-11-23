/**
 * The game's own kinds of shop (8a7b1a; approved mockup docs/mockups/types-in-shops.html, 2026-11-21, the user: "in Item Type
 * we have a section to add what store sells this item ... then add that store to the building Type list"). A GM makes an
 * Apothecary: checked, carried by the system file, ticked by a type's SOLD AT, listed for buildings after the app's own, and a
 * building set to it sells the types that tick it. Off, or in another game, it is no shop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const ADMIN = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { ownShops, ownShopOf, shopKindsOf, buildingOn, buildingName, ownBuildings, SHOPS_MOST } = require_('../systemBuilder/buildings');
const { soldAt, typeShelvesAt, typesShown } = require_('../systemBuilder/itemTypes');
const citysys = require_('../systemBuilder/citysys');
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const POTIONS = { id: 'potions', label: 'POTIONS', one: 'Potion', columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] };
const HERBAL = (shops = [{ id: 'apothecary', name: 'Apothecary' }], soldAtList = ['apothecary']) => ({
  format: 1, name: 'Herbal', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  buildings: { shops },
  items: { types: [{ ...POTIONS, sold_at: soldAtList }], list: [{ id: 'draught', label: 'Healing Draught', type: 'potions', values: { heals: '2d4' }, price: 40 }] },
});
const problemsOf = (shops) => checkDefinition({ format: 1, name: 'A', buildings: { shops } }).problems;

describe('checked', () => {
  it('a list of shops, each an id and a name, perhaps off', () => {
    expect(problemsOf([{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', on: false }])).toEqual([]);
    expect(problemsOf([])).toEqual([]);
  });

  it('names whatever it can\'t take', () => {
    expect(problemsOf({})).toEqual([{ where: 'buildings shops', message: 'A list of the shops this game makes' }]);
    expect(problemsOf(['apothecary'])).toEqual([{ where: 'buildings shop 1', message: 'Must say an id and a name' }]);
    expect(problemsOf([{ id: 'Apothecary!', name: 'A' }])).toEqual([{ where: 'buildings shop 1, id', message: 'Lowercase letters, digits and _, starting with a letter' }]);
    expect(problemsOf([{ id: 'gun_shop', name: 'Guns' }])).toEqual([{ where: 'buildings shop 1, id', message: 'The app has a building type called gun_shop: call it something else' }]);
    expect(problemsOf([{ id: 'fence', name: 'Fence' }, { id: 'fence', name: 'Fence too' }])).toEqual([{ where: 'buildings shop 2, id', message: 'Two shops called fence' }]);
    expect(problemsOf([{ id: 'fence', name: '  ' }])).toEqual([{ where: 'buildings shop 1, name', message: 'Must be some text' }]);
    expect(problemsOf([{ id: 'fence', name: 'x'.repeat(41) }])).toEqual([{ where: 'buildings shop 1, name', message: 'At most 40 characters' }]);
    expect(problemsOf([{ id: 'fence', name: 'Fence', on: 'no' }])).toEqual([{ where: 'buildings shop 1, on', message: 'Must be true or false' }]);
    expect(problemsOf([{ id: 'fence', name: 'Fence', sells: ['gear'] }])).toEqual([{ where: 'buildings shop 1, sells', message: 'Only "id", "name", "on" and "buys" are set here' }]);
    expect(SHOPS_MOST).toBe(20);
    const many = Array.from({ length: 21 }, (_, n) => ({ id: `shop_${n}`, name: `Shop ${n}` }));
    expect(problemsOf(many)).toEqual([{ where: 'buildings shops', message: 'At most 20 shops of its own' }]);
  });
});

describe('the game\'s own shops, read', () => {
  const def = HERBAL([{ id: 'apothecary', name: '  Apothecary ' }, { id: 'fence', name: 'Fence', on: false }, { id: 'gun_shop', name: 'Clash' }, 'junk']);

  it('those well formed, trimmed, on unless said off; by id; every kind of shop the game has', () => {
    expect(ownShops(def)).toEqual([{ id: 'apothecary', name: 'Apothecary', on: true }, { id: 'fence', name: 'Fence', on: false }]);
    expect(ownShopOf(def, 'fence')).toEqual({ id: 'fence', name: 'Fence', on: false });
    expect(ownShopOf(def, 'tavern')).toBeNull();
    expect(ownShops({ name: 'A' })).toEqual([]);
    expect(shopKindsOf(def).slice(-2)).toEqual(['apothecary', 'fence']);
    expect(shopKindsOf(def)).toContain('general_store');
  });

  it('a building type of the game: on as it says, by its name; sent to the browser only where it has some', () => {
    expect(buildingOn(def, 'types', 'apothecary')).toBe(true);
    expect(buildingOn(def, 'types', 'fence')).toBe(false);
    expect(buildingName(def, 'types', 'apothecary')).toBe('Apothecary');
    expect(ownBuildings(def).shops).toEqual(ownShops(def));
    expect(ownBuildings({ name: 'A' })).not.toHaveProperty('shops');
  });
});

describe('SOLD AT the game\'s own shops', () => {
  it('ticked where the game makes it; not where the game is not said, nor in another game; the shelf of its building', () => {
    const def = HERBAL();
    const type = def.items.types[0];
    expect(soldAt(type, def)).toEqual(['apothecary']);
    // Told nothing of the game, only the app's shops count.
    expect(soldAt(type)).toEqual([]);
    expect(soldAt(type, HERBAL([]))).toEqual([]);
    expect(typeShelvesAt(def, 'apothecary')).toEqual(['type:potions']);
    expect(typeShelvesAt(def, 'general_store')).toEqual([]);
    expect(typesShown(def)[0].sold_at).toEqual(['apothecary']);
  });

  it('checked against the game\'s own: one it makes is fine, one it doesn\'t is said', () => {
    const soldProblems = (def) => checkDefinition(def).problems.filter((p) => /sold_at/.test(p.where));
    expect(soldProblems(HERBAL())).toEqual([]);
    expect(soldProblems(HERBAL([]))).toEqual([{ where: 'type potions, sold_at 1', message: 'No kind of shop is called apothecary' }]);
  });

  it('carried by the system file, exported and read back unchanged', () => {
    const definition = HERBAL([{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', on: false }]);
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition, version: 1, origin: 'sys_herbalherbalherba' })));
    expect(read.problems, JSON.stringify(read.problems)).toEqual([]);
    expect(read.file.definition.buildings.shops).toEqual(definition.buildings.shops);
    expect(read.file.definition.items.types[0].sold_at).toEqual(['apothecary']);
  });
});

describe('at the table', () => {
  const ID = 'sys_herbalherbalherba';
  let db;
  const install = async (definition) => {
    const text = JSON.stringify(definition);
    await run(db, 'DELETE FROM custom_systems WHERE id = ?', [ID]);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Herbal', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    return a;
  };
  const give = (id, type) => request(app()).patch(`/api/locations/${id}/building-type`).set('Authorization', `Bearer ${ADMIN}`).send({ building_type: type });
  const stall = async (type = null) => (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Stall', 0, 0, 0, 'box', ?)", [type])).lastID;
  const boot = async (who) => {
    const emitted = [];
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `os-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
    handlers.identify(who);
    await drain(db);
    return { handlers, emitted };
  };
  const checkout = async (who, locationId, more) => {
    who.handlers.checkoutShop({ locationId, ...more });
    return (await untilValue(() => [...who.emitted].reverse().find((e) => e.event === 'shopCheckout'), Boolean, { label: 'shopCheckout' })).data;
  };

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    await install(HERBAL([{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', on: false }]));
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
    await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 100, 0)', ['kes', ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', ID, JSON.stringify({ inventory: '[]' })]);
  });

  it('listed for buildings after the app\'s, marked its own, an off one left out', async () => {
    const listed = (await request(app()).get('/api/locations/building-types')).body;
    expect(listed.slice(-1)).toEqual([{ id: 'apothecary', label: 'Apothecary', shop: true, sells: [], own: true }]);
    expect(listed.some((t) => t.id === 'fence')).toBe(false);
    expect(listed.findIndex((t) => t.id === 'general_store')).toBeLessThan(listed.findIndex((t) => t.id === 'apothecary'));
  });

  it('a building can be one; not one turned off, nor one no game makes', async () => {
    const id = await stall();
    expect((await give(id, 'apothecary')).status).toBe(200);
    expect((await get(db, 'SELECT building_type FROM locations WHERE id = ?', [id])).building_type).toBe('apothecary');
    expect((await give(id, 'fence')).status).toBe(409);
    expect((await give(id, 'tavern')).status).toBe(400);
  });

  it('a building keeps another game\'s own shop when saved again (8a7b3a); a new unknown one is still refused', async () => {
    const id = await stall('apothecary');
    await install({ ...HERBAL([]), items: { types: [{ ...POTIONS, sold_at: [] }], list: [] } });
    expect((await give(id, 'apothecary')).status).toBe(200);
    expect((await get(db, 'SELECT building_type FROM locations WHERE id = ?', [id])).building_type).toBe('apothecary');
    expect((await give(id, 'tavern')).status).toBe(400);
    expect((await give(id, '')).status).toBe(200);
    expect((await give(id, 'apothecary')).status).toBe(400);
  });

  it('sells the types that tick it, at their price; the General Store doesn\'t; off, or in another game, it is no shop', async () => {
    const shop = await stall('apothecary');
    const goods = await stall('general_store');
    const kes = await boot('kes');
    const buy = { buys: [{ catalogue: 'type:potions', itemId: 'item:draught', qty: 1 }] };
    expect(await checkout(kes, shop, buy)).toMatchObject({ ok: true, buys: [{ catalogue: 'type:potions', itemId: 'item:draught', qty: 1, price: 40 }] });
    expect((await get(db, 'SELECT balance FROM bank_accounts WHERE username = ?', ['kes'])).balance).toBe(60);
    kes.emitted.length = 0;
    expect(await checkout(kes, goods, buy)).toMatchObject({ ok: false, reason: 'not_sold' });
    // Turned off: the building keeps its type, but is no shop.
    await install(HERBAL([{ id: 'apothecary', name: 'Apothecary', on: false }]));
    kes.emitted.length = 0;
    expect(await checkout(kes, shop, buy)).toMatchObject({ ok: false, reason: 'no_shop' });
    // Another game, which makes no Apothecary: nothing sold there.
    await install({ ...HERBAL([]), items: { types: [{ ...POTIONS, sold_at: [] }], list: [] } });
    kes.emitted.length = 0;
    expect((await checkout(kes, shop, buy)).ok).toBe(false);
  });
});
