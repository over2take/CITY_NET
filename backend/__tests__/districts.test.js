import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';
import adminRouteFactory from '../routes/admin.js';

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);
const auth = (r) => r.set('Authorization', `Bearer ${ADMIN_TOKEN}`);

/**
 * Assigning buildings to districts.
 *
 * The old flow was one endpoint that cleared the whole district and re-inserted whatever
 * the client posted, so the posted list WAS the district: a stale or mis-dragged selection
 * unassigned buildings silently, with nothing to undo from. These cover the replacement -
 * additive assign, explicit unassign, and a recolor that reaches the buildings.
 *
 * The color is denormalized onto every building (`locations.district_color`), which is why
 * recoloring has to cascade and why assign reads the color from the districts table
 * rather than trusting the request: two copies that can disagree is the whole hazard.
 */

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  const helpers = { emitUpdate: () => {}, recordAction: () => {} };
  app.use('/api/locations', locationsRouteFactory(db, io, helpers));
  app.use('/api', adminRouteFactory(db, io, helpers));
});

const seedDistrict = (name, color) =>
  run(db, `INSERT INTO districts (name, color) VALUES (?, ?)`, [name, color]);

const seedBuilding = async (name, district = null, color = null) => {
  const r = await run(db,
    `INSERT INTO locations (name, x, y, z, shape, district_name, district_color) VALUES (?, 0, 0, 0, 'box', ?, ?)`,
    [name, district, color]);
  return r.lastID;
};

const districtOf = (id) => get(db, `SELECT district_name, district_color FROM locations WHERE id = ?`, [id]);

