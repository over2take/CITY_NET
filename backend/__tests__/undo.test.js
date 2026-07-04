import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import adminRouteFactory from '../routes/admin.js';

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  const emitUpdate = () => {};
  const recordAction = (type, payload, cb) => {
    db.run(
      'INSERT INTO action_history (type, payload) VALUES (?, ?)',
      [type, JSON.stringify(payload)],
      cb || (() => {})
    );
  };
  app.use('/api/admin', adminRouteFactory(db, io, { emitUpdate, recordAction }));
  return app;
};

const seedHistory = (db, type, payload) =>
  run(db, 'INSERT INTO action_history (type, payload) VALUES (?, ?)', [type, JSON.stringify(payload)]);

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── POST /api/admin/undo ────────────────────────────────────────────────────

describe('POST /api/admin/undo — auth', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/admin/undo');
    expect(res.status).toBe(401);
  });

  it('returns 400 when history is empty', async () => {
    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no history/i);
  });
});

describe('POST /api/admin/undo — location_create', () => {
  it('deletes the created locations and removes the history entry', async () => {
    const r1 = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('A', 0, 0, 0)`);
    const r2 = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('B', 1, 0, 1)`);
    await seedHistory(db, 'location_create', { ids: [r1.lastID, r2.lastID] });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('location_create');

    const remaining = await all(db, 'SELECT * FROM locations');
    expect(remaining).toHaveLength(0);

    const history = await all(db, 'SELECT * FROM action_history');
    expect(history).toHaveLength(0);
  });
});

describe('POST /api/admin/undo — location_delete', () => {
  it('restores the deleted locations', async () => {
    const loc = { id: 99, name: 'Restored', description: null, npcs: null, x: 5, y: 0, z: 5, width: 1, height: 1, depth: 1, shape: 'box', color: '#fff', district_name: null, district_color: null, parent_id: null, isFavorite: 0, isDanger: 0, owner: null, rotation: 0, rotation_x: 0, rotation_z: 0, classification: null, polyCount: 5, map_scale_multiplier: 5 };
    await seedHistory(db, 'location_delete', { data: [loc] });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const row = await get(db, 'SELECT * FROM locations WHERE id = 99');
    expect(row).toBeTruthy();
    expect(row.name).toBe('Restored');
  });
});

describe('POST /api/admin/undo — location_update', () => {
  it('rolls back a field change to its previous value', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, color) VALUES ('Old', 0, 0, 0, '#000')`);
    const id = r.lastID;
    await run(db, `UPDATE locations SET name='New', color='#fff' WHERE id=?`, [id]);
    await seedHistory(db, 'location_update', {
      id,
      old_data: { name: 'Old', description: null, npcs: null, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, shape: 'box', color: '#000', district_name: null, district_color: null, parent_id: null, isFavorite: 0, isDanger: 0, owner: null, rotation: 0, rotation_x: 0, rotation_z: 0, classification: null, polyCount: 5, map_scale_multiplier: 5 },
    });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const row = await get(db, 'SELECT name, color FROM locations WHERE id=?', [id]);
    expect(row.name).toBe('Old');
    expect(row.color).toBe('#000');
  });
});

describe('POST /api/admin/undo — road_create', () => {
  it('deletes the created road segments', async () => {
    const r1 = await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0,0,10,0,4)`);
    const r2 = await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (10,0,20,0,4)`);
    await seedHistory(db, 'road_create', { ids: [r1.lastID, r2.lastID] });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('road_create');
    const roads = await all(db, 'SELECT * FROM roads');
    expect(roads).toHaveLength(0);
  });
});

describe('POST /api/admin/undo — road_delete_all', () => {
  it('restores all previously purged roads', async () => {
    const roads = [
      { id: 10, x1: 0, z1: 0, x2: 5, z2: 0, width: 4 },
      { id: 11, x1: 5, z1: 0, x2: 10, z2: 0, width: 4 },
    ];
    await seedHistory(db, 'road_delete_all', { data: roads });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const restored = await all(db, 'SELECT * FROM roads ORDER BY id');
    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe(10);
    expect(restored[1].id).toBe(11);
  });
});

describe('POST /api/admin/undo — water_create', () => {
  it('deletes the created water body', async () => {
    const r = await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[{"x":0,"z":0}]')`);
    await seedHistory(db, 'water_create', { ids: [r.lastID] });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('water_create');
    const bodies = await all(db, 'SELECT * FROM water_bodies');
    expect(bodies).toHaveLength(0);
  });
});

describe('POST /api/admin/undo — unknown type', () => {
  it('returns 400 for an unrecognised action type', async () => {
    await seedHistory(db, 'alien_create', { ids: [1] });

    const res = await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown action/i);
  });
});

describe('POST /api/admin/undo — only most-recent entry is undone', () => {
  it('undoes only the latest action and leaves the earlier one intact', async () => {
    const r1 = await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0,0,10,0,4)`);
    const r2 = await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (10,0,20,0,4)`);
    // Give the first entry an older timestamp so ORDER BY timestamp DESC reliably picks the second
    await run(db, `INSERT INTO action_history (type, payload, timestamp) VALUES (?, ?, datetime('now', '-10 seconds'))`,
      ['road_create', JSON.stringify({ ids: [r1.lastID] })]);
    await seedHistory(db, 'road_create', { ids: [r2.lastID] });

    await request(app)
      .post('/api/admin/undo')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const roads = await all(db, 'SELECT * FROM roads');
    expect(roads).toHaveLength(1);
    expect(roads[0].id).toBe(r1.lastID);

    const history = await all(db, 'SELECT * FROM action_history');
    expect(history).toHaveLength(1);
  });
});
