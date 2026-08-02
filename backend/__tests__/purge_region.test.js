import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, all, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

/**
 * Clearing a generated city from a region so it can be generated afresh.
 *
 * Generating over an occupied area otherwise infills around what is there. The rule
 * that matters is what survives: anything a GM named is kept, because losing
 * hand-placed work is the one outcome generating again cannot undo.
 */

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

let recorded;

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  recorded = [];
  app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, {
    emitUpdate: () => {},
    recordAction: (type, payload) => recorded.push({ type, payload }),
  }));
  return app;
};

/** The 100x100 square the tests clear. */
const REGION = { bounds: { min: { x: -50, z: -50 }, max: { x: 50, z: 50 } } };

const addLocation = (db, { name = 'CORPO', x = 0, z = 0, shape = 'box', parent_id = null, battle_map_id = null } = {}) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, parent_id, battle_map_id) VALUES (?, ?, 0, ?, ?, ?, ?)`,
    [name, x, z, shape, parent_id, battle_map_id]);

const addRoad = (db, x1, z1, x2, z2) =>
  run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, 4)`, [x1, z1, x2, z2]);

const purge = (app, body = REGION) =>
  request(app).post('/api/locations/purge-region')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send(body);

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

describe('POST /api/locations/purge-region', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/locations/purge-region').send(REGION);
    expect(res.status).toBe(401);
  });

  it('rejects a request with no region', async () => {
    const res = await purge(app, {});
    expect(res.status).toBe(400);
  });

  it('removes generated structures inside the region', async () => {
    await addLocation(db, { name: 'CORPO', x: 10, z: 10 });
    await addLocation(db, { name: 'SLUMS', x: -20, z: 5 });

    const res = await purge(app);
    expect(res.status).toBe(200);
    expect(res.body.locations).toBe(2);
    expect(await all(db, 'SELECT * FROM locations')).toHaveLength(0);
  });

  it('leaves generated structures outside the region alone', async () => {
    await addLocation(db, { name: 'CORPO', x: 500, z: 500 });
    await purge(app);
    expect(await all(db, 'SELECT * FROM locations')).toHaveLength(1);
  });

  it('keeps anything the GM named, and says how many', async () => {
    // The rule that matters: hand-placed work survives regenerating.
    await addLocation(db, { name: 'CORPO', x: 5, z: 5 });
    await addLocation(db, { name: "AFTERLIFE", x: 6, z: 6 });
    await addLocation(db, { name: 'Watson Clinic', x: 7, z: 7 });

    const res = await purge(app);
    expect(res.body.locations).toBe(1);
    expect(res.body.keptNamed).toBe(2);

    const left = await all(db, 'SELECT name FROM locations');
    expect(left.map(r => r.name).sort()).toEqual(['AFTERLIFE', 'Watson Clinic']);
  });

  it('never touches player, enemy or friendly tokens', async () => {
    for (const shape of ['rhombus', 'enemy_rhombus', 'friendly_rhombus']) {
      await addLocation(db, { name: '', x: 1, z: 1, shape });
    }
    await purge(app);
    expect(await all(db, 'SELECT * FROM locations')).toHaveLength(3);
  });

  it('leaves battle map content alone', async () => {
    await addLocation(db, { name: 'CORPO', x: 1, z: 1, battle_map_id: 4 });
    await purge(app);
    expect(await all(db, 'SELECT * FROM locations')).toHaveLength(1);
  });

  it('takes the parts of a structure it removes, even ones outside the region', async () => {
    // A root's parts sit at their own coordinates, so a child can fall outside while
    // its root is inside. Leaving it behind orphans it.
    const root = await addLocation(db, { name: 'CORPO', x: 0, z: 0 });
    await addLocation(db, { name: 'CORPO', x: 400, z: 400, parent_id: root.lastID });

    await purge(app);
    expect(await all(db, 'SELECT * FROM locations')).toHaveLength(0);
  });

  it('removes roads running through the region', async () => {
    await addRoad(db, -10, 0, 10, 0);
    await addRoad(db, 900, 900, 950, 950);

    const res = await purge(app);
    expect(res.body.roads).toBe(1);
    expect(await all(db, 'SELECT * FROM roads')).toHaveLength(1);
  });

  it('never touches hand-drawn water or signs', async () => {
    // A lake the GM drew is hand-placed work and survives exactly as a named
    // structure does.
    await run(db, `INSERT INTO water_bodies (points_json, generated) VALUES (?, 0)`,
      [JSON.stringify([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }])]);
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('DOCKS', 5, 0, 5)`);

    await purge(app);
    expect(await all(db, 'SELECT * FROM water_bodies')).toHaveLength(1);
    expect(await all(db, 'SELECT * FROM signs')).toHaveLength(1);
  });

  it('clears water the generator made', async () => {
    await run(db, `INSERT INTO water_bodies (points_json, generated) VALUES (?, 1)`,
      [JSON.stringify([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }])]);

    const res = await purge(app);
    expect(res.body.water).toBe(1);
    expect(await all(db, 'SELECT * FROM water_bodies')).toHaveLength(0);
  });

  it('leaves generated water outside the region alone', async () => {
    await run(db, `INSERT INTO water_bodies (points_json, generated) VALUES (?, 1)`,
      [JSON.stringify([{ x: 900, z: 900 }, { x: 950, z: 900 }, { x: 950, z: 950 }])]);

    const res = await purge(app);
    expect(res.body.water).toBe(0);
    expect(await all(db, 'SELECT * FROM water_bodies')).toHaveLength(1);
  });

  it('clears exactly the drawn shape, not its bounding box', async () => {
    // An L: the notch must survive, or a drawn boundary means nothing.
    const polygon = [
      { x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 40 },
      { x: 40, z: 40 }, { x: 40, z: 100 }, { x: 0, z: 100 },
    ];
    await addLocation(db, { name: 'CORPO', x: 20, z: 20 });   // inside the L
    await addLocation(db, { name: 'CORPO', x: 70, z: 70 });   // in the notch

    const res = await purge(app, { polygon });
    expect(res.body.locations).toBe(1);

    const left = await all(db, 'SELECT x, z FROM locations');
    expect(left).toHaveLength(1);
    expect(left[0].x).toBe(70);
  });

  it('succeeds on an empty region', async () => {
    const res = await purge(app);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ locations: 0, roads: 0, keptNamed: 0 });
  });

  it('records what it removed, so it can be undone', async () => {
    await addLocation(db, { name: 'CORPO', x: 1, z: 1 });
    await purge(app);
    expect(recorded.map(r => r.type)).toContain('region_purge');
    expect(recorded[0].payload.locations).toHaveLength(1);
  });
});
