/**
 * A game's own shops, kept per game (8a7b3c1; decided with the user, 2026-11-22). A building is a Magican in one game, a
 * Mechanic in another, and its shared type in a game that makes neither; two games each making a "Magican" never mix;
 * picking one of the app's types sets the shared type, as ever, and this game's own shop comes off. Buildings set to a
 * game's own shop before this are moved, once, to every game that makes it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';
import mapsRouteFactory from '../routes/maps.js';

process.env.JWT_SECRET = 'test-secret';
const ADMIN = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const require_ = createRequire(import.meta.url);
const { typeIn, shopsIn, setShop, buildingIn, moveOldShops, pruneOrphans } = require_('../shops/locationShops');
const store = require_('../shops/catalogueStore');
const { insertLocations } = require_('../buildings/locationRows');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const FANTASY = 'sys_fantasyfantasyfan';
const SCIFI = 'sys_scifiscifiscifisc';
const OTHER = 'sys_otherotherotherot';
const game = (name, shops, typeId, item) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  buildings: { shops },
  items: { types: [{ id: typeId, label: typeId.toUpperCase(), one: typeId, sold_at: shops.map((s) => s.id), columns: [] }], list: [{ id: item, label: item, type: typeId, price: 30 }] },
});
const DEFS = {
  [FANTASY]: game('Fantasy', [{ id: 'magican', name: 'Magican' }, { id: 'shrine', name: 'Shrine', on: false }], 'magic', 'wand'),
  [SCIFI]: game('Scifi', [{ id: 'mechanic', name: 'Mechanic' }, { id: 'magican', name: 'Magican' }], 'parts', 'spanner'),
  [OTHER]: game('Other', [{ id: 'tavern', name: 'Tavern' }], 'drink', 'ale'),
};

describe('a building\'s type in a game', () => {
  const def = DEFS[FANTASY];
  it('the game\'s own shop it is there, on or off; one the game no longer makes, or none, its shared type', () => {
    expect(typeIn(def, 'general_store', 'magican')).toBe('magican');
    expect(typeIn(def, 'general_store', 'shrine')).toBe('shrine');
    expect(typeIn(def, 'general_store', 'mechanic')).toBe('general_store');
    expect(typeIn(def, 'general_store', null)).toBe('general_store');
    expect(typeIn(def, null, undefined)).toBeNull();
    expect(typeIn(null, 'gun_shop', 'magican')).toBe('gun_shop');
  });
});

describe('kept per game', () => {
  let db;
  beforeEach(async () => { db = await makeTestDb(); });
  const building = async (type = null) => (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('B', 0, 0, 0, 'box', ?)", [type])).lastID;
  const cb = (fn) => new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))));

  it('set, changed, read with the building, and taken off for one game alone', async () => {
    const id = await building('general_store');
    await cb((done) => setShop(db, id, FANTASY, 'magican', done));
    await cb((done) => setShop(db, id, SCIFI, 'mechanic', done));
    await cb((done) => setShop(db, id, FANTASY, 'shrine', done));
    expect([...(await cb((done) => shopsIn(db, FANTASY, done)))]).toEqual([[id, 'shrine']]);
    expect(await cb((done) => buildingIn(db, id, SCIFI, done))).toEqual({ id, building_type: 'general_store', buyback_pct: null, shop: 'mechanic' });
    expect(await cb((done) => buildingIn(db, id, OTHER, done))).toMatchObject({ shop: null });
    await cb((done) => setShop(db, id, FANTASY, null, done));
    expect(await all(db, 'SELECT system, shop FROM location_shops')).toEqual([{ system: SCIFI, shop: 'mechanic' }]);
    expect(await cb((done) => buildingIn(db, 999, FANTASY, done))).toBeNull();
  });

  it('kept through a delete, for an undone delete to find, and dropped once its building is gone for good', async () => {
    const id = await building();
    const kept = await building();
    await cb((done) => setShop(db, id, FANTASY, 'magican', done));
    await cb((done) => setShop(db, kept, FANTASY, 'shrine', done));
    await run(db, 'DELETE FROM locations WHERE id = ?', [id]);
    expect(await all(db, 'SELECT location_id FROM location_shops ORDER BY location_id')).toEqual([{ location_id: id }, { location_id: kept }]);
    await cb((done) => pruneOrphans(db, done));
    expect(await all(db, 'SELECT location_id FROM location_shops')).toEqual([{ location_id: kept }]);
  });

  it('those set before, moved once to every game that makes their shop; one no game makes, and the app\'s, left', async () => {
    for (const [id, def] of Object.entries(DEFS)) await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, def.name, '{}', JSON.stringify(def)]);
    await run(db, "INSERT INTO custom_systems (id, name, draft, published, version) VALUES ('sys_brokenbrokenbroken', 'Broken', '{}', '{nope', 1)");
    const magican = await building('magican');
    const tavern = await building('tavern');
    const lost = await building('apothecary');
    const store_ = await building('general_store');
    expect(await cb((done) => moveOldShops(db, done))).toBe(2);
    expect(await all(db, 'SELECT location_id, system, shop FROM location_shops ORDER BY location_id, system')).toEqual([
      { location_id: magican, system: FANTASY, shop: 'magican' },
      { location_id: magican, system: SCIFI, shop: 'magican' },
      { location_id: tavern, system: OTHER, shop: 'tavern' },
    ]);
    expect((await all(db, 'SELECT id, building_type FROM locations ORDER BY id')).map((r) => r.building_type)).toEqual([null, null, 'apothecary', 'general_store']);
    expect(lost).toBeGreaterThan(0);
    expect(store_).toBeGreaterThan(0);
    // Done once: nothing more to move.
    expect(await cb((done) => moveOldShops(db, done))).toBe(0);
  });

  it('nothing to move, and the systems not even read, on a map of the app\'s types or none', async () => {
    await run(db, 'DROP TABLE custom_systems');
    expect(await cb((done) => moveOldShops(db, done))).toBe(0);
    await building('general_store');
    await building();
    expect(await cb((done) => moveOldShops(db, done))).toBe(0);
  });

  it('none to move with no published system making it', async () => {
    await building('apothecary');
    expect(await cb((done) => moveOldShops(db, done))).toBe(0);
  });
});

describe('at the table', () => {
  let db;
  const install = async () => {
    for (const [id, def] of Object.entries(DEFS)) {
      const text = JSON.stringify(def);
      await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, def.name, text, text]);
    }
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const running = (system) => run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [system]);
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    return a;
  };
  const give = (id, type, more = {}) => request(app()).patch(`/api/locations/${id}/building-type`).set('Authorization', `Bearer ${ADMIN}`).send({ building_type: type, ...more });
  const typeOf = async (id) => (await request(app()).get('/api/locations')).body.find((l) => l.id === id).building_type;

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    await install();
  });

  it('a Magican in one game, a Mechanic in another, its shared type in a game that makes neither', async () => {
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Corner', 0, 0, 0, 'box', 'general_store')")).lastID;
    await running(FANTASY);
    expect((await give(id, 'magican')).status).toBe(200);
    await running(SCIFI);
    // The Scifi game makes a Magican too: not this building until it is picked here.
    expect(await typeOf(id)).toBe('general_store');
    expect((await give(id, 'mechanic', { buyback_pct: 30 })).status).toBe(200);
    expect(await typeOf(id)).toBe('mechanic');
    await running(FANTASY);
    expect(await typeOf(id)).toBe('magican');
    await running(OTHER);
    expect(await typeOf(id)).toBe('general_store');
    // The rate set is the building's, in every game; its shared type untouched by the games' own.
    expect(await get(db, 'SELECT building_type, buyback_pct FROM locations WHERE id = ?', [id])).toEqual({ building_type: 'general_store', buyback_pct: 30 });
  });

  it('one of the app\'s picked: the shared type, every game; this game\'s own shop off, the others kept', async () => {
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Corner', 0, 0, 0, 'box')")).lastID;
    await running(SCIFI);
    await give(id, 'mechanic');
    await running(FANTASY);
    await give(id, 'magican');
    expect((await give(id, 'gun_shop')).status).toBe(200);
    expect(await typeOf(id)).toBe('gun_shop');
    await running(SCIFI);
    expect(await typeOf(id)).toBe('mechanic');
    expect(await all(db, 'SELECT system, shop FROM location_shops')).toEqual([{ system: SCIFI, shop: 'mechanic' }]);
  });

  it('carried by a saved map and put back with it; a map saved before, its old-style shops moved; cleared with the map', async () => {
    const maps = express();
    maps.use(express.json());
    maps.use('/api/maps', mapsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    const as = (r) => r.set('Authorization', `Bearer ${ADMIN}`);
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Corner', 0, 0, 0, 'box')")).lastID;
    await running(FANTASY);
    await give(id, 'magican');
    expect((await as(request(maps).post('/api/maps/save')).send({ name: 'realm' })).status).toBe(200);
    await give(id, '');
    expect((await as(request(maps).post('/api/maps/load/realm'))).status).toBe(200);
    expect(await typeOf(id)).toBe('magican');
    // A map saved before the shops traveled, its building set to the Magican the old way: moved to the games making it.
    await run(db, 'INSERT INTO saved_maps (name, locations_data) VALUES (?, ?)', ['old-realm', JSON.stringify([{ id, name: 'Corner', x: 0, y: 0, z: 0, shape: 'box', building_type: 'magican' }])]);
    await as(request(maps).post('/api/maps/load/old-realm'));
    expect(await all(db, 'SELECT system, shop FROM location_shops ORDER BY system')).toEqual([{ system: FANTASY, shop: 'magican' }, { system: SCIFI, shop: 'magican' }]);
    expect(await typeOf(id)).toBe('magican');
    await as(request(maps).post('/api/maps/clear'));
    expect(await all(db, 'SELECT * FROM location_shops')).toEqual([]);
  });

  it('a loaded map\'s rows replace what was there: none for a building it doesn\'t have, junk skipped', async () => {
    const maps = express();
    maps.use(express.json());
    maps.use('/api/maps', mapsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Corner', 0, 0, 0, 'box')")).lastID;
    const other = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Lane', 0, 0, 0, 'box')")).lastID;
    await running(FANTASY);
    await give(other, 'magican');
    const saved = [{ id, name: 'Corner', x: 0, y: 0, z: 0, shape: 'box' }, { id: other, name: 'Lane', x: 0, y: 0, z: 0, shape: 'box' }];
    await run(db, 'INSERT INTO saved_maps (name, locations_data, shops_data) VALUES (?, ?, ?)', ['realm-2', JSON.stringify(saved),
      JSON.stringify([null, { location_id: id }, { location_id: id, system: FANTASY, shop: 'shrine' }, { location_id: 9999, system: FANTASY, shop: 'magican' }])]);
    expect((await request(maps).post('/api/maps/load/realm-2').set('Authorization', `Bearer ${ADMIN}`)).status).toBe(200);
    expect(await all(db, 'SELECT location_id, system, shop FROM location_shops')).toEqual([{ location_id: id, system: FANTASY, shop: 'shrine' }]);
  });

  it('an undone delete brings the building back as the game\'s own shop it was', async () => {
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Corner', 0, 0, 0, 'box')")).lastID;
    await running(FANTASY);
    await give(id, 'magican');
    const row = await get(db, 'SELECT * FROM locations WHERE id = ?', [id]);
    expect((await request(app()).delete(`/api/locations/${id}`).set('Authorization', `Bearer ${ADMIN}`)).status).toBe(200);
    await new Promise((resolve, reject) => insertLocations(db, [row], {}, (e) => (e ? reject(e) : resolve())));
    expect(await typeOf(id)).toBe('magican');
  });

  it('saved again unchanged, an off one is kept; a new off one refused, an unknown one too', async () => {
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Corner', 0, 0, 0, 'box')")).lastID;
    await running(FANTASY);
    await run(db, 'INSERT INTO location_shops (location_id, system, shop) VALUES (?, ?, ?)', [id, FANTASY, 'shrine']);
    expect(await typeOf(id)).toBe('shrine');
    expect((await give(id, 'shrine')).status).toBe(200);
    expect((await give(id, 'mechanic')).status).toBe(400);
    expect((await give(id, '')).status).toBe(200);
    expect(await typeOf(id)).toBeNull();
    expect((await give(id, 'shrine')).status).toBe(409);
  });

  it('sold at in the game it is set in, by that game\'s types; nothing of it in another', async () => {
    const id = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Corner', 0, 0, 0, 'box')")).lastID;
    await running(FANTASY);
    await give(id, 'magican');
    for (const system of [FANTASY, SCIFI]) {
      await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 100, 0)', ['kes', system]);
      await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', system, JSON.stringify({ inventory: '[]' })]);
    }
    const boot = async () => {
      const emitted = [];
      let connect;
      socketsFactory({ on: (e, f) => { if (e === 'connection') connect = f; }, emit: () => {}, to: () => ({ emit: () => {} }) }, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
      const handlers = {};
      connect({ id: `pg-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
      handlers.identify('kes');
      await drain(db);
      return { handlers, emitted };
    };
    const checkout = async (buys) => {
      const kes = await boot();
      kes.handlers.checkoutShop({ locationId: id, buys });
      return (await untilValue(() => kes.emitted.find((e) => e.event === 'shopCheckout'), Boolean, { label: 'shopCheckout' })).data;
    };
    expect(await checkout([{ catalogue: 'type:magic', itemId: 'item:wand', qty: 1 }])).toMatchObject({ ok: true });
    await running(SCIFI);
    await new Promise((resolve) => runtime.load(db, resolve));
    // In the Scifi game it is no Magican (its own Magican was never picked here): no shop at all.
    expect(await checkout([{ catalogue: 'type:parts', itemId: 'item:spanner', qty: 1 }])).toMatchObject({ ok: false, reason: 'no_shop' });
  });
});
