/**
 * The game's own shops on FEATURES, at the server (8a7b3b): how many buildings each is in its game, for what DELETE says;
 * and a game published without one, its buildings let go of it, each its shared type again, so one made later with the
 * same name starts with none.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, all, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const require_ = createRequire(import.meta.url);
const { countsIn, dropGone, setShop } = require_('../shops/locationShops');
const systemsRoute = require_('../routes/systems.js');
const runtime = require_('../systemBuilder/runtime');

const ID = 'sys_feed0feed0feed0f';
const OTHER = 'sys_0dd00dd00dd00dd0';
const herbal = (shops) => ({ format: 1, name: 'Herbal', core: { health: { model: 'pool' } }, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }], buildings: { shops } });
const cb = (fn) => new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))));

let db;
let emitted;
let app;
const building = async () => (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('B', 0, 0, 0, 'box')")).lastID;

beforeEach(async () => {
  db = await makeTestDb();
  emitted = [];
  app = express();
  app.use(express.json());
  app.use('/api/systems', systemsRoute(db, { emit: (event, data) => emitted.push({ event, data }) }));
});

describe('how many buildings each is', () => {
  it('per shop, in its game alone, only buildings that exist', async () => {
    const [a, b, c] = [await building(), await building(), await building()];
    await cb((done) => setShop(db, a, ID, 'apothecary', done));
    await cb((done) => setShop(db, b, ID, 'apothecary', done));
    await cb((done) => setShop(db, c, ID, 'fence', done));
    await cb((done) => setShop(db, a, OTHER, 'apothecary', done));
    await cb((done) => setShop(db, 999, ID, 'fence', done));
    expect(await cb((done) => countsIn(db, ID, done))).toEqual({ apothecary: 2, fence: 1 });
    expect(await cb((done) => countsIn(db, 'sys_0000000000000000', done))).toEqual({});
  });

  it('asked of the route by the GM; a system that isn\'t there, not found', async () => {
    const text = JSON.stringify(herbal([{ id: 'apothecary', name: 'Apothecary' }]));
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Herbal', text, text]);
    const shop = await building();
    await cb((done) => setShop(db, shop, ID, 'apothecary', done));
    const res = await request(app).get(`/api/systems/${ID}/shop-buildings`).set('Authorization', `Bearer ${GM}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ counts: { apothecary: 1 } });
    expect((await request(app).get('/api/systems/sys_nonenonenonenonen/shop-buildings').set('Authorization', `Bearer ${GM}`)).status).toBe(404);
    expect((await request(app).get(`/api/systems/${ID}/shop-buildings`)).status).toBe(401);
  });
});

describe('published without one', () => {
  it('its buildings let go of it in that game; the others, and other games, kept', async () => {
    const [a, b] = [await building(), await building()];
    await cb((done) => setShop(db, a, ID, 'apothecary', done));
    await cb((done) => setShop(db, b, ID, 'fence', done));
    await cb((done) => setShop(db, a, OTHER, 'apothecary', done));
    expect(await cb((done) => dropGone(db, ID, ['fence'], done))).toBe(1);
    expect(await all(db, 'SELECT location_id, system, shop FROM location_shops ORDER BY location_id DESC')).toEqual([
      { location_id: b, system: ID, shop: 'fence' }, { location_id: a, system: OTHER, shop: 'apothecary' },
    ]);
    expect(await cb((done) => dropGone(db, ID, [], done))).toBe(1);
    expect(await all(db, 'SELECT system FROM location_shops')).toEqual([{ system: OTHER }]);
  });

  it('by PUBLISH, every screen told when any building let go', async () => {
    const before = JSON.stringify(herbal([{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence' }]));
    const after = JSON.stringify(herbal([{ id: 'fence', name: 'Fence' }]));
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Herbal', after, before]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const a = await building();
    await cb((done) => setShop(db, a, ID, 'apothecary', done));
    const res = await request(app).post(`/api/systems/${ID}/publish`).set('Authorization', `Bearer ${GM}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await all(db, 'SELECT * FROM location_shops')).toEqual([]);
    expect(emitted).toContainEqual({ event: 'dataUpdated', data: { isRhombusOnly: true } });
    // Published again with nothing to let go: no redraw asked for that.
    emitted.length = 0;
    await request(app).post(`/api/systems/${ID}/publish`).set('Authorization', `Bearer ${GM}`).send({});
    expect(emitted.some((e) => e.event === 'dataUpdated')).toBe(false);
  });
});
