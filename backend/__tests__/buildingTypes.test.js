/**
 * What a building is for, and the gate that keeps shops to one system.
 *
 * The gate is the part worth testing hardest. Hiding a button is a courtesy; refusing the
 * request is the rule, and the two are easy to let drift apart.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret';

const types = createRequire(import.meta.url)('../buildingTypes');

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret',
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, {
    emitUpdate: () => {},
    recordAction: () => {},
  }));
  return app;
};

/** The system gate reads global_settings, so each test says which game is running. */
const setSystem = (db, system) =>
  run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

let db;
let app;
let locId;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
  const r = await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('Clinic', 0, 0, 0, 'box')`);
  locId = r.lastID;
});

describe('the vocabulary', () => {
  it('knows which types can trade', () => {
    expect(types.isShop('ripperdoc')).toBe(true);
    expect(types.isShop('bar')).toBe(false);
  });

  it('treats an unset type as no type rather than an error', () => {
    // Every building starts here, and clearing one returns it here.
    for (const empty of ['', null, undefined]) expect(types.isValidType(empty)).toBe(true);
    expect(types.isShop('')).toBe(false);
  });

  it('refuses a type nobody has heard of', () => {
    expect(types.isValidType('speakeasy')).toBe(false);
  });

  it('gives every type a unique id and a label', () => {
    const ids = types.BUILDING_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of types.BUILDING_TYPES) expect(t.label.length).toBeGreaterThan(0);
  });

  it('only lets a shop declare stock', () => {
    // A bar with a catalogue would be a contradiction the UI would have to resolve.
    for (const t of types.BUILDING_TYPES) if (!t.shop) expect(t.sells).toBeNull();
  });
});

describe('the system gate', () => {
  it('sets a building type under Cities Without Number', async () => {
    await setSystem(db, 'cities_without_number');
    const res = await request(app)
      .patch(`/api/locations/${locId}/building-type`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ building_type: 'ripperdoc' });

    expect(res.status).toBe(200);
    expect((await get(db, 'SELECT building_type FROM locations WHERE id = ?', [locId])).building_type)
      .toBe('ripperdoc');
  });

  it('refuses under another system, rather than only hiding the control', async () => {
    await setSystem(db, 'cyberpunk_red');
    const res = await request(app)
      .patch(`/api/locations/${locId}/building-type`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ building_type: 'ripperdoc' });

    expect(res.status).toBe(409);
    expect((await get(db, 'SELECT building_type FROM locations WHERE id = ?', [locId])).building_type)
      .toBeNull();
  });

  it('will not list the types under another system either', async () => {
    await setSystem(db, 'cyberpunk_red');
    expect((await request(app).get('/api/locations/building-types')).status).toBe(409);
  });

  it('lists them under CWN', async () => {
    await setSystem(db, 'cities_without_number');
    const res = await request(app).get('/api/locations/building-types');
    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.id)).toContain('ripperdoc');
  });
});

describe('setting a type', () => {
  beforeEach(() => setSystem(db, 'cities_without_number'));

  it('refuses a type that is not on the list', async () => {
    const res = await request(app)
      .patch(`/api/locations/${locId}/building-type`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ building_type: 'speakeasy' });
    expect(res.status).toBe(400);
  });

  it('clears back to none', async () => {
    await request(app).patch(`/api/locations/${locId}/building-type`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ building_type: 'bar' });
    const res = await request(app).patch(`/api/locations/${locId}/building-type`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ building_type: '' });

    expect(res.status).toBe(200);
    expect((await get(db, 'SELECT building_type FROM locations WHERE id = ?', [locId])).building_type)
      .toBeNull();
  });

  it('needs an admin', async () => {
    const res = await request(app)
      .patch(`/api/locations/${locId}/building-type`)
      .send({ building_type: 'ripperdoc' });
    expect(res.status).toBe(401);
  });

  it('404s for a building that is not there', async () => {
    const res = await request(app)
      .patch('/api/locations/99999/building-type')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ building_type: 'ripperdoc' });
    expect(res.status).toBe(404);
  });
});