describe('POST /api/locations/assign-district', () => {
  it('files the posted buildings under the district', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    const a = await seedBuilding('A');
    const b = await seedBuilding('B');

    const res = await auth(request(app).post('/api/locations/assign-district'))
      .send({ ids: [a, b], district_name: 'DOWNTOWN' });

    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(2);
    expect(await districtOf(a)).toEqual({ district_name: 'DOWNTOWN', district_color: '#ff0000' });
    expect(await districtOf(b)).toEqual({ district_name: 'DOWNTOWN', district_color: '#ff0000' });
  });

  it('leaves buildings it was not asked about alone', async () => {
    // The whole point of the change. The old endpoint cleared the district first, so a
    // building already in it that was missing from the posted list came out of it.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const kept = await seedBuilding('KEPT', 'DOWNTOWN', '#ff0000');
    const added = await seedBuilding('ADDED');

    await auth(request(app).post('/api/locations/assign-district'))
      .send({ ids: [added], district_name: 'DOWNTOWN' });

    expect((await districtOf(kept)).district_name).toBe('DOWNTOWN');
    expect((await districtOf(added)).district_name).toBe('DOWNTOWN');
  });

  it('moves a building that is already in another district', async () => {
    // A building belongs to one district, so this is a move rather than a refusal.
    await seedDistrict('DOWNTOWN', '#ff0000');
    await seedDistrict('SLUMS', '#00ff00');
    const b = await seedBuilding('B', 'DOWNTOWN', '#ff0000');

    await auth(request(app).post('/api/locations/assign-district'))
      .send({ ids: [b], district_name: 'SLUMS' });

    expect(await districtOf(b)).toEqual({ district_name: 'SLUMS', district_color: '#00ff00' });
  });

  it('takes the color off the district, not off the request', async () => {
    // Otherwise the copy on the building can disagree with the district it names, and the
    // map draws a color no district has.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const b = await seedBuilding('B');

    await auth(request(app).post('/api/locations/assign-district'))
      .send({ ids: [b], district_name: 'DOWNTOWN', district_color: '#123456' });

    expect((await districtOf(b)).district_color).toBe('#ff0000');
  });

  it('refuses a district that does not exist', async () => {
    const b = await seedBuilding('B');
    const res = await auth(request(app).post('/api/locations/assign-district'))
      .send({ ids: [b], district_name: 'NOWHERE' });
    expect(res.status).toBe(404);
    expect((await districtOf(b)).district_name).toBeNull();
  });

  it('rejects a malformed body', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    for (const body of [{}, { ids: 'all', district_name: 'DOWNTOWN' }, { ids: [1] }]) {
      const res = await auth(request(app).post('/api/locations/assign-district')).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('does nothing for an empty selection rather than clearing the district', async () => {
    // The old endpoint read an empty list as "the district is now empty" and wiped it.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const kept = await seedBuilding('KEPT', 'DOWNTOWN', '#ff0000');

    const res = await auth(request(app).post('/api/locations/assign-district'))
      .send({ ids: [], district_name: 'DOWNTOWN' });

    expect(res.status).toBe(200);
    expect((await districtOf(kept)).district_name).toBe('DOWNTOWN');
  });

  it('needs a token', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    const b = await seedBuilding('B');
    const res = await request(app).post('/api/locations/assign-district')
      .send({ ids: [b], district_name: 'DOWNTOWN' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/locations/unassign-district', () => {
  it('takes the named buildings out, and only those', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    const out = await seedBuilding('OUT', 'DOWNTOWN', '#ff0000');
    const stays = await seedBuilding('STAYS', 'DOWNTOWN', '#ff0000');

    const res = await auth(request(app).post('/api/locations/unassign-district')).send({ ids: [out] });

    expect(res.status).toBe(200);
    expect(res.body.unassigned).toBe(1);
    expect(await districtOf(out)).toEqual({ district_name: null, district_color: null });
    expect((await districtOf(stays)).district_name).toBe('DOWNTOWN');
  });

  it('clears the color with the name', async () => {
    // Leaving the color behind would tint a building that is in no district at all.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const b = await seedBuilding('B', 'DOWNTOWN', '#ff0000');
    await auth(request(app).post('/api/locations/unassign-district')).send({ ids: [b] });
    expect((await districtOf(b)).district_color).toBeNull();
  });

  it('needs a token', async () => {
    const b = await seedBuilding('B');
    const res = await request(app).post('/api/locations/unassign-district').send({ ids: [b] });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/districts/:name', () => {
  it('recolors the district and every building in it', async () => {
    // The copy on each building is why this has to cascade, and why recoloring was not
    // possible before: the only way to change a color was delete and recreate, which
    // dropped every assignment.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const a = await seedBuilding('A', 'DOWNTOWN', '#ff0000');
    const b = await seedBuilding('B', 'DOWNTOWN', '#ff0000');
    const other = await seedBuilding('OTHER');

    const res = await auth(request(app).put('/api/districts/DOWNTOWN')).send({ color: '#0000ff' });

    expect(res.status).toBe(200);
    expect((await get(db, `SELECT color FROM districts WHERE name = 'DOWNTOWN'`)).color).toBe('#0000ff');
    expect((await districtOf(a)).district_color).toBe('#0000ff');
    expect((await districtOf(b)).district_color).toBe('#0000ff');
    expect((await districtOf(other)).district_color).toBeNull();
  });

  it('leaves another district alone', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    await seedDistrict('SLUMS', '#00ff00');
    const slum = await seedBuilding('S', 'SLUMS', '#00ff00');

    await auth(request(app).put('/api/districts/DOWNTOWN')).send({ color: '#0000ff' });

    expect((await get(db, `SELECT color FROM districts WHERE name = 'SLUMS'`)).color).toBe('#00ff00');
    expect((await districtOf(slum)).district_color).toBe('#00ff00');
  });

  it('404s for a district that does not exist', async () => {
    const res = await auth(request(app).put('/api/districts/NOWHERE')).send({ color: '#0000ff' });
    expect(res.status).toBe(404);
  });

  it('needs a color, and a token', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    expect((await auth(request(app).put('/api/districts/DOWNTOWN')).send({})).status).toBe(400);
    expect((await request(app).put('/api/districts/DOWNTOWN').send({ color: '#0000ff' })).status).toBe(401);
  });
});

describe('renaming a district', () => {
  /**
   * The name is the key every building is filed under, so a rename has to rewrite those
   * rows in step. Leaving them behind would orphan them from a district that no longer
   * answers to that name - they would vanish from the list while still carrying a color.
   */
  it('carries the buildings across with it', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    const a = await seedBuilding('A', 'DOWNTOWN', '#ff0000');
    const b = await seedBuilding('B', 'DOWNTOWN', '#ff0000');

    const res = await auth(request(app).put('/api/districts/DOWNTOWN'))
      .send({ name: 'THE CORE', color: '#ff0000' });

    expect(res.status).toBe(200);
    expect(await get(db, `SELECT name FROM districts WHERE name = 'THE CORE'`)).toBeTruthy();
    expect(await get(db, `SELECT name FROM districts WHERE name = 'DOWNTOWN'`)).toBeFalsy();
    expect((await districtOf(a)).district_name).toBe('THE CORE');
    expect((await districtOf(b)).district_name).toBe('THE CORE');
  });

  it('renames and recolors in one go', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    const a = await seedBuilding('A', 'DOWNTOWN', '#ff0000');

    await auth(request(app).put('/api/districts/DOWNTOWN')).send({ name: 'THE CORE', color: '#0000ff' });

    expect(await districtOf(a)).toEqual({ district_name: 'THE CORE', district_color: '#0000ff' });
  });

  it('leaves another district alone', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    await seedDistrict('SLUMS', '#00ff00');
    const slum = await seedBuilding('S', 'SLUMS', '#00ff00');

    await auth(request(app).put('/api/districts/DOWNTOWN')).send({ name: 'THE CORE', color: '#ff0000' });

    expect(await districtOf(slum)).toEqual({ district_name: 'SLUMS', district_color: '#00ff00' });
  });

  it('refuses a name another district already uses', async () => {
    // Allowing it would silently merge two districts, and the UNIQUE index would fail the
    // write anyway - so it says so plainly.
    await seedDistrict('DOWNTOWN', '#ff0000');
    await seedDistrict('SLUMS', '#00ff00');
    const a = await seedBuilding('A', 'DOWNTOWN', '#ff0000');

    const res = await auth(request(app).put('/api/districts/DOWNTOWN')).send({ name: 'SLUMS', color: '#ff0000' });

    expect(res.status).toBe(409);
    expect((await districtOf(a)).district_name).toBe('DOWNTOWN');
    expect(await get(db, `SELECT name FROM districts WHERE name = 'DOWNTOWN'`)).toBeTruthy();
  });

  it('lets a district keep its own name while recoloring', async () => {
    // The no-op rename must not trip the clash check against itself.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const res = await auth(request(app).put('/api/districts/DOWNTOWN')).send({ name: 'DOWNTOWN', color: '#0000ff' });
    expect(res.status).toBe(200);
    expect((await get(db, `SELECT color FROM districts WHERE name = 'DOWNTOWN'`)).color).toBe('#0000ff');
  });

  it('trims the name rather than storing the spaces', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    const a = await seedBuilding('A', 'DOWNTOWN', '#ff0000');
    await auth(request(app).put('/api/districts/DOWNTOWN')).send({ name: '  THE CORE  ', color: '#ff0000' });
    expect((await districtOf(a)).district_name).toBe('THE CORE');
  });

  it('refuses an empty name', async () => {
    await seedDistrict('DOWNTOWN', '#ff0000');
    for (const name of ['', '   ']) {
      const res = await auth(request(app).put('/api/districts/DOWNTOWN')).send({ name, color: '#ff0000' });
      expect(res.status).toBe(400);
    }
    expect(await get(db, `SELECT name FROM districts WHERE name = 'DOWNTOWN'`)).toBeTruthy();
  });

  it('still recolors when no name is sent at all', async () => {
    // Backwards compatible with a client that only knows about color.
    await seedDistrict('DOWNTOWN', '#ff0000');
    const res = await auth(request(app).put('/api/districts/DOWNTOWN')).send({ color: '#0000ff' });
    expect(res.status).toBe(200);
    expect((await get(db, `SELECT color FROM districts WHERE name = 'DOWNTOWN'`)).color).toBe('#0000ff');
  });
});
