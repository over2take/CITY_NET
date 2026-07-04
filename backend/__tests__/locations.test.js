import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/locations', locationsRouteFactory(db, io, {
    emitUpdate: () => {},
    recordAction: () => {},
  }));
  return app;
};

const loc = (overrides = {}) => ({
  name: 'TEST', x: 1, y: 0, z: 1, shape: 'box', ...overrides,
});

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── GET /api/locations ───────────────────────────────────────────────────────

describe('GET /api/locations', () => {
  it('returns empty array when no locations exist', async () => {
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all locations', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('A', 0, 0, 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('B', 1, 0, 1)`);
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── POST /api/locations ──────────────────────────────────────────────────────

describe('POST /api/locations', () => {
  it('creates a single location and returns it', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(loc());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('TEST');
  });

  it('creates multiple locations from an array', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([loc({ name: 'A' }), loc({ name: 'B' })]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 500 when coordinates are missing', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'MISSING_COORDS' });
    expect(res.status).toBe(500);
  });

  it('unauthenticated users can create rhombuses', async () => {
    const res = await request(app)
      .post('/api/locations')
      .send(loc({ shape: 'rhombus', owner: 'player1' }));
    expect(res.status).toBe(200);
    expect(res.body.data[0].shape).toBe('rhombus');
  });

  it('unauthenticated users cannot create non-rhombus locations', async () => {
    const res = await request(app)
      .post('/api/locations')
      .send(loc({ shape: 'box' }));
    expect(res.status).toBe(401);
  });

  it('defaults width/height/depth to 1 when omitted', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(loc());
    const row = await get(db, 'SELECT * FROM locations LIMIT 1');
    expect(row.width).toBe(1);
    expect(row.height).toBe(1);
    expect(row.depth).toBe(1);
  });

  it('persists optional fields correctly', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(loc({ description: 'A corp tower', color: '#ff0000', isFavorite: true, isDanger: true }));
    const row = await get(db, 'SELECT * FROM locations LIMIT 1');
    expect(row.description).toBe('A corp tower');
    expect(row.color).toBe('#ff0000');
    expect(row.isFavorite).toBe(1);
    expect(row.isDanger).toBe(1);
  });
});

// ─── PUT /api/locations/:id ───────────────────────────────────────────────────

describe('PUT /api/locations/:id', () => {
  it('returns 400 when required fields are missing', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('OLD', 0, 0, 0)`);
    const res = await request(app)
      .put(`/api/locations/${r.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ description: 'no name or coords' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/locations/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(loc({ name: 'X' }));
    expect(res.status).toBe(404);
  });

  it('updates an existing location', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('OLD', 0, 0, 0)`);
    await request(app)
      .put(`/api/locations/${r.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(loc({ name: 'NEW', x: 5, y: 0, z: 5 }));
    const row = await get(db, `SELECT name, x FROM locations WHERE id = ?`, [r.lastID]);
    expect(row.name).toBe('NEW');
    expect(row.x).toBe(5);
  });

  it('unauthenticated users can update rhombuses', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('GHOST', 0, 0, 0, 'rhombus')`);
    const res = await request(app)
      .put(`/api/locations/${r.lastID}`)
      .send(loc({ name: 'GHOST', shape: 'rhombus', x: 3, y: 0, z: 3 }));
    expect(res.status).toBe(200);
  });

  it('unauthenticated users cannot update non-rhombus locations', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('CORP', 0, 0, 0, 'box')`);
    const res = await request(app)
      .put(`/api/locations/${r.lastID}`)
      .send(loc({ name: 'CORP', shape: 'box' }));
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/locations/:id ────────────────────────────────────────────────

describe('DELETE /api/locations/:id', () => {
  it('returns 401 without a token', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('A', 0, 0, 0)`);
    const res = await request(app).delete(`/api/locations/${r.lastID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/locations/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('deletes a location by id', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('GONE', 0, 0, 0)`);
    const res = await request(app)
      .delete(`/api/locations/${r.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT * FROM locations WHERE id = ?`, [r.lastID]);
    expect(row).toBeUndefined();
  });
});

// ─── POST /api/locations/batch-delete ────────────────────────────────────────

describe('POST /api/locations/batch-delete', () => {
  it('returns 400 for empty ids array', async () => {
    const res = await request(app)
      .post('/api/locations/batch-delete')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('deletes multiple locations by id', async () => {
    const r1 = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('A', 0, 0, 0)`);
    const r2 = await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('B', 1, 0, 1)`);
    const res = await request(app)
      .post('/api/locations/batch-delete')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ids: [r1.lastID, r2.lastID] });
    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM locations');
    expect(rows).toHaveLength(0);
  });
});

// ─── PUT /api/locations/:id/health ───────────────────────────────────────────

describe('PUT /api/locations/:id/health', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/locations/9999/health')
      .send({ hp_current: 10, hp_max: 20, hp_temp: 0 });
    expect(res.status).toBe(404);
  });

  it('sets hp values directly', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('FIGHTER', 0, 0, 0, 'rhombus')`);
    const res = await request(app)
      .put(`/api/locations/${r.lastID}/health`)
      .send({ hp_current: 15, hp_max: 20, hp_temp: 5 });
    expect(res.status).toBe(200);
    expect(res.body.hp_current).toBe(15);
    expect(res.body.hp_max).toBe(20);
    expect(res.body.hp_temp).toBe(5);
  });

  it('damage action reduces hp_current, absorbing temp hp first', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, shape, hp_current, hp_max, hp_temp) VALUES ('TANK', 0, 0, 0, 'rhombus', 20, 20, 5)`);
    await request(app)
      .put(`/api/locations/${r.lastID}/health`)
      .send({ action: 'damage', amount: 8 });
    const row = await get(db, `SELECT hp_current, hp_temp FROM locations WHERE id = ?`, [r.lastID]);
    expect(row.hp_temp).toBe(0);
    expect(row.hp_current).toBe(17); // 5 temp absorbs first, 3 bleeds to current
  });

  it('heal action increases hp_current capped at hp_max', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, shape, hp_current, hp_max, hp_temp) VALUES ('MEDIC', 0, 0, 0, 'rhombus', 10, 20, 0)`);
    await request(app)
      .put(`/api/locations/${r.lastID}/health`)
      .send({ action: 'heal', amount: 100 });
    const row = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [r.lastID]);
    expect(row.hp_current).toBe(20);
  });

  it('hp_current cannot exceed hp_max', async () => {
    const r = await run(db, `INSERT INTO locations (name, x, y, z, shape, hp_current, hp_max, hp_temp) VALUES ('OVER', 0, 0, 0, 'rhombus', 20, 20, 0)`);
    await request(app)
      .put(`/api/locations/${r.lastID}/health`)
      .send({ hp_current: 999, hp_max: 20 });
    const row = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [r.lastID]);
    expect(row.hp_current).toBe(20);
  });
});
