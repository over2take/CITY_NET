/**
 * A system's own building types and shop catalogues (3b3b1): renamed, or turned off, never new
 * (decided with the user, 2026-10-01). The ids stay, so off only hides: a building keeps its
 * type, and turning the type back on brings its shop back. Every built-in system keeps all ten
 * types and every catalogue, by the app's own names.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const ADMIN = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { checkDefinition } = require_('../systemBuilder/definition');
const { ownBuildings } = require_('../systemBuilder/buildings');
const types = require_('../buildingTypes');
const socketsFactory = (await import('../sockets/index.js')).default;

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

const hearth = (gunShopOn = false) => ({
  format: 1, name: 'Hearth',
  buildings: {
    types: { ripperdoc: { name: '  Temple ' }, gun_shop: { on: gunShopOn }, corp: { name: 'Guildhall', on: true } },
    catalogues: { cyberware: { name: 'Relics' }, armor: { on: false } },
  },
});

const problemsOf = (buildings) => checkDefinition({ format: 1, name: 'A', buildings }).problems;

describe('the buildings section of a system', () => {
  it('takes names and on or off for the app\'s own types and catalogues', () => {
    expect(problemsOf(hearth().buildings)).toEqual([]);
    expect(problemsOf(undefined)).toEqual([]);
    expect(problemsOf({ types: {}, catalogues: {} })).toEqual([]);
  });

  it('names whatever it cannot take', () => {
    const where = (buildings) => problemsOf(buildings).map((p) => p.where);
    expect(where([])).toEqual(['buildings']);
    expect(where({ shops: {} })).toEqual(['buildings shops']);
    expect(where({ types: [] })).toEqual(['buildings types']);
    expect(where({ types: { tavern: { name: 'Tavern' } } })).toEqual(['buildings types tavern']);
    expect(where({ catalogues: { ale: { on: false } } })).toEqual(['buildings catalogues ale']);
    expect(where({ types: { bar: 'Tavern' } })).toEqual(['buildings types bar']);
    expect(where({ types: { bar: { on: 'no' } } })).toEqual(['buildings types bar, on']);
    expect(where({ types: { bar: { name: '   ' } } })).toEqual(['buildings types bar, name']);
    expect(where({ types: { bar: { name: 7 } } })).toEqual(['buildings types bar, name']);
    expect(where({ types: { bar: { name: 'x'.repeat(41) } } })).toEqual(['buildings types bar, name']);
    expect(where({ types: { bar: { name: 'x'.repeat(40) } } })).toEqual([]);
    expect(where({ catalogues: { gear: { price: 3 } } })).toEqual(['buildings catalogues gear, price']);
  });

  it('sends the browser only what the system renamed or turned off', () => {
    expect(ownBuildings(hearth())).toEqual({
      types: { ripperdoc: { name: 'Temple' }, gun_shop: { on: false }, corp: { name: 'Guildhall' } },
      catalogues: { cyberware: { name: 'Relics' }, armor: { on: false } },
    });
    expect(ownBuildings({ name: 'A' })).toEqual({ types: {}, catalogues: {} });
  });
});

let db;
beforeEach(async () => {
  db = await makeTestDb();
  const text = JSON.stringify(hearth());
  const plain = JSON.stringify({ format: 1, name: 'Plain' });
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)',
    [HEARTH, 'Hearth', text, text, PLAIN, 'Plain', plain, plain]);
  await new Promise((resolve) => runtime.load(db, resolve));
});

const setSystem = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
const republish = async (definition) => {
  await run(db, 'UPDATE custom_systems SET published = ?, version = version + 1 WHERE id = ?', [JSON.stringify(definition), HEARTH]);
  await new Promise((resolve) => runtime.refresh(db, HEARTH, resolve));
};

describe('the running game', () => {
  it('has every type and catalogue, by the app\'s names, under the built-ins and a system that changed none', () => {
    for (const system of [...BUILT_INS, PLAIN]) {
      expect(types.BUILDING_TYPES.every((t) => runtime.buildingIn(system, 'types', t.id)), system).toBe(true);
      expect(types.CATALOGUES.every((c) => runtime.buildingIn(system, 'catalogues', c.id)), system).toBe(true);
      expect(runtime.buildingNameIn(system, 'types', 'ripperdoc'), system).toBeNull();
    }
  });

  it('has what a custom system kept, by its names', () => {
    expect(runtime.buildingIn(HEARTH, 'types', 'gun_shop')).toBe(false);
    expect(runtime.buildingIn(HEARTH, 'types', 'ripperdoc')).toBe(true);
    expect(runtime.buildingIn(HEARTH, 'catalogues', 'armor')).toBe(false);
    expect(runtime.buildingNameIn(HEARTH, 'types', 'ripperdoc')).toBe('Temple');
    expect(runtime.buildingNameIn(HEARTH, 'catalogues', 'cyberware')).toBe('Relics');
    expect(runtime.render(HEARTH).buildings.types.gun_shop).toEqual({ on: false });
  });
});

describe('the building-type routes', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    return a;
  };
  const listed = async () => (await request(app()).get('/api/locations/building-types')).body.map((t) => `${t.id}:${t.label}`);
  const give = async (id, type) => request(app()).patch(`/api/locations/${id}/building-type`)
    .set('Authorization', `Bearer ${ADMIN}`).send({ building_type: type });
  const stall = async (type = null) => (await run(db, `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Stall', 0, 0, 0, 'box', ?)`, [type])).lastID;
  const typeOf = async (id) => (await get(db, 'SELECT building_type FROM locations WHERE id = ?', [id])).building_type;

  it('lists every type by the app\'s name under a built-in system', async () => {
    await setSystem('cyberpunk_red');
    expect(await listed()).toEqual(types.BUILDING_TYPES.map((t) => `${t.id}:${t.label}`));
  });

  it('lists only the types a custom system kept, by its names', async () => {
    await setSystem(HEARTH);
    const list = await listed();
    expect(list).toContain('ripperdoc:Temple');
    expect(list).toContain('corp:Guildhall');
    expect(list).toContain('bar:Bar');
    expect(list.some((t) => t.startsWith('gun_shop:'))).toBe(false);
    expect(list).toHaveLength(types.BUILDING_TYPES.length - 1);
  });

  it('will not give a building a type the game turned off, and leaves one already given alone', async () => {
    await setSystem(HEARTH);
    const fresh = await stall();
    expect((await give(fresh, 'gun_shop')).status).toBe(409);
    expect(await typeOf(fresh)).toBeNull();
    expect((await give(fresh, 'ripperdoc')).status).toBe(200);
    const old = await stall('gun_shop');
    // Saving the building again sends the type it already has, and its rate rides along.
    const again = await request(app()).patch(`/api/locations/${old}/building-type`)
      .set('Authorization', `Bearer ${ADMIN}`).send({ building_type: 'gun_shop', buyback_pct: 30 });
    expect(again.status).toBe(200);
    expect(await get(db, 'SELECT building_type, buyback_pct FROM locations WHERE id = ?', [old])).toEqual({ building_type: 'gun_shop', buyback_pct: 30 });
    // But another building cannot be moved onto it.
    expect((await give(fresh, 'gun_shop')).status).toBe(409);
    // Clearing it is still allowed.
    expect((await give(old, '')).status).toBe(200);
    expect(await typeOf(old)).toBeNull();
  });
});

describe('the checkout', () => {
  let nextSocket = 0;
  const checkout = async (system, buildingType) => {
    await setSystem(system);
    const { lastID } = await run(db, `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Shop', 0, 0, 0, 'box', ?)`, [buildingType]);
    const sent = [];
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `bt-sock-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
    handlers.identify('GHOST');
    await drain(db);
    // An empty basket: whatever comes back is about the shop, not about what was in it.
    handlers.checkoutShop({ locationId: lastID, buys: [] });
    await drain(db);
    return sent.find((e) => e.event === 'shopCheckout').data.reason;
  };

  it('is no shop where the game turned the building\'s type off, until it is turned back on', async () => {
    expect(await checkout(HEARTH, 'gun_shop')).toBe('no_shop');
    await republish(hearth(true));
    expect(await checkout(HEARTH, 'gun_shop')).not.toBe('no_shop');
  });

  it('sells nothing from a catalogue the game turned off', async () => {
    // The armorer sells armor and armor mods; Hearth turned armor off, so the mods remain.
    expect(await checkout(HEARTH, 'armorer')).not.toBe('not_sold');
    await republish({ ...hearth(), buildings: { ...hearth().buildings, catalogues: { armor: { on: false }, armor_mods: { on: false } } } });
    expect(await checkout(HEARTH, 'armorer')).toBe('not_sold');
  });

  it('is as before under the built-in systems', async () => {
    for (const system of BUILT_INS) expect(await checkout(system, 'gun_shop'), system).not.toMatch(/^no_shop|^not_sold$/);
  });
});
